import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createFixed, createWideFixed, type FixedOverflow, type FixedRounding} from './fixed';
import {lcg} from './vectors';

// An independent oracle in BigInt rational arithmetic: round n/d (d > 0) per mode, then fit the word.
function oRound(n: bigint, d: bigint, mode: FixedRounding): bigint {
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const fl = n >= 0n ? n / d : -((-n + d - 1n) / d);
  const r = n - fl * d;
  if (r === 0n) return fl;
  if (mode === 'floor') return fl;
  if (mode === 'trunc') return fl < 0n ? fl + 1n : fl;
  return 2n * r >= d ? fl + 1n : fl;
}
function oFit(v: bigint, W: number, policy: FixedOverflow): bigint | 'error' {
  const min = -(1n << BigInt(W - 1)),
    max = (1n << BigInt(W - 1)) - 1n;
  if (v >= min && v <= max) return v;
  if (policy === 'throw') return 'error';
  if (policy === 'saturate') return v < min ? min : max;
  const span = 1n << BigInt(W);
  let w = (v - min) % span;
  if (w < 0n) w += span;
  return w + min;
}
function oSqrt(n: bigint, mode: FixedRounding): bigint {
  let r = 0n;
  for (let b = 1n << 128n; b > 0n; b >>= 1n) if ((r + b) * (r + b) <= n) r += b;
  return mode === 'nearest' && n - r * r > r ? r + 1n : r;
}
const attempt = (fn: () => number | bigint): bigint | 'error' => {
  try {
    return BigInt(fn());
  } catch (e) {
    assert.ok(e instanceof RangeError, String(e));
    return 'error';
  }
};

const MODES: FixedRounding[] = ['nearest', 'floor', 'trunc'];
const POLICIES: FixedOverflow[] = ['throw', 'wrap', 'saturate'];

test('fixed: an 8-bit Q4.4 word matches the rational oracle exhaustively for every rounding and overflow policy', () => {
  for (const rounding of MODES)
    for (const overflow of POLICIES) {
      const q = createFixed({wordBits: 8, fracBits: 4, rounding, overflow});
      const F = 4n,
        ONE = 16n;
      for (let a = -128; a <= 127; a++) {
        const A = BigInt(a);
        for (let b = -128; b <= 127; b++) {
          const B = BigInt(b);
          const tag = `${rounding}/${overflow} a=${a} b=${b}`;
          assert.equal(
            attempt(() => q.mul(a, b)),
            oFit(oRound(A * B, ONE, rounding), 8, overflow),
            `mul ${tag}`,
          );
          assert.equal(
            attempt(() => q.add(a, b)),
            oFit(A + B, 8, overflow),
            `add ${tag}`,
          );
          assert.equal(
            attempt(() => q.sub(a, b)),
            oFit(A - B, 8, overflow),
            `sub ${tag}`,
          );
          assert.equal(
            attempt(() => q.div(a, b)),
            b === 0 ? 'error' : oFit(oRound(A << F, B, rounding), 8, overflow),
            `div ${tag}`,
          );
        }
        assert.equal(
          attempt(() => q.sqrt(a)),
          a < 0 ? 'error' : oFit(oSqrt(A << F, rounding), 8, overflow),
          `sqrt ${a}`,
        );
      }
    }
});

test('fixed: 32-bit formats match the oracle on seeded inputs, including the BigInt path above 2^53', () => {
  const next = lcg(7);
  const raw = (W: number) => {
    const mag = next() % W;
    const v = Math.floor((next() / 4294967296) * 2 ** mag);
    return Math.min(v, 2 ** (W - 1) - 1) * (next() & 1 ? -1 : 1);
  };
  for (const fracBits of [0, 8, 16, 24, 30])
    for (const rounding of MODES)
      for (const overflow of POLICIES) {
        const q = createFixed({wordBits: 32, fracBits, rounding, overflow});
        const ONE = 1n << BigInt(fracBits);
        for (let i = 0; i < 1500; i++) {
          const a = raw(32),
            b = raw(32),
            c = raw(32);
          const A = BigInt(a),
            B = BigInt(b),
            C = BigInt(c);
          const tag = `Q${32 - fracBits}.${fracBits} ${rounding}/${overflow} a=${a} b=${b}`;
          assert.equal(
            attempt(() => q.mul(a, b)),
            oFit(oRound(A * B, ONE, rounding), 32, overflow),
            `mul ${tag}`,
          );
          assert.equal(
            attempt(() => q.mulAdd(a, b, c)),
            oFit(oRound(A * B, ONE, rounding) + C, 32, overflow),
            `mulAdd ${tag}`,
          );
          assert.equal(
            attempt(() => q.div(a, b)),
            b === 0 ? 'error' : oFit(oRound(A * ONE, B, rounding), 32, overflow),
            `div ${tag}`,
          );
          assert.equal(
            attempt(() => q.lerp(a, b, c)),
            oFit(A + oRound((B - A) * C, ONE, rounding), 32, overflow),
            `lerp ${tag}`,
          );
          const s = Math.abs(a);
          assert.equal(
            attempt(() => q.sqrt(s)),
            oFit(oSqrt(BigInt(s) * ONE, rounding), 32, overflow),
            `sqrt ${tag}`,
          );
        }
      }
});

test('fixed: conversions round once and never produce −0', () => {
  const q = createFixed({wordBits: 32, fracBits: 16});
  assert.equal(q.fromNumber(1.5), 98304);
  assert.equal(q.fromNumber(-0.5 / 65536), 0); // −½ quantum rounds half up to 0, not −0
  assert.ok(Object.is(q.fromNumber(-0), 0));
  assert.equal(q.fromNumber(0.5 / 65536), 1);
  assert.equal(q.toNumber(q.fromNumber(-3.375)), -3.375);
  assert.throws(() => q.fromNumber(NaN), RangeError);
  assert.throws(() => q.fromNumber(40000), RangeError);
  assert.equal(createFixed({wordBits: 32, fracBits: 16, overflow: 'saturate'}).fromNumber(1e300), q.max);
  assert.equal(createFixed({wordBits: 32, fracBits: 16, overflow: 'wrap'}).fromNumber(32768), -(2 ** 31));
  const floor = createFixed({wordBits: 32, fracBits: 16, rounding: 'floor'});
  const trunc = createFixed({wordBits: 32, fracBits: 16, rounding: 'trunc'});
  assert.equal(floor.fromNumber(-1e-9), -1);
  assert.equal(trunc.fromNumber(-1e-9), 0);
  // convert between formats
  const ps = createFixed({wordBits: 16, fracBits: 12, rounding: 'floor', overflow: 'wrap'});
  assert.equal(ps.convert(q.fromNumber(1.25), q), 5120);
  assert.equal(q.convert(5120, ps), q.fromNumber(1.25));
  assert.equal(ps.convert(q.fromNumber(9), q), -28672); // 9.0 wraps in a 4.12 word
  assert.equal(q.floor(q.fromNumber(-1.25)), q.fromInt(-2));
  assert.equal(q.fract(q.fromNumber(-1.25)), q.fromNumber(0.75));
  assert.equal(q.clamp(5, 0, 3), 3);
});

test('fixed: malformed formats and raw values are refused before any arithmetic', () => {
  assert.throws(() => createFixed({wordBits: 33, fracBits: 16}), RangeError);
  assert.throws(() => createFixed({wordBits: 16, fracBits: 16}), RangeError);
  assert.throws(() => createFixed({wordBits: 32, fracBits: 16, rounding: 'even' as never}), RangeError);
  assert.throws(() => createFixed({wordBits: 32, fracBits: 16, overflow: 'ignore' as never}), RangeError);
  const q = createFixed({wordBits: 16, fracBits: 8});
  assert.throws(() => q.add(1.5, 0), RangeError);
  assert.throws(() => q.add(40000, 0), RangeError);
  assert.throws(() => q.mul(Number.NaN, 1), RangeError);
  assert.throws(() => q.div(1, 0), RangeError);
  assert.throws(() => createFixed({wordBits: 16, fracBits: 8, overflow: 'wrap'}).div(1, 0), RangeError);
  assert.ok(Object.isFrozen(q) && Object.isFrozen(q.format));
});

test('fixed: wide Q32.32 and Q64.64 match the oracle and encode for JSON snapshots', () => {
  const next = lcg(11);
  const big = (W: number) => {
    let v = 0n;
    for (let i = 0; i < W; i += 32) v = (v << 32n) | BigInt(next());
    const mag = BigInt(next() % W);
    v &= (1n << mag) - 1n;
    return next() & 1 ? -v : v;
  };
  for (const [W, F] of [
    [64, 32],
    [128, 64],
    [48, 20],
  ] as const)
    for (const rounding of MODES)
      for (const overflow of POLICIES) {
        const q = createWideFixed({wordBits: W, fracBits: F, rounding, overflow});
        const ONE = 1n << BigInt(F);
        for (let i = 0; i < 400; i++) {
          const a = big(W),
            b = big(W);
          const tag = `Q${W - F}.${F} ${rounding}/${overflow}`;
          assert.equal(
            attempt(() => q.mul(a, b)),
            oFit(oRound(a * b, ONE, rounding), W, overflow),
            `mul ${tag}`,
          );
          assert.equal(
            attempt(() => q.div(a, b)),
            b === 0n ? 'error' : oFit(oRound(a * ONE, b, rounding), W, overflow),
            `div ${tag}`,
          );
          const s = a < 0n ? -a : a;
          assert.equal(
            attempt(() => q.sqrt(s)),
            oFit(oSqrt(s * ONE, rounding), W, overflow),
            `sqrt ${tag}`,
          );
          assert.equal(q.decode(q.encode(a)), a);
        }
      }
  const q = createWideFixed({wordBits: 64, fracBits: 32});
  assert.equal(q.fromNumber(0.5), 1n << 31n);
  assert.equal(q.fromNumber(-2.5), -(5n << 31n));
  assert.equal(q.fromNumber(2 ** -40), 0n); // 2^-8 of a quantum rounds to 0
  assert.equal(q.fromNumber(3 * 2 ** -33), 2n); // 1.5 quanta round half up
  assert.equal(q.toNumber(q.fromNumber(Math.PI)), Math.round(Math.PI * 2 ** 32) / 2 ** 32);
  assert.equal(JSON.parse(JSON.stringify({x: q.encode(q.one)})).x, '4294967296');
  assert.throws(() => q.decode('1e5'), RangeError);
  assert.throws(() => q.decode(String(1n << 70n)), RangeError);
  assert.throws(() => q.add(1n << 64n, 0n), RangeError);
  assert.throws(() => q.add(1 as never, 0n), RangeError);
});

test('fixed: review regressions — fracBits 0 with wrap keeps mulAdd and lerp exact near 2^53', () => {
  const q = createFixed({wordBits: 32, fracBits: 0, overflow: 'wrap'});
  const wrap = (v: bigint) => Number(BigInt.asIntN(32, v));
  assert.equal(q.mulAdd(94906265, 94906265, 2147483646), wrap(94906265n * 94906265n + 2147483646n));
  assert.equal(q.lerp(1073741825, 2147483647, 8388608), wrap(1073741825n + (2147483647n - 1073741825n) * 8388608n));
  // products just under 2^53, with every addend sign
  for (const c of [-2147483648, -1, 0, 1, 2147483647])
    for (const [a, b] of [
      [94906265, 94906265],
      [-94906265, 94906265],
      [94906267, -94906263],
    ] as const)
      assert.equal(q.mulAdd(a, b, c), wrap(BigInt(a) * BigInt(b) + BigInt(c)), `${a}·${b}+${c}`);
  assert.ok(Object.is(createFixed({wordBits: 16, fracBits: 8}).clamp(-0, -5, 5), 0));
});
