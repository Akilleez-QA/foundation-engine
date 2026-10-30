// Independent oracles: dense sampling with a separately written point-box distance and quaternion rotation, and the
// combat kit's closed-form sphere sweep. They share no code with the kernels under test.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GAP, segmentBox, segmentSegment} from './geometry';
import {defineVolumeSet, sweepVolume, type VolumeCollider, type VolumeVec3} from './index';
import {sweep as analyticSweep} from '../combat';

type V = [number, number, number];
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
const lerp = (a: V, b: V, t: number): V => add(a, scale(sub(b, a), t));
const len = (a: V) => Math.hypot(a[0], a[1], a[2]);
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** v' = v + 2w(q x v) + 2 q x (q x v), the vector form of q v q*. */
function rotate(q: readonly number[], v: V): V {
  const u: V = [q[0]!, q[1]!, q[2]!],
    w = q[3]!;
  const t = scale(cross(u, v), 2);
  return add(add(v, scale(t, w)), cross(u, t));
}
const inverse = (q: readonly number[]) => [-q[0]!, -q[1]!, -q[2]!, q[3]!];
function randomQuat(r: () => number) {
  const q = [r() - 0.5, r() - 0.5, r() - 0.5, r() - 0.5];
  const n = Math.hypot(...q);
  return q.map(v => v / n) as [number, number, number, number];
}
function pointSegment(p: V, a: V, b: V) {
  const ab = sub(b, a),
    l2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
  const t =
    l2 === 0 ? 0 : Math.max(0, Math.min(1, (sub(p, a)[0] * ab[0] + sub(p, a)[1] * ab[1] + sub(p, a)[2] * ab[2]) / l2));
  return len(sub(p, lerp(a, b, t)));
}
function pointBox(p: V, c: V, h: V, q: readonly number[]) {
  const l = rotate(inverse(q), sub(p, c));
  return Math.hypot(...l.map((x, i) => Math.max(Math.abs(x) - h[i]!, 0)));
}
const SAMPLES = 1500,
  COARSE = 400;
/** Sampled core distance from segment a-b; overestimates by at most |b - a| / (2 (SAMPLES - 1)). */
function sampled(a: V, b: V, other: (p: V) => number, n = SAMPLES) {
  let best = Infinity;
  for (let i = 0; i < n; i++) best = Math.min(best, other(lerp(a, b, i / (n - 1))));
  return best;
}
const boxData = (c: V, h: V, q: readonly number[]) =>
  Float64Array.from([...c, ...h, ...rotate(q, [1, 0, 0]), ...rotate(q, [0, 1, 0]), ...rotate(q, [0, 0, 1])]);

test('segment-segment and segment-box kernels match a sampled oracle and report a consistent gap vector', () => {
  const r = lcg(7);
  const pt = (k = 4): V => [(r() - 0.5) * k, (r() - 0.5) * k, (r() - 0.5) * k];
  for (let i = 0; i < 300; i++) {
    const a = pt(),
      b = i % 7 === 0 ? a : pt(),
      c = pt(),
      d = i % 5 === 0 ? c : pt();
    const got = segmentSegment(...a, ...b, ...c, ...d);
    assert.ok(Math.abs(Math.hypot(GAP[0]!, GAP[1]!, GAP[2]!) - got) < 1e-9);
    const want = sampled(a, b, p => pointSegment(p, c, d));
    assert.ok(got <= want + 1e-12, `segment pair ${i}: ${got} > ${want}`);
    assert.ok(want - got <= len(sub(b, a)) / (2 * (SAMPLES - 1)) + 1e-9, `segment pair ${i}: ${got} << ${want}`);
    const h: V = [0.1 + r(), 0.1 + r(), 0.1 + r()],
      q = randomQuat(r),
      centre = pt(2);
    const boxed = segmentBox(...a, ...b, boxData(centre, h, q), 0);
    // The gap ends on the box: subtracting it from some body point lands within the box (oracle distance ~0).
    assert.ok(Math.abs(Math.hypot(GAP[0]!, GAP[1]!, GAP[2]!) - boxed) < 1e-9);
    const boxWant = sampled(a, b, p => pointBox(p, centre, h, q));
    if (boxWant > 1e-3) {
      assert.ok(
        Math.abs(boxed - boxWant) <= len(sub(b, a)) / (2 * (SAMPLES - 1)) + 1e-9,
        `box ${i}: ${boxed} vs ${boxWant}`,
      );
    } else {
      assert.ok(boxed <= boxWant + 1e-9, `box ${i}: missed contact`);
    }
  }
});

test('near-parallel long segments are exact in either endpoint order, and the gap vector has the distance as length', () => {
  const r = lcg(31);
  for (let i = 0; i < 200; i++) {
    const length = 1 + r() * 200,
      tilt = (r() - 0.5) * 2e-6,
      lift = 1e-4 + r() * 1e-2;
    const p0: V = [r() * 5, lift, 0],
      p1: V = [p0[0] + length, lift + tilt * length, 0],
      q0: V = [-10, 0, 0],
      q1: V = [length + 20, 0, 0];
    const want = Math.min(lift, lift + tilt * length);
    for (const [a, b] of [
      [p0, p1],
      [p1, p0],
    ] as const) {
      const got = segmentSegment(...a, ...b, ...q0, ...q1);
      assert.ok(Math.abs(got - Math.max(0, want)) < 1e-12, `case ${i}: ${got} vs ${want}`);
      assert.ok(Math.abs(Math.hypot(GAP[0]!, GAP[1]!, GAP[2]!) - got) < 1e-12);
    }
  }
});

test('sphere sweeps agree with the closed-form relative sphere sweep, including id ties', () => {
  const r = lcg(11);
  let hits = 0;
  for (let i = 0; i < 400; i++) {
    const from: V = [(r() - 0.5) * 10, (r() - 0.5) * 10, (r() - 0.5) * 10],
      to: V = [(r() - 0.5) * 10, (r() - 0.5) * 10, (r() - 0.5) * 10],
      radius = 0.1 + r();
    const targets = Array.from({length: 6}, (_, k) => {
      const centre: V = [(r() - 0.5) * 10, (r() - 0.5) * 10, (r() - 0.5) * 10];
      return {id: `s${k}`, from: centre, to: centre, radius: 0.1 + r() * 2};
    });
    if (i % 9 === 0) targets.push({...targets[0]!, id: 'a-twin'});
    const set = defineVolumeSet({
      revision: i,
      maxColliders: 8,
      colliders: targets.map(t => ({id: t.id, kind: 'sphere', center: t.from as VolumeVec3, radius: t.radius})),
    });
    const want = analyticSweep(from, to, radius, targets);
    const got = sweepVolume(set, {kind: 'sphere', center: from, radius}, sub(to, from), {tolerance: 1e-7});
    assert.equal(got.revision, i);
    if (!want) {
      assert.equal(got.status, 'clear', `case ${i}`);
      continue;
    }
    if (want.time === 0) {
      // Starting inside (or touching) a target. Touching exactly is measure zero for random data.
      assert.equal(got.status, 'start-overlap', `case ${i}`);
      continue;
    }
    hits++;
    assert.equal(got.status, 'hit', `case ${i}`);
    if (got.status !== 'hit') continue;
    assert.equal(got.id, want.id, `case ${i}`);
    // The contract bounds separation at the reported fraction, not travel: at grazing incidence they differ.
    assert.ok(got.fraction <= want.time + 1e-12, `case ${i}: passed the contact`);
    const target = targets.find(t => t.id === got.id)!;
    const at = lerp(from, to, got.fraction);
    const gap = len(sub(at, target.from as V)) - radius - target.radius;
    assert.ok(gap >= -1e-12 && gap <= 1e-7 + 1e-12, `case ${i}: separation ${gap} at the contact`);
    assert.ok(Math.abs(len(got.normal as V) - 1) < 1e-9);
  }
  assert.ok(hits > 40, `only ${hits} hit cases exercised`);
});

test('capsule sweeps against rotated boxes, capsules and spheres agree with a sampled separation oracle', () => {
  const r = lcg(23);
  let hits = 0,
    clears = 0;
  for (let i = 0; i < 60; i++) {
    const colliders: VolumeCollider[] = [];
    const oracles: ((p0: V, p1: V) => number)[] = [];
    for (let k = 0; k < 3; k++) {
      const centre: V = [(r() - 0.5) * 6, (r() - 0.5) * 6, (r() - 0.5) * 6];
      if (k === 0) {
        const h: V = [0.05 + r(), 0.05 + r(), 0.05 + r()],
          q = randomQuat(r);
        colliders.push({id: `box${k}`, kind: 'box', center: centre, halfExtents: h, rotation: q});
        oracles.push((p0, p1) => sampled(p0, p1, p => pointBox(p, centre, h, q), COARSE));
      } else {
        const other = add(centre, [r() - 0.5, r() - 0.5, r() - 0.5]),
          rad = 0.1 + r() * 0.5;
        colliders.push({id: `cap${k}`, kind: 'capsule', a: centre, b: other, radius: rad});
        oracles.push((p0, p1) => sampled(p0, p1, p => pointSegment(p, centre, other), COARSE) - rad);
      }
    }
    const set = defineVolumeSet({revision: 0, maxColliders: 3, colliders});
    const a: V = [-6, (r() - 0.5) * 4, (r() - 0.5) * 4],
      b = add(a, [r() - 0.5, 1 + r(), r() - 0.5]),
      radius = 0.2 + r() * 0.3,
      move: V = [12, (r() - 0.5) * 2, (r() - 0.5) * 2],
      margin = i % 2 ? 0.05 : 0;
    const got = sweepVolume(set, {kind: 'capsule', a, b, radius}, move, {margin, maxIterations: 64});
    const separation = (t: number) => {
      const off = scale(move, t);
      return Math.min(...oracles.map(o => o(add(a, off), add(b, off)))) - radius;
    };
    // Sampling error: along the body segment, plus the travel between time samples.
    const steps = 160,
      err = len(sub(b, a)) / (2 * (COARSE - 1)) + len(move) / steps + 1e-9;
    if (separation(0) < 0) {
      assert.equal(got.status, 'start-overlap');
      continue;
    }
    assert.ok(got.status === 'hit' || got.status === 'clear', `case ${i}: ${got.status}`);
    const end = got.fraction;
    for (let s = 0; s <= steps; s++) {
      const t = (s / steps) * end;
      assert.ok(separation(t) >= Math.min(margin, separation(0)) - 1e-6 - err, `case ${i}: dipped at ${t}`);
    }
    if (got.status === 'hit') {
      hits++;
      assert.ok(separation(end) <= margin + 1e-6 + err, `case ${i}: hit with room left`);
    } else clears++;
  }
  assert.ok(hits > 10 && clears > 5, `coverage hits=${hits} clears=${clears}`);
});
