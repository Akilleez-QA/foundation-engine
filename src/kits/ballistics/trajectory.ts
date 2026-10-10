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
export const BALLISTIC_LIMITS = Object.freeze({maxSamples: 4096, maxLeadIterations: 64, maxMagnitude: 1e9});

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
const solved = (
  origin: BallisticVec3,
  velocity: [number, number, number],
  gravity: number,
  duration: number,
): Solution => {
  if (!velocity.every(Number.isFinite) || !Number.isFinite(duration))
    return Object.freeze({status: 'unreachable', reason: 'numeric overflow'});
  return Object.freeze({
    status: 'solved',
    trajectory: Object.freeze({origin, velocity: Object.freeze(velocity) as BallisticVec3, gravity, duration}),
  });
};
const unreachable = (reason: string): Solution => Object.freeze({status: 'unreachable', reason});

/** Arrive at `to` exactly `duration` seconds after leaving `from`. Always solvable for a positive duration. */
export function solveByDuration(from: BallisticVec3, to: BallisticVec3, duration: number, gravity: number): Solution {
  const a = vec(from, 'from'),
    b = vec(to, 'to'),
    t = positive(duration, 'duration'),
    g = positive(gravity, 'gravity');
  return solved(a, [(b[0] - a[0]) / t, (b[1] - a[1]) / t + (g * t) / 2, (b[2] - a[2]) / t], g, t);
}

/** Move horizontally at a constant `speed`; the vertical launch speed is whatever reaches `to`'s height. */
export function solveByHorizontalSpeed(
  from: BallisticVec3,
  to: BallisticVec3,
  speed: number,
  gravity: number,
): Solution {
  const a = vec(from, 'from'),
    b = vec(to, 'to');
  positive(speed, 'speed');
  positive(gravity, 'gravity');
  const distance = Math.hypot(b[0] - a[0], b[2] - a[2]);
  if (distance === 0) return unreachable('no horizontal distance: duration is undefined for a horizontal speed');
  return solveByDuration(a, b, distance / speed, gravity);
}

/**
 * Leave with vertical speed `verticalSpeed` (positive is up) and arrive at `to`. `branch` picks the later
 * (`'descending'`, default: the arc comes down onto the target) or the earlier (`'ascending'`) crossing of the
 * target height; `unreachable` when the arc never gets that high.
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
  const rise = b[1] - a[1];
  const discriminant = verticalSpeed * verticalSpeed - 2 * g * rise;
  if (discriminant < 0) return unreachable('the target is above the apex');
  const root = Math.sqrt(discriminant);
  const t = branch === 'descending' ? (verticalSpeed + root) / g : (verticalSpeed - root) / g;
  if (!(t > 0)) return unreachable('the requested crossing is not in the future');
  return solveByDuration(a, b, t, g);
}

/** Peak `height` above the higher of the two endpoints (>= 0), then come down onto `to`. */
export function solveByApexHeight(from: BallisticVec3, to: BallisticVec3, height: number, gravity: number): Solution {
  const a = vec(from, 'from'),
    b = vec(to, 'to');
  if (!finite(height) || height < 0) fail('height must be finite and nonnegative');
  const g = positive(gravity, 'gravity');
  const apex = Math.max(a[1], b[1]) + height;
  const vy = Math.sqrt(2 * g * (apex - a[1]));
  if (vy === 0 && b[1] === a[1]) return unreachable('a zero-height arc between equal heights has no duration');
  return solveByVerticalSpeed(a, b, vy, g, 'descending');
}

/**
 * Fixed launch `speed` (magnitude of the whole velocity): choose the elevation that hits `to`. `arc` selects the
 * flatter (`'low'`, default) or lobbed (`'high'`) of the two solutions. `unreachable` when the target is out of
 * range at that speed.
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
  const dx = b[0] - a[0],
    dz = b[2] - a[2],
    dy = b[1] - a[1];
  const d = Math.hypot(dx, dz);
  if (d === 0) {
    // Straight up or down: only a vertical shot can arrive.
    if (dy > 0 && (v * v) / (2 * g) < dy) return unreachable('out of range at this speed');
    return solveByVerticalSpeed(a, b, dy >= 0 ? v : -v, g, dy >= 0 ? 'ascending' : 'descending');
  }
  const v2 = v * v;
  const discriminant = v2 * v2 - g * (g * d * d + 2 * dy * v2);
  if (discriminant < 0) return unreachable('out of range at this speed');
  const root = Math.sqrt(discriminant);
  // tan(theta) = (v^2 -/+ root) / (g d); low uses the minus root.
  const tan = (arc === 'low' ? v2 - root : v2 + root) / (g * d);
  const cos = 1 / Math.sqrt(1 + tan * tan);
  const horizontal = v * cos;
  if (!(horizontal > 0)) return unreachable('no horizontal progress at this elevation');
  return solveByDuration(a, b, d / horizontal, g);
}

/**
 * Hit a target moving at constant velocity with a fixed launch speed. Iterates on the flight time (at most
 * `maxIterations`, default 16, hard maximum 64) and reports `unreachable` if it does not converge to `tolerance`.
 */
export function solveLead(
  from: BallisticVec3,
  target: BallisticVec3,
  targetVelocity: BallisticVec3,
  speed: number,
  gravity: number,
  options: {arc?: 'low' | 'high'; maxIterations?: number; tolerance?: number} = {},
): Solution & {readonly iterations?: number} {
  const a = vec(from, 'from'),
    p = vec(target, 'target'),
    u = vec(targetVelocity, 'targetVelocity');
  positive(speed, 'speed');
  positive(gravity, 'gravity');
  const maxIterations = options.maxIterations ?? 16,
    tolerance = options.tolerance ?? 1e-6;
  if (!Number.isSafeInteger(maxIterations) || maxIterations < 1 || maxIterations > BALLISTIC_LIMITS.maxLeadIterations)
    fail('maxIterations must be an integer from 1 to 64');
  if (!finite(tolerance) || tolerance <= 0) fail('tolerance must be finite and positive');
  let time = 0;
  for (let i = 1; i <= maxIterations; i++) {
    const aim: BallisticVec3 = [p[0] + u[0] * time, p[1] + u[1] * time, p[2] + u[2] * time];
    if (!aim.every(finite)) return unreachable('the predicted target left the finite domain');
    const s = solveByLaunchSpeed(a, aim, speed, gravity, options.arc ?? 'low');
    if (s.status !== 'solved') return s;
    const next = s.trajectory.duration;
    if (Math.abs(next - time) <= tolerance) return Object.freeze({...s, iterations: i});
    time = next;
  }
  return unreachable('lead time did not converge');
}

function check(trajectory: Trajectory): Trajectory {
  if (typeof trajectory !== 'object' || trajectory === null) return fail('trajectory must be an object');
  vec(trajectory.origin, 'origin');
  vec(trajectory.velocity, 'velocity');
  positive(trajectory.gravity, 'gravity');
  positive(trajectory.duration, 'duration');
  return trajectory;
}

/** Position at time `t` (any finite time; the arc is not clamped to its duration). */
export function positionAt(trajectory: Trajectory, t: number): BallisticVec3 {
  const {origin: o, velocity: v, gravity: g} = check(trajectory);
  if (!finite(t)) fail('t must be finite');
  return [o[0] + v[0] * t, o[1] + v[1] * t - (g * t * t) / 2, o[2] + v[2] * t];
}

/** Velocity at time `t`. */
export function velocityAt(trajectory: Trajectory, t: number): BallisticVec3 {
  const {velocity: v, gravity: g} = check(trajectory);
  if (!finite(t)) fail('t must be finite');
  return [v[0], v[1] - g * t, v[2]];
}

/** Highest point of the whole parabola and when it is reached (time may be negative for a falling launch). */
export function apex(trajectory: Trajectory): {readonly time: number; readonly position: BallisticVec3} {
  const t = check(trajectory).velocity[1] / trajectory.gravity;
  return Object.freeze({time: t, position: positionAt(trajectory, t)});
}

/**
 * When the arc crosses height `y`: the `'descending'` (default) or `'ascending'` crossing, or null if the arc
 * never reaches it or the crossing is before launch.
 */
export function timeAtHeight(
  trajectory: Trajectory,
  y: number,
  crossing: 'descending' | 'ascending' = 'descending',
): number | null {
  const {origin: o, velocity: v, gravity: g} = check(trajectory);
  if (!finite(y)) fail('y must be finite');
  const discriminant = v[1] * v[1] - 2 * g * (y - o[1]);
  if (discriminant < 0) return null;
  const root = Math.sqrt(discriminant);
  const t = crossing === 'descending' ? (v[1] + root) / g : (v[1] - root) / g;
  return t >= 0 ? t : null;
}

/**
 * Evenly spaced points from launch to the end of the arc, both included: `count` points (2 to 4096). Writes into
 * `out` (a Float64Array of at least 3 * count numbers) when given, and returns the points as flat x, y, z triples.
 */
export function samplePoints(trajectory: Trajectory, count: number, out?: Float64Array): Float64Array {
  check(trajectory);
  if (!Number.isSafeInteger(count) || count < 2 || count > BALLISTIC_LIMITS.maxSamples)
    fail('count must be an integer from 2 to 4096');
  const target = out ?? new Float64Array(count * 3);
  if (!(target instanceof Float64Array) || target.length < count * 3) fail('out must be a Float64Array of 3 * count');
  for (let i = 0; i < count; i++) {
    const p = positionAt(trajectory, (trajectory.duration * i) / (count - 1));
    target[i * 3] = p[0];
    target[i * 3 + 1] = p[1];
    target[i * 3 + 2] = p[2];
  }
  return target;
}
