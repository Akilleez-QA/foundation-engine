/**
 * kits/locomotion/jump-system: a fixed-step adapter that drives `createJumpFeel` from an action and a creator-supplied
 * support query, and writes only the target's Transform height. Horizontal motion stays with its own owner
 * (for example `characterSystem()` without a `ground` option).
 */
import { defineSystem, Transform, type Entity, type SceneContext, type SystemDefinition, type World } from '../../author';
import { createJumpFeel, type JumpFeel, type JumpFeelConfig } from './jump';

export interface JumpSystemOptions {
  /** The press action, defined by the game with `defineInput({ …, hold: true })` so release is observable. */
  action: string;
  config: JumpFeelConfig;
  /**
   * The highest walkable surface height at (x, z) that is at or below `below` (world metres), or null for none.
   * Passing the start-of-tick foot height makes surfaces above the feet one-way: they never catch a rising actor.
   */
  ground(x: number, z: number, below: number): number | null;
  /** Named target (default 'player'). */
  target?: string;
  /** Transform centre height above the feet (m), [0, 100]. Default 0. */
  groundOffset?: number;
  /** A supported actor climbs onto a surface up to this much higher (m), [0, 10]. Default 0. */
  stepHeight?: number;
  /** A supported, non-rising actor stays attached to a surface up to this much lower (m), [0, 10]. Default 0. */
  snapDistance?: number;
  /** Only while this returns true. A false tick drops any pending press. */
  when?: (ctx: SceneContext) => boolean;
}

interface Body { feel: JumpFeel; supported: boolean; pressFrame: number }
const bodies = new WeakMap<World, Map<Entity, Body>>();
const EPS = 1e-9;

function length(name: string, value: number | undefined, max: number): number {
  const v = value ?? 0;
  if (!Number.isFinite(v) || v < 0 || v > max) throw new RangeError(`jump: ${name} must be within [0, ${max}]`);
  return v;
}

/**
 * Per fixed tick: query support, step the controller, resolve the landing against the same query and publish height.
 * Presses are consumed at most once per rendered frame, so a frame that runs several fixed ticks cannot jump twice from
 * one press. Cost: per target, two support queries per tick; no draws, no allocation beyond the step record.
 */
export function jumpSystem(o: JumpSystemOptions): SystemDefinition {
  if (!o || typeof o.action !== 'string' || !o.action || typeof o.ground !== 'function') throw new RangeError('jump: action and ground are required');
  createJumpFeel(o.config);   // validate eagerly: configuration errors surface at definition, not on the first tick
  const offset = length('groundOffset', o.groundOffset, 100), stepUp = length('stepHeight', o.stepHeight, 10), snap = length('snapDistance', o.snapDistance, 10);
  const support = (x: number, z: number, below: number) => {
    const h = o.ground(x, z, below);
    if (h === null) return null;
    if (!Number.isFinite(h) || h > below + EPS) throw new RangeError('jump: ground must return a finite height at or below the query, or null');
    return h;
  };
  return defineSystem({
    id: 'locomotion-jump',
    run(ctx, dt) {
      let byWorld = bodies.get(ctx.world);
      if (!byWorld) bodies.set(ctx.world, byWorld = new Map());
      const e = ctx.named(o.target ?? 'player'), tr = e === undefined ? undefined : ctx.world.get(e, Transform);
      if (e === undefined || !tr) return;
      let body = byWorld.get(e);
      if (!body) byWorld.set(e, body = { feel: createJumpFeel(o.config), supported: false, pressFrame: -1 });
      if (o.when && !o.when(ctx)) { body.feel.cancelPress(); return; }
      const frame = ctx.time.frame, pressed = ctx.input.pressed(o.action) && body.pressFrame !== frame;
      if (pressed) body.pressFrame = frame;
      const feet = tr.y - offset, rising = body.feel.state.vy > 0;
      // Support: a supported actor may step up or snap down; an airborne one only touches what it already rests on.
      const reach = body.supported && !rising ? stepUp : 0;
      const under = support(tr.x, tr.z, feet + reach);
      const grounded = !rising && under !== null && feet - under <= (body.supported ? snap : 0) + EPS;
      const r = body.feel.step(dt, { pressed, held: ctx.input.held(o.action), grounded });
      let next = (grounded ? under! : feet) + r.dy;
      body.supported = grounded && !r.jumped;
      if (r.vy <= 0) {
        // Swept against the support query: anything between the start and end of the tick is found, at any speed.
        const top = grounded ? Math.max(feet, under!) : feet;
        const land = support(tr.x, tr.z, top);
        if (land !== null && next <= land + EPS) { next = land; body.supported = true; }
      }
      const y = next + offset;
      if (y !== tr.y) { tr.y = y; ctx.world.touch(); }
    },
  });
}

/** Clear jump state on an authority change or a teleport, without moving the actor. */
export function resetJump(world: World, entity?: Entity): void {
  const active = bodies.get(world); if (!active) return;
  for (const [e, body] of active) if (entity === undefined || e === entity) { body.feel.reset(); body.supported = false; }
}
