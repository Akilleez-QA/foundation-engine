/**
 * kits/physics/character: the character kit's movement intent resolved through the physics library's kinematic
 * character controller. It composes with `@kits/character` rather than replacing it:
 *
 * - intent is the character kit's own: its `character-x` / `character-z` axes, its camera-relative mapping and its
 *   frame-rate-independent motion integrator (`createMotion`) and facing (`turnToward`);
 * - resolution differs: instead of the kit's planar `slide` against `Walls`/`Solid`s, the displacement (planar step
 *   plus gravity) goes through the physics world, which handles slopes, steps, snap-to-ground and every collider.
 *
 * An entity has `Transform` + `PhysicsCharacter` (not the character kit's `Character`: an entity with both is refused
 * and counted, because the stock `characterSystem` would move it too). List this system before the physics step
 * system: `systems: [physicsCharacterSystem(physics), physics.system]`.
 */
import {
  defineSystem,
  scalarMath,
  Transform,
  type SceneContext,
  type ScalarMathMode,
  type SystemDefinition,
  type World,
  type Entity,
} from '../../author';
import {Character, createMotion, turnToward} from '../character';
import {PhysicsCharacter} from './components';
import {ENGINE_FIXED_STEP} from './config';
import type {ScenePhysics} from './scene';

type Motion = ReturnType<typeof createMotion>;

export interface PhysicsCharacterOptions {
  /** 'camera' (default): up moves away from the camera; 'world': up moves towards -z. As the character kit. */
  relative?: 'camera' | 'world';
  /** A world-space point to walk towards while the pointer is held (null: none). Without it, no pointer movement. */
  pointerTarget?: (ctx: SceneContext) => {x: number; z: number} | null;
  /** Vertical acceleration (m/s²). Default: the physics world's gravity.y. */
  gravity?: number;
  /** Fastest fall (m/s): [0, 200]. Default 50. */
  maxFallSpeed?: number;
  /** Arithmetic for camera yaw, speed and facing, as the character kit's `math`. */
  math?: ScalarMathMode;
  /** Only while this returns true. */
  when?: (ctx: SceneContext) => boolean;
}

export interface PhysicsCharacterStats {
  /** Characters moved on the last tick. */
  readonly moved: number;
  /** Entities with both `Character` and `PhysicsCharacter` on the last tick (not moved by this system). */
  readonly conflicts: number;
  /** Characters not yet admitted by the physics world (a limit or invalid data) on the last tick. */
  readonly waiting: number;
}

const stats = new WeakMap<World, PhysicsCharacterStats>();
/** What the physics character system did on its last tick in this visit. */
export function physicsCharacterStats(world: World): PhysicsCharacterStats {
  return stats.get(world) ?? Object.freeze({moved: 0, conflicts: 0, waiting: 0});
}

export function physicsCharacterSystem(physics: ScenePhysics, o: PhysicsCharacterOptions = {}): SystemDefinition {
  const maxFall = o.maxFallSpeed ?? 50;
  if (!Number.isFinite(maxFall) || maxFall < 0 || maxFall > 200)
    throw new RangeError('physicsCharacterSystem: maxFallSpeed must be in [0, 200]');
  if (o.gravity !== undefined && !(Number.isFinite(o.gravity) && Math.abs(o.gravity) <= 100))
    throw new RangeError('physicsCharacterSystem: gravity must be in [-100, 100]');
  const m = scalarMath(o.math);
  const motions = new WeakMap<World, Map<Entity, Motion>>();
  return defineSystem({
    id: 'physics-character-move',
    run(ctx, dt) {
      if (Math.abs(dt - ENGINE_FIXED_STEP) > 1e-9) return;
      if (o.when && !o.when(ctx)) return;
      const pw = physics.of(ctx);
      if (!pw) return;
      let byEntity = motions.get(ctx.world);
      if (!byEntity) motions.set(ctx.world, (byEntity = new Map()));
      const g = o.gravity ?? pw.config.gravity.y;
      const [cx, , cz] = ctx.view.camera.position,
        [tx, , tz] = ctx.view.camera.target;
      const yaw = o.relative === 'world' ? 0 : m.atan2(tx - cx, -(tz - cz));
      const ix = ctx.input.axis('character-x'),
        iz = ctx.input.axis('character-z');
      const cy = m.cos(yaw),
        sy = m.sin(yaw),
        keyed = {x: ix * cy - iz * sy, z: ix * sy + iz * cy};
      const target = o.pointerTarget && ctx.input.pointer.down ? o.pointerTarget(ctx) : null;
      let moved = 0,
        conflicts = 0,
        waiting = 0,
        touched = false;
      for (const [e, tr, pc] of ctx.world.query(Transform, PhysicsCharacter)) {
        if (ctx.world.has(e, Character)) {
          conflicts++;
          continue;
        }
        if (pw.handles(e)?.kind !== 'character') {
          waiting++;
          continue;
        }
        // The integrator is the character kit's; its velocity lives in the component, so a restored or reloaded
        // component resumes the same ramp (a cached integrator whose velocity differs is replaced).
        let motion = byEntity.get(e);
        const v = motion?.velocity;
        if (!motion || !v || !Object.is(v.x, pc.vx) || !Object.is(v.z, pc.vz) || motion.speed !== pc.speed)
          byEntity.set(e, (motion = createMotion({speed: pc.speed, math: m, velocity: {x: pc.vx, z: pc.vz}})));
        let dir = keyed;
        if (target && Number.isFinite(target.x) && Number.isFinite(target.z) && !ix && !iz) {
          const dx = target.x - tr.x,
            dz = target.z - tr.z,
            d = m.hypot(dx, dz);
          dir = d < 0.3 ? {x: 0, z: 0} : {x: (dx / d) * Math.min(1, d), z: (dz / d) * Math.min(1, d)};
        }
        const want = motion.step(dir, dt);
        const vy = Math.max(-maxFall, Math.min(maxFall, (pc.grounded && pc.vy < 0 ? 0 : pc.vy) + g * dt));
        const result = pw.moveCharacter(e, {x: want.x, y: vy * dt, z: want.z});
        if (result.status !== 'moved') {
          waiting++;
          continue;
        }
        motion.moved(want, {x: result.x, z: result.z}, dt);
        tr.x += result.x;
        tr.y += result.y;
        tr.z += result.z;
        tr.ry = turnToward(tr.ry, result.x, result.z, dt, undefined, m);
        const after = motion.velocity;
        pc.vx = after.x;
        pc.vz = after.z;
        pc.grounded = result.grounded;
        // Landing or a ceiling ends vertical motion; otherwise keep the integrated velocity.
        const landed = result.grounded && vy < 0,
          ceiling = vy > 0 && result.y < vy * dt - 1e-6;
        pc.vy = landed || ceiling ? 0 : vy;
        moved++;
        touched = touched || result.x !== 0 || result.y !== 0 || result.z !== 0;
      }
      for (const e of [...byEntity.keys()]) if (!ctx.world.has(e, PhysicsCharacter)) byEntity.delete(e);
      if (touched) ctx.world.touch();
      stats.set(ctx.world, Object.freeze({moved, conflicts, waiting}));
    },
  });
}
