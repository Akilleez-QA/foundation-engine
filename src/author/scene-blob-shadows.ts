/**
 * author/scene-blob-shadows.ts: the visit's blob (contact) shadows (VIS-10), a lazy chunk loaded only by scenes that
 * opt in with `sceneBlobShadows()`. Data and the placement policy are in author/blob-shadow.ts; the GPU layer (one
 * instanced draw, buffers allocated once at `max`) is platform/render/blob-shadows.ts.
 *
 * Each `sync` reads every `Transform` + `BlobShadow` entity, decides which blobs stand in for a missing real shadow
 * (`planBlobs`), and writes them to the layer, which uploads only what changed. Leaving the visit disposes the layer.
 */
import type * as T from 'three';
import type {World} from '../core/ecs/world';
import {createBlobShadowLayer} from '../platform/render/blob-shadows';
import {Model} from './model';
import {Mesh} from './mesh';
import {Shape, Transform} from './defs';
import {Shadow, shadowFlags, type SceneShadows} from './shadow-casting';
import {BlobShadow, planBlobs, type BlobCandidate, type SceneBlobShadowLimits, type SunCoverage} from './blob-shadow';

export interface SceneBlobShadowOptions {
  world: World;
  scene: T.Scene;
  limits: Readonly<SceneBlobShadowLimits>;
  /** The scene's `sceneShadows()`, if any: which entities cast a real shadow. */
  shadows: SceneShadows | undefined;
  /** Overload, once per visit (designed behaviour, not an error). */
  report(message: string): void;
}

export interface BlobFrame {
  /** The camera's world position: only read when more blobs want drawing than `max`. */
  camera: readonly [number, number, number];
  /** The live sun shadow's box, or null when the sun casts no real shadow now (`sunCoverage`). */
  sun: SunCoverage;
}

export interface BlobShadowStats {
  /** The instance capacity (`max`), allocated once. */
  capacity: number;
  /** Entities with a visible `BlobShadow` and a `Transform`, before policy and capacity. */
  candidates: number;
  /** Blobs drawn now. */
  drawn: number;
  /** Blobs over capacity now (not drawn). */
  dropped: number;
  /** Draw calls a frame issues for blobs: 1 when any is drawn, else 0. */
  draws: number;
  /** Instance uploads since the visit began (each a change of a matrix, an alpha or the count). */
  uploads: number;
}

export interface SceneBlobShadowDrawing {
  /** Reconcile with the world; true when the picture changed. */
  sync(frame: BlobFrame): boolean;
  readonly stats: Readonly<BlobShadowStats>;
  /** The one instanced mesh (for tests and diagnostics). */
  readonly mesh: T.InstancedMesh;
  dispose(): void;
}

export function createSceneBlobShadows(o: SceneBlobShadowOptions): SceneBlobShadowDrawing {
  const layer = createBlobShadowLayer(o.scene, {capacity: o.limits.max, distance: o.limits.distance});
  const stats: BlobShadowStats = {capacity: layer.capacity, candidates: 0, drawn: 0, dropped: 0, draws: 0, uploads: 0};
  const candidates: BlobCandidate[] = [];
  let reported = false,
    disposed = false;
  return {
    stats,
    mesh: layer.mesh,
    sync(frame) {
      if (disposed) return false;
      candidates.length = 0;
      const {world} = o;
      for (const [e, tr, b] of world.query(Transform, BlobShadow)) {
        if (!b.visible) continue;
        // A drawn Shape or Mesh casts by the scene's shadow flags; a Model (or no body) casts no real shadow yet.
        const body = !world.has(e, Model) && (world.has(e, Shape) || world.has(e, Mesh));
        candidates.push({
          entity: e,
          x: tr.x,
          ground: b.ground ?? o.limits.ground,
          z: tr.z,
          yaw: tr.ry,
          width: b.width * tr.scale,
          depth: b.depth * tr.scale,
          opacity: b.opacity,
          casts: body && !!o.shadows && shadowFlags(o.shadows, world.get(e, Shadow)).cast,
        });
      }
      const plan = planBlobs(candidates, {
        max: layer.capacity,
        sun: frame.sun,
        crossfade: o.limits.crossfade,
        camera: frame.camera,
      });
      if (plan.dropped > 0 && !reported) {
        reported = true;
        try {
          o.report(
            `${plan.dropped + layer.capacity} blob shadows want drawing but the scene draws at most ${layer.capacity} ` +
              '(sceneBlobShadows({ max })): the nearest to the camera are kept',
          );
        } catch {
          /* Diagnostics cannot strand drawing. */
        }
      }
      const changed = layer.write(
        plan.kept.map(c => ({x: c.x, y: c.ground, z: c.z, yaw: c.yaw, width: c.width, depth: c.depth, alpha: c.alpha})),
      );
      stats.candidates = candidates.length;
      stats.drawn = plan.kept.length;
      stats.dropped = plan.dropped;
      stats.draws = plan.kept.length > 0 ? 1 : 0;
      stats.uploads = layer.uploads;
      return changed;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      layer.dispose();
      stats.drawn = stats.draws = 0;
    },
  };
}
