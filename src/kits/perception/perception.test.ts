import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  chooseCover,
  chooseUtility,
  createAwareness,
  createCoverReservations,
  createSquadKnowledge,
  hearingStrength,
  sightStrength,
  type Vec3,
} from './index';

const close = (a: number, b: number, tol = 1e-9, msg = '') => assert.ok(Math.abs(a - b) < tol, `${msg} ${a} vs ${b}`);
const open = () => true;

test('sight: range, cone, peripheral falloff, near radius and occlusion via the creator query', () => {
  const spec = {range: 10, fov: Math.PI / 2, near: 1, edge: 0.5};
  const eye = {position: [0, 0, 0] as Vec3, forward: [0, 0, 1] as Vec3};
  close(sightStrength(spec, eye, [0, 0, 5], open), 0.5);
  close(sightStrength(spec, eye, [Math.sin(Math.PI / 4) * 5, 0, Math.cos(Math.PI / 4) * 5], open), 0.25, 1e-9, 'edge');
  assert.equal(sightStrength(spec, eye, [0, 0, 11], open), 0, 'out of range');
  assert.equal(sightStrength(spec, eye, [0, 0, -5], open), 0, 'behind');
  close(sightStrength(spec, eye, [0, 0, -0.5], open), 0.95 * 0.5, 1e-9, 'near radius notices behind');
  let calls = 0;
  const wall = () => {
    calls++;
    return false;
  };
  assert.equal(sightStrength(spec, eye, [0, 0, 5], wall), 0);
  sightStrength(spec, eye, [0, 0, -5], wall);
  assert.equal(calls, 1, 'occlusion is queried only inside range and cone');
  assert.throws(() => sightStrength({range: 0, fov: 1}, eye, [0, 0, 1], open), RangeError);
  assert.throws(() => sightStrength(spec, {position: [0, 0, 0], forward: [0, 0, 0]}, [0, 0, 1], open), RangeError);
});

test('hearing: linear falloff, path distance, unreachable and attenuation', () => {
  close(hearingStrength([0, 0, 0], {position: [3, 0, 4], loudness: 10}), 0.5);
  assert.equal(hearingStrength([0, 0, 0], {position: [30, 0, 0], loudness: 10}), 0);
  close(
    hearingStrength([0, 0, 0], {position: [3, 0, 4], loudness: 10}, {distance: () => 8}),
    0.2,
    1e-9,
    'around a wall',
  );
  assert.equal(hearingStrength([0, 0, 0], {position: [3, 0, 4], loudness: 10}, {distance: () => null}), 0);
  close(hearingStrength([0, 0, 0], {position: [3, 0, 4], loudness: 10}, {attenuation: () => 0.5}), 0.25);
  assert.throws(
    () => hearingStrength([0, 0, 0], {position: [1, 0, 0], loudness: 10}, {attenuation: () => 2}),
    RangeError,
  );
});

test('awareness rises with sight, jumps with sound, decays, and changes level with hysteresis', () => {
  const a = createAwareness({
    sightRate: 1,
    soundImpulse: 0.4,
    decay: 0.1,
    suspicious: [0.3, 0.15],
    alerted: [0.8, 0.5],
    maxStep: 10,
  });
  a.update(0);
  a.update(0.5, [{target: 'p', kind: 'sight', strength: 1, position: [1, 0, 1]}]);
  close(a.recall('p')!.awareness, 0.5);
  assert.equal(a.alert, 'suspicious');
  a.update(1, [{target: 'p', kind: 'sight', strength: 1, position: [2, 0, 2]}]);
  assert.equal(a.alert, 'alerted');
  assert.deepEqual(a.recall('p')!.lastKnown, [2, 0, 2]);
  a.update(3);
  close(a.recall('p')!.awareness, 0.8);
  assert.equal(a.alert, 'alerted', 'stays alerted above the leave threshold');
  a.update(6.5);
  assert.equal(a.alert, 'suspicious');
  assert.equal(a.recall('p')!.visible, false);
  a.update(7, [{target: 'q', kind: 'sound', strength: 0.5, position: [9, 0, 9]}]);
  close(a.recall('q')!.awareness, 0.2);
  assert.equal(a.focus!.target, 'p');
  const board = new Map<string, unknown>();
  a.write({set: (k, v) => board.set(k, v)}, 'eyes');
  assert.equal(board.get('eyes.target'), 'p');
  assert.equal(board.get('eyes.alert'), 'suspicious');
  close(board.get('eyes.seenAgo') as number, 6);
  assert.throws(() => a.update(6), /backwards/);
  assert.throws(
    () => a.update(8, [{target: 'p', kind: 'smell' as never, strength: 1, position: [0, 0, 0]}]),
    RangeError,
  );
});

test('awareness forgets quiet targets and keeps the most aware when memory is full', () => {
  const a = createAwareness({maxTargets: 2, decay: 1, forgetAfter: 2, soundImpulse: 0.5});
  a.update(0, [
    {target: 'a', kind: 'sound', strength: 1, position: [0, 0, 0]},
    {target: 'b', kind: 'sound', strength: 0.4, position: [0, 0, 0]},
  ]);
  const lost = a.update(0, [{target: 'c', kind: 'sound', strength: 0.2, position: [0, 0, 0]}]);
  assert.equal(lost, 1, 'a weaker newcomer is dropped');
  a.update(0, [{target: 'c', kind: 'sound', strength: 1, position: [0, 0, 0]}]);
  assert.deepEqual(
    a.targets().map(t => t.target),
    ['a', 'c'],
    'a stronger newcomer replaces the weakest',
  );
  a.update(5);
  assert.deepEqual(a.targets(), [], 'forgotten after decaying to zero and forgetAfter');
});

test('squad knowledge shares the newest reports and informs members with fading report stimuli', () => {
  const squad = createSquadKnowledge({maxAge: 10});
  const scout = createAwareness({sightRate: 2, maxStep: 1});
  scout.update(0);
  scout.update(1, [{target: 'p', kind: 'sight', strength: 1, position: [5, 0, 5]}]);
  assert.equal(squad.share('scout', scout), 1);
  assert.equal(squad.report({target: 'p', position: [0, 0, 0], time: 0.5, confidence: 1, reporter: 'other'}), 'older');
  const stimuli = squad.inform('guard', 6);
  assert.equal(stimuli.length, 1);
  close(stimuli[0]!.strength, 1 * (1 - 5 / 10));
  assert.deepEqual(squad.inform('scout', 6), [], 'no echo of your own report');
  const guard = createAwareness({reportRate: 0.5, maxStep: 1});
  guard.update(5);
  guard.update(6, stimuli);
  close(guard.recall('p')!.awareness, 0.25, 1e-9, 'rate 0.5 × confidence 0.5 × 1 s');
  assert.deepEqual(guard.recall('p')!.lastKnown, [5, 0, 5]);
  assert.equal(guard.recall('p')!.lastDirect, null, 'known only from a report');
  assert.equal(squad.expire(20), 1);
  assert.throws(() => squad.expire(Number.NaN), RangeError);
});

test('review fixes: no rumour loop, rate-independent reports, atomic updates, sight priority, forgetting', () => {
  // Re-sharing reported knowledge never refreshes it.
  const squad = createSquadKnowledge({maxAge: 5});
  const a = createAwareness({sightRate: 10, reportRate: 2, decay: 0.05, maxStep: 1}),
    b = createAwareness({reportRate: 2, decay: 0.05, maxStep: 1});
  a.update(0);
  b.update(0);
  a.update(1, [{target: 'p', kind: 'sight', strength: 1, position: [1, 0, 1]}]);
  for (let t = 2; t <= 30; t++) {
    squad.share('a', a);
    squad.share('b', b);
    a.update(t, squad.inform('a', t));
    b.update(t, squad.inform('b', t));
  }
  assert.equal(squad.recall('p')!.time, 1, 'the report keeps its original perception time');
  assert.deepEqual(squad.inform('b', 30), [], 'and expires');
  // Report gain does not depend on how often inform is called.
  const once = (hz: number) => {
    const s = createSquadKnowledge({maxAge: 100});
    s.report({target: 'q', position: [0, 0, 0], time: 0, confidence: 0.5, reporter: 'x'});
    const m = createAwareness({reportRate: 0.5, decay: 0, maxStep: 1});
    m.update(0);
    for (let i = 1; i <= hz; i++) m.update(i / hz, s.inform('m', 0));
    return m.recall('q')!.awareness;
  };
  close(once(1), once(60), 1e-9);
  // A failed update leaves time and memory unchanged.
  const c = createAwareness({decay: 0.1, soundImpulse: 0.4});
  c.update(0, [{target: 's', kind: 'sound', strength: 1, position: [0, 0, 0]}]);
  assert.throws(() => c.update(10, [{target: 's', kind: 'bad' as never, strength: 1, position: [0, 0, 0]}]));
  c.update(2);
  close(c.recall('s')!.awareness, 0.2);
  // Several identical sights do not add up; sight wins the last-known position over a report.
  const d = createAwareness({sightRate: 2});
  d.update(0);
  d.update(0.1, [
    {target: 'r', kind: 'sight', strength: 1, position: [1, 1, 1]},
    {target: 'r', kind: 'sight', strength: 1, position: [1, 1, 1]},
    {target: 'r', kind: 'report', strength: 1, position: [9, 9, 9]},
  ]);
  assert.deepEqual(d.recall('r')!.lastKnown, [1, 1, 1]);
  close(d.recall('r')!.awareness, 0.2 + 0.5 * 0.1, 1e-9);
  // With no decay, an unaware target is still forgotten after forgetAfter.
  const e = createAwareness({decay: 0, forgetAfter: 1});
  e.update(0, [{target: 'w', kind: 'sound', strength: 0.1, position: [0, 0, 0]}]);
  e.update(2);
  assert.equal(e.recall('w'), null);
});

test('cover: nearest protected point inside the band, skipping reserved points, with bounded checks', () => {
  const points = [
    {id: 'a', position: [1, 0, 0] as Vec3},
    {id: 'b', position: [3, 0, 0] as Vec3},
    {id: 'c', position: [6, 0, 0] as Vec3},
    {id: 'd', position: [50, 0, 0] as Vec3},
  ];
  const hidden = new Set(['b', 'c']);
  const byPos = new Map(points.map(p => [p.position.join(), p.id]));
  const protects = (p: Vec3) => hidden.has(byPos.get(p.join())!);
  const reservations = createCoverReservations();
  const pick = chooseCover(points, {
    agent: [0, 0, 0],
    threat: [0, 0, 20],
    protects,
    maxDistance: 10,
    reserved: reservations.takenFor('me'),
  });
  assert.equal(pick!.id, 'b');
  assert.equal(pick!.checks, 2);
  assert.equal(reservations.claim('other', 'b'), 'claimed');
  assert.equal(
    chooseCover(points, {
      agent: [0, 0, 0],
      threat: [0, 0, 20],
      protects,
      maxDistance: 10,
      reserved: reservations.takenFor('me'),
    })!.id,
    'c',
  );
  assert.equal(
    chooseCover(points, {agent: [0, 0, 0], threat: [0, 0, 20], protects, maxDistance: 10, maxChecks: 1}),
    null,
  );
  assert.equal(reservations.claim('me', 'b'), 'taken');
  assert.equal(reservations.release('other'), true);
  assert.equal(reservations.claim('me', 'b'), 'claimed');
  assert.throws(
    () => chooseCover([points[0]!, points[0]!], {agent: [0, 0, 0], threat: [1, 0, 0], protects}),
    RangeError,
  );
});

test('utility scores compensated products, applies momentum and refuses invalid considerations', () => {
  const options = [
    {
      id: 'attack',
      considerations: [(i: {hp: number; ammo: number}) => i.hp, (i: {hp: number; ammo: number}) => i.ammo],
    },
    {id: 'retreat', considerations: [(i: {hp: number; ammo: number}) => 1 - i.hp]},
  ];
  const strong = chooseUtility(options, {hp: 0.9, ammo: 0.8});
  assert.equal(strong.choice, 'attack');
  const p = 0.72;
  close(strong.scores.attack!, p + (1 - p) * 0.5 * p);
  const torn = chooseUtility(options, {hp: 0.5, ammo: 0.9}, {current: 'retreat', momentum: 0.5});
  assert.equal(torn.choice, 'retreat', 'momentum keeps the current choice when close');
  assert.equal(chooseUtility(options, {hp: 0, ammo: 0}, {minScore: 2}).choice, null);
  assert.throws(() => chooseUtility([{id: 'x', considerations: [() => 2]}], {}), RangeError);
});

test('re-review fixes: credited step cap, direct-only sharing, report positions, eviction counting', () => {
  const gap = createAwareness({reportRate: 1, maxStep: 0.25});
  gap.update(0);
  gap.update(5, [{target: 'p', kind: 'report', strength: 1, position: [0, 0, 0]}]);
  assert.ok(gap.recall('p')!.awareness <= 0.25 + 1e-12, 'one report after a long gap credits at most maxStep');
  const relay = createAwareness({reportRate: 1, maxStep: 1});
  relay.update(0, [{target: 'q', kind: 'sound', strength: 0.05, position: [50, 0, 0]}]);
  relay.update(1, [{target: 'q', kind: 'report', strength: 1, position: [1, 0, 0], time: 0}]);
  relay.update(2, [{target: 'q', kind: 'report', strength: 1, position: [1, 0, 0], time: 0}]);
  assert.deepEqual(relay.recall('q')!.lastKnown, [50, 0, 0], 'reports older than the direct perception do not move it');
  relay.update(3, [{target: 'q', kind: 'report', strength: 1, position: [9, 0, 0], time: 2.5}]);
  assert.deepEqual(relay.recall('q')!.lastKnown, [9, 0, 0], 'a report newer than the direct perception does');
  const board = createSquadKnowledge();
  board.share('relay', relay);
  const r = board.recall('q');
  if (r) {
    assert.deepEqual(r.position, [50, 0, 0], 'shared position is the direct one');
    assert.equal(r.confidence, 0.05, 'confidence is the direct strength');
    assert.equal(r.time, 0);
  }
  const full = createAwareness({maxTargets: 1, soundImpulse: 0.5});
  full.update(0, [{target: 'x', kind: 'sound', strength: 0.1, position: [0, 0, 0]}]);
  assert.equal(full.update(0, [{target: 'y', kind: 'sound', strength: 1, position: [0, 0, 0]}]), 1, 'eviction counted');
  assert.equal(full.recall('x'), null);
});
