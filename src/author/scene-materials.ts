/**
 * author/scene-materials.ts: the visit-owned surfaces of `Shape` entities.
 *
 * A shape without a `Material` keeps its original matte `MeshLambertMaterial` (STD-REN-27: looks migrate verbatim).
 * A shape with one gets a `MeshStandardMaterial` built from the data. A texture is leased from the shared texture
 * library (STD-REN-33: one decode and one upload per asset, variant, sampler and context), and the surface draws a
 * clone of it: the clone carries this surface's wrap and repeat, shares the leased image (three.js keeps one GPU texture
 * per image and sampler), and is disposed with the surface; the leased original is never mutated or disposed here.
 *
 * Ownership and lifetime: the run owns every surface (its material through the visit's resources, its texture through
 * a lease whose signal follows the visit). `dispose()` releases both; leaving the visit aborts every pending load, and
 * a texture that arrives after that is released by the library, never applied. A failed load is reported once per
 * surface and the surface stays untextured. Anisotropy is fixed per visit (the `textures.anisotropy` quality knob,
 * capped by the context), so a quality change applies on the next visit, as the knob declares.
 */
import * as T from 'three';
import type { TextureLibrary } from '../platform/assets/textures';
import { isAbortError } from '../platform/assets/lease-cache';
import { materialKey, validateMaterial, type MaterialData } from './material';

const WRAP = { repeat: T.RepeatWrapping, clamp: T.ClampToEdgeWrapping, mirror: T.MirroredRepeatWrapping } as const;
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
  /** True when built from `Material` data (a standard material). */
  readonly authored: boolean;
  /** The data signature this surface stands for ('' for no `Material`). */
  readonly key: string;
  dispose(): void;
}

export interface SceneSurfaces {
  /** A surface for `data` (or the plain one); invalid data is reported and drawn plain. */
  create(data: MaterialData | undefined, color: number): Surface;
  /** Leases taken and textures applied this visit (for tests and diagnostics). */
  readonly stats: { readonly leased: number; readonly applied: number; readonly failed: number; readonly live: number };
}

export function createSceneSurfaces(o: SceneSurfaceOptions): SceneSurfaces {
  const anisotropy = Math.max(1, Math.min(16, Number.isFinite(o.anisotropy) ? Math.floor(o.anisotropy) : 1));
  const stats = { leased: 0, applied: 0, failed: 0, live: 0 };
  const report = (error: unknown) => { try { o.report(error); } catch { /* Diagnostics cannot strand cleanup. */ } };

  /** The original matte surface; `key` is the data it stands in for, so invalid data is reported once, not per frame. */
  const plain = (color: number, key = ''): Surface => {
    const material = o.resources.own(new T.MeshLambertMaterial({ color }));
    return { material, authored: false, key, dispose: () => o.resources.release(material) };
  };

  return {
    stats,
    create(data, color) {
      if (!data) return plain(color);
      try { validateMaterial(data); } catch (error) { report(error); return plain(color, materialKey(data)); }
      const material = o.resources.own(new T.MeshStandardMaterial({
        color, roughness: data.roughness, metalness: data.metalness, emissive: data.emissive, emissiveIntensity: data.emissiveIntensity,
        opacity: data.opacity, transparent: data.transparent,
      }));
      const key = materialKey(data);
      let life: AbortController | undefined, clone: T.Texture | undefined, release: (() => void) | undefined, closed = false;
      const onVisitAbort = () => life?.abort();
      if (data.texture && o.library && !o.signal.aborted) {
        life = new AbortController();
        o.signal.addEventListener('abort', onVisitAbort, { once: true });
        const signal = life.signal, wrap = WRAP[data.wrap], [u, v] = data.repeat, id = data.texture;
        stats.leased++; stats.live++;
        o.library.texture(id, { screenPx: SCREEN_PX, signal, anisotropy, colorSpace: 'srgb' }).then(lease => {
          if (closed || signal.aborted) { lease.release(); return; }
          release = lease.release;
          const texture = lease.value.clone();
          texture.wrapS = texture.wrapT = wrap; texture.repeat.set(u, v); texture.needsUpdate = true;
          clone = texture; material.map = texture; material.needsUpdate = true;
          stats.applied++;
          o.changed();
        }, error => {
          if (closed || signal.aborted || isAbortError(error)) return;
          stats.failed++;
          report(error);
        }).catch(report);
      }
      return {
        material, authored: true, key,
        dispose() {
          if (closed) return;
          closed = true;
          if (life) { stats.live--; o.signal.removeEventListener('abort', onVisitAbort); life.abort(); }
          const errors: unknown[] = [];
          try { if (material.map === clone) material.map = null; clone?.dispose(); } catch (error) { errors.push(error); }
          try { release?.(); } catch (error) { errors.push(error); }
          try { o.resources.release(material); } catch (error) { errors.push(error); }
          if (errors.length) throw new AggregateError(errors, 'surface cleanup failed');
        },
      };
    },
  };
}
