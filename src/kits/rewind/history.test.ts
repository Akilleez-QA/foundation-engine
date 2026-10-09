import assert from 'node:assert/strict';
import {test} from 'node:test';
import {sweep} from '../combat';
import {chooseRewindTime, createRewindHistory, type RewindHistory} from './index';

const make = (over: Partial<{width: number; maxSubjects: number; maxSamples: number; maxRewind: number}> = {}) =>
  createRewindHistory({limits: {width: 2, maxSubjects: 4, maxSamples: 8, maxRewind: 1, ...over}});

function at(h: RewindHistory, subject: string | number, time: number) {
  const out = new Float64Array(h.limits.width);
  const result = h.sample(subject, time, out);
  return {...result, values: Array.from(out)};
}

test('queries are exact, interpolated or current and never extrapolate', () => {
  const h = make();
  assert.equal(h.record('a', 0, [0, 10]), 'recorded');
  assert.equal(h.record('a', 0.5, [5, 10]), 'recorded');
  assert.equal(h.record('a', 1, [10, 20]), 'recorded');
  assert.deepEqual(at(h, 'a', 0.5), {status: 'exact', time: 0.5, values: [5, 10]});
  assert.deepEqual(at(h, 'a', 0.75), {status: 'interpolated', time: 0.75, from: 0.5, to: 1, values: [7.5, 15]});
  assert.deepEqual(at(h, 'a', 1), {status: 'exact', time: 1, values: [10, 20]});
  assert.deepEqual(at(h, 'a', 9), {status: 'current', time: 1, values: [10, 20]});
  assert.deepEqual(at(h, 'a', -1), {status: 'before-history', values: [0, 0]});
  assert.deepEqual(at(h, 'b', 0.5), {status: 'absent', values: [0, 0]});
});

test('equal and older times store nothing; invalid input changes nothing', () => {
  const h = make();
  h.record(1, 1, [1, 1]);
  assert.equal(h.record(1, 1, [9, 9]), 'unchanged');
  assert.equal(h.record(1, 0.5, [9, 9]), 'out-of-order');
  assert.deepEqual(at(h, 1, 1).values, [1, 1]);
  const before = h.stats();
  assert.throws(() => h.record(1, 2, [1]), TypeError);
  assert.throws(() => h.record(1, 2, [1, Number.NaN]), TypeError);
  assert.throws(() => h.record(1, Number.POSITIVE_INFINITY, [1, 1]), TypeError);
  assert.throws(() => h.record(-1, 2, [1, 1]), TypeError);
  assert.throws(() => h.record('', 2, [1, 1]), TypeError);
  assert.throws(() => h.record('x'.repeat(257), 2, [1, 1]), TypeError);
  assert.throws(() => h.sample(1, Number.NaN, new Float64Array(2)), TypeError);
  assert.throws(() => h.sample(1, 1, new Float64Array(1)), TypeError);
  assert.deepEqual(h.stats(), before);
});

test('a discontinuity is never blended across nor looked past', () => {
  const h = make();
  h.record('a', 0, [0, 0]);
  h.record('a', 1, [1, 0]);
  h.record('a', 2, [100, 0], {discontinuity: true});
  h.record('a', 3, [101, 0]);
  assert.equal(at(h, 'a', 2.5).status, 'interpolated');
  assert.deepEqual(at(h, 'a', 2.5).values, [100.5, 0]);
  assert.equal(at(h, 'a', 2).status, 'exact');
  assert.deepEqual(at(h, 'a', 1.5), {status: 'discontinuous', values: [0, 0]});
  assert.deepEqual(at(h, 'a', 0.5), {status: 'discontinuous', values: [0, 0]});
});

test('a full ring overwrites the oldest sample and reports it', () => {
  const h = make({maxSamples: 3});
  for (let t = 0; t < 5; t++) h.record('a', t, [t, 0]);
  assert.deepEqual(h.stats(), {subjects: 1, samples: 3, evicted: 2, trimmed: 0, refused: 0});
  assert.equal(at(h, 'a', 1.5).status, 'before-history');
  assert.deepEqual(at(h, 'a', 2.5).values, [2.5, 0]);
});

test('trim retains the bracket below the cutoff', () => {
  const h = make({maxRewind: 1});
  for (const t of [0, 0.4, 0.8, 1.2]) h.record('a', t, [t * 10, 0]);
  assert.equal(h.trim(1.5), 1); // cutoff 0.5: 0 goes, 0.4 brackets the edge
  const edge = at(h, 'a', 0.5);
  assert.equal(edge.status, 'interpolated');
  assert.ok(Math.abs(edge.values[0]! - 5) < 1e-9);
  assert.equal(at(h, 'a', 0.3).status, 'before-history');
  assert.equal(h.stats().trimmed, 1);
});

test('trim drops a bracket that a discontinuity separates from the window', () => {
  const h = make({maxRewind: 1});
  h.record('a', 0, [0, 0]);
  h.record('a', 0.4, [4, 0]);
  h.record('a', 0.8, [80, 0], {discontinuity: true});
  assert.equal(h.trim(1.5), 2);
  assert.equal(at(h, 'a', 0.6).status, 'before-history');
  assert.equal(at(h, 'a', 0.8).status, 'exact');
});

test('subject capacity refuses new subjects without disturbing existing ones; remove frees a slot', () => {
  const h = make({maxSubjects: 2});
  h.record('a', 0, [0, 0]);
  h.record('b', 0, [0, 0]);
  assert.equal(h.record('c', 0, [0, 0]), 'saturated');
  assert.equal(h.stats().refused, 1);
  assert.equal(h.remove('a'), true);
  assert.equal(h.remove('a'), false);
  assert.equal(h.record('c', 0, [0, 0]), 'recorded');
  assert.equal(at(h, 'a', 0).status, 'absent');
  h.clear();
  assert.equal(h.stats().subjects, 0);
  assert.equal(h.stats().samples, 0);
});

test('a re-added subject starts a new history with no bridge to its old one', () => {
  const h = make();
  h.record('a', 0, [0, 0]);
  h.record('a', 1, [1, 0]);
  h.remove('a');
  h.record('a', 2, [50, 0]);
  assert.equal(at(h, 'a', 1.5).status, 'before-history');
});

test('creator blend is used, may not reenter, and must be finite', () => {
  let calls = 0;
  const h = createRewindHistory({
    limits: {width: 1, maxSubjects: 1, maxSamples: 4, maxRewind: 1},
    blend: (from, to, t, out) => {
      calls++;
      // Shortest arc on a 0..360 circle.
      let d = to[0]! - from[0]!;
      if (d > 180) d -= 360;
      if (d < -180) d += 360;
      out[0] = (from[0]! + d * t + 360) % 360;
    },
  });
  h.record('a', 0, [350]);
  h.record('a', 1, [10]);
  assert.ok(Math.abs(at(h, 'a', 0.5).values[0]! - 0) < 1e-9);
  assert.equal(calls, 1);

  const reentrant = createRewindHistory({
    limits: {width: 1, maxSubjects: 1, maxSamples: 4, maxRewind: 1},
    blend: (_f, _t, _x, out) => {
      out[0] = 0;
      reentrant.record('a', 5, [0]);
    },
  });
  reentrant.record('a', 0, [0]);
  reentrant.record('a', 1, [1]);
  const out = new Float64Array([7]);
  assert.throws(() => reentrant.sample('a', 0.5, out), /inside blend/);
  assert.equal(out[0], 7);
  assert.equal(reentrant.stats().samples, 2);

  const bad = createRewindHistory({
    limits: {width: 1, maxSubjects: 1, maxSamples: 4, maxRewind: 1},
    blend: (_f, _t, _x, out) => {
      out[0] = Number.NaN;
    },
  });
  bad.record('a', 0, [0]);
  bad.record('a', 1, [1]);
  assert.throws(() => bad.sample('a', 0.5, out), /non-finite/);
  assert.equal(out[0], 7);
});

test('limits are validated and bounded', () => {
  const base = {width: 2, maxSubjects: 4, maxSamples: 8, maxRewind: 1};
  for (const bad of [
    {width: 0},
    {width: 65},
    {maxSubjects: 0},
    {maxSamples: 1},
    {maxSamples: 2.5},
    {maxRewind: 0},
    {maxRewind: Number.POSITIVE_INFINITY},
    {maxSubjects: 1 << 20, maxSamples: 1 << 10},
  ])
    assert.throws(() => createRewindHistory({limits: {...base, ...bad}}), RangeError, JSON.stringify(bad));
  const h = createRewindHistory({limits: base});
  assert.ok(Object.isFrozen(h.limits));
});

test('dispose is terminal', () => {
  const h = make();
  h.record('a', 0, [0, 0]);
  h.dispose();
  assert.equal(h.record('a', 1, [1, 1]), 'retired');
  assert.equal(at(h, 'a', 0).status, 'retired');
  assert.equal(h.trim(10), 0);
  assert.equal(h.stats().samples, 0);
});

test('chooseRewindTime trusts a plausible claim, replaces an implausible one and clamps to the window', () => {
  assert.deepEqual(chooseRewindTime({now: 10, claimed: 9.8, maxRewind: 1}), {
    time: 9.8,
    basis: 'claim',
    clamped: false,
  });
  assert.deepEqual(chooseRewindTime({now: 10, claimed: 2, maxRewind: 1}), {time: 9, basis: 'claim', clamped: true});
  assert.deepEqual(chooseRewindTime({now: 10, claimed: 12, maxRewind: 1}), {time: 10, basis: 'claim', clamped: true});
  assert.deepEqual(chooseRewindTime({now: 10, claimed: 9.1, maxRewind: 1, behind: 0.2, maxSkew: 0.2}), {
    time: 9.8,
    basis: 'estimate',
    clamped: false,
  });
  assert.deepEqual(chooseRewindTime({now: 10, claimed: 9.75, maxRewind: 1, behind: 0.2, maxSkew: 0.2}), {
    time: 9.75,
    basis: 'claim',
    clamped: false,
  });
  for (const claimed of [undefined, null, Number.NaN, '9.5', {}])
    assert.deepEqual(chooseRewindTime({now: 10, claimed, maxRewind: 1, behind: 0.3}), {
      time: 9.7,
      basis: 'estimate',
      clamped: false,
    });
  assert.deepEqual(chooseRewindTime({now: 10, maxRewind: 1}), {time: 10, basis: 'now', clamped: false});
  assert.deepEqual(chooseRewindTime({now: 10, maxRewind: 1, behind: 5}), {time: 9, basis: 'estimate', clamped: true});
  assert.throws(() => chooseRewindTime({now: Number.NaN, maxRewind: 1}), TypeError);
  assert.throws(() => chooseRewindTime({now: 1, maxRewind: -1}), RangeError);
  assert.throws(() => chooseRewindTime({now: 1, maxRewind: 1, behind: -1}), RangeError);
  assert.throws(() => chooseRewindTime({now: 1, maxRewind: 1, maxSkew: 1}), RangeError);
});

test('composition: an authoritative hit test against what the observer saw, live state untouched', () => {
  // A host steps at 0.05 s and records each mover's centre. An observer displayed the world 0.15 s late and fired a
  // swept probe across x = 0. The mover had left x = 0 by `now`, so testing live positions misses.
  const step = 0.05;
  const h = createRewindHistory({limits: {width: 3, maxSubjects: 16, maxSamples: 32, maxRewind: 0.5}});
  const live = new Map<string, [number, number, number]>();
  let now = 0;
  for (let i = 0; i <= 20; i++) {
    now = i * step;
    live.set('mover', [now * 4 - 3, 0, 0]); // passes x = 0 at t = 0.75
    live.set('still', [50, 0, 0]);
    for (const [id, p] of live) h.record(id, now, p);
    h.trim(now);
  }
  assert.ok(h.stats().samples <= 2 * 12);
  const probe = {from: [0, 0, -5] as [number, number, number], to: [0, 0, 5] as [number, number, number], radius: 0.1};
  const liveTargets = [...live].map(([id, p]) => ({id, from: p, to: p, radius: 0.5}));
  assert.equal(sweep(probe.from, probe.to, probe.radius, liveTargets), null);

  const when = chooseRewindTime({now, claimed: now - 0.25, maxRewind: 0.5, behind: 0.2, maxSkew: 0.1});
  assert.equal(when.basis, 'claim');
  const out = new Float64Array(3);
  const rewound = [];
  for (const id of live.keys()) {
    const r = h.sample(id, when.time, out);
    assert.ok(r.status === 'exact' || r.status === 'interpolated', `${id}: ${r.status}`);
    const p = [out[0], out[1], out[2]] as [number, number, number];
    rewound.push({id, from: p, to: p, radius: 0.5});
  }
  const hit = sweep(probe.from, probe.to, probe.radius, rewound);
  assert.equal(hit?.id, 'mover');
  assert.deepEqual(live.get('mover'), [1, 0, 0]);
});
