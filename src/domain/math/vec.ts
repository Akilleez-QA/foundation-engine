// domain/astro/vec.ts: the one vector type for every simulation (ADR 0010).
// Pure: imports nothing. Two call styles:
//  - value style (`V3` tuples) for APIs, saves and tests;
//  - out-parameter style (`...To(out, ...)`) on Float64Array or tuple views for hot loops, so a step allocates nothing.
// `Math.hypot(a, b, c)` allocates its argument list in V8 and is banned here; `norm` uses sqrt.

export type V3 = readonly [number, number, number];
export type MutV3 = [number, number, number] | Float64Array;
/** Anything indexable as x, y, z: a V3 tuple, a Float64Array(3) or a subarray view. */
export type Vec3Like = ArrayLike<number>;
// Vec3Like/MutV3 hold at least 3 elements by contract (Float64Array views cannot be typed as tuples), so every
// `v[0..2]!` read in this file is in range; the `!` keeps the kernels allocation- and branch-free.

export const v3 = (x = 0, y = 0, z = 0): V3 => [x, y, z];
export const copy = (a: Vec3Like): V3 => [a[0]!, a[1]!, a[2]!];
export const add = (a: Vec3Like, b: Vec3Like): V3 => [a[0]! + b[0]!, a[1]! + b[1]!, a[2]! + b[2]!];
export const sub = (a: Vec3Like, b: Vec3Like): V3 => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
export const scale = (a: Vec3Like, k: number): V3 => [a[0]! * k, a[1]! * k, a[2]! * k];
export const neg = (a: Vec3Like): V3 => [-a[0]!, -a[1]!, -a[2]!];
/** k·x + y */
export const axpy = (k: number, x: Vec3Like, y: Vec3Like): V3 => [k * x[0]! + y[0]!, k * x[1]! + y[1]!, k * x[2]! + y[2]!];
export const dot = (a: Vec3Like, b: Vec3Like): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
export const normSq = (a: Vec3Like): number => a[0]! * a[0]! + a[1]! * a[1]! + a[2]! * a[2]!;
/** Euclidean length via sqrt of the sum of squares (allocation-free; never Math.hypot). */
export const norm = (a: Vec3Like): number => Math.sqrt(a[0]! * a[0]! + a[1]! * a[1]! + a[2]! * a[2]!);
export const dist = (a: Vec3Like, b: Vec3Like): number => {
  const x = a[0]! - b[0]!, y = a[1]! - b[1]!, z = a[2]! - b[2]!;
  return Math.sqrt(x * x + y * y + z * z);
};
export const cross = (a: Vec3Like, b: Vec3Like): V3 => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
/** Unit vector, or [0, 0, 0] for the zero vector (callers that need a direction must check first). */
export const unit = (a: Vec3Like): V3 => {
  const n = norm(a);
  return n > 0 ? [a[0]! / n, a[1]! / n, a[2]! / n] : [0, 0, 0];
};
export const isFiniteV3 = (a: Vec3Like): boolean => Number.isFinite(a[0]!) && Number.isFinite(a[1]!) && Number.isFinite(a[2]!);
/** Angle between two vectors in [0, π], robust near 0 and π (atan2 of |a×b| and a·b). */
export function angleBetween(a: Vec3Like, b: Vec3Like): number {
  const cx = a[1]! * b[2]! - a[2]! * b[1]!, cy = a[2]! * b[0]! - a[0]! * b[2]!, cz = a[0]! * b[1]! - a[1]! * b[0]!;
  return Math.atan2(Math.sqrt(cx * cx + cy * cy + cz * cz), dot(a, b));
}

// ---------------------------------------------------------------- out-parameter forms (no allocation)
// Every `...To` writes into `out` and returns it; `out` may alias any input.

export function setTo(out: MutV3, x: number, y: number, z: number): MutV3 { out[0] = x; out[1] = y; out[2] = z; return out; }
export function copyTo(out: MutV3, a: Vec3Like): MutV3 { out[0] = a[0]!; out[1] = a[1]!; out[2] = a[2]!; return out; }
export function addTo(out: MutV3, a: Vec3Like, b: Vec3Like): MutV3 { out[0] = a[0]! + b[0]!; out[1] = a[1]! + b[1]!; out[2] = a[2]! + b[2]!; return out; }
export function subTo(out: MutV3, a: Vec3Like, b: Vec3Like): MutV3 { out[0] = a[0]! - b[0]!; out[1] = a[1]! - b[1]!; out[2] = a[2]! - b[2]!; return out; }
export function scaleTo(out: MutV3, a: Vec3Like, k: number): MutV3 { out[0] = a[0]! * k; out[1] = a[1]! * k; out[2] = a[2]! * k; return out; }
/** out = k·x + y */
export function axpyTo(out: MutV3, k: number, x: Vec3Like, y: Vec3Like): MutV3 {
  out[0] = k * x[0]! + y[0]!; out[1] = k * x[1]! + y[1]!; out[2] = k * x[2]! + y[2]!; return out;
}
export function crossTo(out: MutV3, a: Vec3Like, b: Vec3Like): MutV3 {
  const x = a[1]! * b[2]! - a[2]! * b[1]!, y = a[2]! * b[0]! - a[0]! * b[2]!, z = a[0]! * b[1]! - a[1]! * b[0]!;
  out[0] = x; out[1] = y; out[2] = z; return out;
}
/** out = a/|a|, or zero for the zero vector. */
export function unitTo(out: MutV3, a: Vec3Like): MutV3 {
  const n = Math.sqrt(a[0]! * a[0]! + a[1]! * a[1]! + a[2]! * a[2]!), k = n > 0 ? 1 / n : 0;
  out[0] = a[0]! * k; out[1] = a[1]! * k; out[2] = a[2]! * k; return out;
}

/** A fixed pool of Float64Array(3) scratch views, reset once per step. A sim owns one; nothing escapes a step. */
export class ScratchVec3 {
  private readonly buf: Float64Array;
  private readonly views: Float64Array[];
  private next = 0;
  constructor(readonly capacity = 32) {
    this.buf = new Float64Array(capacity * 3);
    this.views = [];
    for (let i = 0; i < capacity; i++) this.views.push(this.buf.subarray(3 * i, 3 * i + 3));
  }
  /** A zero-cost view (pre-built at construction); its contents are whatever the previous user left. */
  take(): Float64Array {
    if (this.next >= this.capacity) throw Error('ScratchVec3 exhausted: raise capacity');
    return this.views[this.next++]!; // next < capacity = views.length
  }
  reset(): void { this.next = 0; }
  get used(): number { return this.next; }
}

// ---------------------------------------------------------------- burn frame

/** Prograde / radial / normal components of an impulse. One shape for every impulse a game applies. */
export type BurnVector = { prograde: number; radial: number; normal: number };
export interface BurnBasis { prograde: V3; radial: V3; normal: V3 }

function assertBurnState(r: Vec3Like, v: Vec3Like): void {
  const rm = norm(r), vm = norm(v);
  const hx = r[1]! * v[2]! - r[2]! * v[1]!, hy = r[2]! * v[0]! - r[0]! * v[2]!, hz = r[0]! * v[1]! - r[1]! * v[0]!;
  if (!isFiniteV3(r) || !isFiniteV3(v) || rm === 0 || vm === 0 || !(Math.sqrt(hx * hx + hy * hy + hz * hz) > rm * vm * 1e-12)) {
    throw Error('A maneuver frame needs position and non-radial motion relative to the same body.');
  }
}

/**
 * Velocity-aligned P/R/N basis frozen at the pre-burn state (the maneuver-frame.ts convention):
 * prograde = v̂, normal = (r × v)^, radial = prograde × normal (outward; equals r̂ only at apsides or on a circle).
 * Orthonormal, so the Euclidean norm of a BurnVector is the commanded Δv. Throws on radial or degenerate motion.
 */
export function burnBasis(r: Vec3Like, v: Vec3Like): BurnBasis {
  assertBurnState(r, v);
  const prograde = unit(v), normal = unit(cross(r, v));
  return { prograde, radial: unit(cross(prograde, normal)), normal };
}

/** Inertial Δv of a burn given in the P/R/N frame of state (r, v). */
export function burnToInertial(b: BurnVector, r: Vec3Like, v: Vec3Like): V3 {
  const out: [number, number, number] = [0, 0, 0];
  burnToInertialTo(out, b.prograde, b.radial, b.normal, r, v);
  return out;
}

/** Allocation-free burnToInertial: out = p·P̂ + q·R̂ + n·N̂. `out` may alias r or v. */
export function burnToInertialTo(out: MutV3, prograde: number, radial: number, normal: number, r: Vec3Like, v: Vec3Like): MutV3 {
  assertBurnState(r, v);
  const vm = Math.sqrt(v[0]! * v[0]! + v[1]! * v[1]! + v[2]! * v[2]!);
  const px = v[0]! / vm, py = v[1]! / vm, pz = v[2]! / vm;
  let nx = r[1]! * v[2]! - r[2]! * v[1]!, ny = r[2]! * v[0]! - r[0]! * v[2]!, nz = r[0]! * v[1]! - r[1]! * v[0]!;
  const hm = Math.sqrt(nx * nx + ny * ny + nz * nz); nx /= hm; ny /= hm; nz /= hm;
  // P and N are orthonormal, so P × N is already unit length.
  const rx = py * nz - pz * ny, ry = pz * nx - px * nz, rz = px * ny - py * nx;
  out[0] = prograde * px + radial * rx + normal * nx;
  out[1] = prograde * py + radial * ry + normal * ny;
  out[2] = prograde * pz + radial * rz + normal * nz;
  return out;
}

/** Components of an inertial Δv in the P/R/N frame of state (r, v): the inverse of burnToInertial. */
export function inertialToBurn(dv: Vec3Like, r: Vec3Like, v: Vec3Like): BurnVector {
  const f = burnBasis(r, v);
  return { prograde: dot(dv, f.prograde), radial: dot(dv, f.radial), normal: dot(dv, f.normal) };
}

export const burnMagnitude = (b: BurnVector): number => Math.sqrt(b.prograde * b.prograde + b.radial * b.radial + b.normal * b.normal);
