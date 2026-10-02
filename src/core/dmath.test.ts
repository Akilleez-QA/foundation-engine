import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dmath, platformMath, scalarMath, type ScalarMath } from './dmath';
import { computeGolden, fromHex, goldenInputs, GOLDEN_FUNCTIONS, toHex, type GoldenFile } from './dmath-vectors';

const golden = JSON.parse(readFileSync(new URL('./dmath.golden.json', import.meta.url), 'utf8')) as GoldenFile;

// Ordered distance between two doubles in ulps (0 for equal; NaN only matches NaN).
const view = new DataView(new ArrayBuffer(8));
const ordinal = (x: number): bigint => { view.setFloat64(0, x); const b = view.getBigInt64(0); return b < 0n ? -(b & 0x7fffffffffffffffn) : b; };
function ulps(a: number, b: number): number {
  if (a !== a || b !== b) return a !== a && b !== b ? 0 : Infinity;
  const d = ordinal(a) - ordinal(b);
  return Number(d < 0n ? -d : d);
}
/** A finite double as exactly m·2^e with integer m ≥ 0 (the sign is dropped). */
function exact(x: number): { m: bigint; e: number } {
  view.setFloat64(0, Math.abs(x));
  const hi = view.getUint32(0), lo = view.getUint32(4), be = hi >>> 20;
  const m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  return be ? { m: m | (1n << 52n), e: be - 1075 } : { m, e: -1074 };
}
/** a·2^ea compared with b·2^eb, exactly. */
function cmp(a: bigint, ea: number, b: bigint, eb: number): number {
  const e = Math.min(ea, eb), l = a << BigInt(ea - e), r = b << BigInt(eb - e);
  return l < r ? -1 : l > r ? 1 : 0;
}
/** Whether r is within `half` half-ulps of √(v·2^ev): (r − k·ulp/2)² ≤ v·2^ev ≤ (r + k·ulp/2)². k = 1 is correct rounding. */
function rootWithin(r: number, v: bigint, ev: number, half = 1): boolean {
  const { m, e } = exact(r), k = BigInt(half), lo = 2n * m - k, hi = 2n * m + k, eh = 2 * (e - 1);
  return cmp(lo * lo, eh, v, ev) <= 0 && cmp(v, ev, hi * hi, eh) <= 0;
}

test('dmath: the committed golden vectors are exactly what this engine computes (hex bits)', () => {
  assert.equal(golden.format, 'foundation.dmath-golden');
  assert.equal(golden.version, 1);
  const inputs = goldenInputs();
  for (const fn of GOLDEN_FUNCTIONS) {
    assert.deepEqual(golden.cases[fn].map(row => row.slice(0, -1)), inputs[fn].map(args => args.map(toHex)), `${fn} golden inputs`);
  }
  assert.deepEqual(computeGolden(dmath), golden.cases);
  assert.ok(Object.values(golden.cases).reduce((n, rows) => n + rows.length, 0) > 1000);
});

test('dmath: hex encoding round-trips every double class', () => {
  for (const x of [0, -0, 1, -1.5, 5e-324, 1.7976931348623157e308, Infinity, -Infinity]) assert.ok(Object.is(fromHex(toHex(x)), x));
  assert.ok(Number.isNaN(fromHex(toHex(NaN))));
  assert.throws(() => fromHex('xyz'), RangeError);
});

test('dmath: Math.sqrt is correctly rounded on the golden inputs, so dmath.sqrt is Math.sqrt', () => {
  assert.equal(dmath.sqrt, Math.sqrt);
  let checked = 0;
  for (const [x] of goldenInputs().sqrt) {
    if (!(x! > 0 && x! < Infinity)) continue;
    const { m, e } = exact(x!);
    assert.ok(rootWithin(Math.sqrt(x!), m, e), `sqrt(${x}) is correctly rounded`);
    checked++;
  }
  assert.ok(checked >= 85, `${checked} positive finite inputs`);
});

test('dmath: hypot is within one ulp of the exact root (checked in integers), without overflow or underflow', () => {
  const r = seeded(9), cases: [number, number][] = [...goldenInputs().hypot as [number, number][]];
  for (let i = 0; i < 4000; i++) cases.push([(r() - .5) * 2e3, (r() - .5) * 2e3]);
  let correctlyRounded = 0, finite = 0;
  for (const [x, y] of cases) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || (x === 0 && y === 0)) continue;
    const h = dmath.hypot(x, y); if (h === Infinity) continue;
    const a = exact(x), b = exact(y), e = Math.min(2 * a.e, 2 * b.e);
    const v = ((a.m * a.m) << BigInt(2 * a.e - e)) + ((b.m * b.m) << BigInt(2 * b.e - e));
    assert.ok(rootWithin(h, v, e, 2), `hypot(${x}, ${y}) = ${h}`);
    finite++; if (rootWithin(h, v, e, 1)) correctlyRounded++;
  }
  assert.ok(correctlyRounded / finite > 0.99, `${correctlyRounded}/${finite} correctly rounded`);
  assert.equal(dmath.hypot(1e300, 1e300), 1.4142135623730952e300);
  assert.equal(dmath.hypot(3e-320, 4e-320), 5e-320);
});

/** The special values ECMAScript fixes for Math.* (NaN, signed zeros, infinities) are reproduced exactly. */
test('dmath: special values match Math exactly', () => {
  const S = [0, -0, Infinity, -Infinity, NaN, 1, -1, 0.5, -0.5, 2, -2, 3, -3, 5e-324, -5e-324];
  const exactWhereSpecified = (name: string, a: number, b: number, args: number[]) => {
    if (a !== a || b !== b || !Number.isFinite(b) || b === 0) assert.ok(Object.is(a, b), `${name}(${args}) = ${a}, Math gives ${b}`);
    else assert.ok(ulps(a, b) <= 1, `${name}(${args}) = ${a}, Math gives ${b}`);
  };
  for (const fn of ['sin', 'cos', 'atan', 'exp', 'log', 'sqrt'] as const) for (const x of S) exactWhereSpecified(fn, dmath[fn](x), Math[fn](x), [x]);
  for (const fn of ['atan2', 'pow', 'hypot'] as const) for (const x of S) for (const y of S) exactWhereSpecified(fn, dmath[fn](x, y), Math[fn](x, y), [x, y]);
  assert.ok(Object.is(dmath.pow(-0, 0.5), 0) && dmath.pow(-Infinity, 0.5) === Infinity, 'pow(·, 0.5) is not sqrt at −0 and −∞');
  assert.ok(Number.isNaN(dmath.pow(-8, 1 / 3)) && dmath.pow(-2, 3) === -8 && Object.is(dmath.pow(-0, -3), -Infinity));
});

function seeded(seed: number) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }

/**
 * Accuracy against this engine's Math (V8's fdlibm-derived functions, themselves under one ulp): at most one ulp
 * apart over the documented domains. The guide's tables (docs/guides/deterministic-math.md) give the measured error
 * against exact values.
 */
test('dmath: within one ulp of Math over the documented domains', () => {
  const r = seeded(4242), u = (lo: number, hi: number) => lo + (hi - lo) * r(), N = 20000;
  const domains: [keyof ScalarMath, () => number[]][] = [
    ['sin', () => [u(-10, 10)]], ['sin', () => [u(-1e5, 1e5)]], ['sin', () => [u(-1.6e6, 1.6e6)]], ['sin', () => [(r() - .5) * 10 ** u(6, 308)]],
    ['cos', () => [u(-10, 10)]], ['cos', () => [u(-1e5, 1e5)]], ['cos', () => [u(-1.6e6, 1.6e6)]], ['cos', () => [(r() - .5) * 10 ** u(6, 308)]],
    ['atan', () => [u(-100, 100)]],
    ['atan2', () => [u(-50, 50), u(-50, 50)]], ['atan2', () => [(r() - .5) * 10 ** u(-10, 10), (r() - .5) * 10 ** u(-10, 10)]],
    ['exp', () => [u(-50, 50)]], ['exp', () => [u(-708, 709.7)]],
    ['log', () => [u(0, 10)]], ['log', () => [10 ** u(-300, 300)]],
    ['pow', () => [u(0, 50), u(-4, 4)]], ['pow', () => [u(0, 2), u(-300, 300)]], ['pow', () => [-Math.ceil(u(0, 20)), Math.round(u(-30, 30))]],
  ];
  for (const [fn, gen] of domains) {
    let worst = 0, at: number[] = [];
    const f = dmath[fn] as (...a: number[]) => number, g = Math[fn] as (...a: number[]) => number;
    for (let i = 0; i < N; i++) { const a = gen(), d = ulps(f(...a), g(...a)); if (d > worst) { worst = d; at = a; } }
    assert.ok(worst <= 1, `${fn}: ${worst} ulps at ${at}`);
  }
});

test('dmath: identities a simulation relies on', () => {
  assert.equal(dmath.sin(0), 0); assert.ok(Object.is(dmath.sin(-0), -0)); assert.equal(dmath.cos(0), 1);
  assert.equal(dmath.atan2(0, 1), 0); assert.equal(dmath.atan2(1, 0), Math.PI / 2); assert.equal(dmath.atan2(0, -1), Math.PI);
  assert.equal(dmath.exp(0), 1); assert.equal(dmath.log(1), 0); assert.equal(dmath.pow(3, 2), 9); assert.equal(dmath.pow(2, 10), 1024);
  assert.equal(dmath.pow(2, -1074), 5e-324); assert.equal(dmath.pow(2, 1024), Infinity); assert.equal(dmath.exp(710), Infinity); assert.equal(dmath.exp(-746), 0);
  assert.equal(dmath.hypot(3, 4), 5);
  // Large and ill-conditioned arguments take the exact reduction: still within one ulp of Math.
  for (const x of [1e10, 1e22, 1.7976931348623157e308, 6381956970095103 * 2 ** 797, 1.5707963267948966, 3.141592653589793 * 1e5, 355, 103993]) {
    assert.ok(ulps(dmath.sin(x), Math.sin(x)) <= 1 && ulps(dmath.cos(x), Math.cos(x)) <= 1, `sin/cos(${x})`);
  }
});

test('dmath: scalarMath chooses the implementation and refuses unknown modes', () => {
  assert.equal(scalarMath(undefined), platformMath);
  assert.equal(scalarMath('platform'), platformMath);
  assert.equal(scalarMath('deterministic'), dmath);
  assert.throws(() => scalarMath('fast' as never), RangeError);
  assert.ok(Object.isFrozen(dmath) && Object.isFrozen(platformMath));
  for (const x of [0.3, -2, 7]) assert.equal(platformMath.sin(x), Math.sin(x));
  assert.equal(platformMath.hypot(3, 4), Math.hypot(3, 4));
});
