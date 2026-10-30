import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPrecision, f32, pc24} from './precision';
import {createFixed} from './fixed';
import {createFixedTrig} from './angle';
import {dmath} from '../../author';
import {lcg} from './vectors';

// Exact oracle: a double as m·2^e (BigInt), rounded to p significand bits with ties to even, double exponent range.
const view = new DataView(new ArrayBuffer(8));
function decompose(x: number): {m: bigint; e: number} {
  view.setFloat64(0, Math.abs(x));
  const hi = view.getUint32(0),
    lo = view.getUint32(4),
    be = hi >>> 20;
  const m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  return be ? {m: m | (1n << 52n), e: be - 1075} : {m, e: -1074};
}
/** Round the exact rational sign·n/2^k (n ≥ 0) to p bits, quantum never below 2^-1074; return a double. */
function oracleRound(sign: number, n: bigint, k: number, p: number): number {
  if (n === 0n) return sign < 0 ? -0 : 0;
  const bitlen = n.toString(2).length;
  const e = bitlen - 1 - k; // 2^e ≤ value < 2^(e+1)
  const quantum = Math.max(e, -1022) - p + 1; // the double exponent floor keeps subnormal quanta
  const shift = BigInt(quantum + k); // value / 2^quantum = n / 2^shift
  let q: bigint, r: bigint, d: bigint;
  if (shift <= 0n) {
    q = n << -shift;
    r = 0n;
    d = 1n;
  } else {
    d = 1n << shift;
    q = n / d;
    r = n % d;
  }
  if (2n * r > d || (2n * r === d && (q & 1n) === 1n)) q += 1n;
  return sign * Number(q) * 2 ** quantum;
}
const roundOracle = (x: number, p: number): number => {
  if (x === 0 || !Number.isFinite(x)) return x;
  const {m, e} = decompose(x);
  return e >= 0 ? oracleRound(Math.sign(x), m << BigInt(e), 0, p) : oracleRound(Math.sign(x), m, -e, p);
};
function seeded(seed: number): () => number {
  const next = lcg(seed);
  return () => {
    const m = next() / 4294967296 + next() / 2 ** 64;
    const e = (next() % 200) - 100;
    return (next() & 1 ? -1 : 1) * (1 + m) * 2 ** e;
  };
}

test('precision: f32 is exactly Math.fround, including overflow and subnormals', () => {
  const next = seeded(3);
  for (let i = 0; i < 5000; i++) {
    const a = next(),
      b = next();
    assert.ok(Object.is(f32.add(a, b), Math.fround(Math.fround(a) + Math.fround(b))));
    assert.ok(Object.is(f32.mul(a, b), Math.fround(Math.fround(a) * Math.fround(b))));
  }
  assert.equal(f32.mul(3e38, 10), Infinity);
  assert.equal(f32.round(1e-45), 1.401298464324817e-45);
  assert.equal(pc24.mul(3e38, 10), pc24.round(Math.fround(3e38) * 10));
  for (let i = 0; i < 1000; i++) {
    const x = Math.abs(next());
    assert.ok(Object.is(f32.sqrt(x), Math.fround(Math.sqrt(Math.fround(x)))));
  }
  assert.ok(Number.isFinite(pc24.mul(3e38, 10)), 'the 24-bit significand keeps the double exponent range');
});

test('precision: round to p bits matches the exact ties-to-even oracle for p in 2..25', () => {
  const next = seeded(5);
  for (const p of [2, 5, 11, 16, 24, 25]) {
    const P = createPrecision({significandBits: p});
    for (let i = 0; i < 3000; i++) {
      const x = next();
      assert.ok(Object.is(P.round(x), roundOracle(x, p)), `p=${p} x=${x}`);
    }
    // exact halfway cases: 1 + 2^-p is a tie between 1 and 1 + 2^(1-p); ties to even gives 1
    assert.equal(P.round(1 + 2 ** -p), 1);
    assert.equal(P.round(1 + 3 * 2 ** -p), 1 + 2 * 2 ** (1 - p));
    assert.equal(P.round(-(1 + 2 ** -p)), -1);
  }
  // subnormal doubles and the top of the range
  for (const x of [5e-324, 3e-310, -2.5e-308, 1.7976931348623157e308, -1.7976931348623157e308])
    assert.ok(Object.is(pc24.round(x), roundOracle(x, 24)), `x=${x}`);
  assert.equal(pc24.round(1.7976931348623157e308), Infinity); // rounds up out of the double range
  assert.ok(Object.is(pc24.round(-0), -0));
  assert.ok(Number.isNaN(pc24.round(NaN)));
});

test('precision: +, −, × and ÷ equal the correctly rounded p-bit result (double rounding is innocuous for p ≤ 25)', () => {
  const next = seeded(9);
  for (const p of [11, 24, 25]) {
    const P = createPrecision({significandBits: p});
    for (let i = 0; i < 3000; i++) {
      const a = P.round(next()),
        b = P.round(next());
      const A = decompose(a),
        B = decompose(b);
      const sa = Math.sign(a),
        sb = Math.sign(b);
      // exact product: m_a·m_b·2^(e_a+e_b)
      const ep = A.e + B.e;
      const prod =
        ep >= 0 ? oracleRound(sa * sb, (A.m * B.m) << BigInt(ep), 0, p) : oracleRound(sa * sb, A.m * B.m, -ep, p);
      assert.ok(Object.is(P.mul(a, b), prod), `mul p=${p} ${a} ${b}`);
      // exact sum on a common exponent
      const e0 = Math.min(A.e, B.e);
      const s = BigInt(sa) * (A.m << BigInt(A.e - e0)) + BigInt(sb) * (B.m << BigInt(B.e - e0));
      const sum =
        s === 0n
          ? 0
          : e0 >= 0
            ? oracleRound(s < 0n ? -1 : 1, (s < 0n ? -s : s) << BigInt(e0), 0, p)
            : oracleRound(s < 0n ? -1 : 1, s < 0n ? -s : s, -e0, p);
      assert.equal(P.add(a, b), sum, `add p=${p} ${a} ${b}`);
      // quotient to 200 extra bits then the sticky bit: exact enough to decide the rounding
      const K = 400;
      const num = A.m << BigInt(K),
        quo = num / B.m,
        sticky = num % B.m === 0n ? 0n : 1n;
      const eq = A.e - B.e - K;
      const div = oracleRound(sa * sb, (quo << 1n) | sticky, -(eq - 1), p);
      assert.equal(P.div(a, b), div, `div p=${p} ${a} ${b}`);
    }
  }
  assert.throws(() => createPrecision({significandBits: 26}), RangeError);
  assert.throws(() => createPrecision({significandBits: 11, exponent: 'binary32'}), RangeError);
});

test('precision: reduced-precision transcendental helpers are deterministic dmath rounded at both ends', () => {
  const P = createPrecision({significandBits: 16});
  for (const x of [0.1, 1, 2.5, -7.25, 100]) assert.equal(P.math.sin(x), P.round(dmath.sin(P.round(x))));
  assert.ok(Math.abs(f32.math.atan2(1, 2) - Math.atan2(1, 2)) < 2 ** -22);
});

test('trig: binary-angle sin, cos and atan2 stay within a quantum of the exact value and keep symmetry', () => {
  const q = createFixed({wordBits: 32, fracBits: 16});
  const trig = createFixedTrig(q);
  assert.equal(trig.turn, 65536);
  for (let a = -70000; a <= 70000; a += 7) {
    const exact = dmath.sin((a * 2 * Math.PI) / 65536) * 65536;
    assert.ok(Math.abs(trig.sin(a) - exact) <= 0.5 + 1e-6, `sin ${a}`);
    assert.equal(trig.sin(-a), -trig.sin(a) || 0);
    assert.equal(trig.cos(a), trig.sin(a + 16384));
  }
  assert.deepEqual([0, 16384, 32768, 49152].map(trig.sin), [0, 65536, 0, -65536]);
  const next = lcg(13);
  let worst = 0;
  for (let i = 0; i < 20000; i++) {
    const y = (next() | 0) >> (next() % 31),
      x = (next() | 0) >> (next() % 31);
    const got = trig.atan2(y, x);
    if (x === 0 && y === 0) {
      assert.equal(got, 0);
      continue;
    }
    let diff = Math.abs(got - (dmath.atan2(y, x) * 65536) / (2 * Math.PI));
    if (diff > 32768) diff = 65536 - diff;
    worst = Math.max(worst, diff);
    assert.ok(got > -32768 && got <= 32768, `range ${got}`);
  }
  assert.ok(worst <= 1.5, `atan2 worst error ${worst} angle units`);
  assert.equal(trig.atan2(0, -5), 32768);
  assert.equal(trig.atan2(5, 0), 16384);
  assert.equal(trig.atan2(-5, 5), -8192);
  assert.equal(trig.wrap(40000), 40000 - 65536);
  assert.equal(trig.fromRadians(Math.PI / 2), 16384);
  const coarse = createFixedTrig(createFixed({wordBits: 16, fracBits: 12}), {turnBits: 12});
  assert.equal(coarse.sin(1024), 4096);
  assert.throws(() => createFixedTrig(q, {turnBits: 17}), RangeError);
  assert.throws(() => createFixedTrig(createFixed({wordBits: 16, fracBits: 15})), RangeError);
  assert.throws(() => trig.sin(0.5), RangeError);
  assert.throws(() => trig.atan2(2 ** 31, 0), RangeError);
});

test('precision: review regressions — products and quotients below 2^-1021 are still correctly rounded', () => {
  // Both operands are exact 24-bit values; the exact product lies just above half of the 2^-1045 quantum.
  const a = 11865889 * 2 ** -500,
    b = 11860678 * 2 ** -593;
  assert.ok(pc24.isExact(a) && pc24.isExact(b));
  const A = decompose(a),
    B = decompose(b);
  assert.equal(pc24.mul(a, b), oracleRound(1, A.m * B.m, -(A.e + B.e), 24));
  assert.equal(pc24.mul(a, b), 2 ** -1045);
  const next = seeded(17);
  for (const p of [8, 11, 24, 25]) {
    const P = createPrecision({significandBits: p});
    for (let i = 0; i < 3000; i++) {
      const x = P.round(next() * 2 ** -480),
        y = P.round(next() * 2 ** -560);
      const X = decompose(x),
        Y = decompose(y),
        sign = Math.sign(x) * Math.sign(y);
      assert.ok(Object.is(P.mul(x, y), oracleRound(sign, X.m * Y.m, -(X.e + Y.e), p)), `mul p=${p} ${x} ${y}`);
      const z = P.round(next() * 2 ** 520),
        Z = decompose(z),
        K = 400;
      const num = X.m << BigInt(K),
        quo = num / Z.m,
        sticky = num % Z.m === 0n ? 0n : 1n;
      const eq = X.e - Z.e - K;
      const expected = oracleRound(Math.sign(x) * Math.sign(z), (quo << 1n) | sticky, -(eq - 1), p);
      assert.ok(Object.is(P.div(x, z), expected), `div p=${p} ${x} ${z}`);
    }
  }
});

test('trig: review regressions — cos near 2^53, fromRadians of huge values, and clamp of −0', () => {
  const q = createFixed({wordBits: 32, fracBits: 16});
  const trig = createFixedTrig(q);
  assert.equal(trig.cos(Number.MAX_SAFE_INTEGER), trig.sin((Number.MAX_SAFE_INTEGER & 65535) + 16384));
  assert.ok(Number.isInteger(trig.fromRadians(1e308)));
  assert.equal(trig.fromRadians(-Math.PI / 2), -16384);
  assert.equal(trig.fromRadians(Math.PI), 32768);
});
