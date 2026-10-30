/**
 * kits/physics/components: what a game puts on entities. Units are metres, seconds, kilograms and radians. Values are
 * read when the physics world admits the entity; later in-place edits of shape or material fields are not observed
 * (call `rebuild(entity)` on the world). Pose is read from `Transform` (Y-up, Euler XYZ as the renderer applies it);
 * `Transform.scale` is not applied to colliders.
 */
import {defineComponent} from '../../author';

export type BodyKind = 'dynamic' | 'kinematic' | 'fixed';
export type ColliderShape = 'cuboid' | 'ball' | 'capsule' | 'cylinder';

/**
 * A rigid body. `dynamic`: simulated, its pose is written back to Transform every tick. `kinematic`: follows Transform
 * (the game moves it) and pushes dynamic bodies. `fixed`: never moves after admission. `vx, vy, vz` is the initial
 * linear velocity at admission (m/s).
 */
export const RigidBody = defineComponent('physics-body', {
  kind: 'dynamic' as BodyKind,
  linearDamping: 0,
  angularDamping: 0,
  gravityScale: 1,
  ccd: false,
  lockRotations: false,
  vx: 0,
  vy: 0,
  vz: 0,
});

/**
 * One collider. With a `RigidBody` it is attached to that body; alone it is a static collider at the Transform.
 * `cuboid` uses half extents `hx, hy, hz`; `ball` uses `radius`; `capsule` and `cylinder` use `radius` and
 * `halfHeight` along Y. `sensor` colliders report overlap events but do not push. `events` enables collision events.
 */
export const Collider = defineComponent('physics-collider', {
  shape: 'cuboid' as ColliderShape,
  hx: 0.5,
  hy: 0.5,
  hz: 0.5,
  radius: 0.5,
  halfHeight: 0.5,
  friction: 0.5,
  restitution: 0,
  density: 1,
  sensor: false,
  events: true,
});

/**
 * A character resolved through the library's kinematic character controller (an upright capsule: `radius`,
 * `halfHeight` of its straight part). Configuration: `speed` (m/s), `offset` (skin gap, m), `maxSlope` (steepest
 * climbable, rad), `minSlide` (slopes steeper than this slide the character down, rad), `stepHeight`/`stepWidth`
 * (autostep; height 0 disables), `snap` (snap-to-ground distance; 0 disables).
 * State, written every tick and part of the game's own saved state: `vx, vz` (planar velocity of the character kit's
 * motion integrator), `vy` (vertical velocity) and `grounded`.
 */
export const PhysicsCharacter = defineComponent('physics-character', {
  speed: 3.5,
  radius: 0.35,
  halfHeight: 0.55,
  offset: 0.02,
  maxSlope: Math.PI / 4,
  minSlide: Math.PI / 6,
  stepHeight: 0.3,
  stepWidth: 0.2,
  snap: 0.3,
  vx: 0,
  vy: 0,
  vz: 0,
  grounded: false,
});

export type RigidBodyData = ReturnType<typeof RigidBody.initial>;
export type ColliderData = ReturnType<typeof Collider.initial>;
export type PhysicsCharacterData = ReturnType<typeof PhysicsCharacter.initial>;

const num = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const pos = (v: unknown, hi: number) => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= hi;

/** Why a body's data cannot be admitted, or null. */
export function bodyProblem(b: RigidBodyData): string | null {
  if (b.kind !== 'dynamic' && b.kind !== 'kinematic' && b.kind !== 'fixed') return 'kind';
  if (!num(b.linearDamping, 0, 1000) || !num(b.angularDamping, 0, 1000)) return 'damping';
  if (!num(b.gravityScale, -100, 100)) return 'gravityScale';
  if (!num(b.vx, -1e4, 1e4) || !num(b.vy, -1e4, 1e4) || !num(b.vz, -1e4, 1e4)) return 'velocity';
  if (typeof b.ccd !== 'boolean' || typeof b.lockRotations !== 'boolean') return 'flags';
  return null;
}

/** Why a collider's data cannot be admitted, or null. Sizes are in (0, 10000] m. */
export function colliderProblem(c: ColliderData): string | null {
  switch (c.shape) {
    case 'cuboid':
      if (!pos(c.hx, 1e4) || !pos(c.hy, 1e4) || !pos(c.hz, 1e4)) return 'size';
      break;
    case 'ball':
      if (!pos(c.radius, 1e4)) return 'size';
      break;
    case 'capsule':
    case 'cylinder':
      if (!pos(c.radius, 1e4) || !pos(c.halfHeight, 1e4)) return 'size';
      break;
    default:
      return 'shape';
  }
  if (!num(c.friction, 0, 100) || !num(c.restitution, 0, 10) || !pos(c.density, 1e6)) return 'material';
  if (typeof c.sensor !== 'boolean' || typeof c.events !== 'boolean') return 'flags';
  return null;
}

/** Why a character's data cannot be admitted, or null. */
export function characterProblem(c: PhysicsCharacterData): string | null {
  if (!num(c.speed, 0, 100)) return 'speed';
  if (!pos(c.radius, 100) || !num(c.halfHeight, 0, 100)) return 'size';
  if (!pos(c.offset, 1)) return 'offset';
  if (!num(c.maxSlope, 0, Math.PI / 2) || !num(c.minSlide, 0, Math.PI / 2)) return 'slope';
  if (!num(c.stepHeight, 0, 10) || !num(c.stepWidth, 0, 10) || !num(c.snap, 0, 10)) return 'ground';
  if (!num(c.vx, -1e4, 1e4) || !num(c.vy, -1e4, 1e4) || !num(c.vz, -1e4, 1e4)) return 'velocity';
  return null;
}
