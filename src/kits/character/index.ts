/**
 * kits/character: a kinematic character controller. An entity with `Transform` and `Character` moves on the ground
 * plane from two axis inputs (the kit's `character-x` and `character-z`: WASD, arrows, left stick, d-pad) or, with
 * `pointer: true`, towards where the pointer is held (touch and mouse). It accelerates and stops at fixed rates
 * independent of the frame rate (motion.ts), turns to face where it goes, and slides along `Walls` and `Solid`s
 * (collide.ts). Movement is relative to the camera by default: "up" is away from the camera.
 *
 *   entities: [[Name({ name: 'player' }), Transform(), Shape({ kind: 'capsule', … }), Character({ speed: 3.5 })],
 *              [Walls({ minX: -6, maxX: 6, minZ: -6, maxZ: 6 })],
 *              [Transform({ x: 2 }), Solid({ halfX: 0.5, halfZ: 0.5 })]]
 *   systems:  [characterSystem()]
 *
 * Cost: per fixed step, one pass over characters times solids (fine for tens of solids); no draws of its own.
 */
import {
  defineComponent,
  defineInput,
  defineKit,
  defineSystem,
  platformMath,
  pointerOnGround,
  scalarMath,
  Transform,
  type Entity,
  type KitDefinition,
  type ScalarMath,
  type ScalarMathMode,
  type SystemDefinition,
  type World,
} from '../../author';
import {slide, type Area} from './collide';
import {createMotion, turnToward, type Motion} from './motion';
import type {Solid as SolidShape} from './solids';

/** A moving character: top speed (m/s) and body radius (m). */
export const Character = defineComponent('character', {speed: 3.5, radius: 0.35});
/** Something a character cannot walk through, centred on the entity's Transform: a box (halfX, halfZ) or a circle (r > 0). */
export const Solid = defineComponent('solid', {halfX: 0.5, halfZ: 0.5, r: 0});
/** The rectangle characters stay inside (the first `Walls` in the world applies). */
export const Walls = defineComponent('walls', {minX: -10, maxX: 10, minZ: -10, maxZ: 10});

export const moveX = defineInput({
  id: 'character-x',
  label: 'Move left and right',
  axis: {
    negative: {keys: ['code:KeyA', 'code:ArrowLeft'], pad: ['ls-left', 'dpad-left']},
    positive: {keys: ['code:KeyD', 'code:ArrowRight'], pad: ['ls-right', 'dpad-right']},
  },
});
export const moveZ = defineInput({
  id: 'character-z',
  label: 'Move forward and back',
  axis: {
    negative: {keys: ['code:KeyW', 'code:ArrowUp'], pad: ['ls-up', 'dpad-up']},
    positive: {keys: ['code:KeyS', 'code:ArrowDown'], pad: ['ls-down', 'dpad-down']},
  },
});

const motions = new WeakMap<World, Map<Entity, Motion>>();

/** The area characters move in: the walls and every solid, as collide.ts reads it. `math` evaluates rotated solids. */
export function areaOf(world: World, body: number, math: ScalarMath = platformMath): Area {
  let walls = {minX: -1e6, maxX: 1e6, minZ: -1e6, maxZ: 1e6};
  for (const [, w] of world.query(Walls)) {
    walls = w;
    break;
  }
  const solids: SolidShape[] = [];
  for (const [e, tr, s] of world.query(Transform, Solid))
    solids.push(
      s.r > 0
        ? {id: `e${e}`, kind: 'circle', x: tr.x, z: tr.z, r: s.r}
        : {id: `e${e}`, kind: 'box', x: tr.x, z: tr.z, halfX: s.halfX, halfZ: s.halfZ, rotation: tr.ry},
    );
  return {...walls, solids, body, math};
}

/** A world-space surface sample. Null from the query means no walkable surface. */
export interface CharacterGround {
  height: number;
  normal?: {x: number; y: number; z: number};
}

export interface CharacterOptions {
  /** 'camera' (default): up moves away from the camera; 'world': up moves towards -z. */
  relative?: 'camera' | 'world';
  /** Move towards a held pointer on the ground (touch and mouse players). Default true. */
  pointer?: boolean;
  /** World-space ground height at the character centre; null blocks candidate movement. */
  ground?: (x: number, z: number) => CharacterGround | null;
  /** Height of the Transform centre above the queried ground, in metres. Default 0. */
  groundOffset?: number;
  /** Custom world-space pointer target. Required for pointer movement when ground is supplied. */
  pointerTarget?: (ctx: Parameters<SystemDefinition['run']>[0]) => {x: number; z: number} | null;
  /**
   * Arithmetic for the movement simulation (camera yaw, speed, facing, rotated solids). 'platform' (default) is the
   * engine's own Math, unchanged; 'deterministic' uses dmath, so results are bit-identical in every JavaScript engine
   * (a browser replay log re-simulates exactly in Node) at a small cost. See docs/guides/deterministic-math.md.
   */
  math?: ScalarMathMode;
  /** Only while this returns true (a paused game, an open dialog). */
  when?: (ctx: Parameters<SystemDefinition['run']>[0]) => boolean;
}

export function characterSystem(o: CharacterOptions = {}): SystemDefinition {
  const groundOffset = o.groundOffset ?? 0;
  if (!Number.isFinite(groundOffset)) throw new RangeError('groundOffset must be finite');
  const m = scalarMath(o.math);
  return defineSystem({
    id: 'character-move',
    run(ctx, dt) {
      if (o.when && !o.when(ctx)) return;
      let byWorld = motions.get(ctx.world);
      if (!byWorld) motions.set(ctx.world, (byWorld = new Map()));
      const [cx, , cz] = ctx.view.camera.position,
        [tx, , tz] = ctx.view.camera.target;
      const yaw = o.relative === 'world' ? 0 : m.atan2(tx - cx, -(tz - cz)); // 0 when the camera looks along -z
      const ix = ctx.input.axis('character-x'),
        iz = ctx.input.axis('character-z');
      const cy = m.cos(yaw),
        sy = m.sin(yaw),
        keyed = {x: ix * cy - iz * sy, z: ix * sy + iz * cy};
      const ground =
        (o.pointer ?? true) && ctx.input.pointer.down
          ? o.pointerTarget
            ? o.pointerTarget(ctx)
            : o.ground
              ? null
              : pointerOnGround(ctx)
          : null;
      for (const [e, tr, ch] of ctx.world.query(Transform, Character)) {
        let motion = byWorld.get(e);
        if (!motion) byWorld.set(e, (motion = createMotion({speed: ch.speed, math: m})));
        // Ground even an idle or externally teleported actor. Missing surface never means y=0.
        const currentGround = o.ground?.(tr.x, tr.z);
        if (currentGround && Number.isFinite(currentGround.height)) tr.y = currentGround.height + groundOffset;
        let dir = keyed;
        if (ground && Number.isFinite(ground.x) && Number.isFinite(ground.z) && !ix && !iz) {
          const dx = ground.x - tr.x,
            dz = ground.z - tr.z,
            d = m.hypot(dx, dz);
          dir = d < 0.3 ? {x: 0, z: 0} : {x: (dx / d) * Math.min(1, d), z: (dz / d) * Math.min(1, d)};
        }
        const want = motion.step(dir, dt);
        if (!want.x && !want.z) continue;
        const next = slide(areaOf(ctx.world, ch.radius, m), {x: tr.x, z: tr.z}, want);
        const nextGround = o.ground?.(next.x, next.z);
        if (o.ground && (!nextGround || !Number.isFinite(nextGround.height))) {
          motion.moved(want, {x: 0, z: 0}, dt);
          continue;
        }
        const moved = {x: next.x - tr.x, z: next.z - tr.z};
        motion.moved(want, moved, dt);
        tr.x = next.x;
        tr.z = next.z;
        if (nextGround) tr.y = nextGround.height + groundOffset;
        tr.ry = turnToward(tr.ry, moved.x, moved.z, dt, undefined, m);
      }
    },
  });
}

/** Clear the existing integrator on an authority change or discontinuity, without moving the actor. */
export function resetCharacterMotion(world: World, entity?: Entity): void {
  const active = motions.get(world);
  if (!active) return;
  if (entity === undefined) {
    for (const motion of active.values()) motion.reset();
  } else active.get(entity)?.reset();
}

export {standable, slide, type Area} from './collide';
export {createMotion, turnToward} from './motion';

/** The kit: the two move axes. Use `characterSystem()` in the scenes that have characters. */
export function character(): KitDefinition {
  return defineKit({id: 'character', defs: [moveX, moveZ]});
}

export {createAppearanceDocument} from './appearance';
export type {AppearanceValue, AppearanceLimits, AppearanceOptions} from './appearance';
