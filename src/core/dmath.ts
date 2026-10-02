/**
 * core/dmath.ts: deterministic scalar maths. Every function here is built only from IEEE-754 operations that
 * ECMAScript requires to be correctly rounded (+, −, ×, ÷), exact operations (comparison, Math.abs, Math.round,
 * integer bit tests, power-of-two scaling through a typed-array view of the bits) and `Math.sqrt`, with fixed range reduction and fixed
 * polynomials. So the same input gives the same bits in every conforming JavaScript engine, unlike `Math.sin`,
 * `Math.cos`, `Math.atan2`, `Math.exp`, `Math.log`, `Math.pow` and `Math.hypot`, which the language leaves
 * implementation-approximated and which do differ between engine versions.
 *
 * `Math.sqrt` is also implementation-approximated in the specification text, but every engine compiles it to the
 * IEEE-754 square root, which is correctly rounded; dmath.test.ts proves the rounding on the golden vectors, and the
 * browser check (`npm run test:dmath-browser`) compares the bits with Node. `dmath.sqrt` is `Math.sqrt`.
 *
 * Optional: nothing in the engine uses it unless a creator opts in (kits take a `math: 'deterministic'` option).
 * Accuracy and cost against Math.* are in docs/guides/deterministic-math.md. Pure, no imports. The fast paths create
 * no objects or arrays; V8 may still box a returned double in a heap number (see the guide's Cost section).
 *
 * Coefficients were fitted for this file (Chebyshev fits in 60-digit arithmetic, rounded to double); the reductions
 * are the textbook Cody–Waite and argument-halving identities.
 */

/** The functions a simulation may need, with `Math`'s signatures. Both `dmath` and `platformMath` implement it. */
export interface ScalarMath {
  readonly sin: (x: number) => number;
  readonly cos: (x: number) => number;
  readonly atan: (x: number) => number;
  readonly atan2: (y: number, x: number) => number;
  readonly exp: (x: number) => number;
  readonly log: (x: number) => number;
  readonly pow: (x: number, y: number) => number;
  readonly sqrt: (x: number) => number;
  readonly hypot: (x: number, y: number) => number;
}

/** Which arithmetic a kit's simulation uses: the engine's own `Math` (default) or `dmath`. */
export type ScalarMathMode = 'platform' | 'deterministic';

// ---- bit access and exact power-of-two scaling --------------------------------------------------------------
// One double viewed as two 32-bit words; HI/LO index the high and low word on this platform's byte order.
const f64 = new Float64Array(1), u32 = new Uint32Array(f64.buffer);
const HI = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1 ? 1 : 0, LO = 1 - HI;
/** 2^n exactly, for integer n in [−1022, 1023]. */
function pow2(n: number): number { u32[HI] = (n + 1023) * 1048576; u32[LO] = 0; return f64[0]!; }
const TWO_P1023 = pow2(1023), TWO_M969 = pow2(-969), TWO_P54 = pow2(54);
/** v·2^n for integer n, with at most one rounding (at the last multiply). */
function scale(v: number, n: number): number {
  if (n > 1023) { v *= TWO_P1023; n -= 1023; if (n > 1023) { v *= TWO_P1023; n -= 1023; if (n > 1023) n = 1023; } }
  else if (n < -1022) { v *= TWO_M969; n += 969; if (n < -1022) { v *= TWO_M969; n += 969; if (n < -1022) n = -1022; } }
  return v * pow2(n);
}

// ---- secondary results ------------------------------------------------------------------------------------
// Helpers that produce two doubles return one and leave the other in this scratch array. A module-level `let`
// holding a double would be boxed into a fresh heap number on every store in V8; a Float64Array slot is not.
const scratch = new Float64Array(5);
const PROD_ERR = 0, RED_HI = 1, RED_LO = 2, MANT = 3, LOG_LO = 4;

// ---- exact products (Veltkamp/Dekker); the error term is left in scratch[PROD_ERR] -------------------------
const SPLIT = 134217729; // 2^27 + 1
/** a·b rounded; scratch[PROD_ERR] receives the exact remainder a·b − result. Valid while |a|,|b| < 2^995. */
function twoProd(a: number, b: number): number {
  const p = a * b;
  let t = SPLIT * a; const ah = t - (t - a), al = a - ah;
  t = SPLIT * b; const bh = t - (t - b), bl = b - bh;
  scratch[PROD_ERR] = ((ah * bh - p) + ah * bl + al * bh) + al * bl;
  return p;
}

// ---- constants (each literal round-trips exactly) -----------------------------------------------------------
const INV_PIO2 = 0.6366197723675814;
// π/2 = PIO2_1 + PIO2_2 + PIO2_3 (+ 1e-37): the first two have 33 significant bits, so n·PIO2_k is exact for |n| < 2^20.
const PIO2_1 = 1.5707963267341256, PIO2_2 = 6.077100506303966e-11, PIO2_3 = 2.0222662487959506e-21;
const PIO2_HI = 1.5707963267948966, PIO2_LO = 6.123233995736766e-17;
const PI_HI = 3.141592653589793, PI_LO = 1.2246467991473532e-16;
const PIO4 = 0.7853981633974483, THREE_PIO4 = 2.356194490192345;
const INV_LN2 = 1.4426950408889634;
// ln 2 split for exp and log: LN2_HI has 32 significant bits (k·LN2_HI exact for |k| < 2^21).
const LN2_HI = 0.6931471803691238, LN2_LO = 1.9082149292705877e-10;
// ln 2 split for pow's extended log: 42 bits (k·LN2_HI42 exact for |k| < 2^11).
const LN2_HI42 = 0.6931471805598903, LN2_LO42 = 5.497923018708371e-14;
const SQRT2 = 1.4142135623730951;

// ---- sin and cos ------------------------------------------------------------------------------------------
// sin r = r + r³·S(r²), cos r = 1 − r²/2 + r⁴·C(r²) on |r| ≤ π/4.
const S0 = -0.16666666666666666, S1 = 0.008333333333333331, S2 = -0.00019841269841265065, S3 = 2.7557319219339167e-06,
  S4 = -2.5052106232447578e-08, S5 = 1.6058531618986147e-10, S6 = -7.586697117706918e-13;
const C0 = 0.041666666666666664, C1 = -0.0013888888888887398, C2 = 2.480158729876569e-05, C3 = -2.7557317271729793e-07,
  C4 = 2.08761462684032e-09, C5 = -1.1382632425521717e-11;

/** sin(x + y) for |x| ≤ ~π/4, |y| ≤ ulp(x). */
function sinKernel(x: number, y: number): number {
  const z = x * x, v = z * x;
  const s = S0 + z * (S1 + z * (S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)))));
  return x + (v * s + y * (1 - 0.5 * z));
}
/** cos(x + y) for |x| ≤ π/4, |y| ≤ ulp(x). */
function cosKernel(x: number, y: number): number {
  const z = x * x, hz = 0.5 * z, w = 1 - hz;
  const r = z * z * (C0 + z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * C5)))));
  return w + (((1 - w) - hz) + (r - x * y));
}

/**
 * x − n·π/2 as scratch[RED_HI] + scratch[RED_LO] (|hi| ≤ ~π/4); returns n mod 4. Cody–Waite for |x| < 1.6e6,
 * else exact.
 */
function reduce(x: number): number {
  if (Math.abs(x) >= 1.6e6) return reduceExact(x);
  const n = Math.round(x * INV_PIO2);  // |n| < 2^20, so n·PIO2_1 and n·PIO2_2 are exact
  const a = x - n * PIO2_1, w = n * PIO2_2;
  const hi = a - w, bb = hi - a, err = (a - (hi - bb)) + (-w - bb); // two-sum
  const lo = err - n * PIO2_3;
  const rh = hi + lo;
  scratch[RED_HI] = rh; scratch[RED_LO] = lo - (rh - hi);
  // Within 2^-30 of a multiple of π/2 the 119-bit π/2 above is not enough: use the exact path (rare).
  if (Math.abs(rh) < 9.313225746154785e-10 && n !== 0) return reduceExact(x);
  return n & 3;
}

// ⌊2/π · 2^1280⌋: enough bits for any double (exponent ≤ 971 + 53-bit significand + 150 bits of fraction).
const TWO_OVER_PI = BigInt('0x' +
  'a2f9836e4e441529fc2757d1f534ddc0db6295993c439041fe5163abdebbc561b7246e3a424dd2e006492eea09d1921cfe1d' +
  'eb1cb129a73ee88235f52ebb4484e99c7026b45f7e413991d639835339f49c845f8bbdf9283b1ff897ffde05980fef2f118b' +
  '5a0a6d1f6d367ecf27cb09b74f463f669e5fea2d7527bac7ebe5f17b3d0739f78a5292ea6bfb5fb11f8d5d0856033046fc7b' +
  '6babf0cfbc209af4361d');
const TWO_OVER_PI_BITS = 1280, TWO_M120 = pow2(-120);
/**
 * Exact (Payne–Hanek style) reduction in integer arithmetic for large or ill-conditioned arguments: x·2/π is
 * formed exactly from x's significand and the stored bits of 2/π, its integer part gives the quadrant and the top
 * 120 bits of its fraction give r. BigInt arithmetic is exact in every engine; this path allocates, the fast one does not.
 */
function reduceExact(x: number): number {
  f64[0] = Math.abs(x);
  const hw = u32[HI]!, lw = u32[LO]!, be = hw >>> 20;
  const m = (BigInt((hw & 0xfffff) | 0x100000) << 32n) | BigInt(lw); // |x| ≥ 1.6e6 or near a multiple: normal
  const shift = BigInt(TWO_OVER_PI_BITS - (be - 1075));             // x·2/π = m·T·2^-(shift)
  const p = m * TWO_OVER_PI, one = 1n << shift;
  let n = Number((p >> shift) & 3n), frac = p & (one - 1n);
  if (frac >= one >> 1n) { frac -= one; n++; }
  const top = frac >> (shift - 120n);                                // |top| < 2^119: the fraction × 2^120
  const fh = Number(top), fl = Number(top - BigInt(fh));
  const h = fh * TWO_M120, l = fl * TWO_M120;
  // r = (h + l)·π/2 in double-double
  const rh = twoProd(h, PIO2_HI), rl = scratch[PROD_ERR]! + h * PIO2_LO + l * PIO2_HI;
  let hi = rh + rl, lo = rl - (hi - rh);
  if (x < 0) { hi = -hi; lo = -lo; n = -n; }
  scratch[RED_HI] = hi; scratch[RED_LO] = lo;
  return n & 3;
}

/** Deterministic sine (radians). NaN for ±∞ and NaN. */
export function sin(x: number): number {
  const ax = Math.abs(x);
  if (!(ax < Infinity)) return NaN;
  if (ax <= PIO4) return ax < 3.725290298461914e-9 ? x : sinKernel(x, 0);
  const q = reduce(x), hi = scratch[RED_HI]!, lo = scratch[RED_LO]!;
  switch (q) {
    case 0: return sinKernel(hi, lo);
    case 1: return cosKernel(hi, lo);
    case 2: return -sinKernel(hi, lo);
    default: return -cosKernel(hi, lo);
  }
}

/** Deterministic cosine (radians). NaN for ±∞ and NaN. */
export function cos(x: number): number {
  const ax = Math.abs(x);
  if (!(ax < Infinity)) return NaN;
  if (ax <= PIO4) return ax < 3.725290298461914e-9 ? 1 : cosKernel(x, 0);
  const q = reduce(x), hi = scratch[RED_HI]!, lo = scratch[RED_LO]!;
  switch (q) {
    case 0: return cosKernel(hi, lo);
    case 1: return -sinKernel(hi, lo);
    case 2: return -cosKernel(hi, lo);
    default: return sinKernel(hi, lo);
  }
}

// ---- atan and atan2 ---------------------------------------------------------------------------------------
// atan t = t − t³·A(t²) on |t| ≤ 7/16; larger arguments shift by atan(1/2), atan(1), atan(3/2) or π/2.
const A0 = 0.3333333333333333, A1 = -0.1999999999999941, A2 = 0.14285714285566806, A3 = -0.11111111096645038,
  A4 = 0.09090908355602592, A5 = -0.07692285554889286, A6 = 0.06666241923359964, A7 = -0.05876946456755061,
  A8 = 0.05216679739313656, A9 = -0.04492259293193656, A10 = 0.033128134256069586, A11 = -0.014773184616983806;
const ATAN_HI = [0.4636476090008061, 0.7853981633974483, 0.982793723247329, 1.5707963267948966];
const ATAN_LO = [2.2698777452961687e-17, 3.061616997868383e-17, 1.3903311031230998e-17, 6.123233995736766e-17];

/** atan(t) for t ≥ 0 (including +∞). */
function atanPos(t: number): number {
  if (t >= 7.378697629483821e19) return PIO2_HI; // 2^66: π/2 to double precision
  let id: number;
  if (t < 0.4375) { if (t < 1.862645149230957e-9) return t; id = -1; }
  else if (t < 0.6875) { id = 0; t = (2 * t - 1) / (2 + t); }
  else if (t < 1.1875) { id = 1; t = (t - 1) / (t + 1); }
  else if (t < 2.4375) { id = 2; t = (t - 1.5) / (1 + 1.5 * t); }
  else { id = 3; t = -1 / t; }
  const z = t * t;
  const a = A0 + z * (A1 + z * (A2 + z * (A3 + z * (A4 + z * (A5 + z * (A6 + z * (A7 + z * (A8 + z * (A9 + z * (A10 + z * A11))))))))));
  const tail = t * z * a;
  if (id < 0) return t - tail;
  return ATAN_HI[id]! - ((tail - ATAN_LO[id]!) - t);
}

/** Deterministic arctangent, in [−π/2, π/2]. */
export function atan(x: number): number {
  if (x !== x) return NaN;
  return x < 0 ? -atanPos(-x) : x === 0 ? x : atanPos(x);
}

/** Deterministic atan2(y, x), in [−π, π], with the special values ECMAScript specifies for zeros and infinities. */
export function atan2(y: number, x: number): number {
  if (y !== y || x !== x) return NaN;
  const negY = y < 0 || (y === 0 && 1 / y < 0);
  let r: number;
  if (y === 0) {
    if (x > 0 || (x === 0 && 1 / x > 0)) return y;
    r = PI_HI;
  } else if (x === 0) r = PIO2_HI;
  else if (x === Infinity) { if (y === Infinity || y === -Infinity) r = PIO4; else return negY ? -0 : 0; }
  else if (x === -Infinity) r = y === Infinity || y === -Infinity ? THREE_PIO4 : PI_HI;
  else if (y === Infinity || y === -Infinity) r = PIO2_HI;
  else {
    const t = Math.abs(y) / Math.abs(x);
    r = x > 0 ? atanPos(t) : PI_HI - (atanPos(t) - PI_LO);
  }
  return negY ? -r : r;
}

// ---- exp --------------------------------------------------------------------------------------------------
// e^r = 1 + r + r·c/(2 − c), c = r − r²·P(r²), |r| ≤ ln2/2.
const P0 = 0.1666666666666666, P1 = -0.0027777777777564573, P2 = 6.613756471707873e-05, P3 = -1.6534060165972636e-06,
  P4 = 4.1437725653582016e-08;

/** e^(hi − lo) for |hi − lo| ≤ ~0.35, the reduced pair already split. */
function expKernel(hi: number, lo: number): number {
  const r = hi - lo, z = r * r;
  const c = r - z * (P0 + z * (P1 + z * (P2 + z * (P3 + z * P4))));
  return 1 - ((lo - (r * c) / (2 - c)) - hi);
}

/** Deterministic e^x. */
export function exp(x: number): number {
  if (x !== x) return NaN;
  if (x > 709.8) return Infinity;
  if (x < -745.2) return 0;
  if (Math.abs(x) < 3.725290298461914e-9) return 1 + x;
  if (Math.abs(x) <= 0.34657359027997264) return expKernel(x, 0);
  const n = Math.round(x * INV_LN2);
  return scale(expKernel(x - n * LN2_HI, n * LN2_LO), n);
}

// ---- log --------------------------------------------------------------------------------------------------
// log(1 + f) = f − (f²/2 − s·(f²/2 + R)), s = f/(2 + f), R = s²·L(s²); 1 + f in [√2/2, √2).
const L0 = 0.6666666666666666, L1 = 0.4000000000000088, L2 = 0.28571428570803614, L3 = 0.22222222391713917,
  L4 = 0.18181795640132906, L5 = 0.15386239702814658, L6 = 0.13268773138656886, L7 = 0.13086626147840102;

/** For finite x > 0: returns k and leaves m in scratch[MANT] with x = m·2^k, m in [√2/2, √2). */
function decompose(x: number): number {
  let k = 0;
  if (x < 2.2250738585072014e-308) { x *= TWO_P54; k = -54; }
  f64[0] = x;
  const hw = u32[HI]!;
  k += (hw >>> 20) - 1023;
  u32[HI] = (hw & 0xfffff) | 0x3ff00000;
  let m = f64[0]!;
  if (m > SQRT2) { m *= 0.5; k++; }
  scratch[MANT] = m;
  return k;
}

/** Deterministic natural logarithm. */
export function log(x: number): number {
  if (x !== x || x < 0) return NaN;
  if (x === 0) return -Infinity;
  if (x === Infinity) return Infinity;
  const k = decompose(x), f = scratch[MANT]! - 1;
  if (f === 0) return k === 0 ? 0 : k * LN2_HI + k * LN2_LO;
  const s = f / (2 + f), z = s * s, hfsq = 0.5 * f * f;
  const R = z * (L0 + z * (L1 + z * (L2 + z * (L3 + z * (L4 + z * (L5 + z * (L6 + z * L7)))))));
  if (k === 0) return f - (hfsq - s * (hfsq + R));
  return k * LN2_HI - ((hfsq - (s * (hfsq + R) + k * LN2_LO)) - f);
}

// ---- pow --------------------------------------------------------------------------------------------------
// |x|^y = e^(y·log|x|) with log|x| carried to about 2^-64 relative (double-double), so the product's error stays
// below the final exp's rounding for every result in the normal range.
const C3H = 0.6666666666666666, C3L = 3.700743415417188e-17;
/** log x as hi (returned) + scratch[LOG_LO], for finite x > 0. */
function logExtended(x: number): number {
  const k = decompose(x), f = scratch[MANT]! - 1;
  // s = f/(2+f) in double-double.
  const d = 2 + f, dl = f - (d - 2);
  const sh = f / d, p = twoProd(sh, d), sl = (((f - p) - scratch[PROD_ERR]!) - sh * dl) / d;
  // s² and s³ in double-double.
  const s2h = twoProd(sh, sh), s2l = scratch[PROD_ERR]! + 2 * sh * sl;
  const s3h = twoProd(s2h, sh), s3l = scratch[PROD_ERR]! + s2h * sl + s2l * sh;
  // (2/3)s³ in double-double, the rest (2/5 s⁵ …) in double: Taylor terms 2/(2j+1)·s^(2j+1), j = 2 … 13.
  const t3h = twoProd(C3H, s3h), t3l = scratch[PROD_ERR]! + C3H * s3l + C3L * s3h;
  const z = s2h;
  const tail = s3h * z * (2 / 5 + z * (2 / 7 + z * (2 / 9 + z * (2 / 11 + z * (2 / 13 + z * (2 / 15 + z * (2 / 17
    + z * (2 / 19 + z * (2 / 21 + z * (2 / 23 + z * (2 / 25 + z * (2 / 27))))))))))));
  // 2s + t3 + tail
  const a = 2 * sh, h = a + t3h, bb = h - a, e = (a - (h - bb)) + (t3h - bb);
  const l = e + (2 * sl + t3l + tail);
  // + k·ln 2
  const kh = k * LN2_HI42, H = kh + h, cc = H - kh, E = (kh - (H - cc)) + (h - cc);
  const lo = E + (k * LN2_LO42 + l);
  const hi = H + lo;
  scratch[LOG_LO] = lo - (hi - H);
  return hi;
}

const isOddInteger = (y: number): boolean => Number.isInteger(y) && Math.abs(y) < 9007199254740992 && y % 2 !== 0;

/** Deterministic x^y, with the special values ECMAScript specifies for Math.pow. */
export function pow(x: number, y: number): number {
  if (y !== y) return NaN;
  if (y === 0) return 1;
  if (x !== x) return NaN;
  const ay = Math.abs(y), ax = Math.abs(x);
  if (ay === Infinity) {
    if (ax === 1) return NaN;
    return (ax > 1) === (y > 0) ? Infinity : 0;
  }
  if (ax === Infinity) {
    if (x > 0) return y > 0 ? Infinity : 0;
    const odd = isOddInteger(y);
    return y > 0 ? (odd ? -Infinity : Infinity) : (odd ? -0 : 0);
  }
  if (x === 0) {
    const neg = 1 / x < 0 && isOddInteger(y);
    return y > 0 ? (neg ? -0 : 0) : (neg ? -Infinity : Infinity);
  }
  let sign = 1;
  if (x < 0) {
    if (!Number.isInteger(y)) return NaN;
    if (isOddInteger(y)) sign = -1;
  }
  // Exactly rounded shortcuts.
  if (y === 1) return x;
  if (y === 2) return x * x;
  if (y === -1) return 1 / x;
  if (y === 0.5) return Math.sqrt(x);
  if (ax === 1) return sign;
  const lh = logExtended(ax), ll = scratch[LOG_LO]!;
  const est = y * lh;
  if (est > 710) return sign * Infinity;
  if (est < -746) return sign * 0;
  const ph = twoProd(y, lh), pl = scratch[PROD_ERR]! + y * ll;
  const P = ph + pl, Pl = pl - (P - ph);
  // e^(P + Pl): reduce by n·ln 2 and hand the exact split to the exp kernel.
  const n = Math.round(P * INV_LN2);
  const a = P - n * LN2_HI, lo = n * LN2_LO - Pl;
  return sign * scale(expKernel(a, lo), n);
}

// ---- sqrt and hypot ---------------------------------------------------------------------------------------
/** IEEE-754 square root (correctly rounded in every engine; verified by the golden vectors). */
export const sqrt: (x: number) => number = Math.sqrt;

const TWO_P600 = pow2(600), TWO_M600 = pow2(-600), BIG = pow2(500), SMALL = pow2(-500);
/** √(a² + b²) for a ≥ b > 0 in a safe range: the rounded root plus one Newton correction from the exact residual. */
function hypotCore(a: number, b: number): number {
  const a2 = twoProd(a, a), ea = scratch[PROD_ERR]!, b2 = twoProd(b, b), eb = scratch[PROD_ERR]!;
  const s = a2 + b2, bb = s - a2, es = (a2 - (s - bb)) + (b2 - bb);
  const h = Math.sqrt(s), h2 = twoProd(h, h), eh = scratch[PROD_ERR]!;
  return h + (((s - h2) - eh) + (es + ea + eb)) / (2 * h);
}

/** Deterministic √(x² + y²) without intermediate overflow or underflow; ECMAScript's special values. */
export function hypot(x: number, y: number): number {
  let a = Math.abs(x), b = Math.abs(y);
  if (a === Infinity || b === Infinity) return Infinity;
  if (a !== a || b !== b) return NaN;
  if (a < b) { const t = a; a = b; b = t; }
  if (b === 0) return a;
  if (a > BIG) return hypotCore(a * TWO_M600, b * TWO_M600) * TWO_P600;
  if (a < SMALL) return hypotCore(a * TWO_P600, b * TWO_P600) * TWO_M600;
  return hypotCore(a, b);
}

/** The deterministic implementation. */
export const dmath: ScalarMath = Object.freeze({ sin, cos, atan, atan2, exp, log, pow, sqrt, hypot });

/** The engine's own Math functions (fast, implementation-approximated), behind the same interface. */
export const platformMath: ScalarMath = Object.freeze({
  sin: Math.sin, cos: Math.cos, atan: Math.atan, atan2: Math.atan2, exp: Math.exp, log: Math.log, pow: Math.pow,
  sqrt: Math.sqrt, hypot: (x: number, y: number) => Math.hypot(x, y),
});

/** The implementation for a kit's `math` option: undefined or 'platform' → platformMath; 'deterministic' → dmath. */
export function scalarMath(mode: ScalarMathMode | undefined): ScalarMath {
  if (mode === undefined || mode === 'platform') return platformMath;
  if (mode === 'deterministic') return dmath;
  throw new RangeError(`math must be 'platform' or 'deterministic' (got ${String(mode)})`);
}
