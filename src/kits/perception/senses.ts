/**
 * Senses: pure stimulus strengths for sight and hearing. Occlusion, path distance and acoustic attenuation are
 * creator queries (for example a volume-query sweep, a camera-style ray, or a navigation distance field), so the kit
 * owns no geometry. Strengths are in [0, 1]; awareness turns them into alert levels.
 */
export type Vec3 = readonly [number, number, number];

export function fail(message: string): never {
  throw new RangeError(`perception: ${message}`);
}
export const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** A frozen copy of a vector. */
export const frozenVec = (v: Vec3): Vec3 => Object.freeze<Vec3>([v[0], v[1], v[2]]);
export const vec = (v: unknown, what: string): Vec3 => {
  if (!Array.isArray(v) || v.length !== 3) fail(`${what} must be [x, y, z]`);
  const out: Vec3 = [v[0], v[1], v[2]];
  if (!out.every(finite)) fail(`${what} must be finite`);
  return out;
};

export interface SightSpec {
  /** Farthest distance seen, (0, 1e6]. */
  readonly range: number;
  /** Full cone angle in radians, (0, 2π]. */
  readonly fov: number;
  /** Within this distance a target is noticed whatever the angle (but still not through walls). Default 0. */
  readonly near?: number;
  /** Strength at the cone edge relative to the centre, [0, 1]. Default 0.5 (peripheral vision is weaker). */
  readonly edge?: number;
}

/**
 * Sight strength of `target` for an eye at `position` looking along `forward`: 0 at or beyond range, outside the cone
 * (unless within `near`, where it is noticed at `edge` strength) or when `clear(eye, target)` reports an obstruction;
 * otherwise (1 − d/range) × angle factor, where the angle factor falls linearly from 1 at the centre to `edge` at the
 * cone boundary. `clear` is called at most once, and only when the result would otherwise be above 0.
 */
export function sightStrength(
  spec: SightSpec,
  eye: {readonly position: Vec3; readonly forward: Vec3},
  target: Vec3,
  clear: (from: Vec3, to: Vec3) => boolean,
): number {
  const range: unknown = spec.range,
    fov: unknown = spec.fov,
    near: unknown = spec.near ?? 0,
    edge: unknown = spec.edge ?? 0.5;
  if (!finite(range) || range <= 0 || range > 1e6) fail('sight range must be within (0, 1e6]');
  if (!finite(fov) || fov <= 0 || fov > 2 * Math.PI) fail('sight fov must be within (0, 2π]');
  if (!finite(near) || near < 0 || near > range) fail('sight near must be within [0, range]');
  if (!finite(edge) || edge < 0 || edge > 1) fail('sight edge must be within [0, 1]');
  const p = vec(eye.position, 'eye position'),
    f = vec(eye.forward, 'eye forward'),
    t = vec(target, 'target');
  const flen = Math.hypot(f[0], f[1], f[2]);
  if (flen < 1e-12) fail('eye forward must be nonzero');
  const d: Vec3 = [t[0] - p[0], t[1] - p[1], t[2] - p[2]];
  const dist = Math.hypot(d[0], d[1], d[2]);
  if (dist >= range) return 0;
  let angle = 0;
  if (dist > 1e-12) {
    const cos = (d[0] * f[0] + d[1] * f[1] + d[2] * f[2]) / (dist * flen);
    angle = Math.acos(Math.max(-1, Math.min(1, cos)));
  }
  const half = fov / 2;
  const inCone = angle <= half;
  if (!inCone && dist > near) return 0;
  const angleFactor = inCone ? 1 - (1 - edge) * (half > 0 ? angle / half : 0) : edge;
  if (angleFactor <= 0) return 0;
  if (!clear(p, t)) return 0;
  return (1 - dist / range) * angleFactor;
}

export interface Sound {
  readonly position: Vec3;
  /** Audible radius at full strength, (0, 1e6]. */
  readonly loudness: number;
}

/**
 * Hearing strength of `sound` at `listener`: max(0, 1 − distance/loudness) × attenuation. `distance(a, b)` may return a
 * travel distance (for example around walls from a navigation field) or null when unreachable (strength 0); default
 * straight-line distance. `attenuation(a, b)` returns a multiplier in [0, 1] (for example 0.5 per closed door); default 1.
 */
export function hearingStrength(
  listener: Vec3,
  sound: Sound,
  options: {
    readonly distance?: (from: Vec3, to: Vec3) => number | null;
    readonly attenuation?: (from: Vec3, to: Vec3) => number;
  } = {},
): number {
  const l = vec(listener, 'listener'),
    s = vec(sound.position, 'sound position'),
    loud: unknown = sound.loudness;
  if (!finite(loud) || loud <= 0 || loud > 1e6) fail('sound loudness must be within (0, 1e6]');
  const straight = Math.hypot(s[0] - l[0], s[1] - l[1], s[2] - l[2]);
  if (straight >= loud) return 0; // a path is never shorter than the straight line
  const raw = options.distance ? options.distance(s, l) : straight;
  if (raw === null) return 0;
  if (!finite(raw) || raw < 0) fail('distance must return a nonnegative finite number or null');
  // A path cannot be shorter than the straight line; a shorter answer is treated as the straight distance.
  const d = Math.max(raw, straight);
  if (d >= loud) return 0;
  const a = options.attenuation ? options.attenuation(s, l) : 1;
  if (!finite(a) || a < 0 || a > 1) fail('attenuation must return a number within [0, 1]');
  return (1 - d / loud) * a;
}
