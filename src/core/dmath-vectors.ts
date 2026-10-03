/**
 * core/dmath-vectors.ts: the fixed inputs behind dmath.golden.json, and the hex encoding the golden file uses, so
 * any JavaScript engine (Node, a browser, another runtime) can recompute the vectors and compare bits. Inputs are
 * special values, boundaries of each reduction range and a seeded integer generator (no Math.random, no
 * transcendental functions), so the inputs themselves are identical everywhere.
 */
import type {ScalarMath} from './dmath';

export type GoldenFunction = 'sin' | 'cos' | 'atan' | 'atan2' | 'exp' | 'log' | 'pow' | 'sqrt' | 'hypot';
export const GOLDEN_FUNCTIONS: readonly GoldenFunction[] = [
  'sin',
  'cos',
  'atan',
  'atan2',
  'exp',
  'log',
  'pow',
  'sqrt',
  'hypot',
];
/** Each case is [argument hex…, result hex]. */
export type GoldenCases = Record<GoldenFunction, string[][]>;
export interface GoldenFile {
  format: 'foundation.dmath-golden';
  version: 1;
  cases: GoldenCases;
}

const view = new DataView(new ArrayBuffer(8));
/** The 16-digit big-endian hex of a double's bits (NaN is canonicalised to 7ff8000000000000). */
export function toHex(x: number): string {
  if (x !== x) return '7ff8000000000000';
  view.setFloat64(0, x);
  return view.getUint32(0).toString(16).padStart(8, '0') + view.getUint32(4).toString(16).padStart(8, '0');
}
/** The double whose bits are `hex`. */
export function fromHex(hex: string): number {
  if (!/^[0-9a-f]{16}$/.test(hex)) throw new RangeError(`bad double hex ${hex}`);
  view.setUint32(0, parseInt(hex.slice(0, 8), 16));
  view.setUint32(4, parseInt(hex.slice(8), 16));
  return view.getFloat64(0);
}

/** A 32-bit LCG: uniform in [0, 1) with 2^-32 resolution, identical in every engine. */
function stream(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
/** 2^e for integer e in a safe range, by repeated exact doubling. */
function twoTo(e: number): number {
  let v = 1;
  if (e > 0) for (let i = 0; i < e; i++) v *= 2;
  else for (let i = 0; i < -e; i++) v /= 2;
  return v;
}

const SPECIAL = [
  0,
  -0,
  Infinity,
  -Infinity,
  NaN,
  1,
  -1,
  0.5,
  -0.5,
  2,
  5e-324,
  -5e-324,
  2.2250738585072014e-308,
  1.7976931348623157e308,
  -1.7976931348623157e308,
];
const PI = 3.141592653589793;

/** The golden inputs per function (argument lists). Changing this list changes the golden file. */
export function goldenInputs(): Record<GoldenFunction, number[][]> {
  const r = stream(20261002),
    u = (lo: number, hi: number) => lo + (hi - lo) * r();
  const logUniform = (lo: number, hi: number) => twoTo(Math.floor(u(lo, hi))) * (1 + r());
  const many = (n: number, f: () => number[]) => Array.from({length: n}, f);
  const one = (xs: number[]) => xs.map(x => [x]);
  const angles = [
    PI / 4,
    -PI / 4,
    PI / 2,
    PI,
    (3 * PI) / 2,
    2 * PI,
    1e-9,
    3.7e-9,
    0.785,
    0.786,
    100 * PI,
    1e5,
    1.6e6,
    1e10,
    1e22,
  ];
  // Huge sin/cos arguments for the exact reduction: the double nearest a multiple of π/2 (6381956970095103·2^797),
  // then 20 log-uniform magnitudes in [2^20, 2^1023) ⊂ [1e6, 1e308) with full 53-bit significands and random signs.
  // They come from their own seeded stream, appended after the original inputs, so no earlier vector moves.
  const big = stream(797),
    hardest = 6381956970095103 * twoTo(797);
  const huge = [
    hardest,
    -hardest,
    ...Array.from(
      {length: 20},
      () => twoTo(20 + Math.floor(1003 * big())) * (1 + big() + big() / 4294967296) * (big() < 0.5 ? -1 : 1),
    ),
  ];
  return {
    sin: [
      ...one([...SPECIAL, ...angles]),
      ...many(60, () => [u(-10, 10)]),
      ...many(30, () => [u(-1e5, 1e5)]),
      ...one(huge),
    ],
    cos: [
      ...one([...SPECIAL, ...angles]),
      ...many(60, () => [u(-10, 10)]),
      ...many(30, () => [u(-1e5, 1e5)]),
      ...one(huge),
    ],
    atan: [
      ...one([...SPECIAL, 0.4375, 0.6875, 1.1875, 2.4375, 1e-10, 1e20, 7.4e19]),
      ...many(60, () => [u(-5, 5)]),
      ...many(20, () => [logUniform(-60, 60) * (r() < 0.5 ? -1 : 1)]),
    ],
    atan2: [
      ...[
        [0, 0],
        [-0, 0],
        [0, -0],
        [-0, -0],
        [0, -1],
        [-0, -1],
        [1, 0],
        [-1, -0],
        [Infinity, Infinity],
        [-Infinity, Infinity],
        [Infinity, -Infinity],
        [-Infinity, -Infinity],
        [1, Infinity],
        [-1, Infinity],
        [1, -Infinity],
        [-1, -Infinity],
        [Infinity, 1],
        [NaN, 1],
        [1, NaN],
        [1e-300, -1e300],
        [1e300, 1e-300],
      ],
      ...many(80, () => [u(-50, 50), u(-50, 50)]),
      ...many(20, () => [logUniform(-40, 40) * (r() < 0.5 ? -1 : 1), logUniform(-40, 40) * (r() < 0.5 ? -1 : 1)]),
    ],
    exp: [
      ...one([...SPECIAL, 709.78, 709.79, -745.1, -745.2, -708.4, 0.3465, 0.3466, 3.7e-9, 1e-20]),
      ...many(60, () => [u(-50, 50)]),
      ...many(30, () => [u(-745, 709.7)]),
    ],
    log: [
      ...one([
        ...SPECIAL,
        1.4142135623730951,
        0.7071067811865476,
        1 + 2.220446049250313e-16,
        1 - 1.1102230246251565e-16,
        1e-310,
        10,
        100,
      ]),
      ...many(60, () => [u(0, 10)]),
      ...many(30, () => [logUniform(-1000, 1000)]),
    ],
    pow: [
      ...[
        [2, 0.5],
        [-0, 0.5],
        [-Infinity, 0.5],
        [-8, 1 / 3],
        [-2, 3],
        [-2, 2],
        [-2, -3],
        [-0, -3],
        [-0, 3],
        [0, -2],
        [-Infinity, 3],
        [-Infinity, -3],
        [-Infinity, 2],
        [1, Infinity],
        [-1, Infinity],
        [0.5, Infinity],
        [0.5, -Infinity],
        [2, -Infinity],
        [NaN, 0],
        [1, NaN],
        [NaN, 1],
        [10, 308],
        [10, 309],
        [10, -323],
        [10, -324],
        [3, 2],
        [3, -1],
        [7, 1],
        [1, 1e300],
        [2, 1023],
        [2, 1024],
        [2, -1074],
        [2, -1075],
        [0.999999, 1e9],
      ],
      ...many(60, () => [u(0, 50), u(-4, 4)]),
      ...many(30, () => [u(0, 2), u(-300, 300)]),
      ...many(10, () => [-Math.floor(u(1, 20)), Math.floor(u(-20, 20))]),
    ],
    sqrt: [...one([...SPECIAL, 3, 0.1, 1e-310]), ...many(80, () => [logUniform(-1000, 1000)])],
    hypot: [
      ...[
        [0, 0],
        [-0, -0],
        [Infinity, NaN],
        [NaN, -Infinity],
        [NaN, 1],
        [3, 4],
        [1e300, 1e300],
        [1e-300, 1e-300],
        [5e-324, 5e-324],
        [1.7976931348623157e308, 1.7976931348623157e308],
      ],
      ...many(80, () => [u(-1e3, 1e3), u(-1e3, 1e3)]),
      ...many(20, () => [logUniform(-900, 900), logUniform(-900, 900)]),
    ],
  };
}

/** Evaluate every golden input with `math`: the structure of dmath.golden.json's `cases`. */
export function computeGolden(math: ScalarMath): GoldenCases {
  const inputs = goldenInputs(),
    out = {} as GoldenCases;
  for (const fn of GOLDEN_FUNCTIONS) {
    const f = math[fn] as (...a: number[]) => number;
    out[fn] = inputs[fn].map(args => [...args.map(toHex), toHex(f(...args))]);
  }
  return out;
}
