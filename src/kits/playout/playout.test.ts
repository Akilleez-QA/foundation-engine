import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createViewReceiver, type ViewLimits} from '../network';
import {createClockOffset, createPlayout, type Playout} from './index';

const delay = {min: 0, max: 1, jitterFactor: 2, adapt: 0.1};
const make = (over: Partial<{maxExtrapolation: number; maxSnapshots: number; maxSubjects: number}> = {}) =>
  createPlayout({
    limits: {width: 2, maxSubjects: over.maxSubjects ?? 4, maxSnapshots: over.maxSnapshots ?? 8},
    delay,
    maxExtrapolation: over.maxExtrapolation ?? 0,
  });
function at(p: Playout, subject: string | number, time: number) {
  const out = new Float64Array(2);
  return {...p.sample(subject, time, out), values: Array.from(out)};
}

test('clock offset: the minimum round trip wins, malformed samples are refused, the offset slews', () => {
  const c = createClockOffset({maxSamples: 4, maxRoundTrip: 1, maxSlew: 0.1, snapBeyond: 0.5});
  assert.equal(c.remoteNow(0), null);
  assert.equal(c.sample({sent: 0, remote: 100.3, received: 0.4}), 'accepted'); // offset 100.1, trip 0.4
  assert.equal(c.sample({sent: 1, remote: 101.05, received: 1.1}), 'accepted'); // offset 100.0, trip 0.1
  for (const bad of [
    {sent: 2, remote: 5, received: 1.9},
    {sent: 2, remote: 5, received: 9},
    {sent: Number.NaN, remote: 1, received: 1},
    null,
  ])
    assert.equal(c.sample(bad as never), 'refused');
  const e = c.estimate()!;
  assert.ok(Math.abs(e.offset - 100) < 1e-9);
  assert.ok(Math.abs(e.roundTrip - 0.1) < 1e-9);
  assert.ok(Math.abs(c.remoteNow(2)! - 102) < 1e-9); // first application snaps
  // A slightly better sample moves the applied offset by at most maxSlew per unit of local time.
  c.sample({sent: 3, remote: 103.25, received: 3.01}); // offset 100.245, trip 0.01
  assert.ok(Math.abs(c.remoteNow(3)! - (3 + 100.1)) < 1e-9);
  assert.ok(Math.abs(c.remoteNow(10)! - (10 + 100.245)) < 1e-9);
  // A large step snaps.
  c.reset();
  c.sample({sent: 11, remote: 211, received: 11});
  assert.ok(Math.abs(c.remoteNow(11)! - 211) < 1e-9);
  assert.throws(() => c.remoteNow(10), RangeError);
  assert.throws(() => createClockOffset({maxSamples: 0, maxRoundTrip: 1, maxSlew: 0, snapBeyond: 0}), RangeError);
  c.dispose();
  assert.equal(c.sample({sent: 12, remote: 1, received: 12}), 'retired');
});

test('sampling interpolates, holds across a discontinuity, extrapolates within the cap then holds', () => {
  const p = make({maxExtrapolation: 0.5});
  p.push('a', 0, [0, 0]);
  p.push('a', 1, [10, 0]);
  p.push('a', 2, [20, 0]);
  assert.deepEqual(at(p, 'a', 1.5), {status: 'interpolated', from: 1, to: 2, values: [15, 0]});
  assert.deepEqual(at(p, 'a', 1), {status: 'exact', time: 1, values: [10, 0]});
  assert.deepEqual(at(p, 'a', 2.25), {status: 'extrapolated', from: 1, to: 2, beyond: 0.25, values: [22.5, 0]});
  assert.deepEqual(at(p, 'a', 9), {status: 'extrapolated', from: 1, to: 2, beyond: 0.5, values: [25, 0]});
  assert.deepEqual(at(p, 'a', -5), {status: 'held', time: 0, values: [0, 0]});
  p.push('a', 3, [500, 0], {discontinuity: true});
  assert.deepEqual(at(p, 'a', 2.5), {status: 'held', time: 2, values: [20, 0]});
  assert.deepEqual(at(p, 'a', 3), {status: 'exact', time: 3, values: [500, 0]});
  assert.deepEqual(at(p, 'a', 3.2), {status: 'held', time: 3, values: [500, 0]}); // no extrapolation off a jump
  assert.equal(at(p, 'b', 1).status, 'absent');
});

test('push ordering, capacity, eviction and trim', () => {
  const p = make({maxSnapshots: 3, maxSubjects: 1});
  assert.equal(p.push('a', 1, [1, 1]), 'stored');
  assert.equal(p.push('a', 1, [9, 9]), 'duplicate');
  assert.equal(p.push('a', 0.5, [9, 9]), 'out-of-order');
  assert.equal(p.push('b', 1, [1, 1]), 'saturated');
  for (const t of [2, 3, 4]) p.push('a', t, [t, 0]);
  assert.equal(p.stats().evicted, 1);
  assert.equal(p.trim(3.5), 1);
  assert.deepEqual(at(p, 'a', 3.5).values, [3.5, 0]);
  assert.deepEqual(p.stats().outOfOrder, 1);
  assert.deepEqual(p.stats().refused, 1);
  assert.throws(() => p.push('a', 5, [1]), TypeError);
  assert.throws(() => p.push('a', 5, [1, Number.NaN]), TypeError);
  assert.equal(p.remove('a'), true);
  assert.equal(p.stats().snapshots, 0);
  p.dispose();
  assert.equal(p.push('a', 9, [0, 0]), 'retired');
});

test('the delay adapts to lateness and jitter within bounds, gradually, and render time never decreases', () => {
  const p = createPlayout({
    limits: {width: 1, maxSubjects: 1, maxSnapshots: 4},
    delay: {min: 0.05, max: 0.4, jitterFactor: 2, adapt: 0.1},
    maxExtrapolation: 0,
  });
  assert.equal(p.advance(0), 0 - 0.05);
  let now = 0;
  let last = Number.NEGATIVE_INFINITY;
  for (let i = 1; i <= 200; i++) {
    const stamp = i * 0.05;
    now = stamp + 0.08 + (i % 2) * 0.04; // lateness 0.08 or 0.12
    p.observe(stamp, now);
    const r = p.advance(now);
    assert.ok(r >= last);
    last = r;
  }
  const s = p.stats();
  assert.ok(s.target > 0.14 && s.target < 0.4, String(s.target));
  assert.ok(Math.abs(s.delay - s.target) < 0.01);
  // A remote clock that steps back does not move render time back.
  assert.equal(p.advance(now - 1), last);
  // A huge lateness is capped by delay.max.
  for (let i = 0; i < 100; i++) p.observe(0, 50);
  assert.equal(p.stats().target, 0.4);
});

test('reentry from blend throws and leaves out untouched', () => {
  const p: Playout = createPlayout({
    limits: {width: 1, maxSubjects: 1, maxSnapshots: 4},
    delay,
    maxExtrapolation: 0,
    blend: () => {
      p.push('a', 9, [0]);
    },
  });
  p.push('a', 0, [0]);
  p.push('a', 1, [1]);
  const out = new Float64Array([7]);
  assert.throws(() => p.sample('a', 0.5, out), /inside blend/);
  assert.equal(out[0], 7);
});

test('composition: jittered complete views through the network receiver present smooth, accurate motion', () => {
  // Authority: 20 views per second, one subject moving +1 unit per second, stamped with authority ms (worldRevision).
  // Client clock is 5 s behind the authority; one-way delay 30..110 ms; pings every 500 ms.
  let seed = 7;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const limits: ViewLimits = {maxBytes: 4096, maxNodes: 256, maxDepth: 6, maxEntities: 8, maxIdentityLength: 32};
  const receiver = createViewReceiver({session: 's', limits});
  const clock = createClockOffset({maxSamples: 16, maxRoundTrip: 400, maxSlew: 0.02, snapBeyond: 200});
  const playout = createPlayout({
    limits: {width: 1, maxSubjects: 8, maxSnapshots: 16},
    delay: {min: 50, max: 400, jitterFactor: 3, adapt: 0.05},
    maxExtrapolation: 100,
  });
  const skew = 5000;
  type Msg = {arrive: number; kind: 'view' | 'pong'; json?: string; sent?: number; remote?: number};
  const inflight: Msg[] = [];
  const oneWay = () => 30 + rand() * 80;
  let seq = 0;
  const out = new Float64Array(1);
  let previous: number | null = null;
  let worstStep = 0;
  let worstError = 0;
  let naivePrev: number | null = null;
  let naiveWorstStep = 0;
  for (let ms = 0; ms <= 20_000; ms++) {
    if (ms % 50 === 0) {
      seq++;
      const json = JSON.stringify({
        v: 1,
        type: 'view',
        session: 's',
        sequence: seq,
        worldRevision: ms,
        entities: [{id: 'm', incarnation: 1, fields: {x: ms / 1000}}],
      });
      inflight.push({arrive: ms + oneWay(), kind: 'view', json});
    }
    const local = ms - skew;
    if (ms % 500 === 0) {
      const up = oneWay();
      inflight.push({arrive: ms + up + oneWay(), kind: 'pong', sent: local, remote: ms + up});
    }
    for (let i = inflight.length - 1; i >= 0; i--) {
      const m = inflight[i]!;
      if (m.arrive > ms) continue;
      inflight.splice(i, 1);
      if (m.kind === 'pong') clock.sample({sent: m.sent!, remote: m.remote!, received: local});
      else if (receiver.receive(m.json!).status === 'accepted') {
        const view = receiver.read().view!;
        const now = clock.remoteNow(local);
        if (now !== null) playout.observe(view.worldRevision, now);
        for (const e of view.entities) playout.push(e.id, view.worldRevision, [(e.fields as {x: number}).x]);
      }
    }
    if (ms % 16 !== 0) continue; // ~60 presentation frames per second
    const now = clock.remoteNow(local);
    if (now === null) continue;
    const render = playout.advance(now);
    playout.trim(render);
    const r = playout.sample('m', render, out);
    const naive = receiver.read().view
      ? ((receiver.read().view!.entities[0]!.fields as {x: number}).x as number)
      : null;
    if (ms < 3000 || r.status === 'absent') {
      previous = out[0]!;
      naivePrev = naive;
      continue;
    }
    const step = out[0]! - previous!;
    worstStep = Math.max(worstStep, Math.abs(step - 0.016));
    worstError = Math.max(worstError, Math.abs(out[0]! - render / 1000));
    if (naive !== null && naivePrev !== null)
      naiveWorstStep = Math.max(naiveWorstStep, Math.abs(naive - naivePrev - 0.016));
    previous = out[0]!;
    naivePrev = naive;
  }
  const s = playout.stats();
  assert.ok(worstError < 0.002, `presented position error ${worstError}`);
  assert.ok(worstStep < 0.004, `per-frame step deviation ${worstStep}`);
  assert.ok(naiveWorstStep > 10 * worstStep, `naive ${naiveWorstStep} vs playout ${worstStep}`);
  assert.ok(s.delay >= 50 && s.delay <= 400, String(s.delay));
  assert.ok(s.snapshots <= 16);
  assert.ok(Math.abs(clock.estimate()!.offset - skew) <= clock.estimate()!.roundTrip / 2);
});
