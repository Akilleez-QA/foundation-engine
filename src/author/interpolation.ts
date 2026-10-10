/**
 * author/interpolation.ts: optional render interpolation of fixed-step Transforms.
 *
 * Simulation advances in fixed steps; a display can refresh faster or slower. Without interpolation a moving
 * entity is drawn where the latest step left it, so on a 120/144 Hz display it holds still for some frames and
 * jumps on others. An entity that opts in with `Interpolated()` is drawn between the pose before the latest step
 * and the pose after it, by the fraction of the next step already elapsed (`ctx.time.alpha`).
 *
 * Ownership: the scene runtime captures the previous pose before every fixed step and reads the blended pose when
 * it draws. `Transform` stays the simulation's truth and is never written by this module. Presentation lags the
 * simulation by less than one step. Cost: one copy per opted-in entity per fixed step and one blend per drawn
 * frame; entities without `Interpolated` are unaffected.
 */
import {Transform} from './defs';
import {component, type Entity, type World} from '../core/ecs/world';

/** The pose fields interpolation reads and returns: the same fields as `Transform`. */
export interface TransformPose {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly rx: number;
  readonly ry: number;
  readonly rz: number;
  readonly scale: number;
}

/**
 * Opt-in marker with its own bookkeeping.
 * - `revision`: change it (for example increment it) when the entity is placed rather than moved: a respawn,
 *   a teleport, a scene cut. Until the next fixed step captures the new revision, the entity is drawn exactly at
 *   its Transform.
 * - `teleport`: a distance; a step that moves the entity farther than this is drawn without blending. 0 (default)
 *   disables the check.
 * The `previous*`, `captured` and `capturedRevision` fields are written by the runtime before each fixed step; do
 * not set them, and spawn with `Interpolated({revision, teleport})` rather than copying another entity's value.
 */
export const Interpolated = component('interpolated', {
  revision: 0,
  teleport: 0,
  captured: false,
  capturedRevision: 0,
  previousX: 0,
  previousY: 0,
  previousZ: 0,
  previousRx: 0,
  previousRy: 0,
  previousRz: 0,
  previousScale: 1,
});
export type InterpolatedData = ReturnType<typeof Interpolated>['value'];

/**
 * Record each opted-in entity's pose as "previous", before a fixed step runs. The runtime calls this from the
 * runner's `beforeStep`; it never throws for ordinary data. Non-finite poses are recorded as not capturable.
 */
export function captureInterpolation(world: World): void {
  for (const [, tr, it] of world.query(Transform, Interpolated)) {
    const finite =
      Number.isFinite(tr.x) &&
      Number.isFinite(tr.y) &&
      Number.isFinite(tr.z) &&
      Number.isFinite(tr.rx) &&
      Number.isFinite(tr.ry) &&
      Number.isFinite(tr.rz) &&
      Number.isFinite(tr.scale);
    if (!finite || !Number.isSafeInteger(it.revision)) {
      it.captured = false;
      continue;
    }
    it.previousX = tr.x;
    it.previousY = tr.y;
    it.previousZ = tr.z;
    it.previousRx = tr.rx;
    it.previousRy = tr.ry;
    it.previousRz = tr.rz;
    it.previousScale = tr.scale;
    it.capturedRevision = it.revision;
    it.captured = true;
  }
}

const TAU = Math.PI * 2;
/** Blend two angles along the shorter arc. */
function angle(from: number, to: number, alpha: number): number {
  let delta = (to - from) % TAU;
  if (delta > Math.PI) delta -= TAU;
  else if (delta < -Math.PI) delta += TAU;
  // Exactly at the end of the step, return the simulation's own value (no wrap drift).
  return alpha === 1 ? to : from + delta * alpha;
}

/**
 * The pose to draw for one entity. Returns `tr` itself (no blending, no allocation) when the entity has no
 * `Interpolated`, nothing was captured yet, its `revision` changed since the capture, the step exceeded its
 * `teleport` distance, `alpha` is outside [0, 1] or any value is not finite.
 * Rotations blend each Euler angle along its shorter arc; this is exact for single-axis turns (heading) and an
 * approximation for combined rotations.
 */
export function presentTransform(tr: TransformPose, it: InterpolatedData | undefined, alpha: number): TransformPose {
  if (!it || it.captured !== true || it.revision !== it.capturedRevision) return tr;
  if (!(alpha >= 0 && alpha <= 1)) return tr;
  const dx = tr.x - it.previousX,
    dy = tr.y - it.previousY,
    dz = tr.z - it.previousZ;
  if (it.teleport > 0 && Math.hypot(dx, dy, dz) > it.teleport) return tr;
  if (alpha === 1) return tr;
  const pose: TransformPose = {
    x: it.previousX + dx * alpha,
    y: it.previousY + dy * alpha,
    z: it.previousZ + dz * alpha,
    rx: angle(it.previousRx, tr.rx, alpha),
    ry: angle(it.previousRy, tr.ry, alpha),
    rz: angle(it.previousRz, tr.rz, alpha),
    scale: it.previousScale + (tr.scale - it.previousScale) * alpha,
  };
  return Number.isFinite(pose.x) &&
    Number.isFinite(pose.y) &&
    Number.isFinite(pose.z) &&
    Number.isFinite(pose.rx) &&
    Number.isFinite(pose.ry) &&
    Number.isFinite(pose.rz) &&
    Number.isFinite(pose.scale)
    ? pose
    : tr;
}

/** Convenience for systems and kits: the drawn pose of `entity`, or undefined when it has no Transform. */
export function presentedTransform(world: World, entity: Entity, alpha: number): TransformPose | undefined {
  const tr = world.get(entity, Transform);
  return tr ? presentTransform(tr, world.get(entity, Interpolated), alpha) : undefined;
}
