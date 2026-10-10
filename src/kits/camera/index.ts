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
  type KitDefinition,
  type SceneContext,
  type SystemDefinition,
  type Vec3,
} from '../../author';

import {clearCamera, type CameraObstruction, type Pose} from './clearance';
export {clearCamera, type CameraObstruction, type Pose} from './clearance';

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
    teleportDistance?: number;
    resetRevision?: (ctx: SceneContext) => number;
  } = {},
): SystemDefinition {
  const previous = new WeakMap<object, Vec3>();
  const revisions = new WeakMap<object, number>();
  if (o.teleportDistance !== undefined && (!Number.isFinite(o.teleportDistance) || o.teleportDistance <= 0))
    throw new RangeError('camera: teleport distance must be positive');
  return defineSystem({
    id: `camera-${mode}`,
    phase: 'frame',
    run(ctx, dt) {
      const revision = o.resetRevision?.(ctx);
      if (revision !== undefined && !Number.isSafeInteger(revision))
        throw Error('camera: reset revision must be an integer');
      const revisionChanged = revision !== undefined && revisions.get(ctx.world) !== revision;
      const e = ctx.named(o.target ?? 'player'),
        tr = e === undefined ? undefined : ctx.world.get(e, Transform);
      if (!tr && mode !== 'fixed') {
        previous.delete(ctx.world);
        return;
      }
      const pose = cameraPose(mode, tr ? {x: tr.x, y: tr.y, z: tr.z, heading: tr.ry} : {x: 0, y: 0, z: 0, heading: 0}, {
        ...o,
        ...o.options?.(ctx),
      });
      const old = revisionChanged ? undefined : previous.get(ctx.world);
      const discontinuity =
        old &&
        o.teleportDistance !== undefined &&
        Math.hypot(...pose.target.map((v, i) => v - old[i]!)) > o.teleportDistance;
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
        ? clearCamera(eased, o.obstruction, o.clearanceRadius, o.clearancePadding)
        : eased;
      if (position.some((v, i) => v !== cam.position[i]) || target.some((v, i) => v !== cam.target[i])) {
        cam.position = position;
        cam.target = target;
      }
      // A missing target or failed clearance must not consume a reset request.
      previous.set(ctx.world, [...pose.target]);
      if (revision !== undefined) revisions.set(ctx.world, revision);
    },
  });
}

/** The kit: pure functions and a system; nothing to register. */
export function camera(): KitDefinition {
  return defineKit({id: 'camera'});
}
export {
  cameraDirectorSystem,
  closeUpPose,
  createCameraTransition,
  createCameraVolumes,
  createLetterbox,
  railPose,
  shotPose,
  stringPose,
  type CameraPose,
  type CameraSelection,
  type CameraSettingPose,
  type CameraTransition,
  type CameraVolume,
  type RailRig,
  type StringRig,
  type VolumeShape,
} from './director';
