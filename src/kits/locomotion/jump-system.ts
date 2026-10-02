/**
 * kits/locomotion/jump-system: a fixed-step adapter that drives `createJumpFeel` from an action and a creator-supplied
 * support query, and writes only the target's Transform height. Horizontal motion stays with its own owner
 * (for example `characterSystem()` without a `ground` option).
 */
import { defineSystem, Transform, type Entity, type SceneContext, type SystemDefinition, type World } from '../../author';
import { areaOf, slide } from '../character';
import { createJumpFeel, type JumpFeel, type JumpFeelConfig } from './jump';
import type { Platforms } from './platforms';

/**
 * What an actor keeps from a platform it leaves (by jumping or moving off its footprint), after Godot's
 * `platform_on_leave`: the platform's whole mean velocity, only its upward part, or nothing.
 */
export type PlatformLeave = 'add-velocity' | 'add-upward' | 'none';

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
  /**
   * Moving platforms (MV-02). Run `platformSystem(platforms)` earlier in the same fixed lane. A supported actor rides
   * its platform's exact displacement each tick; platforms are one-way in their own frame and may pick up an actor
   * they overtake. Horizontal carry and inherited motion slide against `Walls` and `Solid`s.
   */
  platforms?: Platforms;
  /** What leaving a platform keeps. Default 'add-velocity'. */
  onLeave?: PlatformLeave;
  /** Body radius for sliding carried motion against walls and solids (m), (0, 10]. Default 0.35. */
  radius?: number;
}

interface Body { feel: JumpFeel; supported: boolean; carrier: string | null; vx: number; vz: number }
const bodies = new WeakMap<World, Map<Entity, Body>>();
const EPS = 1e-9;

function length(name: string, value: number | undefined, max: number): number {
  const v = value ?? 0;
  if (!Number.isFinite(v) || v < 0 || v > max) throw new RangeError(`jump: ${name} must be within [0, ${max}]`);
  return v;
}

/**
 * Per fixed tick: ride the supporting platform, query support, step the controller, resolve the landing against the
 * same query (and the platforms' one-way catch) and publish the position. Without `platforms` it writes only
 * `Transform.y`; with them it also writes x and z for carried and inherited motion.
 * Presses are taken as the input layer reports them: one tick per press with the stock runtime. Cost: per target, two
 * support queries per tick plus O(platforms) for riding and catching; no draws.
 */
export function jumpSystem(o: JumpSystemOptions): SystemDefinition {
  if (!o || typeof o.action !== 'string' || !o.action || typeof o.ground !== 'function') throw new RangeError('jump: action and ground are required');
  createJumpFeel(o.config);   // validate eagerly: configuration errors surface at definition, not on the first tick
  const offset = length('groundOffset', o.groundOffset, 100), stepUp = length('stepHeight', o.stepHeight, 10), snap = length('snapDistance', o.snapDistance, 10);
  const leave = o.onLeave ?? 'add-velocity', platforms = o.platforms, radius = o.radius ?? 0.35;
  if (leave !== 'add-velocity' && leave !== 'add-upward' && leave !== 'none') throw new RangeError('jump: onLeave must be add-velocity, add-upward or none');
  if (!Number.isFinite(radius) || radius <= 0 || radius > 10) throw new RangeError('jump: radius must be within (0, 10]');
  const support = (x: number, z: number, below: number) => {
    const h = o.ground(x, z, below);
    if (h === null) return null;
    if (!Number.isFinite(h) || h > below + EPS) throw new RangeError('jump: ground must return a finite height at or below the query, or null');
    return h;
  };
  /** Planar motion through walls and solids, in sub-steps no longer than half the radius (at most 64). */
  const move = (world: World, tr: { x: number; z: number }, dx: number, dz: number) => {
    if (!dx && !dz) return;
    const steps = Math.min(64, Math.max(1, Math.ceil(Math.hypot(dx, dz) / (radius / 2)))), area = areaOf(world, radius);
    let p = { x: tr.x, z: tr.z };
    for (let i = 0; i < steps; i++) p = slide(area, p, { x: dx / steps, z: dz / steps });
    tr.x = p.x; tr.z = p.z;
  };
  return defineSystem({
    id: 'locomotion-jump',
    run(ctx, dt) {
      let byWorld = bodies.get(ctx.world);
      if (!byWorld) bodies.set(ctx.world, byWorld = new Map());
      const e = ctx.named(o.target ?? 'player'), tr = e === undefined ? undefined : ctx.world.get(e, Transform);
      // Only the current target keeps state: a despawned or renamed actor's controller is dropped (at most one entry).
      for (const key of byWorld.keys()) if (key !== e || !tr) byWorld.delete(key);
      if (e === undefined || !tr) return;
      let body = byWorld.get(e);
      if (!body) byWorld.set(e, body = { feel: createJumpFeel(o.config), supported: false, carrier: null, vx: 0, vz: 0 });
      // The stock runtime's press latch shows each press to exactly one fixed tick (STD-SIM-12), even across frames
      // that run no tick, so the press edge is used as given.
      const pressed = ctx.input.pressed(o.action);
      if (o.when && !o.when(ctx)) { body.feel.cancelPress(); return; }
      const x0 = tr.x, z0 = tr.z, y0 = tr.y;
      let feet = tr.y - offset;
      // Ride: follow the carrier's exact displacement for this tick, then check the actor is still on its footprint.
      let riding = false, lift = 0;
      // An actor resting exactly on a platform's previous top (placed there, or stepped on) rides from this tick.
      if (platforms && body.carrier === null && body.feel.vy <= 0) body.carrier = platforms.standing(tr.x, tr.z, feet);
      if (body.carrier !== null) {
        const id = body.carrier, d = platforms?.delta(id) ?? null, v = platforms?.velocity(id) ?? null;
        body.carrier = null;
        if (d && v) {
          move(ctx.world, tr, d.dx, d.dz);
          const top = platforms!.supportOn(id, tr.x, tr.z);
          if (top !== null) { feet = top; riding = true; body.carrier = id; lift = v.dy; }
          else departed(body, v, false);
        }
      } else if (!body.supported && (body.vx || body.vz)) move(ctx.world, tr, body.vx * dt, body.vz * dt);
      const rising = body.feel.vy > 0;
      // Static support: a supported actor may step up or snap down; an airborne one only touches what it rests on.
      const reach = body.supported && !rising ? stepUp : 0;
      const under = support(tr.x, tr.z, feet + reach);
      const onStatic = !rising && under !== null && feet - under <= (body.supported ? snap : 0) + EPS;
      const grounded = riding || onStatic;
      const boost = riding && leave !== 'none' ? (leave === 'add-upward' ? Math.max(0, lift) : lift) : 0;
      const r = body.feel.step(dt, { pressed, held: ctx.input.held(o.action), grounded, boost });
      const base = riding ? (onStatic ? Math.max(feet, under!) : feet) : onStatic ? under! : feet;
      let next = base + r.dy;
      body.supported = onStatic && !riding && !r.jumped;
      if (riding && !r.jumped) next = base;   // stays on the carrier; gravity resumes when it leaves
      else {
        if (riding && r.jumped) { const v = platforms!.velocity(body.carrier!)!; body.carrier = null; departed(body, v, true); }
        let landed: number | null = null;
        if (r.vy <= 0) {
          // Swept against the support query from the highest point of the tick (an apex inside the tick included) down
          // to its end: anything crossed while descending is found, at any speed.
          const top = Math.max(onStatic ? Math.max(feet, under!) : feet, base + r.peak);
          const land = support(tr.x, tr.z, top);
          if (land !== null && next <= land + EPS) landed = land;
        }
        const caught = platforms?.catch(tr.x, tr.z, base + r.peak, next) ?? null;
        if (caught && (landed === null || caught.height >= landed)) {
          next = caught.height; body.carrier = caught.id; body.supported = false; body.vx = body.vz = 0;
          if (body.feel.vy > 0) body.feel.setVelocity(0);
        } else if (landed !== null) { next = landed; body.supported = true; body.vx = body.vz = 0; }
      }
      if (body.supported || body.carrier !== null) body.vx = body.vz = 0;
      const y = next + offset;
      if (y !== y0) tr.y = y;
      if (tr.x !== x0 || tr.z !== z0 || tr.y !== y0) ctx.world.touch();
    },
  });
  /** Apply the leave policy: horizontal velocity to keep while airborne, and vertical velocity when not jumping. */
  function departed(body: Body, v: { dx: number; dy: number; dz: number }, jumped: boolean) {
    body.vx = leave === 'add-velocity' ? v.dx : 0; body.vz = leave === 'add-velocity' ? v.dz : 0;
    if (!jumped && leave !== 'none') {
      const up = leave === 'add-upward' ? Math.max(0, v.dy) : v.dy;
      if (up) body.feel.setVelocity(up);
    }
  }
}

/**
 * Advance `platforms` by each fixed tick and publish their poses to named entities (`bind: { platformId: 'name' }`,
 * Transform x/y/z = top-centre pose). Put it before the movers and `jumpSystem` in the same fixed lane.
 */
export function platformSystem(platforms: Platforms, o: { bind?: Readonly<Record<string, string>> } = {}): SystemDefinition {
  if (!platforms || typeof platforms.advance !== 'function') throw new RangeError('platforms: a registry is required');
  const bind = Object.entries(o.bind ?? {});
  return defineSystem({
    id: 'locomotion-platforms',
    run(ctx, dt) {
      platforms.advance(dt);
      for (const [id, name] of bind) {
        const p = platforms.pose(id), e = ctx.named(name), tr = e === undefined ? undefined : ctx.world.get(e, Transform);
        if (!p || !tr || (tr.x === p.x && tr.y === p.y && tr.z === p.z)) continue;
        tr.x = p.x; tr.y = p.y; tr.z = p.z; ctx.world.touch();
      }
    },
  });
}

/** Clear jump state on an authority change or a teleport, without moving the actor. */
export function resetJump(world: World, entity?: Entity): void {
  const active = bodies.get(world); if (!active) return;
  for (const [e, body] of active) if (entity === undefined || e === entity) { body.feel.reset(); body.supported = false; body.carrier = null; body.vx = body.vz = 0; }
}

/** Diagnostic: how many actors hold adapter state in this world (0 or 1 per running `jumpSystem` target). */
export function jumpStateCount(world: World): number { return bodies.get(world)?.size ?? 0; }
