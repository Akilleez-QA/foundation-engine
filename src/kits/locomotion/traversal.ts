/**
 * Traversal helpers: ledge detection, ladders and pushable blocks. Pure functions and small state over creator
 * geometry queries, so any collision owner can answer them; the optional volume-query kit's `sweepVolume` fits the
 * `cast` shape (sphere sweep returning a fraction and a normal). No entity, clock or physics owner is installed: the
 * caller decides when to grab, climb, push or let go, and applies the returned positions through its own movement.
 */
export type TraversalVec3 = readonly [number, number, number];
/** Sweep a sphere of `radius` from `from` to `to`; `fraction` in [0, 1] of the way, `normal` from the surface. */
export type SphereCast = (
  from: TraversalVec3,
  to: TraversalVec3,
  radius: number,
) => {readonly hit: false} | {readonly hit: true; readonly fraction: number; readonly normal: TraversalVec3};
/** Height of the walkable surface under (x, z) searching down from `fromY` by at most `maxDrop`, or null. */
export type GroundProbe = (x: number, z: number, fromY: number, maxDrop: number) => number | null;

function fail(message: string): never {
  throw new RangeError(`traversal: ${message}`);
}
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const vec = (v: unknown, what: string): TraversalVec3 => {
  if (!Array.isArray(v) || v.length !== 3) fail(`${what} must be [x, y, z]`);
  const out: TraversalVec3 = [v[0], v[1], v[2]];
  if (!out.every(finite)) fail(`${what} must be finite`);
  return out;
};
const frozen = (v: readonly number[]): TraversalVec3 => Object.freeze<TraversalVec3>([v[0]!, v[1]!, v[2]!]);
const positive = (v: unknown, max: number, what: string): number => {
  if (!finite(v) || v <= 0 || v > max) fail(`${what} must be within (0, ${max}]`);
  return v;
};
const castOnce = (cast: SphereCast, from: TraversalVec3, to: TraversalVec3, r: number) => {
  const res = cast(from, to, r);
  if (!res || typeof res !== 'object') fail('cast must return a result');
  if (!res.hit) return null;
  const fraction: unknown = res.fraction;
  if (!finite(fraction) || fraction < 0 || fraction > 1) fail('cast fraction must be within [0, 1]');
  const n = vec(res.normal, 'cast normal');
  const len = Math.hypot(n[0], n[1], n[2]);
  if (len < 1e-9) fail('cast normal must be nonzero');
  return {fraction, normal: frozen([n[0] / len, n[1] / len, n[2] / len])};
};

// ------------------------------------------------------------------ ledges

export interface LedgeQuery {
  /** Feet position of the body. */
  readonly position: TraversalVec3;
  /** Horizontal facing (x, z); normalised internally. */
  readonly facing: readonly [number, number];
  /** Body height and radius. */
  readonly height: number;
  readonly radius: number;
  /** How far ahead a wall may be, (0, 100]. */
  readonly reach: number;
  /** Ledge top relative to the feet must be within [minClimb, maxClimb]. */
  readonly minClimb?: number;
  readonly maxClimb: number;
  /** Largest |normal.y| accepted for the wall (default 0.3: near vertical). */
  readonly wallSlope?: number;
}
export type LedgeResult =
  | {
      readonly status: 'ledge';
      /** The point on the ledge edge at the top height, the standing point on top, and the wall's outward normal. */
      readonly edge: TraversalVec3;
      readonly top: TraversalVec3;
      readonly normal: TraversalVec3;
      /** Top height minus feet height. */
      readonly climb: number;
    }
  | {readonly status: 'no-wall' | 'not-a-wall' | 'no-top' | 'too-low' | 'too-high' | 'no-headroom'};

/**
 * Look for a ledge ahead: a near-vertical wall within `reach` at chest height, a walkable top just beyond it within
 * [minClimb, maxClimb] above the feet, and headroom for the whole body on top. Uses four creator queries at most
 * (wall cast, a cast over the top to make sure the space above the edge is open, the ground probe, the headroom cast).
 */
export function findLedge(q: LedgeQuery, cast: SphereCast, ground: GroundProbe): LedgeResult {
  const p = vec(q.position, 'position');
  if (!Array.isArray(q.facing) || q.facing.length !== 2) fail('facing must be [x, z]');
  const fx0: unknown = q.facing[0],
    fz0: unknown = q.facing[1];
  if (!finite(fx0) || !finite(fz0) || Math.hypot(fx0, fz0) < 1e-9) fail('facing must be a nonzero direction');
  const fl = Math.hypot(fx0, fz0),
    fx = fx0 / fl,
    fz = fz0 / fl;
  const height = positive(q.height, 100, 'height'),
    radius = positive(q.radius, 10, 'radius'),
    reach = positive(q.reach, 100, 'reach'),
    maxClimb = positive(q.maxClimb, 100, 'maxClimb'),
    minClimb = q.minClimb ?? 0,
    wallSlope = q.wallSlope ?? 0.3;
  if (!finite(minClimb) || minClimb < 0 || minClimb > maxClimb) fail('minClimb must be within [0, maxClimb]');
  if (!finite(wallSlope) || wallSlope < 0 || wallSlope > 1) fail('wallSlope must be within [0, 1]');
  // 1. A wall at chest height.
  const chest: TraversalVec3 = [p[0], p[1] + height * 0.5, p[2]];
  const wall = castOnce(cast, chest, [chest[0] + fx * reach, chest[1], chest[2] + fz * reach], radius);
  if (!wall) return Object.freeze({status: 'no-wall'});
  if (Math.abs(wall.normal[1]) > wallSlope) return Object.freeze({status: 'not-a-wall'});
  const dist = wall.fraction * reach;
  // 2. The space above the ledge must be open: cast forward at the highest climbable height.
  const over: TraversalVec3 = [p[0], p[1] + maxClimb + radius, p[2]];
  const ahead = dist + radius * 2;
  if (castOnce(cast, over, [over[0] + fx * ahead, over[1], over[2] + fz * ahead], radius))
    return Object.freeze({status: 'too-high'});
  // 3. The top surface just beyond the wall.
  const tx = p[0] + fx * ahead,
    tz = p[2] + fz * ahead;
  const topY = ground(tx, tz, over[1], maxClimb + radius);
  if (topY === null) return Object.freeze({status: 'no-top'});
  if (!finite(topY)) fail('ground must return a finite height or null');
  const climb = topY - p[1];
  if (climb < minClimb) return Object.freeze({status: 'too-low'});
  if (climb > maxClimb) return Object.freeze({status: 'too-high'});
  // 4. Headroom: the body stands on top.
  const top: TraversalVec3 = [tx, topY, tz];
  if (castOnce(cast, [tx, topY + radius, tz], [tx, topY + Math.max(radius, height - radius), tz], radius))
    return Object.freeze({status: 'no-headroom'});
  return Object.freeze({
    status: 'ledge',
    edge: frozen([p[0] + fx * (dist + radius), topY, p[2] + fz * (dist + radius)]),
    top: frozen(top),
    normal: wall.normal,
    climb,
  });
}

// ------------------------------------------------------------------ ladders

export interface Ladder {
  readonly id: string;
  readonly bottom: TraversalVec3;
  readonly top: TraversalVec3;
  /** Horizontal outward direction (x, z): the side a climber stands on. */
  readonly outward: readonly [number, number];
  /** Distance from the ladder line to the climber's centre, (0, 10]. Default 0.4. */
  readonly offset?: number;
}
export interface LadderGrip {
  readonly ladder: string;
  /** Position along the ladder, [0, 1] bottom to top. */
  readonly t: number;
}

/**
 * Ladders as authored segments. `attach` finds the nearest ladder within `maxDistance` whose climbing side the body
 * faces, `climb` moves along it at `speed` (units per second) by input in [−1, 1] and reports exits at either end, and
 * `pose` gives the body position for a grip. Pure: the caller switches its own movement owner while attached.
 */
export function createLadders(list: readonly Ladder[]) {
  if (!Array.isArray(list) || list.length < 1 || list.length > 1024) fail('1-1,024 ladders');
  const ids = new Set<string>();
  const ladders: {
    id: string;
    bottom: TraversalVec3;
    top: TraversalVec3;
    ox: number;
    oz: number;
    offset: number;
    length: number;
  }[] = [];
  for (let i = 0; i < list.length; i++) {
    const l = list[i];
    if (!l || typeof l !== 'object') fail(`ladder ${i} must be an object`);
    const id: unknown = l.id;
    if (typeof id !== 'string' || !id || ids.has(id)) fail('ladder ids must be unique names');
    ids.add(id);
    const bottom = vec(l.bottom, `${id} bottom`),
      top = vec(l.top, `${id} top`);
    const length = Math.hypot(top[0] - bottom[0], top[1] - bottom[1], top[2] - bottom[2]);
    if (length < 1e-6 || top[1] <= bottom[1]) fail(`${id}: top must be above bottom`);
    if (!Array.isArray(l.outward) || l.outward.length !== 2) fail(`${id}: outward is [x, z]`);
    const ox0: unknown = l.outward[0],
      oz0: unknown = l.outward[1];
    if (!finite(ox0) || !finite(oz0) || Math.hypot(ox0, oz0) < 1e-9) fail(`${id}: outward must be nonzero`);
    const ol = Math.hypot(ox0, oz0);
    const offset = l.offset === undefined ? 0.4 : positive(l.offset, 10, `${id} offset`);
    ladders.push({id, bottom, top, ox: ox0 / ol, oz: oz0 / ol, offset, length});
  }
  const byId = new Map(ladders.map(l => [l.id, l]));
  const at = (l: (typeof ladders)[number], t: number): TraversalVec3 =>
    frozen([
      l.bottom[0] + (l.top[0] - l.bottom[0]) * t + l.ox * l.offset,
      l.bottom[1] + (l.top[1] - l.bottom[1]) * t,
      l.bottom[2] + (l.top[2] - l.bottom[2]) * t + l.oz * l.offset,
    ]);
  return {
    /** The nearest ladder within `maxDistance` that `facing` points at (from its outward side), or null. */
    attach(position: TraversalVec3, facing: readonly [number, number], maxDistance = 0.8): LadderGrip | null {
      const p = vec(position, 'position');
      if (!Array.isArray(facing) || facing.length !== 2 || !finite(facing[0]) || !finite(facing[1]))
        fail('facing must be [x, z]');
      if (!finite(maxDistance) || maxDistance <= 0) fail('maxDistance must be positive');
      let best: LadderGrip | null = null,
        bestD = Infinity;
      for (const l of ladders) {
        // Facing into the ladder means opposite to its outward direction.
        if (facing[0] * l.ox + facing[1] * l.oz > -0.5 * Math.hypot(facing[0], facing[1])) continue;
        const dx = l.top[0] - l.bottom[0],
          dy = l.top[1] - l.bottom[1],
          dz = l.top[2] - l.bottom[2];
        const t = Math.max(
          0,
          Math.min(
            1,
            ((p[0] - l.bottom[0]) * dx + (p[1] - l.bottom[1]) * dy + (p[2] - l.bottom[2]) * dz) / (l.length * l.length),
          ),
        );
        const g = at(l, t);
        const d = Math.hypot(g[0] - p[0], g[2] - p[2]);
        if (d <= maxDistance && Math.abs(g[1] - p[1]) <= l.length && d < bestD) {
          bestD = d;
          best = Object.freeze({ladder: l.id, t});
        }
      }
      return best;
    },
    /** Move along the ladder; `exit` reports leaving at an end (the grip is then clamped at that end). */
    climb(
      grip: LadderGrip,
      input: number,
      speed: number,
      dt: number,
    ): {readonly grip: LadderGrip; readonly exit: 'top' | 'bottom' | null} {
      const l = byId.get(grip.ladder);
      if (!l) fail(`unknown ladder ${String(grip.ladder)}`);
      if (!finite(grip.t) || grip.t < 0 || grip.t > 1) fail('grip t must be within [0, 1]');
      if (!finite(input) || input < -1 || input > 1) fail('input must be within [-1, 1]');
      if (!finite(speed) || speed < 0 || !finite(dt) || dt < 0) fail('speed and dt must be ≥ 0');
      const t = grip.t + (input * speed * dt) / l.length;
      const exit = t > 1 ? 'top' : t < 0 ? 'bottom' : null;
      return Object.freeze({grip: Object.freeze({ladder: l.id, t: Math.max(0, Math.min(1, t))}), exit});
    },
    /** Body position for a grip (on the outward side). */
    pose(grip: LadderGrip): TraversalVec3 {
      const l = byId.get(grip.ladder);
      if (!l) fail(`unknown ladder ${String(grip.ladder)}`);
      return at(l, Math.max(0, Math.min(1, grip.t)));
    },
    /** Where to stand after leaving at the top: past the top, away from the outward side by `step`. */
    topExit(grip: LadderGrip, step = 0.5): TraversalVec3 {
      const l = byId.get(grip.ladder);
      if (!l) fail(`unknown ladder ${String(grip.ladder)}`);
      return frozen([l.top[0] - l.ox * step, l.top[1], l.top[2] - l.oz * step]);
    },
  };
}

// ------------------------------------------------------------------ pushables

/** Fraction in [0, 1] of `displacement` the box (centre, half extents) can move before touching anything. */
export type BoxSweep = (center: TraversalVec3, half: TraversalVec3, displacement: TraversalVec3) => number;

export interface PushableState {
  readonly position: TraversalVec3;
  /** Horizontal velocity (x, z). */
  readonly velocity: readonly [number, number];
}
/**
 * One step of a pushable block: a horizontal push force (x, z, newtons-like units) accelerates it by force / mass,
 * friction decelerates it by `friction` (units per second²) when nothing pushes, speed is capped by `maxSpeed`, and
 * the move is limited by the creator's `sweep` (a hit stops that axis). With `snap`, pushes move it whole cells of
 * that size along the dominant axis only. Returns the new state and whether it was blocked.
 */
export function pushStep(
  state: PushableState,
  options: {
    readonly half: TraversalVec3;
    readonly mass: number;
    readonly force: readonly [number, number];
    readonly dt: number;
    readonly sweep: BoxSweep;
    readonly friction?: number;
    readonly maxSpeed?: number;
    /** Cell size for grid pushing, (0, 1e3]; the block moves to the next cell centre along the dominant push axis. */
    readonly snap?: number;
  },
): {readonly state: PushableState; readonly blocked: boolean} {
  const pos = vec(state.position, 'position');
  if (!Array.isArray(state.velocity) || state.velocity.length !== 2) fail('velocity must be [x, z]');
  const vx0: unknown = state.velocity[0],
    vz0: unknown = state.velocity[1];
  if (!finite(vx0) || !finite(vz0)) fail('velocity must be finite');
  let vx: number = vx0,
    vz: number = vz0;
  const half = vec(options.half, 'half');
  if (!half.every(h => h > 0)) fail('half extents must be positive');
  const mass = positive(options.mass, 1e6, 'mass'),
    dtIn: unknown = options.dt,
    friction = options.friction ?? 8,
    maxSpeed = options.maxSpeed ?? 2;
  if (!finite(dtIn) || dtIn < 0 || dtIn > 1) fail('dt must be within [0, 1]');
  const dt: number = dtIn;
  if (!finite(friction) || friction < 0 || !finite(maxSpeed) || maxSpeed <= 0) fail('friction ≥ 0 and maxSpeed > 0');
  if (!Array.isArray(options.force) || options.force.length !== 2) fail('force must be [x, z]');
  const fx: unknown = options.force[0],
    fz: unknown = options.force[1];
  if (!finite(fx) || !finite(fz)) fail('force must be finite');
  const sweep = (d: TraversalVec3) => {
    const f = options.sweep(pos, half, d);
    if (!finite(f) || f < 0 || f > 1) fail('sweep must return a fraction within [0, 1]');
    return f;
  };
  if (options.snap !== undefined) {
    const cell = positive(options.snap, 1e3, 'snap');
    if (fx === 0 && fz === 0)
      return Object.freeze({
        state: Object.freeze({position: frozen(pos), velocity: Object.freeze([0, 0] as [number, number])}),
        blocked: false,
      });
    const alongX = Math.abs(fx) >= Math.abs(fz);
    const dir = Math.sign(alongX ? fx : fz);
    const d: TraversalVec3 = alongX ? [dir * cell, 0, 0] : [0, 0, dir * cell];
    const f = sweep(d);
    if (f < 1)
      return Object.freeze({
        state: Object.freeze({position: frozen(pos), velocity: Object.freeze([0, 0] as [number, number])}),
        blocked: true,
      });
    return Object.freeze({
      state: Object.freeze({
        position: frozen([pos[0] + d[0], pos[1], pos[2] + d[2]]),
        velocity: Object.freeze([0, 0] as [number, number]),
      }),
      blocked: false,
    });
  }
  // Accelerate by the push, then apply friction to what remains, then cap speed.
  vx += (fx / mass) * dt;
  vz += (fz / mass) * dt;
  const speed = Math.hypot(vx, vz);
  if (fx === 0 && fz === 0 && speed > 0) {
    const slowed = Math.max(0, speed - friction * dt);
    vx = (vx / speed) * slowed;
    vz = (vz / speed) * slowed;
  }
  const capped = Math.hypot(vx, vz);
  if (capped > maxSpeed) {
    vx = (vx / capped) * maxSpeed;
    vz = (vz / capped) * maxSpeed;
  }
  // Resolve each axis separately so a block slides along a wall instead of sticking.
  let blocked = false,
    x = pos[0],
    z = pos[2];
  for (const axis of [0, 2] as const) {
    const v = axis === 0 ? vx : vz;
    if (v === 0) continue;
    const d: TraversalVec3 = axis === 0 ? [v * dt, 0, 0] : [0, 0, v * dt];
    const f = options.sweep([x, pos[1], z], half, d);
    if (!finite(f) || f < 0 || f > 1) fail('sweep must return a fraction within [0, 1]');
    if (axis === 0) x += d[0] * f;
    else z += d[2] * f;
    if (f < 1) {
      blocked = true;
      if (axis === 0) vx = 0;
      else vz = 0;
    }
  }
  return Object.freeze({
    state: Object.freeze({position: frozen([x, pos[1], z]), velocity: Object.freeze([vx, vz] as [number, number])}),
    blocked,
  });
}
