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

interface Body {
  feel: JumpFeel; supported: boolean; vx: number; vz: number;
  /** The platform carrying the actor, and its pose when the actor last moved with it. */
  carrier: string | null; cx: number; cy: number; cz: number;
}
const bodies = new WeakMap<World, Map<Entity, Body>>();
const EPS = 1e-9;
/** Sub-steps per tick for carried and inherited planar motion; more would be needed above 512 radii per tick. */
const MAX_SLIDE_STEPS = 1024;

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
  /**
   * Planar motion through walls and solids, in sub-steps of at most half the radius. A sub-step that short cannot cross
   * a solid's outline inflated by the radius (at least two radii wide), so carried motion does not tunnel. Motion
   * needing more than 1,024 sub-steps (over 512 radii in one tick) is refused before anything changes.
   */
  const slideBy = (world: World, from: { x: number; z: number }, dx: number, dz: number) => {
    if (!dx && !dz) return { x: from.x, z: from.z };
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / (radius / 2)));
    if (steps > MAX_SLIDE_STEPS) throw new RangeError(`jump: carried motion of ${Math.hypot(dx, dz).toFixed(3)} m in one tick exceeds 512 radii`);
    const area = areaOf(world, radius);
    let p = { x: from.x, z: from.z };
    for (let i = 0; i < steps; i++) p = slide(area, p, { x: dx / steps, z: dz / steps });
    return p;
  };
  const clampBoost = (v: number) => Math.max(-1000, Math.min(1000, v));
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
      if (!body) byWorld.set(e, body = { feel: createJumpFeel(o.config), supported: false, vx: 0, vz: 0, carrier: null, cx: 0, cy: 0, cz: 0 });
      const active = !o.when || o.when(ctx);
      // The stock runtime's press latch shows each press to exactly one fixed tick (STD-SIM-12), even across frames
      // that run no tick, so the press edge is used as given. An inactive tick drops any pending press.
      const pressed = active && ctx.input.pressed(o.action);
      if (!active) body.feel.cancelPress();
      const feet0 = tr.y - offset;
      let x = tr.x, z = tr.z, feet = feet0;

      // ---- Ride. Every quantity is computed before any state changes; writes happen at the end of the tick.
      let ride: { id: string; dx: number; dy: number; dz: number; vx: number; vy: number; vz: number; top: number; px: number; py: number; pz: number } | null = null;
      let left: { vx: number; vy: number; vz: number } | null = null;   // a carrier left this tick by moving off it
      if (platforms && body.carrier === null && body.feel.vy <= 0) {
        // An actor resting exactly on a platform's previous top (placed there, or stepped on) rides from this tick.
        const id = platforms.standing(x, z, feet);
        const p = id === null ? null : platforms.pose(id), d = id === null ? null : platforms.delta(id);
        if (id !== null && p && d) { body.carrier = id; body.cx = p.x - d.dx; body.cy = p.y - d.dy; body.cz = p.z - d.dz; }
      }
      if (body.carrier !== null) {
        const id = body.carrier, p = platforms?.pose(id) ?? null, d = platforms?.delta(id) ?? null, v = platforms?.velocity(id) ?? null;
        // The platform must have moved continuously since the actor last moved with it: frozen (no advance since), or
        // exactly one advance by `delta`. A cut, a restart, a removal and re-add, or an actor moved vertically by
        // another owner is a discontinuity, and the actor detaches with no velocity.
        const still = p !== null && Math.abs(p.x - body.cx) <= EPS && Math.abs(p.y - body.cy) <= EPS && Math.abs(p.z - body.cz) <= EPS;
        const stepped = p !== null && d !== null && Math.abs(body.cx + d.dx - p.x) <= EPS && Math.abs(body.cy + d.dy - p.y) <= EPS && Math.abs(body.cz + d.dz - p.z) <= EPS;
        const attached = Math.abs(feet - body.cy) <= EPS;
        if (p && v && (still || stepped) && attached) {
          const m = still ? { dx: 0, dy: 0, dz: 0 } : d!, vel = still ? { dx: 0, dy: 0, dz: 0 } : v;
          const moved = slideBy(ctx.world, { x, z }, m.dx, m.dz), top = platforms!.supportOn(id, moved.x, moved.z);
          if (top !== null) ride = { id, dx: moved.x - x, dy: m.dy, dz: moved.z - z, vx: vel.dx, vy: vel.dy, vz: vel.dz, top, px: p.x, py: p.y, pz: p.z };
          else { left = { vx: vel.dx, vy: vel.dy, vz: vel.dz }; x = moved.x; z = moved.z; }
        }
      } else if (active && !body.supported && (body.vx || body.vz)) {
        const moved = slideBy(ctx.world, { x, z }, body.vx * dt, body.vz * dt); x = moved.x; z = moved.z;
      }

      if (!active) {
        // Paused movement still rides: the actor stays on its carrier (or drops off it) but nothing else simulates.
        const carrier = ride;
        body.carrier = carrier ? carrier.id : null;
        if (carrier) { x += carrier.dx; z += carrier.dz; feet = carrier.top; body.cx = carrier.px; body.cy = carrier.py; body.cz = carrier.pz; }
        publish(ctx, tr, x, z, feet);
        return;
      }

      // ---- Static support and the controller.
      const riding = ride !== null, rx = riding ? x + ride!.dx : x, rz = riding ? z + ride!.dz : z, rideTop = riding ? ride!.top : feet;
      const rising = body.feel.vy > 0;
      const reach = (body.supported || riding) && !rising ? stepUp : 0;
      const standFeet = riding ? rideTop : feet;
      const under = support(rx, rz, standFeet + reach);
      const onStatic = !riding && !rising && under !== null && feet - under <= (body.supported ? snap : 0) + EPS;
      if (left && leave !== 'none') {
        const up = leave === 'add-upward' ? Math.max(0, left.vy) : left.vy;
        if (up) body.feel.setVelocity(clampBoost(up), true);
      }
      const lift = riding && leave !== 'none' ? clampBoost(leave === 'add-upward' ? Math.max(0, ride!.vy) : ride!.vy) : 0;
      const r = body.feel.step(dt, { pressed, held: ctx.input.held(o.action), grounded: riding || onStatic, boost: lift });

      // ---- Resolve the tick. Queries first; adapter state and the Transform change only after all of them succeed.
      const carried = riding && !r.jumped;
      let next: number, top: number, staticSupported = false;
      if (carried) {
        // Carried: end on the carrier's top unless static ground, or another platform overtaking it, is higher.
        x = rx; z = rz; next = rideTop; top = Math.max(feet0, rideTop);
      } else {
        // Jumping off a carrier: vertical motion starts from the top the actor stood on at the start of the tick (the
        // launch boost carries the platform's rise); the tick's horizontal ride is kept only with add-velocity.
        if (riding && leave === 'add-velocity') { x = rx; z = rz; }
        const base = onStatic ? under! : feet;
        next = base + r.dy; top = Math.max(onStatic ? Math.max(feet, under!) : feet, base + r.peak);
        staticSupported = onStatic && !r.jumped;
        if (staticSupported) next = Math.max(next, under!);
      }
      // Sweep static ground and every platform's one-way catch from the highest point of the tick down to its end.
      let land: number | null = null;
      if (carried || r.vy <= 0) { const h = support(x, z, top + (carried ? stepUp : 0)); if (h !== null && next <= h + EPS) land = h; }
      const caught = platforms?.catch(x, z, top, next) ?? null;
      const caughtPose = caught ? platforms!.pose(caught.id) : null;
      const best = Math.max(land ?? -Infinity, caught?.height ?? -Infinity);

      body.carrier = null; body.supported = staticSupported;
      if (left) { body.vx = leave === 'add-velocity' ? left.vx : 0; body.vz = leave === 'add-velocity' ? left.vz : 0; }
      if (riding && r.jumped) { body.vx = leave === 'add-velocity' ? ride!.vx : 0; body.vz = leave === 'add-velocity' ? ride!.vz : 0; }
      if (carried && best <= next) {
        // Stay on the carrier: only a strictly higher surface takes over (an exact tie keeps it).
        body.carrier = ride!.id; body.cx = ride!.px; body.cy = ride!.py; body.cz = ride!.pz;
      } else if (caught && caughtPose && caught.height >= (land ?? -Infinity)) {
        next = caught.height; body.carrier = caught.id; body.supported = false;
        body.cx = caughtPose.x; body.cy = caughtPose.y; body.cz = caughtPose.z;
        if (body.feel.vy > 0) body.feel.setVelocity(0);
      } else if (land !== null) { next = land; body.supported = true; }
      if (body.supported || body.carrier !== null) body.vx = body.vz = 0;
      publish(ctx, tr, x, z, next);
    },
  });
  function publish(ctx: SceneContext, tr: { x: number; y: number; z: number }, x: number, z: number, feet: number) {
    const y = feet + offset;
    if (x === tr.x && z === tr.z && y === tr.y) return;
    tr.x = x; tr.z = z; tr.y = y; ctx.world.touch();
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
