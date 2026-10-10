/**
 * kits/numeric/precision.ts: strict reduced-precision floating point. Every operation computes the double result
 * and rounds it once to `significandBits` (round to nearest, ties to even), which equals the correctly rounded
 * reduced-precision result for +, −, ×, ÷ and √ whenever 53 ≥ 2·p + 2, i.e. p ≤ 25 (double rounding is innocuous
 * there; Figueroa 1995). Wider significands are refused because that guarantee would not hold. Products and
 * quotients that land below 2^-1021 are recomputed scaled by 2^600, because a subnormal double has too few bits for
 * that argument; sums and differences that small are exact in double already.
 *
 * Two exponent ranges:
 *   - 'binary32': IEEE single precision (p = 24 only), with its overflow to ±∞ and subnormals: exactly `Math.fround`.
 *   - 'double': the double's exponent range, as an x87 FPU with its precision-control field set to 24 bits behaves
 *     for values whose exponent stays within the double range (its extended exponent is wider still).
 *
 * The transcendental helpers (`math`) round the arguments, evaluate the engine's deterministic `dmath` and round
 * the result: deterministic everywhere, within an ulp of the reduced-precision value, not always correctly rounded.
 */
import {dmath, type ScalarMath} from '../../author';

export interface PrecisionFormat {
  /** Significand bits including the implicit bit, 2..25. */
  readonly significandBits: number;
  /** 'binary32' (p must be 24) or 'double'. Default 'double'. */
  readonly exponent?: 'binary32' | 'double';
}

export interface Precision {
  readonly format: Readonly<Required<PrecisionFormat>>;
  /** Round a double to this precision (ties to even). NaN, ±∞ and ±0 pass through. */
  readonly round: (x: number) => number;
  readonly add: (a: number, b: number) => number;
  readonly sub: (a: number, b: number) => number;
  readonly mul: (a: number, b: number) => number;
  readonly div: (a: number, b: number) => number;
  readonly sqrt: (a: number) => number;
  /** a·b + c with the product rounded before the add (no fused multiply-add), as the reduced-precision unit does. */
  readonly mulAdd: (a: number, b: number, c: number) => number;
  /** Whether x is already representable (round(x) is x). */
  readonly isExact: (x: number) => boolean;
  /** The deterministic transcendental functions evaluated at this precision. */
  readonly math: ScalarMath;
}

const bits = new Float64Array(1),
  words = new Uint32Array(bits.buffer);
const HI = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1 ? 1 : 0;
/** 2^n exactly for integer n in [−1022, 1023]. */
function pow2(n: number): number {
  words[HI] = (n + 1023) * 1048576;
  words[1 - HI] = 0;
  return bits[0]!;
}

/** Round to `p` significand bits, ties to even, with the double's exponent range. */
function roundTo(p: number): (x: number) => number {
  return (x: number): number => {
    if (x === 0 || !Number.isFinite(x)) return x;
    bits[0] = x;
    let e = ((words[HI]! >>> 20) & 0x7ff) - 1023;
    if (e === -1023) e = -1022; // subnormal double: its quantum is 2^-1074 at most
    const shift = e - p + 1; // the quantum of a p-bit significand at this binade
    // Scale |x| so that the quantum is 1; |s| < 2^p, exact (power-of-two scaling, never subnormal for shift ≥ -1074).
    const ax = Math.abs(x);
    let s: number;
    if (shift >= -1022) s = ax / pow2(shift);
    else s = (ax * pow2(1022)) / pow2(shift + 1022);
    const f = Math.floor(s),
      d = s - f;
    let n = f;
    if (d > 0.5 || (d === 0.5 && f % 2 === 1)) n = f + 1;
    let r: number;
    if (shift >= -1022)
      r = n * pow2(shift); // shift ≤ 1022 because p ≥ 2
    else r = (n * pow2(shift + 1022)) / pow2(1022);
    return x < 0 ? -r : r;
  };
}

const SCALE = 600,
  TINY = pow2(-1021);
/**
 * Round m·2^-SCALE to `p` bits with the double exponent range, where m is a normal double carrying the exactly scaled
 * (or once-rounded, 53-bit) result. Used when a product or quotient lands below 2^-1021: there the double result is
 * subnormal with fewer than 2p + 2 bits, so rounding it again would not be innocuous.
 */
function roundScaled(p: number): (m: number) => number {
  return (m: number): number => {
    if (m === 0 || !Number.isFinite(m)) return m;
    bits[0] = m;
    const field = (words[HI]! >>> 20) & 0x7ff;
    if (field === 0) return m < 0 ? -0 : 0; // below 2^-1622: far under half the smallest quantum (2^-1047)
    const eTrue = field - 1023 - SCALE;
    const qe = Math.max(eTrue, -1022) - p + 1; // ≥ −1046
    const s = Math.abs(m) / pow2(qe + SCALE),
      f = Math.floor(s),
      d = s - f;
    const n = d > 0.5 || (d === 0.5 && f % 2 === 1) ? f + 1 : f;
    const r = (n * pow2(qe + SCALE)) / pow2(SCALE); // a multiple of 2^-1046: exact even when subnormal
    return m < 0 ? -r : r;
  };
}

/** Strict reduced-precision arithmetic. */
export function createPrecision(format: PrecisionFormat): Precision {
  const {significandBits: p, exponent = 'double'} = format;
  if (!Number.isInteger(p) || p < 2 || p > 25)
    throw new RangeError(`significandBits must be an integer in [2, 25] (got ${String(p)})`);
  if (exponent !== 'double' && exponent !== 'binary32') throw new RangeError(`exponent must be 'binary32' or 'double'`);
  if (exponent === 'binary32' && p !== 24) throw new RangeError("exponent 'binary32' needs significandBits 24");
  const round = exponent === 'binary32' ? Math.fround : roundTo(p);
  // binary32 operands have at most 24 significant bits and exponents ≥ −149, so their products and quotients stay
  // normal doubles; only the double exponent range needs the scaled path near underflow.
  const scaled = exponent === 'double' ? roundScaled(p) : null;
  const mul = (a: number, b: number): number => {
    a = round(a);
    b = round(b);
    const r = a * b;
    if (scaled && Math.abs(r) < TINY && a !== 0 && b !== 0 && Number.isFinite(a) && Number.isFinite(b))
      return scaled(a * pow2(SCALE) * b);
    return round(r);
  };
  const div = (a: number, b: number): number => {
    a = round(a);
    b = round(b);
    const r = a / b;
    if (scaled && Math.abs(r) < TINY && a !== 0 && Number.isFinite(a) && b !== 0 && Number.isFinite(b))
      return scaled((a * pow2(SCALE)) / b);
    return round(r);
  };
  const m1 = (fn: (x: number) => number) => (x: number) => round(fn(round(x)));
  const m2 = (fn: (a: number, b: number) => number) => (a: number, b: number) => round(fn(round(a), round(b)));
  const math: ScalarMath = Object.freeze({
    sin: m1(dmath.sin),
    cos: m1(dmath.cos),
    atan: m1(dmath.atan),
    atan2: m2(dmath.atan2),
    exp: m1(dmath.exp),
    log: m1(dmath.log),
    pow: m2(dmath.pow),
    sqrt: m1(Math.sqrt),
    hypot: m2(dmath.hypot),
  });
  return Object.freeze({
    format: Object.freeze({significandBits: p, exponent}),
    round,
    add: (a: number, b: number) => round(round(a) + round(b)),
    sub: (a: number, b: number) => round(round(a) - round(b)),
    mul,
    div,
    sqrt: (a: number) => round(Math.sqrt(round(a))),
    mulAdd: (a: number, b: number, c: number) => round(mul(a, b) + round(c)), // a sum is exact when subnormal
    isExact: (x: number) => Number.isNaN(x) || Object.is(round(x), x),
    math,
  });
}

/** IEEE-754 binary32 arithmetic (every result is `Math.fround` of the double result: exact for + − × ÷ √). */
export const f32: Precision = createPrecision({significandBits: 24, exponent: 'binary32'});
/** 24-bit significands with the double exponent range: an x87 FPU with precision control set to single. */
export const pc24: Precision = createPrecision({significandBits: 24, exponent: 'double'});
