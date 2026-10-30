/**
 * kits/numeric/vectors.ts: the fixed inputs behind numeric.golden.json and a seeded lockstep workload, so any
 * JavaScript engine (Node, a browser, another runtime) can recompute them and compare. Inputs come from a 32-bit LCG
 * (Math.imul only), so they are identical everywhere.
 */
import {createFixed, createWideFixed, type Fixed, type WideFixed} from './fixed';
import {createFixedTrig} from './angle';
import {f32, pc24, createPrecision, type Precision} from './precision';

export interface NumericGolden {
  format: 'foundation.numeric-golden';
  version: 1;
  /** Each row is [inputs…, result] as decimal integers (fixed) or 16-digit double hex (precision). */
  cases: Record<string, string[][]>;
  /** FNV-1a digests of the lockstep workload for each arithmetic. */
  workload: Record<string, string>;
}

/** A 32-bit LCG returning uint32. */
export function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0);
}

const view = new DataView(new ArrayBuffer(8));
/** The 16-digit big-endian hex of a double's bits (NaN canonicalised). */
export function hex(x: number): string {
  if (x !== x) return '7ff8000000000000';
  view.setFloat64(0, x);
  return view.getUint32(0).toString(16).padStart(8, '0') + view.getUint32(4).toString(16).padStart(8, '0');
}
/** FNV-1a (32-bit) over a string, as 8 hex digits. */
export function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
}

const COUNT = 64;
/** A signed raw value spread over magnitudes, within a word of `bits`. */
function spread(next: () => number, bits: number): number {
  const mag = next() % (bits - 1);
  const v = next() % 2 ** mag;
  return next() & 1 ? -v : v;
}
/** A double spread over many binades, from integer parts only. */
function double(next: () => number): number {
  const m = next() / 4294967296 + next() / 2 ** 64;
  const e = (next() % 80) - 40;
  return (next() & 1 ? -1 : 1) * (1 + m) * 2 ** e;
}

/** Recompute every golden row. */
export function computeNumericGolden(): NumericGolden['cases'] {
  const cases: NumericGolden['cases'] = {};
  const reference = createFixed({wordBits: 32, fracBits: 16, overflow: 'wrap'});
  const fixedRows = (name: string, q: Fixed) => {
    const next = lcg(name.length * 7919 + q.format.fracBits);
    const W = q.format.wordBits;
    const rows: string[][] = [];
    const safe = (fn: () => number): string => {
      try {
        return String(fn());
      } catch {
        return 'error';
      }
    };
    for (let i = 0; i < COUNT; i++) {
      const a = spread(next, W),
        b = spread(next, W);
      rows.push([
        String(a),
        String(b),
        safe(() => q.mul(a, b)),
        safe(() => q.div(a, b)),
        safe(() => q.sqrt(Math.abs(a))),
      ]);
    }
    cases[name] = rows;
  };
  fixedRows('q16.16-nearest-wrap', createFixed({wordBits: 32, fracBits: 16, overflow: 'wrap'}));
  fixedRows(
    'q16.16-floor-saturate',
    createFixed({wordBits: 32, fracBits: 16, rounding: 'floor', overflow: 'saturate'}),
  );
  fixedRows('q2.30-trunc-wrap', createFixed({wordBits: 32, fracBits: 30, rounding: 'trunc', overflow: 'wrap'}));
  fixedRows('q4.12-floor-wrap', createFixed({wordBits: 16, fracBits: 12, rounding: 'floor', overflow: 'wrap'}));
  fixedRows('q32.0-nearest-wrap', createFixed({wordBits: 32, fracBits: 0, overflow: 'wrap'}));
  fixedRows('q8.8-trunc-throw', createFixed({wordBits: 16, fracBits: 8, rounding: 'trunc'}));

  const wideRows = (name: string, wide: WideFixed, seed: number) => {
    const next = lcg(seed);
    const rows: string[][] = [];
    for (let i = 0; i < COUNT; i++) {
      const a = (BigInt(spread(next, 32)) << 31n) + BigInt(next()),
        b = (BigInt(spread(next, 32)) << 17n) + BigInt(next() | 1);
      rows.push([
        String(a),
        String(b),
        String(wide.mul(a, b)),
        String(wide.div(a, b)),
        String(wide.sqrt(a < 0n ? -a : a)),
      ]);
    }
    cases['q32.32-nearest-wrap'] = rows;
  };

  const q = createFixed({wordBits: 32, fracBits: 16}),
    trig = createFixedTrig(q);
  {
    const next = lcg(360);
    const rows: string[][] = [];
    for (let i = 0; i < COUNT; i++) {
      const angle = next() & 0x1ffff,
        y = spread(next, 32),
        x = spread(next, 32);
      rows.push([
        String(angle),
        String(trig.sin(angle)),
        String(trig.cos(angle)),
        String(y),
        String(x),
        String(trig.atan2(y, x)),
      ]);
    }
    cases['trig-q16.16-turn16'] = rows;
  }
  {
    const coarse = createFixedTrig(createFixed({wordBits: 16, fracBits: 12}), {turnBits: 12});
    const next = lcg(4096);
    const rows: string[][] = [];
    for (let i = 0; i < COUNT; i++) {
      const angle = (next() & 0x3fff) - 0x2000,
        y = spread(next, 16),
        x = spread(next, 16);
      rows.push([
        String(angle),
        String(coarse.sin(angle)),
        String(coarse.cos(angle)),
        String(y),
        String(x),
        String(coarse.atan2(y, x)),
        String(coarse.fromRadians(x / 997)),
      ]);
    }
    cases['trig-q4.12-turn12'] = rows;
  }

  const floatRows = (name: string, p: Precision) => {
    const next = lcg(name.length * 104729);
    const rows: string[][] = [];
    for (let i = 0; i < COUNT; i++) {
      const a = double(next),
        b = double(next);
      rows.push([
        hex(a),
        hex(b),
        hex(p.add(a, b)),
        hex(p.mul(a, b)),
        hex(p.div(a, b)),
        hex(p.sqrt(Math.abs(a))),
        hex(p.math.sin(a)),
        hex(p.math.atan2(a, b)),
        hex(p.math.exp(Math.min(a, 80))),
        hex(p.sub(a, b)),
        hex(p.mulAdd(a, b, a)),
        hex(p.mul(a * 2 ** -520, b * 2 ** -530)),
        hex(p.div(a * 2 ** -1000, b * 2 ** 40)),
      ]);
    }
    cases[name] = rows;
  };
  floatRows('f32', f32);
  floatRows('pc24', pc24);
  floatRows('p11', createPrecision({significandBits: 11}));
  return cases;
}

/**
 * A seeded lockstep workload: bodies steer toward moving targets, with distance (sqrt), heading (atan2), velocity
 * (sin/cos), drag (mul) and a normalised separation (div), for `ticks` fixed steps. Returns the per-step digest chain.
 */
export function fixedWorkload(ticks = 600, bodies = 16): {digest: string; state: number[]} {
  const q = createFixed({wordBits: 32, fracBits: 16, overflow: 'saturate'}),
    trig = createFixedTrig(q);
  const next = lcg(20261009);
  const s: number[] = [];
  for (let i = 0; i < bodies; i++)
    s.push((next() % (200 << 16)) - (100 << 16), (next() % (200 << 16)) - (100 << 16), 0, 0);
  let digest = '';
  const drag = q.fromNumber(0.96),
    speed = q.fromNumber(0.75);
  for (let t = 0; t < ticks; t++) {
    const tx = q.mul(trig.cos(t * 97), q.fromInt(60)),
      ty = q.mul(trig.sin(t * 131), q.fromInt(40));
    for (let i = 0; i < bodies; i++) {
      const k = i * 4;
      const dx = q.sub(tx, s[k]!),
        dy = q.sub(ty, s[k + 1]!);
      const dist = q.sqrt(q.add(q.mul(dx, dx), q.mul(dy, dy)));
      const heading = trig.atan2(dy, dx);
      const push = dist > q.one ? q.div(speed, q.add(q.one, q.div(dist, q.fromInt(32)))) : 0;
      s[k + 2] = q.mulAdd(s[k + 2]!, drag, q.mul(trig.cos(heading), push));
      s[k + 3] = q.mulAdd(s[k + 3]!, drag, q.mul(trig.sin(heading), push));
      s[k] = q.add(s[k]!, s[k + 2]!);
      s[k + 1] = q.add(s[k + 1]!, s[k + 3]!);
    }
    digest = fnv(digest + s.join(','));
  }
  return {digest, state: s};
}

/** The same workload in a reduced-precision float arithmetic. */
export function floatWorkload(p: Precision, ticks = 600, bodies = 16): {digest: string; state: number[]} {
  const next = lcg(20261009);
  const s: number[] = [];
  for (let i = 0; i < bodies; i++)
    s.push(p.round((next() % 20000) / 100 - 100), p.round((next() % 20000) / 100 - 100), 0, 0);
  const m = p.math;
  let digest = '';
  for (let t = 0; t < ticks; t++) {
    const tx = p.mul(m.cos(p.mul(t, 0.0093)), 60),
      ty = p.mul(m.sin(p.mul(t, 0.0125)), 40);
    for (let i = 0; i < bodies; i++) {
      const k = i * 4;
      const dx = p.sub(tx, s[k]!),
        dy = p.sub(ty, s[k + 1]!);
      const dist = p.sqrt(p.add(p.mul(dx, dx), p.mul(dy, dy)));
      const heading = m.atan2(dy, dx);
      const push = dist > 1 ? p.div(0.75, p.add(1, p.div(dist, 32))) : 0;
      s[k + 2] = p.mulAdd(s[k + 2]!, 0.96, p.mul(m.cos(heading), push));
      s[k + 3] = p.mulAdd(s[k + 3]!, 0.96, p.mul(m.sin(heading), push));
      s[k] = p.add(s[k]!, s[k + 2]!);
      s[k + 1] = p.add(s[k + 1]!, s[k + 3]!);
    }
    digest = fnv(digest + s.map(hex).join(','));
  }
  return {digest, state: s};
}

export function computeWorkloadDigests(): NumericGolden['workload'] {
  return {
    'fixed-q16.16': fixedWorkload().digest,
    f32: floatWorkload(f32).digest,
    pc24: floatWorkload(pc24).digest,
  };
}

/** The committed file's exact text: one row per line, so a diff shows which vectors changed. */
export function numericGoldenText(cases: NumericGolden['cases'], workload: NumericGolden['workload']): string {
  return (
    '{"format":"foundation.numeric-golden","version":1,"cases":{\n' +
    Object.entries(cases)
      .map(([name, rows]) => `${JSON.stringify(name)}:[\n${rows.map(r => JSON.stringify(r)).join(',\n')}\n]`)
      .join(',\n') +
    `\n},"workload":${JSON.stringify(workload)}}\n`
  );
}
