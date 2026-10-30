/**
 * kits/numeric/fixed.ts: fixed-point arithmetic for deterministic simulations. A value is an integer `raw` that
 * stands for raw·2^-fracBits. Every operation is exact integer arithmetic followed by one documented rounding, so the
 * result is the same integer in every JavaScript engine and in any other language that implements the same rules.
 *
 * Two representations:
 *   - `createFixed`: words of 2..32 bits held in an ordinary `number` (JSON-safe, allocation-free on the fast path).
 *   - `createWideFixed`: words of 2..128 bits held in a `bigint` (Q32.32 and wider; allocates, encode for JSON).
 *
 * Fast-path exactness: a double holds every integer below 2^53 exactly, and +, −, × and ÷ by a power of two of such
 * integers are exact. Products and shifted dividends that could reach 2^53 take a BigInt path instead, which only
 * happens for fracBits above 21 or for results that overflow the word anyway.
 */

/** How a result that falls between two representable values is rounded. */
export type FixedRounding =
  /** To the nearest value; an exact half rounds toward +∞ (the `(x + half) >> f` idiom). */
  | 'nearest'
  /** Toward −∞ (an arithmetic right shift). */
  | 'floor'
  /** Toward zero (C-style integer division). */
  | 'trunc';

/** What happens when a result does not fit the word. */
export type FixedOverflow =
  /** Throw a RangeError (default): an overflow in a lockstep simulation is a design bug to surface. */
  | 'throw'
  /** Two's-complement wrap to the word, as integer hardware does. */
  | 'wrap'
  /** Clamp to the word's minimum or maximum. */
  | 'saturate';

/** A fixed-point format: a signed word of `wordBits` bits with `fracBits` fraction bits. */
export interface FixedFormat {
  readonly wordBits: number;
  readonly fracBits: number;
  readonly rounding?: FixedRounding;
  readonly overflow?: FixedOverflow;
}

/** Operations on one format. Every argument and result is a raw integer in the word's range. */
export interface Fixed {
  readonly format: Readonly<Required<FixedFormat>>;
  /** The raw value of 1.0. */
  readonly one: number;
  /** The smallest and largest raw values. */
  readonly min: number;
  readonly max: number;
  /** Raw value nearest a number under this format's rounding. Throws for NaN or ±∞. */
  readonly fromNumber: (x: number) => number;
  /** Raw value of an integer (exact; overflow policy applies). */
  readonly fromInt: (n: number) => number;
  /** The exact number a raw value stands for. */
  readonly toNumber: (raw: number) => number;
  /** Whether `raw` is an integer in this word's range. */
  readonly isRaw: (raw: unknown) => raw is number;
  readonly add: (a: number, b: number) => number;
  readonly sub: (a: number, b: number) => number;
  readonly neg: (a: number) => number;
  readonly abs: (a: number) => number;
  /** a·b with one rounding. */
  readonly mul: (a: number, b: number) => number;
  /** a·b + c with one rounding of the product (the sum is exact before the overflow check). */
  readonly mulAdd: (a: number, b: number, c: number) => number;
  /** a ÷ b with one rounding. Throws RangeError for b = 0 under every overflow policy. */
  readonly div: (a: number, b: number) => number;
  /** √a with one rounding ('nearest' rounds to nearest, otherwise floor). Throws RangeError for a < 0. */
  readonly sqrt: (a: number) => number;
  /** a + (b − a)·t, with t in this format. */
  readonly lerp: (a: number, b: number, t: number) => number;
  readonly clamp: (a: number, lo: number, hi: number) => number;
  /** Largest integer value ≤ a, as a raw value. */
  readonly floor: (a: number) => number;
  /** a − floor(a), in [0, one). */
  readonly fract: (a: number) => number;
  /** Re-express a raw value of another format in this one, rounding and checking overflow by this format's rules. */
  readonly convert: (raw: number, from: Fixed) => number;
}

const ROUNDINGS: readonly FixedRounding[] = ['nearest', 'floor', 'trunc'];
const OVERFLOWS: readonly FixedOverflow[] = ['throw', 'wrap', 'saturate'];
const TWO53 = 9007199254740992;
const FAST_PRODUCT = TWO53 - 2 ** 33;

function checkFormat(format: FixedFormat, maxWord: number): Readonly<Required<FixedFormat>> {
  const {wordBits, fracBits, rounding = 'nearest', overflow = 'throw'} = format;
  if (!Number.isInteger(wordBits) || wordBits < 2 || wordBits > maxWord)
    throw new RangeError(`wordBits must be an integer in [2, ${maxWord}] (got ${String(wordBits)})`);
  if (!Number.isInteger(fracBits) || fracBits < 0 || fracBits > wordBits - 1)
    throw new RangeError(`fracBits must be an integer in [0, wordBits − 1] (got ${String(fracBits)})`);
  if (!ROUNDINGS.includes(rounding)) throw new RangeError(`rounding must be one of ${ROUNDINGS.join(', ')}`);
  if (!OVERFLOWS.includes(overflow)) throw new RangeError(`overflow must be one of ${OVERFLOWS.join(', ')}`);
  return Object.freeze({wordBits, fracBits, rounding, overflow});
}

/**
 * Operations for a signed fixed-point format of up to 32 bits held in a number.
 *
 * ```ts
 * const q = createFixed({ wordBits: 32, fracBits: 16 });   // Q16.16, nearest, throw on overflow
 * const v = q.mul(q.fromNumber(1.5), q.fromNumber(-2.25));  // −3.375 exactly, as a raw integer
 * ```
 */
export function createFixed(format: FixedFormat): Fixed {
  const f = checkFormat(format, 32);
  const {wordBits: W, fracBits: F, rounding, overflow} = f;
  const ONE = 2 ** F,
    MIN = -(2 ** (W - 1)),
    MAX = 2 ** (W - 1) - 1,
    SPAN = 2 ** W;
  const BF = BigInt(F),
    BONE = 1n << BF;

  /** Fit an exact integer (|v| < 2^53) to the word. */
  function fit(v: number): number {
    if (v >= MIN && v <= MAX) return v === 0 ? 0 : v; // normalise −0
    if (overflow === 'saturate') return v < MIN ? MIN : MAX;
    if (overflow === 'wrap') {
      const w = v - Math.floor((v - MIN) / SPAN) * SPAN; // exact: SPAN is a power of two, |v| < 2^53
      return w === 0 ? 0 : w;
    }
    throw new RangeError(`fixed-point overflow: ${v} does not fit Q${W - F}.${F}`);
  }
  /** Fit a bigint result to the word (any size). */
  function fitBig(v: bigint): number {
    if (v >= BigInt(MIN) && v <= BigInt(MAX)) return Number(v);
    if (overflow === 'saturate') return v < 0n ? MIN : MAX;
    if (overflow === 'wrap') return Number(BigInt.asIntN(W, v));
    throw new RangeError(`fixed-point overflow: ${v} does not fit Q${W - F}.${F}`);
  }
  /** q = floor(n / d), r = n − q·d in [0, d), for an exact integer n and integer d > 0; rounds q per policy. */
  function roundQuotient(q: number, r: number, d: number): number {
    if (r === 0) return q;
    if (rounding === 'floor') return q;
    if (rounding === 'trunc') return q < 0 ? q + 1 : q;
    return 2 * r >= d ? q + 1 : q;
  }
  function roundBig(n: bigint, d: bigint): bigint {
    // d > 0
    let q = n / d,
      r = n % d;
    if (r < 0n) {
      q -= 1n;
      r += d;
    }
    if (r === 0n || rounding === 'floor') return q;
    if (rounding === 'trunc') return q < 0n ? q + 1n : q;
    return 2n * r >= d ? q + 1n : q;
  }
  /** Round n / 2^F for an exact integer n (|n| < 2^53). */
  function shiftDown(n: number): number {
    if (F === 0) return n;
    const q = Math.floor(n / ONE); // exact: division by a power of two
    return roundQuotient(q, n - q * ONE, ONE);
  }
  /** Round n / d for exact integers |n| < 2^52, 0 < |d| < 2^33. */
  function divide(n: number, d: number): number {
    if (d < 0) {
      n = -n;
      d = -d;
    }
    let q = Math.floor(n / d),
      r = n - q * d; // q is within one of the true floor; q·d is exact
    if (r < 0) {
      q -= 1;
      r += d;
    } else if (r >= d) {
      q += 1;
      r -= d;
    }
    return roundQuotient(q, r, d);
  }

  const isRaw = (raw: unknown): raw is number =>
    Number.isInteger(raw) && (raw as number) >= MIN && (raw as number) <= MAX;
  const need = (raw: number, name: string): void => {
    if (!isRaw(raw)) throw new RangeError(`${name} must be a raw Q${W - F}.${F} integer (got ${String(raw)})`);
  };
  /** Exact integer square root floor for 0 ≤ n < 2^53. */
  function isqrt(n: number): number {
    let r = Math.floor(Math.sqrt(n));
    while (r * r > n) r--;
    while ((r + 1) * (r + 1) <= n) r++;
    return r;
  }
  function isqrtBig(n: bigint): bigint {
    if (n < 2n) return n;
    let x = BigInt(Math.floor(Math.sqrt(Number(n)))); // close start; Newton fixes the low bits
    for (;;) {
      const y = (x + n / x) >> 1n;
      if (y >= x) {
        if (x * x > n) {
          x -= 1n;
          continue;
        }
        while ((x + 1n) * (x + 1n) <= n) x += 1n;
        return x;
      }
      x = y;
    }
  }

  function mulRaw(a: number, b: number, c: number): number {
    const p = a * b;
    // |p| < 2^53 − 2^33 keeps the product exact and, with |c| < 2^33, the sum below 2^53, so even a wrapped result
    // is exact. Anything larger takes the BigInt path.
    if (p > -FAST_PRODUCT && p < FAST_PRODUCT) return fit(shiftDown(p) + c);
    return fitBig(roundBig(BigInt(a) * BigInt(b), BONE) + BigInt(c));
  }

  const ops: Fixed = {
    format: f,
    one: ONE,
    min: MIN,
    max: MAX,
    isRaw,
    fromNumber(x) {
      if (!Number.isFinite(x)) throw new RangeError(`fromNumber needs a finite number (got ${x})`);
      const v = x * ONE; // exact power-of-two scaling (|x|·2^F stays far from overflow for a finite fitting x)
      if (Math.abs(v) >= TWO53) return fitBig(Number.isFinite(v) ? BigInt(v) : BigInt(x) << BF); // already an integer
      const q = Math.floor(v);
      const d = v - q; // exact
      let r: number;
      if (d === 0 || rounding === 'floor') r = q;
      else if (rounding === 'trunc') r = q < 0 ? q + 1 : q;
      else r = d >= 0.5 ? q + 1 : q;
      return fit(r);
    },
    fromInt(n) {
      if (!Number.isSafeInteger(n)) throw new RangeError(`fromInt needs a safe integer (got ${n})`);
      const v = n * ONE;
      return Math.abs(v) < TWO53 ? fit(v) : fitBig(BigInt(n) << BF);
    },
    toNumber(raw) {
      need(raw, 'raw');
      return raw / ONE;
    },
    add(a, b) {
      need(a, 'a');
      need(b, 'b');
      return fit(a + b);
    },
    sub(a, b) {
      need(a, 'a');
      need(b, 'b');
      return fit(a - b);
    },
    neg(a) {
      need(a, 'a');
      return fit(-a);
    },
    abs(a) {
      need(a, 'a');
      return fit(Math.abs(a));
    },
    mul(a, b) {
      need(a, 'a');
      need(b, 'b');
      return mulRaw(a, b, 0);
    },
    mulAdd(a, b, c) {
      need(a, 'a');
      need(b, 'b');
      need(c, 'c');
      return mulRaw(a, b, c);
    },
    div(a, b) {
      need(a, 'a');
      need(b, 'b');
      if (b === 0) throw new RangeError('fixed-point division by zero');
      const n = a * ONE;
      if (Math.abs(n) < 2 ** 52) return fit(divide(n, b));
      return fitBig(roundBig(BigInt(b < 0 ? -a : a) << BF, BigInt(Math.abs(b))));
    },
    sqrt(a) {
      need(a, 'a');
      if (a < 0) throw new RangeError(`fixed-point sqrt of a negative value (${a})`);
      const n = a * ONE;
      let r: number;
      if (n < TWO53) {
        r = isqrt(n);
        if (rounding === 'nearest' && n - r * r > r) r += 1; // n ≥ r² + r + 1 ⇔ √n ≥ r + ½ (no exact ties)
        return fit(r);
      }
      const nb = BigInt(a) << BF;
      let rb = isqrtBig(nb);
      if (rounding === 'nearest' && nb - rb * rb > rb) rb += 1n;
      return fitBig(rb);
    },
    lerp(a, b, t) {
      need(a, 'a');
      need(b, 'b');
      need(t, 't');
      return mulRaw(b - a, t, a); // b − a is exact (< 2^33); the product is rounded once
    },
    clamp(a, lo, hi) {
      need(a, 'a');
      need(lo, 'lo');
      need(hi, 'hi');
      if (lo > hi) throw new RangeError('clamp needs lo ≤ hi');
      const r = a < lo ? lo : a > hi ? hi : a;
      return r === 0 ? 0 : r; // normalise −0
    },
    floor(a) {
      need(a, 'a');
      return fit(Math.floor(a / ONE) * ONE);
    },
    fract(a) {
      need(a, 'a');
      return a - Math.floor(a / ONE) * ONE;
    },
    convert(raw, from) {
      if (!from.isRaw(raw)) throw new RangeError(`raw must be a raw value of the source format (got ${String(raw)})`);
      const d = F - from.format.fracBits;
      if (d >= 0) {
        const v = raw * 2 ** d;
        return Math.abs(v) < TWO53 ? fit(v) : fitBig(BigInt(raw) << BigInt(d));
      }
      const s = 2 ** -d,
        q = Math.floor(raw / s);
      return fit(roundQuotient(q, raw - q * s, s));
    },
  };
  return Object.freeze(ops);
}

/** Operations on one wide format, with bigint raw values. */
export interface WideFixed {
  readonly format: Readonly<Required<FixedFormat>>;
  readonly one: bigint;
  readonly min: bigint;
  readonly max: bigint;
  readonly fromNumber: (x: number) => bigint;
  readonly fromInt: (n: bigint | number) => bigint;
  /** The nearest double to the value (exact when it fits 53 significant bits). */
  readonly toNumber: (raw: bigint) => number;
  readonly isRaw: (raw: unknown) => raw is bigint;
  readonly add: (a: bigint, b: bigint) => bigint;
  readonly sub: (a: bigint, b: bigint) => bigint;
  readonly neg: (a: bigint) => bigint;
  readonly abs: (a: bigint) => bigint;
  readonly mul: (a: bigint, b: bigint) => bigint;
  readonly mulAdd: (a: bigint, b: bigint, c: bigint) => bigint;
  readonly div: (a: bigint, b: bigint) => bigint;
  readonly sqrt: (a: bigint) => bigint;
  readonly lerp: (a: bigint, b: bigint, t: bigint) => bigint;
  readonly clamp: (a: bigint, lo: bigint, hi: bigint) => bigint;
  readonly floor: (a: bigint) => bigint;
  readonly fract: (a: bigint) => bigint;
  /** JSON-safe text for snapshots and save sections (decimal raw integer). */
  readonly encode: (raw: bigint) => string;
  /** Inverse of encode; throws RangeError for malformed or out-of-range text. */
  readonly decode: (text: string) => bigint;
}

/**
 * Operations for a signed fixed-point format of up to 128 bits held in a bigint, for example Q32.32:
 *
 * ```ts
 * const q = createWideFixed({ wordBits: 64, fracBits: 32 });
 * const x = q.div(q.fromInt(1), q.fromInt(3));    // 0x55555555 (nearest)
 * save.write(q.encode(x));                          // bigint is not JSON; encode is
 * ```
 */
export function createWideFixed(format: FixedFormat): WideFixed {
  const f = checkFormat(format, 128);
  const {wordBits: W, fracBits: F, rounding, overflow} = f;
  const BF = BigInt(F),
    ONE = 1n << BF,
    MIN = -(1n << BigInt(W - 1)),
    MAX = (1n << BigInt(W - 1)) - 1n;
  const fit = (v: bigint): bigint => {
    if (v >= MIN && v <= MAX) return v;
    if (overflow === 'saturate') return v < 0n ? MIN : MAX;
    if (overflow === 'wrap') return BigInt.asIntN(W, v);
    throw new RangeError(`fixed-point overflow: ${v} does not fit Q${W - F}.${F}`);
  };
  const roundDiv = (n: bigint, d: bigint): bigint => {
    if (d < 0n) {
      n = -n;
      d = -d;
    }
    let q = n / d,
      r = n % d;
    if (r < 0n) {
      q -= 1n;
      r += d;
    }
    if (r === 0n || rounding === 'floor') return q;
    if (rounding === 'trunc') return q < 0n ? q + 1n : q;
    return 2n * r >= d ? q + 1n : q;
  };
  const isRaw = (raw: unknown): raw is bigint => typeof raw === 'bigint' && raw >= MIN && raw <= MAX;
  const need = (raw: bigint, name: string): void => {
    if (!isRaw(raw)) throw new RangeError(`${name} must be a raw Q${W - F}.${F} bigint (got ${String(raw)})`);
  };
  const isqrt = (n: bigint): bigint => {
    if (n < 2n) return n;
    let x = 1n << BigInt((n.toString(2).length >> 1) + 1); // ≥ √n
    for (;;) {
      const y = (x + n / x) >> 1n;
      if (y >= x) return x;
      x = y;
    }
  };
  const view = new DataView(new ArrayBuffer(8));
  const ops: WideFixed = {
    format: f,
    one: ONE,
    min: MIN,
    max: MAX,
    isRaw,
    fromNumber(x) {
      if (!Number.isFinite(x)) throw new RangeError(`fromNumber needs a finite number (got ${x})`);
      if (x === 0) return 0n;
      // x = m·2^e exactly, from the bits; then scale by 2^F and round once.
      view.setFloat64(0, Math.abs(x));
      const hi = view.getUint32(0),
        lo = view.getUint32(4),
        be = hi >>> 20;
      let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
      let e: number;
      if (be) {
        m |= 1n << 52n;
        e = be - 1075;
      } else e = -1074;
      if (x < 0) m = -m;
      const s = e + F;
      return fit(s >= 0 ? m << BigInt(s) : roundDiv(m, 1n << BigInt(-s)));
    },
    fromInt(n) {
      if (typeof n === 'number' && !Number.isSafeInteger(n))
        throw new RangeError(`fromInt needs a safe integer (got ${n})`);
      return fit(BigInt(n) << BF);
    },
    toNumber(raw) {
      need(raw, 'raw');
      // Number(bigint) rounds to nearest; dividing by 2^F is exact unless the result is subnormal (F ≤ 127 keeps it normal).
      return Number(raw) / Number(ONE);
    },
    add: (a, b) => (need(a, 'a'), need(b, 'b'), fit(a + b)),
    sub: (a, b) => (need(a, 'a'), need(b, 'b'), fit(a - b)),
    neg: a => (need(a, 'a'), fit(-a)),
    abs: a => (need(a, 'a'), fit(a < 0n ? -a : a)),
    mul: (a, b) => (need(a, 'a'), need(b, 'b'), fit(roundDiv(a * b, ONE))),
    mulAdd: (a, b, c) => (need(a, 'a'), need(b, 'b'), need(c, 'c'), fit(roundDiv(a * b, ONE) + c)),
    div(a, b) {
      need(a, 'a');
      need(b, 'b');
      if (b === 0n) throw new RangeError('fixed-point division by zero');
      return fit(roundDiv(a << BF, b));
    },
    sqrt(a) {
      need(a, 'a');
      if (a < 0n) throw new RangeError(`fixed-point sqrt of a negative value (${a})`);
      const n = a << BF;
      let r = isqrt(n);
      if (rounding === 'nearest' && n - r * r > r) r += 1n;
      return fit(r);
    },
    lerp: (a, b, t) => (need(a, 'a'), need(b, 'b'), need(t, 't'), fit(a + roundDiv((b - a) * t, ONE))),
    clamp(a, lo, hi) {
      need(a, 'a');
      need(lo, 'lo');
      need(hi, 'hi');
      if (lo > hi) throw new RangeError('clamp needs lo ≤ hi');
      return a < lo ? lo : a > hi ? hi : a;
    },
    floor: a => (need(a, 'a'), fit((a >> BF) << BF)),
    fract: a => (need(a, 'a'), a - ((a >> BF) << BF)),
    encode: raw => (need(raw, 'raw'), raw.toString()),
    decode(text) {
      if (typeof text !== 'string' || !/^-?(0|[1-9][0-9]{0,40})$/.test(text))
        throw new RangeError(`not an encoded raw value: ${String(text)}`);
      const v = BigInt(text);
      if (!isRaw(v)) throw new RangeError(`encoded value out of range: ${text}`);
      return v;
    },
  };
  return Object.freeze(ops);
}
