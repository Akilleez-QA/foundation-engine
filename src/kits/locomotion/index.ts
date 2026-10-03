import {defineKit, scalarMath, Transform, type SceneContext, type Entity, type ScalarMathMode} from '../../author';
import {areaOf, slide} from '../character';
import type {RootDelta} from '../animation/root-motion';
export function locomotion() {
  return defineKit({id: 'locomotion', requires: ['character', 'animation']});
}
/**
 * Commit bounded authored animation displacement through the existing character collision resolver. `math`:
 * 'platform' (default, Math.*) or 'deterministic' (dmath: the same bits in every JavaScript engine).
 */
export function applyRootMotion(
  ctx: SceneContext,
  entity: Entity,
  delta: RootDelta,
  options: {
    owns(): boolean;
    radius?: number;
    maxStep?: number;
    maxSteps?: number;
    ground?: (x: number, z: number) => number | null;
    math?: ScalarMathMode | undefined;
  },
) {
  const m = scalarMath(options.math);
  if (!options.owns()) return {applied: false, x: 0, z: 0, yaw: 0};
  const tr = ctx.world.get(entity, Transform);
  if (!tr) return {applied: false, x: 0, z: 0, yaw: 0};
  const radius = options.radius ?? 0.35,
    maxStep = options.maxStep ?? radius / 2,
    maxSteps = options.maxSteps ?? 128;
  if (
    ![delta.x, delta.z, delta.yaw, radius, maxStep, tr.x, tr.y, tr.z, tr.ry].every(Number.isFinite) ||
    Math.abs(delta.yaw) > 1e6 ||
    radius <= 0 ||
    maxStep <= 0 ||
    maxStep > radius / 2 ||
    !Number.isSafeInteger(maxSteps) ||
    maxSteps < 1 ||
    maxSteps > 1024
  )
    throw Error('locomotion: invalid motion or budget');
  const c = m.cos(tr.ry),
    s = m.sin(tr.ry),
    x = c * delta.x + s * delta.z,
    z = -s * delta.x + c * delta.z;
  const steps = Math.max(1, Math.ceil(m.hypot(x, z) / maxStep));
  if (steps > maxSteps) throw Error('locomotion: step budget exceeded');
  const area = areaOf(ctx.world, radius, m);
  let next = {x: tr.x, z: tr.z},
    height = tr.y;
  for (let i = 0; i < steps; i++) {
    const candidate = slide(area, next, {x: x / steps, z: z / steps});
    const y = options.ground?.(candidate.x, candidate.z);
    if (options.ground && (y === null || !Number.isFinite(y))) break;
    next = candidate;
    if (y !== undefined && y !== null) height = y;
  }
  // Callbacks can revoke authority; do not publish partially evaluated movement.
  if (!options.owns()) return {applied: false, x: 0, z: 0, yaw: 0};
  const result = {applied: true, x: next.x - tr.x, z: next.z - tr.z, yaw: delta.yaw};
  tr.x = next.x;
  tr.z = next.z;
  tr.y = height;
  tr.ry += delta.yaw;
  ctx.world.touch();
  return result;
}
export {
  createJumpFeel,
  deriveJump,
  type JumpFeel,
  type JumpFeelConfig,
  type JumpFeelDerived,
  type JumpFeelInput,
  type JumpFeelStep,
  type JumpFeelState,
} from './jump';
export {
  jumpSystem,
  platformSystem,
  resetJump,
  jumpStateCount,
  type JumpSystemOptions,
  type PlatformLeave,
} from './jump-system';
export {
  createPlatforms,
  type Platforms,
  type PlatformDef,
  type PlatformPose,
  type PlatformDelta,
  type PlatformsOptions,
} from './platforms';
