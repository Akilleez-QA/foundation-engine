/**
 * author/scene-materials.ts: the visit-owned surfaces of `Shape` entities.
 *
 * A shape without a `Material` keeps its original matte `MeshLambertMaterial` (STD-REN-27: looks migrate verbatim).
 * A shape with one gets a `MeshStandardMaterial` built from the data, and keeps that material for as long as it has a
 * valid `Material`: roughness, metalness, emission, opacity and transparency change in place (no new material, no new
 * program unless three needs one, e.g. for `transparent`).
 *
 * Textures (STD-REN-33): the texture library leases one texture per asset, variant, anisotropy and wrap (wrap is part
 * of its key, so a repeating texture is its own counted, budgeted texture). Repeat is a uv transform held on the
 * texture object, so the visit keeps ONE view per (asset, wrap, repeat), shared by every surface that asks for it. A
 * view shares the leased image, sampler and GPU texture: creating it does not upload anything again. A view is
 * disposed, and its lease released, when the last surface using it lets go or the visit ends.
 *
 * Changing a surface's texture, wrap or repeat asks for the new view first and keeps drawing the old one until the
 * new one is ready (no untextured frame); then the old one is released. A failed load is reported once per view and
 * the surface keeps what it drew (its colour, or the previous texture). Leaving the visit aborts every pending load;
 * a texture that arrives after that is released by the library, never applied. Anisotropy is fixed per visit (the
 * `textures.anisotropy` quality knob, capped by the context), as the knob declares ('reenter-scene').
 */
import * as T from 'three';
import type { TextureLibrary } from '../platform/assets/textures';
import { isAbortError, type AssetLease } from '../platform/assets/lease-cache';
import { materialKey, validateMaterial, type MaterialData } from './material';

/** Author textures have one variant; the on-screen size only matters once an asset lists several. */
const SCREEN_PX = 1024;

type Resources = { own<R extends { dispose(): void }>(resource: R): R; release(resource: { dispose(): void }): void };

export interface SceneSurfaceOptions {
  /** The texture library, or null when the game has none (textures then never load). */
  library: Pick<TextureLibrary, 'texture'> | null;
  resources: Resources;
  /** The visit's lifetime. */
  signal: AbortSignal;
  /** Sampler anisotropy for every texture this visit leases (1…16). */
  anisotropy: number;
  /** A texture arrived and was applied: draw again. */
  changed(): void;
  report(error: unknown): void;
}

export interface Surface {
  readonly material: T.MeshLambertMaterial | T.MeshStandardMaterial;
  /** True when built from valid `Material` data (a standard material). */
  readonly authored: boolean;
  /** The data signature this surface shows ('' for no `Material`). */
  readonly key: string;
  /** Show `data` in place. False when it cannot (a plain surface, or invalid data): the caller makes a new surface. */
  update(data: MaterialData | undefined): boolean;
  dispose(): void;
}

export interface SceneSurfaces {
  /** A surface for `data` (or the plain one); invalid data is reported and drawn plain. */
  create(data: MaterialData | undefined, color: number): Surface;
  /** Views made, leases taken, textures applied and failures this visit (for tests and diagnostics); `views` live now. */
  readonly stats: { readonly leased: number; readonly applied: number; readonly failed: number; readonly views: number };
}

interface View {
  refs: number;
  texture: T.Texture | null;
  lease?: AssetLease<T.Texture>;
  life: AbortController;
  failed: boolean;
  waiting: Set<(texture: T.Texture) => void>;
}
interface Hold { readonly key: string; texture(): T.Texture | null; release(): void }

const textureKey = (d: MaterialData) => d.texture ? `${d.texture}|${d.wrap}|${d.repeat}` : '';

export function createSceneSurfaces(o: SceneSurfaceOptions): SceneSurfaces {
  const anisotropy = Math.max(1, Math.min(16, Number.isFinite(o.anisotropy) ? Math.floor(o.anisotropy) : 1));
  const stats = { leased: 0, applied: 0, failed: 0, views: 0 };
  const report = (error: unknown) => { try { o.report(error); } catch { /* Diagnostics cannot strand cleanup. */ } };
  const views = new Map<string, View>();

  const retire = (key: string, view: View) => {
    if (views.get(key) === view) views.delete(key);
    stats.views = views.size;
    view.life.abort(); view.waiting.clear();
    const errors: unknown[] = [];
    try { view.texture?.dispose(); } catch (error) { errors.push(error); }
    try { view.lease?.release(); } catch (error) { errors.push(error); }
    view.texture = null; view.lease = undefined;
    if (errors.length) throw new AggregateError(errors, 'texture view cleanup failed');
  };
  o.signal.addEventListener('abort', () => { for (const [key, view] of [...views]) try { retire(key, view); } catch (error) { report(error); } }, { once: true });

  /** One shared reference to the view for `data`'s texture; `ready` runs once if it arrives while still held. */
  const hold = (data: MaterialData, ready: (texture: T.Texture) => void): Hold => {
    const key = textureKey(data);
    let view = views.get(key);
    if (!view) {
      view = { refs: 0, texture: null, life: new AbortController(), failed: false, waiting: new Set() };
      views.set(key, view); stats.views = views.size;
      const v = view, [u, w] = data.repeat;
      stats.leased++;
      o.library!.texture(data.texture, { screenPx: SCREEN_PX, signal: v.life.signal, anisotropy, colorSpace: 'srgb', wrap: data.wrap }).then(lease => {
        if (v.life.signal.aborted || views.get(key) !== v) { lease.release(); return; }
        v.lease = lease;
        // clone() flags the shared image for upload; a view needs none (same image, same sampler key: three keeps one
        // GPU texture for both), so the image's version is restored. Only the uv repeat differs.
        const source = lease.value.source, version = source.version;
        const texture = lease.value.clone();
        source.version = version;
        texture.repeat.set(u, w);
        v.texture = texture;
        stats.applied++;
        for (const apply of [...v.waiting]) apply(texture);
        v.waiting.clear();
        o.changed();
      }, error => {
        if (v.life.signal.aborted || isAbortError(error)) return;
        v.failed = true; v.waiting.clear(); stats.failed++;
        report(error);
      }).catch(report);
    }
    const v = view;
    v.refs++;
    let held = true;
    if (!v.texture && !v.failed) v.waiting.add(ready);
    return {
      key,
      texture: () => (held ? v.texture : null),
      release() {
        if (!held) return; held = false;
        v.waiting.delete(ready);
        if (--v.refs === 0) retire(key, v);
      },
    };
  };

  /** The original matte surface; `key` is the data it stands in for, so invalid data is reported once, not per frame. */
  const plain = (color: number, key = ''): Surface => {
    const material = o.resources.own(new T.MeshLambertMaterial({ color }));
    return { material, authored: false, key, update: () => false, dispose: () => o.resources.release(material) };
  };

  return {
    stats,
    create(data, color) {
      if (!data) return plain(color);
      try { validateMaterial(data); } catch (error) { report(error); return plain(color, materialKey(data)); }
      const material = o.resources.own(new T.MeshStandardMaterial({ color }));
      let key = '', current: Hold | null = null, next: Hold | null = null, closed = false;
      const show = (texture: T.Texture | null) => {
        if ((material.map === null) !== (texture === null)) material.needsUpdate = true; // map on/off is a program change
        material.map = texture;
      };
      const surface: Surface = {
        material, authored: true,
        get key() { return key; },
        update(d) {
          if (closed || !d) return false;
          try { validateMaterial(d); } catch { return false; }
          const k = materialKey(d);
          if (k === key) return true;
          key = k;
          material.roughness = d.roughness; material.metalness = d.metalness;
          material.emissive.setHex(d.emissive); material.emissiveIntensity = d.emissiveIntensity; material.opacity = d.opacity;
          if (material.transparent !== d.transparent) { material.transparent = d.transparent; material.needsUpdate = true; }
          const want = o.library && !o.signal.aborted ? textureKey(d) : '';
          if (want === (next ?? current)?.key || (want === '' && !current && !next)) return true;
          next?.release(); next = null;
          if (want === '') { show(null); current?.release(); current = null; return true; }
          const candidate = hold(d, texture => {
            if (closed || next !== candidate) return;
            show(texture); current?.release(); current = candidate; next = null;
          });
          const ready = candidate.texture();
          if (ready) { show(ready); current?.release(); current = candidate; }
          else next = candidate; // keep drawing the current texture until this one arrives
          return true;
        },
        dispose() {
          if (closed) return; closed = true;
          const errors: unknown[] = [];
          try { material.map = null; } catch (error) { errors.push(error); }
          for (const h of [next, current]) try { h?.release(); } catch (error) { errors.push(error); }
          next = current = null;
          try { o.resources.release(material); } catch (error) { errors.push(error); }
          if (errors.length) throw new AggregateError(errors, 'surface cleanup failed');
        },
      };
      surface.update(data);
      return surface;
    },
  };
}
