/**
 * kits/numeric/angle.ts: integer trigonometry on binary angles. An angle is an integer count of 1/2^turnBits of a
 * turn (65,536 per turn at the default 16 bits), so wrapping is a bit mask and every lookup is exact. Results are raw
 * values of a fixed-point format.
 *
 * The tables are built once, on first use, from the engine's deterministic `dmath` and rounded to the format, so
 * they are the same integers in every engine. Lookups and interpolation are integer arithmetic only.
 */
import {dmath} from '../../author';
import type {Fixed} from './fixed';

export interface FixedTrigOptions {
  /** Bits per full turn, 4..16 (default 16: 65,536 angle units per turn). */
  readonly turnBits?: number;
}

export interface FixedTrig {
  /** Angle units per full turn (2^turnBits). */
  readonly turn: number;
  /** sin of a binary angle (any integer; wrapped), as a raw value of the format, rounded to nearest. */
  readonly sin: (angle: number) => number;
  readonly cos: (angle: number) => number;
  /**
   * The binary angle of the vector (x, y) in (−turn/2, turn/2], measured like Math.atan2(y, x). Inputs are any
   * integers with |x|, |y| < 2^31 in a common scale (raw values of one format work). atan2(0, 0) is 0.
   */
  readonly atan2: (y: number, x: number) => number;
  /** Binary angle nearest a radian value (deterministic: correctly rounded basic operations and a nearest rounding). */
  readonly fromRadians: (radians: number) => number;
  readonly toRadians: (angle: number) => number;
  /** Wrap any integer angle to (−turn/2, turn/2]. */
  readonly wrap: (angle: number) => number;
}

const RATIO_BITS = 12; // atan table: 4,097 entries over t = y/x in [0, 1]
const RATIO_FRAC = 16; // the ratio is formed with 16 fraction bits and interpolated between table entries

/** Integer sin/cos/atan2 for one fixed-point format. */
export function createFixedTrig(format: Fixed, options: FixedTrigOptions = {}): FixedTrig {
  const turnBits = options.turnBits ?? 16;
  if (!Number.isInteger(turnBits) || turnBits < 4 || turnBits > 16)
    throw new RangeError(`turnBits must be an integer in [4, 16] (got ${String(turnBits)})`);
  if (format.format.wordBits - format.format.fracBits < 2)
    throw new RangeError('the format needs at least 2 integer bits to hold ±1.0');
  const TURN = 2 ** turnBits,
    QUARTER = TURN / 4,
    MASK = TURN - 1,
    HALF_TURN = TURN / 2;
  const ONE = format.one;
  let sinTable: Int32Array | Float64Array | undefined;
  let atanTable: Float64Array | undefined;

  function sinQuarter(): Int32Array | Float64Array {
    if (sinTable) return sinTable;
    const t = ONE <= 2 ** 30 ? new Int32Array(QUARTER + 1) : new Float64Array(QUARTER + 1);
    const step = (2 * Math.PI) / TURN; // Math.PI is a constant and the quotient is correctly rounded
    for (let i = 0; i <= QUARTER; i++) t[i] = Math.round(dmath.sin(i * step) * ONE);
    t[0] = 0;
    t[QUARTER] = ONE;
    return (sinTable = t);
  }
  function atanOctant(): Float64Array {
    if (atanTable) return atanTable;
    const n = 1 << RATIO_BITS,
      t = new Float64Array(n + 1);
    const scale = TURN / (2 * Math.PI);
    for (let i = 0; i <= n; i++) t[i] = Math.round(dmath.atan(i / n) * scale);
    t[n] = TURN / 8;
    return (atanTable = t);
  }
  const need = (v: number, name: string): void => {
    if (!Number.isSafeInteger(v)) throw new RangeError(`${name} must be an integer (got ${String(v)})`);
  };
  function sin(angle: number): number {
    need(angle, 'angle');
    const a = angle & MASK; // two's-complement wrap of any safe integer's low bits
    const t = sinQuarter();
    const q = Math.floor(a / QUARTER),
      r = a - q * QUARTER;
    switch (q) {
      case 0:
        return t[r]!;
      case 1:
        return t[QUARTER - r]!;
      case 2:
        return -t[r]! || 0;
      default:
        return -t[QUARTER - r]! || 0;
    }
  }
  function atan2(y: number, x: number): number {
    need(y, 'y');
    need(x, 'x');
    if (Math.abs(x) >= 2 ** 31 || Math.abs(y) >= 2 ** 31) throw new RangeError('atan2 inputs must satisfy |v| < 2^31');
    const ax = Math.abs(x),
      ay = Math.abs(y);
    if (ax === 0 && ay === 0) return 0;
    const t = atanOctant();
    // Octant angle in [0, turn/8] from the ratio min/max formed with 16 fraction bits (exact integer floor).
    const lo = Math.min(ax, ay),
      hi = Math.max(ax, ay);
    const ratio = Math.floor((lo * 2 ** RATIO_FRAC) / hi); // lo·2^16 < 2^47 and the quotient floor is exact here
    const fixed = ratio * hi > lo * 2 ** RATIO_FRAC ? ratio - 1 : ratio;
    const shift = RATIO_FRAC - RATIO_BITS,
      i = fixed >> shift,
      frac = fixed & ((1 << shift) - 1);
    let oct = t[i]!;
    if (frac !== 0) oct += Math.floor(((t[i + 1]! - oct) * frac + (1 << (shift - 1))) / (1 << shift));
    let a = ay > ax ? QUARTER - oct : oct;
    if (x < 0) a = HALF_TURN - a;
    if (y < 0) a = -a;
    return a === -HALF_TURN ? HALF_TURN : a === 0 ? 0 : a;
  }
  const wrap = (angle: number): number => {
    need(angle, 'angle');
    const a = angle & MASK;
    return a > HALF_TURN ? a - TURN : a;
  };
  return Object.freeze({
    turn: TURN,
    sin,
    cos: (angle: number) => (need(angle, 'angle'), sin((angle & MASK) + QUARTER)),
    atan2,
    fromRadians(radians: number) {
      if (!Number.isFinite(radians)) throw new RangeError('radians must be finite');
      const turns = radians / (2 * Math.PI); // correctly rounded; finite for every finite input
      return wrap(Math.round((turns - Math.floor(turns)) * TURN) & MASK);
    },
    toRadians: (angle: number) => (need(angle, 'angle'), (angle * 2 * Math.PI) / TURN),
    wrap,
  });
}
