/**
 * kits/camera: where the camera is, as a pure function of a target and a mode, and a frame system that eases the
 * scene's camera there (ctx.view.camera). Six modes:
 *
 *   follow        behind and above the target at `distance`/`height`, looking at it (third person)
 *   orbit         around the target at `yaw`/`pitch`/`distance` (a game or input changes the yaw)
 *   first-person  at the target's eye height, looking along its heading
 *   top-down      straight above the target (a tiny tilt keeps "up" stable)
 *   side-scroll   to the side of the target at a fixed depth, for a 2.5D view
 *   fixed         a fixed position looking at a fixed point (or at the target with `track`)
 *
 * The system reads the target entity's `Transform` (by `Name`, default 'player') and eases with a time constant
 * `smooth` seconds (0 snaps). With Calm (reduced motion) a game may pass `smooth: 0`. Cost: no draws; one small
 * vector update per frame, and the renderer redraws only while the camera moves.
 */
import {
  defineKit,
  defineSystem,
  Transform,
  Interpolated,
  presentTransform,
  type KitDefinition,
  type SceneContext,
  type SystemDefinition,
  type Vec3,
} from '../../author';

import {clearCamera, type CameraObstruction, type Pose} from './clearance';
export {CAMERA_MIN_DISTANCE, clearCamera, type CameraObstruction, type Pose} from './clearance';

export type CameraMode = 'follow' | 'orbit' | 'first-person' | 'top-down' | 'side-scroll' | 'fixed';
export interface CameraOptions {
  distance?: number;
  height?: number;
  yaw?: number;
  pitch?: number;
  eye?: number;
  /** fixed: where the camera stands and what it looks at. */
  position?: Vec3;
  lookAt?: Vec3;
  track?: boolean;
}
interface Target {
  x: number;
  y: number;
  z: number;
  heading: number;
}

/** The camera pose for a mode and a target (heading: radians, three.js rotation.y; 0 faces +z). */
export function cameraPose(mode: CameraMode, t: Target, o: CameraOptions = {}): Pose {
  const d = o.distance ?? 8,
    h = o.height ?? 5;
  switch (mode) {
    case 'follow':
      return {
        position: [t.x - Math.sin(t.heading) * d, t.y + h, t.z - Math.cos(t.heading) * d],
        target: [t.x, t.y + 0.5, t.z],
      };
    case 'orbit': {
      const yaw = o.yaw ?? 0,
        pitch = o.pitch ?? 0.6;
      return {
        position: [
          t.x + Math.sin(yaw) * Math.cos(pitch) * d,
          t.y + Math.sin(pitch) * d,
          t.z + Math.cos(yaw) * Math.cos(pitch) * d,
        ],
        target: [t.x, t.y, t.z],
      };
    }
    case 'first-person': {
      const eye = o.eye ?? 1.6;
      return {
        position: [t.x, t.y + eye, t.z],
        target: [t.x + Math.sin(t.heading), t.y + eye, t.z + Math.cos(t.heading)],
      };
    }
    case 'top-down':
      return {position: [t.x, t.y + (o.height ?? 14), t.z + 0.01], target: [t.x, t.y, t.z]};
    case 'side-scroll':
      return {position: [t.x, t.y + (o.height ?? 1.5), t.z + d], target: [t.x, t.y + (o.height ?? 1.5) * 0.5, t.z]};
    case 'fixed':
      return {
        position: [...(o.position ?? [0, 10, 10])],
        target: o.track ? [t.x, t.y, t.z] : [...(o.lookAt ?? [0, 0, 0])],
      };
  }
}

/**
 * Optional support-anchored vertical framing. `support` returns the height of whatever the target stands on or over
 * (ground, water, a platform), or null when there is none. The pose's position and look target then move by
 * clamp((support - target.y) * weight, ±limit), so a jump or a short drop does not bob the view while a lasting
 * change of support level is followed. Weights 0 leave that point on the target's own height.
 */
export interface SupportFraming {
  support?: (ctx: SceneContext, target: {x: number; y: number; z: number}) => number | null;
  /** Share in [0, 1] of the support offset applied to the camera position (default 1). */
  supportWeight?: number;
  /** Share in [0, 1] applied to the look target (default: `supportWeight`). */
  supportTargetWeight?: number;
  /** Largest vertical shift in world units, (0, 1e6] (default 2). */
  supportLimit?: number;
}
/**
 * Validated support framing, or undefined when `support` is absent (the weights and limit are still validated).
 * The returned function gives the anchored heights for the camera position and the look target. Inside the limit
 * the height is `support * w + y * (1 - w)`, exactly the support height at weight 1 and exactly `y` at weight 0, so a
 * still support never perturbs the pose; outside it, `y ± limit`.
 */
export function supportHeights(
  o: SupportFraming,
): ((support: number | null, y: number) => {position: number; target: number} | null) | undefined {
  const weight = o.supportWeight ?? 1,
    targetWeight = o.supportTargetWeight ?? weight,
    limit = o.supportLimit ?? 2;
  if (![weight, targetWeight].every(w => Number.isFinite(w) && w >= 0 && w <= 1))
    throw new RangeError('camera: support weights must be within [0, 1]');
  if (!Number.isFinite(limit) || limit <= 0 || limit > 1e6)
    throw new RangeError('camera: support limit must be within (0, 1e6]');
  if (!o.support) return undefined;
  return (support, y) => {
    if (support === null) return null;
    if (!Number.isFinite(support)) throw new RangeError('camera: support height must be finite or null');
    const height = (w: number) => {
      const shift = (support - y) * w;
      return Math.abs(shift) <= limit ? support * w + y * (1 - w) : y + Math.sign(shift) * limit;
    };
    return {position: height(weight), target: height(targetWeight)};
  };
}

/** A frame system that eases `ctx.view.camera` to the mode's pose around the named target. */
export function cameraSystem(
  mode: CameraMode,
  o: CameraOptions & {
    target?: string;
    smooth?: number;
    options?: (ctx: SceneContext) => CameraOptions;
    obstruction?: CameraObstruction;
    clearanceRadius?: number;
    clearancePadding?: number;
    /**
     * Closest approach to the target after clearance (default `CAMERA_MIN_DISTANCE`, 0.05). The floor wins
     * over obstructions: while the requested distance is at or below it, clearance does not move the camera.
     */
    clearanceMinDistance?: number;
    teleportDistance?: number;
    resetRevision?: (ctx: SceneContext) => number;
  } & SupportFraming = {},
): SystemDefinition {
  const previous = new WeakMap<object, Vec3>();
  const revisions = new WeakMap<object, number>();
  if (o.teleportDistance !== undefined && (!Number.isFinite(o.teleportDistance) || o.teleportDistance <= 0))
    throw new RangeError('camera: teleport distance must be positive');
  if (o.clearanceMinDistance !== undefined && (!Number.isFinite(o.clearanceMinDistance) || o.clearanceMinDistance <= 0))
    throw new RangeError('camera: clearance minimum distance must be positive');
  const anchor = supportHeights(o);
  return defineSystem({
    id: `camera-${mode}`,
    phase: 'frame',
    run(ctx, dt) {
      const revision = o.resetRevision?.(ctx);
      if (revision !== undefined && !Number.isSafeInteger(revision))
        throw Error('camera: reset revision must be an integer');
      const revisionChanged = revision !== undefined && revisions.get(ctx.world) !== revision;
      const e = ctx.named(o.target ?? 'player'),
        latest = e === undefined ? undefined : ctx.world.get(e, Transform),
        // An `Interpolated` target is followed where it is drawn, not where the latest step left it.
        tr = latest && presentTransform(latest, ctx.world.get(e!, Interpolated), ctx.time.alpha);
      if (!tr && mode !== 'fixed') {
        previous.delete(ctx.world);
        return;
      }
      const options = {...o, ...o.options?.(ctx)};
      const raw = tr ? {x: tr.x, y: tr.y, z: tr.z, heading: tr.ry} : {x: 0, y: 0, z: 0, heading: 0};
      const unanchored = cameraPose(mode, raw, options);
      // Support framing re-poses the mode at the anchored heights. A fixed camera keeps its position; without
      // tracking it ignores the target entirely, so support does not apply.
      const heights =
        anchor && tr && (mode !== 'fixed' || options.track) ? anchor(o.support!(ctx, {...raw}), tr.y) : null;
      let pose = unanchored;
      if (heights) {
        const at = (y: number) => cameraPose(mode, {...raw, y}, options),
          moved = at(heights.position);
        pose = {
          position: mode === 'fixed' ? unanchored.position : moved.position,
          target: heights.target === heights.position ? moved.target : at(heights.target).target,
        };
      }
      const old = revisionChanged ? undefined : previous.get(ctx.world);
      // Discontinuities are judged on the target itself, so a change of support never reads as a teleport.
      const discontinuity =
        old &&
        o.teleportDistance !== undefined &&
        Math.hypot(...unanchored.target.map((v, i) => v - old[i]!)) > o.teleportDistance;
      const k =
        revisionChanged || discontinuity ? 1 : (o.smooth ?? 0.12) <= 0 ? 1 : 1 - Math.exp(-dt / (o.smooth ?? 0.12));
      const cam = ctx.view.camera;
      // Vec3 triples: every map index i is in range (old is a copy of a previous target).
      const ease = (from: Vec3, to: Vec3): Vec3 => {
        const next = from.map((v, i) => v + (to[i]! - v) * k) as Vec3;
        return next.every((v, i) => Math.abs(v - to[i]!) < 1e-3) ? to : next;
      };
      const eased = {position: ease(cam.position, pose.position), target: ease(cam.target, pose.target)};
      const {position, target} = o.obstruction
        ? clearCamera(eased, o.obstruction, o.clearanceRadius, o.clearancePadding, o.clearanceMinDistance)
        : eased;
      if (position.some((v, i) => v !== cam.position[i]) || target.some((v, i) => v !== cam.target[i])) {
        cam.position = position;
        cam.target = target;
      }
      // A missing target or failed clearance must not consume a reset request.
      previous.set(ctx.world, [...unanchored.target]);
      if (revision !== undefined) revisions.set(ctx.world, revision);
    },
  });
}

/** The kit: pure functions and a system; nothing to register. */
export function camera(): KitDefinition {
  return defineKit({id: 'camera'});
}
