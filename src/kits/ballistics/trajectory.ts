/**
 * Drag-free ballistic trajectories under constant gravity along -y. Pure functions over plain values: no clock,
 * entity, physics world or scheduler. The creator chooses units (metres and seconds are typical), gravity and what
 * a solved arc is used for (a throw, a jump, a launch pad, an aim preview, an AI reachability test).
 */
export type BallisticVec3 = readonly [number, number, number];

/** A launch: start position, start velocity, gravity magnitude (> 0, acting along -y) and flight duration. */
export interface Trajectory {
  readonly origin: BallisticVec3;
  readonly velocity: BallisticVec3;
  readonly gravity: number;
  /** Time at which the arc reaches its intended end (the target, or the chosen landing height). */
  readonly duration: number;
}

export type Solution =
  | {readonly status: 'solved'; readonly trajectory: Trajectory}
  | {readonly status: 'unreachable'; readonly reason: string};

/** Hard ceilings so every helper does bounded work. */
export const BALLISTIC_LIMITS = Object.freeze({maxSamples: 4096, maxLeadSamples: 4096, maxMagnitude: 1e9});

const fail = (message: string): never => {
  throw new RangeError(`ballistics: ${message}`);
};
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= BALLISTIC_LIMITS.maxMagnitude;
function vec(value: unknown, what: string): BallisticVec3 {
  if (!Array.isArray(value) || value.length !== 3) return fail(`${what} must be [x, y, z]`);
  const x = value[0] as unknown,
    y = value[1] as unknown,
    z = value[2] as unknown;
  if (!finite(x) || !finite(y) || !finite(z)) return fail(`${what} must be finite (|v| <= 1e9)`);
  return Object.freeze([x + 0, y + 0, z + 0]) as BallisticVec3;
}
function positive(value: unknown, what: string): number {
  if (!finite(value) || value <= 0) return fail(`${what} must be finite and positive`);
  return value;
}
const unreachable = (reason: string): Solution => Object.freeze({status: 'unreachable', reason});

/**
 * Internal: inputs already validated. Any duration or velocity outside the (0, 1e9] domain becomes `unreachable`,
 * so every `solved` trajectory is accepted by the evaluators.
 */
function fromDuration(a: BallisticVec3, b: BallisticVec3, t: number, g: number): Solution {
  if (!(t > 0) || !finite(t)) return unreachable('the flight time is outside the (0, 1e9] domain');
  const velocity: [number, number, number] = [(b[0] - a[0]) / t, (b[1] - a[1]) / t + (g * t) / 2, (b[2] - a[2]) / t];
  if (!velocity.every(finite)) return unreachable('the launch velocity is outside the 1e9 domain');
  return Object.freeze({
    status: 'solved',
    trajectory: Object.freeze({origin: a, velocity: Object.freeze(velocity) as BallisticVec3, gravity: g, duration: t}),
  });
}

/**
 * Both times at which height changes by `rise` with vertical speed `vs` (g t^2 - 2 vs t + 2 rise = 0), smaller
 * first, computed without cancellation; null when the height is never reached.
 */
function crossings(vs: number, rise: number, g: number): readonly [number, number] | null {
  const discriminant = vs * vs - 2 * g * rise;
  if (discriminant < 0) return null;
  const root = Math.sqrt(discriminant);
  const q = vs >= 0 ? vs + root : vs - root;
  if (q === 0) return [0, 0];
  const t1 = q / g,
    t2 = (2 * rise) / q;
  return t1 <= t2 ? [t1, t2] : [t2, t1];
}

/** Arrive at `to` exactly `duration` seconds after leaving `from`. `unreachable` only outside the numeric domain. */
export function solveByDuration(from: BallisticVec3, to: BallisticVec3, duration: number, gravity: number): Solution {
  const a = vec(from, 'from'),
    b = vec(to, 'to'),
    t = positive(duration, 'duration'),
    g = positive(gravity, 'gravity');
  return fromDuration(a, b, t, g);
}

/** Move horizontally at a constant `speed`; the vertical launch speed is whatever reaches `to`'s height. */
export function solveByHorizontalSpeed(
  from: BallisticVec3,
  to: BallisticVec3,
  speed: number,
  gravity: number,
): Solution {
  const a = vec(from, 'from'),
    b = vec(to, 'to'),
    v = positive(speed, 'speed'),
    g = positive(gravity, 'gravity');
  const distance = Math.hypot(b[0] - a[0], b[2] - a[2]);
  if (distance === 0) return unreachable('no horizontal distance: duration is undefined for a horizontal speed');
  return fromDuration(a, b, distance / v, g);
}

function byVertical(a: BallisticVec3, b: BallisticVec3, vs: number, g: number, branch: 'descending' | 'ascending') {
  const roots = crossings(vs, b[1] - a[1], g);
  if (!roots) return unreachable('the target is above the apex');
  const t = branch === 'descending' ? roots[1] : roots[0];
  if (!(t > 0)) return unreachable('the requested crossing is not after launch');
  return fromDuration(a, b, t, g);
}

/**
 * Leave with vertical speed `verticalSpeed` (positive is up) and arrive at `to`. `branch` picks the later
 * (`'descending'`, default: the arc comes down onto the target) or the earlier (`'ascending'`) crossing of the
 * target height; `unreachable` when the arc never gets that high or the crossing is not after launch.
 */
export function solveByVerticalSpeed(
  from: BallisticVec3,
  to: BallisticVec3,
  verticalSpeed: number,
  gravity: number,
  branch: 'descending' | 'ascending' = 'descending',
): Solution {
  const a = vec(from, 'from'),
    b = vec(to, 'to');
  if (!finite(verticalSpeed)) fail('verticalSpeed must be finite');
  const g = positive(gravity, 'gravity');
  if (branch !== 'descending' && branch !== 'ascending') fail('branch must be descending or ascending');
  return byVertical(a, b, verticalSpeed + 0, g, branch);
}

/** Peak `height` (>= 0) above the higher of the two endpoints, then come down onto `to`. */
export function solveByApexHeight(from: BallisticVec3, to: BallisticVec3, height: number, gravity: number): Solution {
  const a = vec(from, 'from'),
    b = vec(to, 'to');
  if (!finite(height) || height < 0) fail('height must be finite and nonnegative');
  const g = positive(gravity, 'gravity');
  const apex = Math.max(a[1], b[1]) + height;
  // Rise time to the apex plus fall time from it: closed form, no discriminant to round below zero.
  const t = Math.sqrt((2 * (apex - a[1])) / g) + Math.sqrt((2 * (apex - b[1])) / g);
  if (!(t > 0)) return unreachable('a zero-height arc between equal heights has no duration');
  return fromDuration(a, b, t, g);
}

/**
 * Fixed launch `speed` (magnitude of the whole velocity): choose the elevation that hits `to`. `arc` selects the
 * flatter (`'low'`, default) or lobbed (`'high'`) of the two solutions. For a target straight above or below,
 * `low` is the direct shot and `high` goes up and falls back onto it. `unreachable` when out of range.
 */
export function solveByLaunchSpeed(
  from: BallisticVec3,
  to: BallisticVec3,
  speed: number,
  gravity: number,
  arc: 'low' | 'high' = 'low',
): Solution {
  const a = vec(from, 'from'),
    b = vec(to, 'to'),
    v = positive(speed, 'speed'),
    g = positive(gravity, 'gravity');
  if (arc !== 'low' && arc !== 'high') fail('arc must be low or high');
  return byLaunchSpeed(a, b, v, g, arc);
}

function byLaunchSpeed(a: BallisticVec3, b: BallisticVec3, v: number, g: number, arc: 'low' | 'high'): Solution {
  const dx = b[0] - a[0],
    dz = b[2] - a[2],
    dy = b[1] - a[1];
  const d = Math.hypot(dx, dz);
  const v2 = v * v;
  if (d === 0) {
    if (dy > 0 && v2 < 2 * g * dy) return unreachable('out of range at this speed');
    if (dy === 0 && arc === 'low') return unreachable('the target is the launch point');
    if (arc === 'low') return byVertical(a, b, dy > 0 ? v : -v, g, dy > 0 ? 'ascending' : 'descending');
    return byVertical(a, b, v, g, 'descending');
  }
  const discriminant = v2 * v2 - g * (g * d * d + 2 * dy * v2);
  if (discriminant < 0) return unreachable('out of range at this speed');
  const root = Math.sqrt(discriminant);
  // tan(theta) roots of g d^2 tan^2 - 2 v^2 d tan + (g d^2 + 2 dy v^2) = 0, each in a cancellation-free form.
  const tan = arc === 'low' ? (g * d * d + 2 * dy * v2) / (d * (v2 + root)) : (v2 + root) / (g * d);
  const horizontal = v / Math.sqrt(1 + tan * tan);
  if (!(horizontal > 0)) return unreachable('no horizontal progress at this elevation');
  return fromDuration(a, b, d / horizontal, g);
}

/**
 * Hit a target moving at constant velocity with a fixed launch speed. Finds flight times t where the launch
 * speed needed to meet the target at t equals `speed`: the earliest for `low`, the latest for `high`. The search
 * brackets roots on `samples` (default 256, maximum 4096) log-spaced times up to a bound derived from the inputs,
 * then bisects to a relative `tolerance` (default 1e-9 of the flight time). Two solutions closer together than one sample interval, or
 * a tangent (single) solution, can be missed and reported `unreachable`.
 */
export function solveLead(
  from: BallisticVec3,
  target: BallisticVec3,
  targetVelocity: BallisticVec3,
  speed: number,
  gravity: number,
  options: {arc?: 'low' | 'high'; samples?: number; tolerance?: number} = {},
): Solution {
  const a = vec(from, 'from'),
    p = vec(target, 'target'),
    u = vec(targetVelocity, 'targetVelocity'),
    v = positive(speed, 'speed'),
    g = positive(gravity, 'gravity');
  if (typeof options !== 'object' || options === null) fail('options must be an object');
  const arc = options.arc ?? 'low',
    samples = options.samples ?? 256,
    tolerance = options.tolerance ?? 1e-9;
  if (arc !== 'low' && arc !== 'high') fail('arc must be low or high');
  if (!Number.isSafeInteger(samples) || samples < 8 || samples > BALLISTIC_LIMITS.maxLeadSamples)
    fail('samples must be an integer from 8 to 4096');
  if (!finite(tolerance) || tolerance < 1e-12) fail('tolerance must be finite and at least 1e-12');
  const aim = (t: number): BallisticVec3 => [p[0] + u[0] * t, p[1] + u[1] * t, p[2] + u[2] * t];
  // F(t) = |required launch velocity|^2 - speed^2, with t^2 factored in to stay finite near 0:
  // t^2 |v|^2 = |D(t)|^2 + g t^2 D_y(t) + g^2 t^4 / 4, where D(t) = aim(t) - from.
  const f = (t: number) => {
    const q = aim(t),
      dx = q[0] - a[0],
      dy = q[1] - a[1],
      dz = q[2] - a[2];
    return dx * dx + dy * dy + dz * dz + g * t * t * dy + (g * g * t * t * t * t) / 4 - v * v * t * t;
  };
  // Beyond this time the vertical term alone needs more than `speed` (target height grows at most linearly).
  const reach = Math.abs(p[1] - a[1]) + 1;
  const tMax = Math.min(BALLISTIC_LIMITS.maxMagnitude, (2 * (v + Math.abs(u[1]) + reach)) / g + 1);
  const tMin = tMax * 1e-9;
  const times: number[] = [];
  for (let i = 0; i < samples; i++) times.push(tMin * Math.pow(tMax / tMin, i / (samples - 1)));
  const order = arc === 'low' ? times.keys() : [...times.keys()].reverse()[Symbol.iterator]();
  let found: number | null = null;
  const bisect = (lo: number, hi: number) => {
    let flo = f(lo);
    for (let k = 0; k < 200 && hi - lo > tolerance * hi; k++) {
      const mid = (lo + hi) / 2,
        fm = f(mid);
      if (fm > 0 === flo > 0) {
        lo = mid;
        flo = fm;
      } else hi = mid;
    }
    return (lo + hi) / 2;
  };
  if (arc === 'low' && f(times[0]!) <= 0) {
    // The earliest root lies below the scan floor: f(0) = |D(0)|^2 > 0 unless the target starts at the muzzle.
    const d0 = Math.hypot(p[0] - a[0], p[1] - a[1], p[2] - a[2]);
    if (d0 === 0) return unreachable('the target starts at the launch point');
    found = bisect(0, times[0]!);
  }
  for (const i of found === null ? order : []) {
    const j = arc === 'low' ? i + 1 : i - 1;
    if (j < 0 || j >= samples) continue;
    let lo = Math.min(times[i]!, times[j]!),
      hi = Math.max(times[i]!, times[j]!);
    let flo = f(lo),
      fhi = f(hi);
    if (!Number.isFinite(flo) || !Number.isFinite(fhi)) continue;
    if (flo === 0) {
      found = lo;
      break;
    }
    if (flo > 0 === fhi > 0 && fhi !== 0) continue;
    for (let k = 0; k < 200 && hi - lo > tolerance * hi; k++) {
      const mid = (lo + hi) / 2,
        fm = f(mid);
      if (fm > 0 === flo > 0) {
        lo = mid;
        flo = fm;
      } else {
        hi = mid;
        fhi = fm;
      }
    }
    found = (lo + hi) / 2;
    break;
  }
  if (found === null) return unreachable('no flight time meets the moving target at this speed');
  const meet = aim(found);
  if (!meet.every(finite)) return unreachable('the predicted target left the finite domain');
  return fromDuration(a, meet, found, g);
}

interface Snapshot {
  readonly o: BallisticVec3;
  readonly v: BallisticVec3;
  readonly g: number;
  readonly duration: number;
}
/** Reads each trajectory field once and validates that copy. */
function check(trajectory: Trajectory): Snapshot {
  if (typeof trajectory !== 'object' || trajectory === null) return fail('trajectory must be an object');
  const o = vec(trajectory.origin, 'origin'),
    v = vec(trajectory.velocity, 'velocity'),
    g = positive(trajectory.gravity, 'gravity'),
    duration = positive(trajectory.duration, 'duration');
  return {o, v, g, duration};
}
const at = (s: Snapshot, t: number): [number, number, number] => [
  s.o[0] + s.v[0] * t,
  s.o[1] + s.v[1] * t - (s.g * t * t) / 2,
  s.o[2] + s.v[2] * t,
];

/** Position at time `t` (any finite time; the arc is not clamped to its duration). Returns a new mutable array. */
export function positionAt(trajectory: Trajectory, t: number): BallisticVec3 {
  const s = check(trajectory);
  if (!finite(t)) fail('t must be finite');
  return at(s, t);
}

/** Velocity at time `t`. Returns a new mutable array. */
export function velocityAt(trajectory: Trajectory, t: number): BallisticVec3 {
  const s = check(trajectory);
  if (!finite(t)) fail('t must be finite');
  return [s.v[0], s.v[1] - s.g * t, s.v[2]];
}

/** Highest point of the whole parabola and when it is reached (time may be negative for a falling launch). */
export function apex(trajectory: Trajectory): {readonly time: number; readonly position: BallisticVec3} {
  const s = check(trajectory);
  const t = s.v[1] / s.g;
  return Object.freeze({time: t, position: Object.freeze(at(s, t)) as BallisticVec3});
}

/**
 * When the arc crosses height `y`: the `'descending'` (default) or `'ascending'` crossing, or null if the arc
 * never reaches it or that crossing is before launch.
 */
export function timeAtHeight(
  trajectory: Trajectory,
  y: number,
  crossing: 'descending' | 'ascending' = 'descending',
): number | null {
  const s = check(trajectory);
  if (!finite(y)) fail('y must be finite');
  if (crossing !== 'descending' && crossing !== 'ascending') fail('crossing must be descending or ascending');
  const roots = crossings(s.v[1], y - s.o[1], s.g);
  if (!roots) return null;
  const t = crossing === 'descending' ? roots[1] : roots[0];
  return t >= 0 ? t : null;
}

/**
 * Evenly spaced points from launch to the end of the arc, both included: `count` points (2 to 4096). Writes into
 * `out` (a Float64Array of at least 3 * count numbers) when given, and returns the points as flat x, y, z triples.
 */
export function samplePoints(trajectory: Trajectory, count: number, out?: Float64Array): Float64Array {
  const s = check(trajectory);
  if (!Number.isSafeInteger(count) || count < 2 || count > BALLISTIC_LIMITS.maxSamples)
    fail('count must be an integer from 2 to 4096');
  const target = out ?? new Float64Array(count * 3);
  if (!(target instanceof Float64Array) || target.length < count * 3) fail('out must be a Float64Array of 3 * count');
  for (let i = 0; i < count; i++) {
    const t = (s.duration * i) / (count - 1);
    target[i * 3] = s.o[0] + s.v[0] * t;
    target[i * 3 + 1] = s.o[1] + s.v[1] * t - (s.g * t * t) / 2;
    target[i * 3 + 2] = s.o[2] + s.v[2] * t;
  }
  return target;
}
