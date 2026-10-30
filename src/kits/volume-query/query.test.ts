import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  defineVolumeSet,
  headroom,
  overlapVolume,
  sweepVolume,
  VOLUME_MAX_COLLIDERS,
  type VolumeCollider,
  type VolumeSet,
  type VolumeSweepResult,
} from './index';
import {clearCamera} from '../camera';

const floor: VolumeCollider = {id: 'floor', kind: 'box', center: [0, -1, 0], halfExtents: [10, 1, 10]};
const hitOf = (r: VolumeSweepResult) => {
  assert.equal(r.status, 'hit');
  if (r.status !== 'hit') throw Error('expected hit');
  return r;
};

test('a sparse ray footprint misses an off-axis lip that the swept volume hits', () => {
  // A thin lip sits between the five camera rays but well inside the 0.5 m footprint.
  const set = defineVolumeSet({
    revision: 3,
    maxColliders: 1,
    colliders: [{id: 'lip', kind: 'box', center: [0.3, 0.3, 5], halfExtents: [0.05, 0.05, 0.05]}],
  });
  const ray = (from: readonly number[], to: readonly number[]) => {
    const d = [to[0]! - from[0]!, to[1]! - from[1]!, to[2]! - from[2]!] as const;
    const r = sweepVolume(set, {kind: 'sphere', center: from as [number, number, number], radius: 1e-6}, d);
    return r.status === 'hit' ? r.fraction * Math.hypot(...d) : null;
  };
  const pose = clearCamera({target: [0, 0, 0], position: [0, 0, 10]}, ray, 0.5, 0);
  assert.deepEqual(pose.position, [0, 0, 10]);
  const swept = hitOf(sweepVolume(set, {kind: 'sphere', center: [0, 0, 0], radius: 0.5}, [0, 0, 10]));
  assert.ok(swept.fraction > 0.4 && swept.fraction < 0.5);
  assert.equal(swept.id, 'lip');
  assert.equal(swept.revision, 3);
});

test('endpoint overlap misses a thin wall that the sweep hits', () => {
  const set = defineVolumeSet({
    revision: 0,
    maxColliders: 2,
    colliders: [{id: 'wall', kind: 'box', center: [0, 1, 0], halfExtents: [0.01, 2, 2]}, floor],
  });
  const body = {kind: 'capsule' as const, a: [-1, 0.5, 0] as const, b: [-1, 1.5, 0] as const, radius: 0.3};
  const end = {...body, a: [1, 0.5, 0] as const, b: [1, 1.5, 0] as const};
  assert.equal(overlapVolume(set, body).status, 'clear');
  assert.equal(overlapVolume(set, end).status, 'clear');
  const r = hitOf(sweepVolume(set, body, [2, 0, 0], {maxIterations: 2}));
  assert.equal(r.id, 'wall');
  // A flat face approached head-on is reached by one tangent step, exactly.
  assert.ok(Math.abs(r.fraction - (1 - 0.01 - 0.3) / 2) < 1e-12);
  assert.ok(Math.abs(r.normal[0] + 1) < 1e-12 && Math.abs(r.normal[1]) < 1e-12 && Math.abs(r.normal[2]) < 1e-12);
});

test('resting contact allows sliding and leaving but not pressing in, with or without a margin', () => {
  const set = defineVolumeSet({revision: 0, maxColliders: 1, colliders: [floor]});
  const resting = {kind: 'sphere' as const, center: [0, 0.5, 0] as const, radius: 0.5};
  assert.equal(sweepVolume(set, resting, [3, 0, -2]).status, 'clear');
  assert.equal(sweepVolume(set, resting, [0, 1, 0]).status, 'clear');
  assert.equal(hitOf(sweepVolume(set, resting, [1, -0.5, 0])).fraction, 0);
  assert.equal(overlapVolume(set, resting).status, 'clear');
  // Closer than the margin but not penetrating: moving away or along is allowed, approaching is not.
  const close = {...resting, center: [0, 0.505, 0] as const};
  assert.equal(overlapVolume(set, close, {margin: 0.01}).status, 'overlap');
  assert.equal(sweepVolume(set, close, [1, 0, 0], {margin: 0.01}).status, 'clear');
  assert.equal(sweepVolume(set, close, [0, 1, 0], {margin: 0.01}).status, 'clear');
  assert.equal(hitOf(sweepVolume(set, close, [0, -1, 0], {margin: 0.01})).fraction, 0);
  // From above, a margin stops the body early.
  const high = {...resting, center: [0, 2, 0] as const};
  const kept = hitOf(sweepVolume(set, high, [0, -2, 0], {margin: 0.1}));
  assert.ok(Math.abs(kept.fraction - 1.4 / 2) < 1e-6);
});

test('penetrating starts, masks, ties and input order are explicit and deterministic', () => {
  const colliders: VolumeCollider[] = [
    {id: 'b', kind: 'sphere', center: [5, 0, 0], radius: 1},
    {id: 'a', kind: 'sphere', center: [5, 0, 0], radius: 1},
    {id: 'ghost', kind: 'sphere', center: [4, 1.5, 0], radius: 1, mask: 2},
    {id: 'pole', kind: 'capsule', a: [0, -1, 0], b: [0, 1, 0], radius: 0.2},
  ];
  const one = defineVolumeSet({revision: 1, maxColliders: 4, colliders});
  const two = defineVolumeSet({revision: 1, maxColliders: 4, colliders: [...colliders].reverse()});
  const body = {kind: 'sphere' as const, center: [-1, 0, 0] as const, radius: 0.5};
  const r1 = sweepVolume(one, body, [10, 0, 0], {mask: 1});
  assert.deepEqual(r1, sweepVolume(two, body, [10, 0, 0], {mask: 1}));
  // The pole is first; skip it with a body above it and confirm the tie between a and b goes to the lower id.
  assert.equal(hitOf(r1).id, 'pole');
  const above = {kind: 'sphere' as const, center: [-1, 3, 0] as const, radius: 0.5};
  const tie = hitOf(sweepVolume(one, above, [10, -3, 0], {mask: 1}));
  assert.equal(tie.id, 'a');
  assert.equal(hitOf(sweepVolume(one, above, [10, -3, 0], {mask: 2})).id, 'ghost');
  const inside = sweepVolume(one, {kind: 'sphere', center: [5, 0, 0], radius: 0.1}, [1, 0, 0], {maxResults: 1});
  assert.deepEqual(inside, {
    status: 'start-overlap',
    revision: 1,
    fraction: 0,
    ids: ['a'],
    truncated: true,
    evaluations: 2,
  });
  const overlap = overlapVolume(one, {kind: 'sphere', center: [5, 0, 0], radius: 0.1});
  assert.deepEqual(overlap.ids, ['a', 'b']);
  assert.ok(Object.isFrozen(overlap) && Object.isFrozen(overlap.ids));
});

test('work is bounded: exhausted budgets and iterations never claim clear', () => {
  const colliders: VolumeCollider[] = Array.from({length: 8}, (_, i) => ({
    id: `s${i}`,
    kind: 'sphere',
    center: [2 + i, 0, 0],
    radius: 0.25,
  }));
  const set = defineVolumeSet({revision: 0, maxColliders: 8, colliders});
  const body = {kind: 'sphere' as const, center: [0, 0, 0] as const, radius: 0.25};
  assert.deepEqual(sweepVolume(set, body, [20, 0, 0], {maxEvaluations: 1}), {
    status: 'over-budget',
    revision: 0,
    fraction: 0,
    evaluations: 1,
  });
  assert.equal(
    overlapVolume(set, {...body, center: [5.5, 0, 0], radius: 0.5}, {maxEvaluations: 1}).status,
    'over-budget',
  );
  const capped = sweepVolume(set, body, [20, 0, 0], {maxIterations: 1});
  assert.equal(capped.status, 'unresolved');
  assert.equal(capped.fraction, 0);
  const full = hitOf(sweepVolume(set, body, [20, 0, 0]));
  assert.equal(full.id, 's0');
  assert.ok(full.evaluations <= 8 * 32);
  // Colliders outside the swept bounds cost nothing.
  assert.equal(sweepVolume(set, body, [0, 5, 0]).evaluations, 0);
  // A grazing pass converges slowly near tangency; the cap reports a proven prefix instead of clear.
  const graze = defineVolumeSet({
    revision: 0,
    maxColliders: 1,
    colliders: [{id: 'g', kind: 'sphere', center: [5, 1.00001, 0], radius: 0.5}],
  });
  const g = sweepVolume(graze, {kind: 'sphere', center: [0, 0, 0], radius: 0.5}, [10, 0, 0], {maxIterations: 3});
  assert.ok(g.status === 'unresolved' || g.status === 'clear');
  if (g.status === 'unresolved') assert.ok(g.fraction > 0 && g.fraction < 0.5);
});

test('snapshots are validated, bounded, detached from caller arrays and unforgeable', () => {
  const centre: [number, number, number] = [0, 0, 0];
  const set = defineVolumeSet({
    revision: 0,
    maxColliders: 1,
    colliders: [{id: 'x', kind: 'sphere', center: centre, radius: 1}],
  });
  centre[0] = 100;
  assert.equal(overlapVolume(set, {kind: 'sphere', center: [0, 0, 0], radius: 0.5}).status, 'overlap');
  assert.ok(Object.isFrozen(set));
  const forged = {revision: 0, size: 1, maxColliders: 1} as VolumeSet;
  assert.throws(() => overlapVolume(forged, {kind: 'sphere', center: [0, 0, 0], radius: 1}), RangeError);
  const bad: unknown[] = [
    {revision: 0, maxColliders: 1, colliders: [floor, {...floor, id: 'f2'}]},
    {revision: 0, colliders: []},
    {revision: 0, maxColliders: VOLUME_MAX_COLLIDERS + 1, colliders: []},
    {revision: -1, maxColliders: 1, colliders: []},
    {revision: 0, maxColliders: 2, colliders: [floor, floor]},
    {revision: 0, maxColliders: 1, colliders: [{...floor, center: [0, NaN, 0]}]},
    {revision: 0, maxColliders: 1, colliders: [{...floor, center: [0, 2e6, 0]}]},
    {revision: 0, maxColliders: 1, colliders: [{...floor, halfExtents: [1, 0, 1]}]},
    {revision: 0, maxColliders: 1, colliders: [{...floor, rotation: [0, 0, 0, 2]}]},
    {revision: 0, maxColliders: 1, colliders: [{...floor, id: ''}]},
    {revision: 0, maxColliders: 1, colliders: [{...floor, id: 7}]},
    {revision: 0, maxColliders: 1, colliders: [{...floor, mask: -1}]},
    {revision: 0, maxColliders: 1, colliders: [{id: 'c', kind: 'cone', center: [0, 0, 0], radius: 1}]},
    {revision: 0, maxColliders: 1, colliders: [{id: 's', kind: 'sphere', center: [0, 0, 0], radius: 0}]},
  ];
  for (const input of bad) assert.throws(() => defineVolumeSet(input as never), RangeError, JSON.stringify(input));
  const ok = defineVolumeSet({revision: 0, maxColliders: 1, colliders: [floor]});
  const body = {kind: 'sphere' as const, center: [0, 1, 0] as const, radius: 0.5};
  for (const o of [
    {margin: -1},
    {tolerance: 0},
    {maxEvaluations: 0},
    {maxIterations: 257},
    {mask: 2 ** 32},
    {maxResults: 0},
  ])
    assert.throws(() => sweepVolume(ok, body, [1, 0, 0], o), RangeError, JSON.stringify(o));
  assert.throws(() => sweepVolume(ok, {...body, radius: 0}, [1, 0, 0]), RangeError);
  assert.throws(() => sweepVolume(ok, body, [Infinity, 0, 0]), RangeError);
  assert.throws(() => headroom(ok, body as never, [0, 1, 0]), RangeError);
});

test('headroom finds room above a crouched capsule, including an off-axis ledge a centre ray misses', () => {
  const crouched = {kind: 'capsule' as const, a: [0, 0.3, 0] as const, b: [0, 0.7, 0] as const, radius: 0.3};
  const ceiling = defineVolumeSet({
    revision: 0,
    maxColliders: 2,
    colliders: [floor, {id: 'ceiling', kind: 'box', center: [0, 2.1, 0], halfExtents: [5, 0.5, 5]}],
  });
  // Room for b to rise from 0.7 to 1.3 (top 1.6, the ceiling's underside) of the 0.9 requested.
  const limited = hitOf(headroom(ceiling, crouched, [0, 0.9, 0]));
  assert.equal(limited.id, 'ceiling');
  assert.ok(Math.abs(limited.fraction - 0.6 / 0.9) < 1e-9);
  assert.equal(headroom(ceiling, crouched, [0, 0.5, 0]).status, 'clear');
  const ledge = defineVolumeSet({
    revision: 4,
    maxColliders: 2,
    colliders: [floor, {id: 'ledge', kind: 'box', center: [0.25, 1.3, 0], halfExtents: [0.02, 0.02, 1]}],
  });
  const centreRay = sweepVolume(ledge, {kind: 'sphere', center: [0, 1, 0], radius: 1e-6}, [0, 1, 0]);
  assert.equal(centreRay.status, 'clear');
  const blocked = hitOf(headroom(ledge, crouched, [0, 0.9, 0]));
  assert.equal(blocked.id, 'ledge');
  assert.ok(blocked.fraction < 0.5);
  const stuck = headroom(ceiling, {...crouched, b: [0, 1.5, 0]}, [0, 0.2, 0]);
  assert.equal(stuck.status, 'start-overlap');
  assert.equal(headroom(ceiling, crouched, [0, 0.9, 0], {maxEvaluations: 1}).status, 'over-budget');
});

test('near-parallel capsules cannot hide penetration, and headroom refuses sideways rise and rereads', () => {
  const rail = defineVolumeSet({
    revision: 0,
    maxColliders: 1,
    colliders: [{id: 'rail', kind: 'capsule', a: [-10, 0, 0], b: [200, 0, 0], radius: 0.1}],
  });
  const body = {kind: 'capsule' as const, a: [0, 0.50002, 0] as const, b: [100, 0.49997, 0] as const, radius: 0.3};
  const r = hitOf(sweepVolume(rail, body, [0, -0.1, 0]));
  assert.ok(Math.abs(r.fraction - 0.9997) < 1e-5, String(r.fraction));
  assert.equal(overlapVolume(rail, {...body, a: [0, 0.40002, 0], b: [100, 0.39997, 0]}).status, 'overlap');
  const set = defineVolumeSet({
    revision: 0,
    maxColliders: 1,
    colliders: [{id: 'knob', kind: 'sphere', center: [1, 0.5, 0], radius: 0.1}],
  });
  const upright = {kind: 'capsule' as const, a: [0, 0, 0] as const, b: [0, 1, 0] as const, radius: 0.2};
  assert.throws(() => headroom(set, upright, [2, 0, 0]), RangeError);
  assert.throws(() => headroom(set, upright, [0, 1, 0], null as never), RangeError);
  // Accessors are read once: a getter cannot widen the budget or move the body between the two inner queries.
  let reads = 0;
  const options = {
    get maxEvaluations() {
      return reads++ ? 1 << 20 : 1;
    },
  };
  const many = defineVolumeSet({
    revision: 0,
    maxColliders: 64,
    colliders: Array.from({length: 64}, (_, i) => ({
      id: `p${i}`,
      kind: 'sphere' as const,
      center: [0, 1.5 + i * 0.01, 0] as const,
      radius: 0.001,
    })),
  });
  const res = headroom(many, upright, [0, 1, 0], options);
  assert.equal(res.status, 'over-budget');
  assert.ok(res.evaluations <= 1);
  assert.equal(reads, 1);
});
