import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDormancy, DORMANCY_CEILING, type DormancyStepInput, type ViewVolume} from './index';

const ahead = (z: number, extra: Partial<ViewVolume> = {}): ViewVolume => ({
  x: 0,
  z,
  yaw: 0,
  far: 20,
  halfWidth: 5,
  ...extra,
});

test('limits, track options and step input are validated before any change', () => {
  assert.throws(() => createDormancy({zones: 0}), RangeError);
  assert.throws(() => createDormancy({zones: DORMANCY_CEILING.zones + 1}), RangeError);
  assert.throws(() => createDormancy({maxEntities: 65537}), RangeError);
  assert.throws(() => createDormancy({maxEntities: 4, maxWakesPerStep: 5}), RangeError);
  assert.throws(() => createDormancy({maxZonesPerEntity: 17}), RangeError);
  assert.throws(() => createDormancy({maxViews: 9}), RangeError);
  assert.throws(() => createDormancy({wakeMargin: 2, sleepMargin: 1}), RangeError, 'sleep margin below wake');
  assert.throws(() => createDormancy({wakeMargin: Number.NaN}), RangeError);
  assert.throws(() => createDormancy({minAwakeSteps: 10001}), RangeError);
  assert.throws(() => createDormancy({minDormantSteps: -1}), RangeError);
  const d = createDormancy({zones: 4, maxEntities: 2, maxZonesPerEntity: 2});
  assert.equal(d.limits.maxWakeLatency, 0);
  assert.throws(() => d.track(-1, {policy: 'zone'}), RangeError);
  assert.throws(() => d.track(1, {policy: 'sometimes' as 'zone'}), RangeError);
  assert.throws(() => d.track(1, {policy: 'zone', zones: [4]}), /unknown zone id 4/);
  assert.throws(() => d.track(1, {policy: 'zone', zones: [0, 1, 2]}), RangeError, 'too many zones per entity');
  assert.throws(() => d.track(1, {policy: 'view', radius: -1}), RangeError);
  assert.throws(() => d.track(1, {policy: 'view', initial: 'asleep' as 'dormant'}), RangeError);
  assert.equal(d.stats().tracked, 0, 'refused tracks change nothing');
  assert.equal(d.track(1, {policy: 'zone', zones: [0]}), 'tracked');
  assert.equal(d.track(1, {policy: 'zone'}), 'duplicate');
  assert.equal(d.track(2, {policy: 'view'}), 'tracked');
  assert.equal(d.track(3, {policy: 'view'}), 'full');
  assert.throws(() => d.setZones(1, [9]), RangeError);
  assert.throws(() => d.step({activeZones: [7]}), /unknown active zone id 7/);
  assert.throws(() => d.step({activeZones: [0.5]}), RangeError);
  assert.throws(() => d.step({views: [ahead(0), ahead(0), ahead(0)]}), RangeError, 'more views than maxViews');
  assert.throws(() => d.step({views: [ahead(0)]}), /position is required/);
  assert.equal(d.stats().steps, 0, 'refused steps change nothing');
});

test('degenerate or non-finite view volumes throw; the volume is a forward frustum, a box behind, and a height band', () => {
  const d = createDormancy({maxEntities: 8, maxWakesPerStep: 8, minAwakeSteps: 0});
  const pos = new Map<number, {x: number; z: number; y?: number}>();
  const step = (views: ViewVolume[]) => d.step({views, position: id => pos.get(id) ?? null});
  d.track(1, {policy: 'view'});
  pos.set(1, {x: 0, z: 10});
  for (const bad of [
    ahead(0, {far: 0}),
    ahead(0, {halfWidth: 0}),
    ahead(0, {halfWidth: -1}),
    ahead(0, {behind: -1}),
    ahead(0, {spread: 101}),
    ahead(Number.NaN),
    ahead(0, {yaw: Number.POSITIVE_INFINITY}),
    ahead(0, {y: 0, up: 0, down: 0}),
    ahead(0, {y: 0}),
    ahead(0, {up: 2, down: 2}),
  ])
    assert.throws(() => step([bad]), RangeError, JSON.stringify(bad));
  assert.equal(d.stats().steps, 0);
  assert.equal(d.state(1), 'dormant');
  // halfWidth 0 with a spread is a proper frustum (a point at the camera, widening ahead).
  const cases: [{x: number; z: number; y?: number}, ViewVolume, boolean][] = [
    [{x: 0, z: 10}, ahead(0), true],
    [{x: 0, z: 21}, ahead(0), false], // past far
    [{x: 6, z: 10}, ahead(0), false], // beside the box
    [{x: 6, z: 10}, ahead(0, {spread: 0.2}), true], // widened: 5 + 0.2 × 10 = 7
    [{x: 0, z: -2}, ahead(0), false], // behind, no box
    [{x: 4, z: -2}, ahead(0, {behind: 3}), true],
    [{x: 0, z: 10, y: 9}, ahead(0, {y: 0, up: 4, down: 1}), false],
    [{x: 0, z: 10, y: -1}, ahead(0, {y: 0, up: 4, down: 1}), true],
    [{x: 0, z: 10}, ahead(0, {y: 100, up: 1, down: 1}), true], // no height: vertical test skipped
    [{x: 10, z: 0}, ahead(0, {yaw: Math.PI / 2}), true], // yaw +90° looks toward +x
    [{x: 0, z: 10}, ahead(0, {yaw: Math.PI / 2}), false],
    [{x: 1, z: 10}, ahead(0, {halfWidth: 0, spread: 0.2}), true],
  ];
  for (const [p, v, expect] of cases) {
    const fresh = createDormancy({maxEntities: 1, minAwakeSteps: 0});
    fresh.track(1, {policy: 'view'});
    fresh.step({views: [v], position: () => p});
    assert.equal(fresh.isAwake(1), expect, `${JSON.stringify(p)} in ${JSON.stringify(v)}`);
  }
});

test('hysteresis: wake and sleep margins stop boundary flicker under an oscillating camera', () => {
  const run = (wakeMargin: number, sleepMargin: number, minAwakeSteps: number, minDormantSteps: number) => {
    const d = createDormancy({maxEntities: 1, wakeMargin, sleepMargin, minAwakeSteps, minDormantSteps});
    d.track(1, {policy: 'view'});
    let transitions = 0;
    for (let t = 0; t < 400; t++) {
      // The camera bobs ±0.6 around z = 0 (a period of 7 steps); the entity sits 20.3 ahead, at the far boundary.
      const camZ = 0.6 * Math.sin((2 * Math.PI * t) / 7);
      const s = d.step({views: [ahead(camZ)], position: () => ({x: 0, z: 20.3})});
      transitions += s.woke.length + s.slept.length;
    }
    return transitions;
  };
  assert.ok(run(0, 0, 0, 0) > 80, 'without hysteresis the entity flickers (the test can see flicker)');
  assert.equal(run(0, 1, 0, 0), 1, 'a sleep margin wider than the oscillation: one wake, never sleeps');
  const dwell = run(0, 0, 20, 20);
  assert.ok(dwell >= 2 && dwell <= Math.ceil(400 / 20), `dwell bounds transitions to one per 20 steps (${dwell})`);
});

test('dwell: an awake entity stays at least minAwakeSteps, a dormant one waits minDormantSteps before queueing', () => {
  const d = createDormancy({zones: 2, maxEntities: 1, minAwakeSteps: 3, minDormantSteps: 2});
  d.track(5, {policy: 'zone', zones: [0]});
  const at = (activeZones: number[]) => d.step({activeZones});
  assert.deepEqual(at([0]).woke, [5], 'initial dormancy has satisfied dwell');
  assert.deepEqual(at([]).slept, [], 'awake 1 step');
  assert.deepEqual(at([]).slept, [], 'awake 2 steps');
  assert.deepEqual(at([]).slept, [5], 'awake 3 steps: may sleep');
  assert.deepEqual(at([0]).woke, [], 'dormant 1 step');
  const back = at([0]);
  assert.deepEqual(back.woke, [5], 'dormant 2 steps: wakes');
  assert.deepEqual(back.dormantSteps, [2]);
});

test('zone transitions wake and sleep the right sets; doorway entities belong to two zones', () => {
  const d = createDormancy({zones: 4, maxEntities: 16, maxWakesPerStep: 16, minAwakeSteps: 0});
  // Zone r holds entities 10r..10r+1; entity 99 straddles the doorway between zones 1 and 2; 7 is always active.
  for (const r of [0, 1, 2, 3]) for (const k of [0, 1]) d.track(10 * r + k, {policy: 'zone', zones: [r]});
  d.track(99, {policy: 'zone', zones: [1, 2]});
  d.track(7, {policy: 'always'});
  assert.equal(d.isAwake(7), true, 'always entities are awake from tracking');
  const s1 = d.step({activeZones: [0]});
  assert.deepEqual(s1.woke, [0, 1]);
  // During a transition the previous and current zones are both active.
  const s2 = d.step({activeZones: [0, 1]});
  assert.deepEqual(s2.woke, [10, 11, 99]);
  assert.deepEqual(s2.slept, []);
  const s3 = d.step({activeZones: [1]});
  assert.deepEqual(s3.slept, [0, 1]);
  const s4 = d.step({activeZones: [2]});
  assert.deepEqual(s4.slept, [10, 11], 'the doorway entity stays awake: zone 2 holds it too');
  assert.deepEqual(s4.woke, [20, 21]);
  const s5 = d.step({activeZones: [3, 3]});
  assert.deepEqual(s5.slept, [20, 21, 99]);
  assert.deepEqual(s5.woke, [30, 31]);
  assert.equal(d.isAwake(7), true);
  assert.equal(s5.awake, 3);
  assert.equal(d.isAwake(12345), true, 'untracked entities are never frozen');
  // An entity moved by the creator into another zone follows it at the next step.
  d.setZones(30, [0]);
  assert.deepEqual(d.step({activeZones: [3]}).slept, [30]);
});

test('zone-or-view keeps an entity awake through either signal; positions are read only when the zone does not decide', () => {
  const d = createDormancy({zones: 2, maxEntities: 4, minAwakeSteps: 0});
  d.track(1, {policy: 'zone-or-view', zones: [0]});
  d.track(2, {policy: 'zone', zones: [1]});
  const asked: number[] = [];
  const input = (zones: number[], z: number): DormancyStepInput => ({
    activeZones: zones,
    views: [ahead(0)],
    position: id => {
      asked.push(id);
      return {x: 0, z};
    },
  });
  d.step(input([0], 100));
  assert.deepEqual(asked, [], 'zone active: no position read');
  assert.equal(d.isAwake(1), true);
  d.step(input([], 10));
  assert.deepEqual(asked, [1], 'zone inactive: the view decides');
  assert.equal(d.isAwake(1), true);
  assert.equal(d.isAwake(2), false, 'a zone-bound entity ignores views');
  d.step(input([], 100));
  assert.equal(d.isAwake(1), false);
});

test('wake budget: overflow queues first-in-first-out within maxWakeLatency, reports deferred counts and drains', () => {
  const make = () => {
    const d = createDormancy({zones: 1, maxEntities: 10, maxWakesPerStep: 3, minAwakeSteps: 0});
    for (let id = 0; id < 10; id++) d.track(id, {policy: 'zone', zones: [0]});
    return d;
  };
  const d = make();
  assert.equal(d.limits.maxWakeLatency, 3);
  const steps = [1, 2, 3, 4].map(() => d.step({activeZones: [0]}));
  assert.deepEqual(
    steps.map(s => s.woke),
    [[0, 1, 2], [3, 4, 5], [6, 7, 8], [9]],
  );
  assert.deepEqual(
    steps.map(s => s.deferred),
    [7, 4, 1, 0],
  );
  assert.deepEqual(
    steps.map(s => s.status),
    ['deferred', 'deferred', 'deferred', 'complete'],
  );
  assert.deepEqual(
    steps.map(s => s.oldestWait),
    [0, 1, 2, 0],
  );
  assert.deepEqual(steps[0]!.dormantSteps, [-1, -1, -1], 'never awake before');
  // Deterministic: a second instance with the same inputs produces the same events.
  const again = make();
  assert.deepEqual(
    [1, 2, 3, 4].map(() => again.step({activeZones: [0]}).woke),
    steps.map(s => s.woke),
  );

  // Cancellation: an entity untracked while queued leaves the queue; one whose zone deactivates is withdrawn.
  const c = make();
  c.step({activeZones: [0]});
  assert.equal(c.state(5), 'queued');
  assert.equal(c.untrack(5), 'untracked');
  assert.equal(c.untrack(5), 'absent');
  assert.equal(c.stats().cancelled, 1);
  assert.deepEqual(c.step({activeZones: [0]}).woke, [3, 4, 6]);
  const w = c.step({activeZones: []});
  assert.equal(w.withdrawn, 3, 'entities 7, 8 and 9 no longer want to wake');
  assert.equal(w.deferred, 0);
  assert.deepEqual(w.slept, [0, 1, 2, 3, 4, 6]);
  // Re-wanting puts them at the back of a fresh queue in track order.
  assert.deepEqual(c.step({activeZones: [0]}).woke, [0, 1, 2]);
});

test('wake latency bound holds under churn: no entity that keeps wanting waits longer than maxWakeLatency', () => {
  const d = createDormancy({zones: 8, maxEntities: 64, maxWakesPerStep: 5, minAwakeSteps: 2, minDormantSteps: 1});
  let seed = 12345;
  const rand = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32;
  for (let id = 0; id < 64; id++) d.track(id, {policy: 'zone', zones: [id % 8, (id * 3) % 8]});
  let maxWait = 0;
  for (let t = 0; t < 2000; t++) {
    const zones = [0, 1, 2, 3, 4, 5, 6, 7].filter(() => rand() < 0.4);
    const s = d.step({activeZones: zones});
    assert.ok(s.woke.length <= 5);
    assert.equal(s.awake + s.dormant, 64);
    maxWait = Math.max(maxWait, s.oldestWait);
  }
  assert.ok(maxWait <= d.limits.maxWakeLatency, `${maxWait} <= ${d.limits.maxWakeLatency}`);
  assert.ok(maxWait > 0, 'the budget was exercised');
});

test('a throwing or invalid position callback leaves the state untouched; the callback cannot mutate', () => {
  const d = createDormancy({zones: 2, maxEntities: 4, minAwakeSteps: 0});
  d.track(1, {policy: 'view'});
  d.track(2, {policy: 'zone', zones: [1]});
  assert.throws(() =>
    d.step({
      activeZones: [1],
      views: [ahead(0)],
      position: () => {
        throw new Error('boom');
      },
    }),
  );
  assert.equal(d.stats().steps, 0);
  assert.equal(d.isAwake(2), false);
  // Stamps from the refused attempt never count later.
  d.step({activeZones: []});
  assert.equal(d.isAwake(2), false, 'zone 1 was not active on the committed step');
  assert.throws(() => d.step({views: [ahead(0)], position: () => ({x: Number.NaN, z: 0})}), RangeError);
  assert.throws(() => d.step({views: [ahead(0)], position: () => ({x: 0, z: 1, y: Number.NaN})}), RangeError);
  assert.throws(() => d.step({views: [ahead(0)], position: () => (d.untrack(1), {x: 0, z: 1})}), /must not/);
  assert.equal(d.stats().tracked, 2);
  assert.equal(d.stats().steps, 1);
});

test('always policy, policy changes, hide, initial state and a radius growing the volume', () => {
  const d = createDormancy({zones: 2, maxEntities: 8, maxWakesPerStep: 1, minAwakeSteps: 0});
  d.track(1, {policy: 'zone', zones: [0], hide: true});
  d.track(2, {policy: 'zone', zones: [0], initial: 'awake'});
  d.track(3, {policy: 'view', radius: 2});
  assert.equal(d.isHidden(1), true);
  assert.equal(d.isHidden(2), false);
  assert.equal(d.isHidden(77), false);
  const s = d.step({views: [ahead(0)], position: () => ({x: 6.5, z: 10})});
  assert.deepEqual(s.slept, [2], 'an initially awake entity sleeps when nothing keeps it');
  assert.deepEqual(s.woke, [3], 'radius 2 reaches a point 1.5 beyond the side');
  // A policy change to always wakes at the next step without spending the wake budget.
  d.setPolicy(1, 'always');
  d.setPolicy(2, 'view');
  assert.equal(d.policy(1), 'always');
  const t = d.step({views: [ahead(0)], position: () => ({x: 0, z: 10})});
  assert.deepEqual(t.woke, [1, 2]);
  assert.equal(d.isHidden(1), false);
  assert.equal(d.setPolicy(42, 'zone'), false);
  assert.equal(d.setZones(42, []), false);
  assert.equal(d.state(42), null);
});
