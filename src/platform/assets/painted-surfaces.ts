import {CanvasTexture} from 'three';
import type {Texture, Material} from 'three';
import type {Quality} from '../render/quality';
import type {Lease} from './lease-cache';

interface Entry {
  value: object;
  canvases: readonly HTMLCanvasElement[];
  refs: number;
  bytes: number;
  dispose?: (() => void) | undefined;
}

/** CPU paintings and optional immutable texture groups shared through explicit leases.
 * Callers either own private GPU wrappers or lease the shared group through a material.
 * Static paintings need no repaint scheduler. Zero warm retention deliberately evicts
 * every unleased painting; live Reference paintings are never resized under pressure.
 */
export class PaintedSurfaces {
  private readonly entries = new Map<string, Entry>();
  private nextCanvas = 0;
  private repaintHz = 30;
  private scheduled = 0;
  private repaints = 0;
  private budgetBytes = 256 * 1024 * 1024;

  /** Total CPU canvas target, not a cap on live content. All unleased paintings
   * are evicted immediately, stricter than a warm LRU. Overcommit is explicit. */
  setBudgetBytes(bytes: number): void {
    if (!Number.isFinite(bytes) || bytes < 0) throw new RangeError('invalid painted residency budget');
    this.budgetBytes = bytes;
  }

  bindQuality(quality: Pick<Quality, 'preset' | 'knob' | 'subscribe'>, signal: AbortSignal): void {
    if (signal.aborted) return;
    const update = () => {
      this.setBudgetBytes(quality.knob('textures.canvas-budget-mib') * 1024 * 1024);
      this.repaintHz = {reference: 30, high: 12, medium: 4, low: 2}[quality.preset];
    };
    update();
    quality.subscribe(update, signal);
  }

  /** Private dynamic canvases have declared dimensions, never a shared mutable key. */
  createCanvas(name: string, width: number, height: number): Lease<HTMLCanvasElement> {
    return this.acquire(
      `dynamic:${name}:${++this.nextCanvas}`,
      () => {
        const c = document.createElement('canvas');
        c.width = width;
        c.height = height;
        return c;
      },
      c => [c],
    );
  }

  /** Driven by the owning activity's frame loop: no timer survives coverage/leave.
   * maxHz retains an existing authored cadence below the preset ceiling. Initial
   * paint stays with the builder so the first presented frame is complete. */
  schedule(lease: Lease<HTMLCanvasElement>, options: {visible(): boolean; paint(): void; maxHz: number}) {
    let elapsed = 0,
      released = false;
    this.scheduled++;
    return {
      ...lease,
      update: (dt: number) => {
        if (released || !Number.isFinite(dt) || dt <= 0) return;
        elapsed += dt;
        const interval = 1 / Math.min(options.maxHz, this.repaintHz);
        if (elapsed + 1e-9 < interval) return;
        // Do not consume visibility evidence until due. Hidden surfaces never paint.
        const visible = options.visible();
        elapsed = Math.max(0, elapsed - Math.floor((elapsed + 1e-9) / interval) * interval);
        if (visible) {
          options.paint();
          this.repaints++;
        }
      },
      release: () => {
        if (released) return;
        released = true;
        this.scheduled--;
        lease.release();
      },
    };
  }

  acquire<T extends object>(
    key: string,
    create: () => T,
    canvases: (value: T) => readonly HTMLCanvasElement[],
    dispose?: (value: T) => void,
  ): Lease<T> {
    let entry = this.entries.get(key);
    if (!entry) {
      const value = create();
      const images = [...new Set(canvases(value))];
      entry = {
        value,
        canvases: images,
        refs: 0,
        dispose: dispose ? () => dispose(value) : undefined,
        bytes: images.reduce((n, c) => n + c.width * c.height * 4, 0),
      };
      this.entries.set(key, entry);
    }
    const held = entry;
    held.refs++;
    let released = false;
    return {
      key,
      value: held.value as T,
      release: () => {
        if (released) return;
        released = true;
        if (--held.refs) return;
        this.entries.delete(key);
        try {
          held.dispose?.();
        } finally {
          // Release backing stores even if a disposed scene/texture is still reachable.
          for (const canvas of held.canvases) canvas.width = canvas.height = 0;
        }
      },
    };
  }

  snapshot() {
    const entries = [...this.entries].map(([key, e]) => ({
      key,
      leases: e.refs,
      canvases: e.canvases.length,
      bytes: e.bytes,
    }));
    const residentBytes = entries.reduce((n, e) => n + e.bytes, 0);
    return {
      entries,
      repaintHz: this.repaintHz,
      scheduledSurfaces: this.scheduled,
      repaints: this.repaints,
      residentBytes,
      liveBytes: residentBytes,
      unleasedBytes: 0,
      budgetBytes: this.budgetBytes,
      overBudgetBytes: Math.max(0, residentBytes - this.budgetBytes),
      residentCanvases: entries.reduce((n, e) => n + e.canvases, 0),
    };
  }
}

export const paintedSurfaces = new PaintedSurfaces();

declare module '../../core/probe' {
  interface EngineProbes {
    'assets.painted': ReturnType<PaintedSurfaces['snapshot']>;
  }
}

/** Bridge existing visit-owned texture teardown to the CPU lease. Wait for every
 * texture in a group (including non-colour maps); repeated dispose is harmless.
 * Context loss does not dispose these textures, so restore keeps its source pixels.
 */
export function releasePaintingWithTextures(lease: Lease<object>, textures: readonly Texture[]): void {
  const pending = new Set(textures);
  if (!pending.size) {
    lease.release();
    return;
  }
  for (const texture of pending) {
    const release = () => {
      texture.removeEventListener('dispose', release);
      pending.delete(texture);
      if (!pending.size) lease.release();
    };
    texture.addEventListener('dispose', release);
  }
}

/** Shared textures must be released by the private material owner, never by a
 * texture dispose event (renderer cleanup may dispatch that event to re-upload).
 * Shader uniforms are included because tree movers cannot discover them. */
type MaterialBinding = {move(to: Material): void; copy(to: Material): void};
const materialBindings = new WeakMap<Material, Set<MaterialBinding>>();
export const hasPaintingMaterialLease = (material: Material): boolean => !!materialBindings.get(material)?.size;

export function releasePaintingWithMaterial(lease: Lease<object>, material: Material): void {
  bindPaintingMaterial({lease, refs: 1}, material);
}
function bindPaintingMaterial(held: {lease: Lease<object>; refs: number}, material: Material): void {
  let owner = material;
  const detach = () => {
    owner.removeEventListener('dispose', release);
    materialBindings.get(owner)?.delete(binding);
  };
  const attach = () => {
    let held = materialBindings.get(owner);
    if (!held) materialBindings.set(owner, (held = new Set()));
    held.add(binding);
    owner.addEventListener('dispose', release);
  };
  const release = () => {
    detach();
    if (--held.refs === 0) held.lease.release();
  };
  const binding: MaterialBinding = {
    move(to) {
      detach();
      owner = to;
      attach();
    },
    copy(to) {
      held.refs++;
      bindPaintingMaterial(held, to);
    },
  };
  attach();
}

/** Only for an explicitly consumed private material: transfer before discarding
 * it during cloning/batching. Never transfer from a material still used elsewhere. */
export function transferPaintingMaterial(from: Material, to: Material): void {
  if (from === to) return;
  for (const binding of [...(materialBindings.get(from) ?? [])]) binding.move(to);
}

/** A borrowed clone needs its own ownership, including shader-uniform paintings.
 * The source stays live until its owner explicitly retires it. */
export function retainPaintingMaterial(from: Material, to: Material): void {
  if (from === to) return;
  for (const binding of [...(materialBindings.get(from) ?? [])]) binding.copy(to);
}

/** A visit-owned GPU wrapper over an immutable recipe shared by live visits. */
export function paintedCanvasTexture(key: string, paint: () => HTMLCanvasElement): CanvasTexture {
  const lease = paintedSurfaces.acquire(key, paint, canvas => [canvas]);
  const texture = new CanvasTexture(lease.value);
  releasePaintingWithTextures(lease, [texture]);
  return texture;
}
