import * as T from 'three';
import type {leaseCube, CubeSpec} from '../platform/assets/cube';
import type {TextureLibrary} from '../platform/assets/textures';
import {isAbortError, type Lease} from '../platform/assets/lease-cache';

export type CubeLoader = () => Promise<{leaseCube: typeof leaseCube}>;
const loadCube: CubeLoader = () => import('../platform/assets/cube');

/** Background and reflection are independent bindings with generation-safe replacement. */
export function bindSceneCubes(
  scene: T.Scene,
  library: TextureLibrary,
  signal: AbortSignal,
  invalidate: () => void,
  report: (error: unknown) => void,
  load: CubeLoader = loadCube,
) {
  type Slot = {key: string; life?: AbortController; lease?: Lease<T.CubeTexture>; pending?: Promise<void>};
  const slots: {background: Slot; environment: Slot} = {background: {key: ''}, environment: {key: ''}};
  const original = {background: scene.background, environment: scene.environment};
  let closed = false;

  const safeReport = (error: unknown) => {
    try {
      report(error);
    } catch {
      /* Never create an unhandled rejection from a diagnostic. */
    }
  };
  const release = (lease: Lease<T.CubeTexture> | undefined, errors?: unknown[]) => {
    try {
      lease?.release();
    } catch (error) {
      if (errors) errors.push(error);
      else safeReport(error);
    }
  };

  function replace(name: keyof typeof slots, slot: Slot, spec: CubeSpec): void {
    // Snapshot authored values before the optional module boundary; callers may mutate their row later.
    // Runtime callers can still supply malformed rows: retain the previous binding and report safely.
    let request: CubeSpec;
    try {
      request = {faces: [...spec.faces], screenPx: spec.screenPx};
    } catch (error) {
      safeReport(error);
      return;
    }
    const life = (slot.life = new AbortController());
    const live = () => !closed && !life.signal.aborted && slot.life === life;
    // One old plus one replacement, each capped at 16 MiB; two independent bindings cap at 64 MiB.
    slot.pending = Promise.resolve()
      .then(async () => {
        if (!live()) return;
        const module = await load();
        if (!live()) return;
        return module.leaseCube(library, request, life.signal, 16 * 1024 * 1024, safeReport);
      })
      .then(
        lease => {
          if (!lease) return;
          if (!live()) {
            release(lease);
            return;
          }
          const old = slot.lease;
          slot.lease = lease;
          slot.life = undefined;
          scene[name] = lease.value;
          release(old);
          invalidate();
        },
        error => {
          if (!closed && !life.signal.aborted && !isAbortError(error)) safeReport(error);
        },
      )
      .catch(safeReport);
  }

  function syncSlot(name: keyof typeof slots, spec: CubeSpec | undefined): boolean {
    const slot = slots[name],
      key = spec ? JSON.stringify(spec) : '';
    let changed = false;
    if (key !== slot.key) {
      slot.key = key;
      slot.life?.abort();
      slot.life = undefined;
      if (!spec) {
        if (scene[name] === slot.lease?.value) scene[name] = original[name] as T.CubeTexture | null;
        const old = slot.lease;
        slot.lease = undefined;
        release(old);
        changed = true;
      } else replace(name, slot, spec);
    }
    if (slot.lease && scene[name] !== slot.lease.value) {
      scene[name] = slot.lease.value;
      changed = true;
    }
    return changed;
  }

  const owner = {
    sync(background?: CubeSpec, reflection?: CubeSpec, fallback?: number) {
      if (closed) return false;
      const clearing = !!slots.background.key && !background;
      const a = syncSlot('background', background),
        b = syncSlot('environment', reflection);
      if (clearing && fallback !== undefined) scene.background = new T.Color(fallback);
      return a || b;
    },
    dispose() {
      if (closed) return;
      closed = true;
      signal.removeEventListener('abort', abort);
      const errors: unknown[] = [];
      for (const name of ['background', 'environment'] as const) {
        const slot = slots[name];
        slot.life?.abort();
        if (scene[name] === slot.lease?.value) scene[name] = original[name] as T.CubeTexture | null;
        const old = slot.lease;
        slot.lease = undefined;
        release(old, errors);
      }
      if (errors.length) safeReport(new AggregateError(errors, 'scene cube cleanup failed'));
    },
  };
  const abort = () => owner.dispose();
  signal.addEventListener('abort', abort, {once: true});
  if (signal.aborted) owner.dispose();
  return owner;
}
