/**
 * core/math.ts: the small scalar helpers that were re-defined file by file.
 * Pure, no imports. Argument order is (value, lo, hi) throughout.
 */

/** v limited to [lo, hi] (lo wins if lo > hi). NaN stays NaN. */
export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
/** v limited to [0, 1]. */
export const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
/** Linear interpolation: a at t = 0, b at t = 1 (not clamped). */
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** Where v lies between a and b as a fraction (not clamped). */
export const inverseLerp = (a: number, b: number, v: number): number => (v - a) / (b - a);
/** Hermite smoothstep of x between edges e0 and e1: 0 below e0, 1 above e1, with zero slope at both ends. */
export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
/** An angle wrapped to (−π, π] (radians). */
export const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
/** Frame-rate independent exponential approach of current toward target at `rate` per second over dt seconds. */
export const damp = (current: number, target: number, rate: number, dt: number): number =>
  current + (target - current) * (1 - Math.exp(-rate * dt));
