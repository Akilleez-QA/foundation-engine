import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createUpdateTiers} from './index';
import {World} from '../../core/ecs/world';
import {createSystemRunner} from '../../core/ecs/systems';
import {Transform} from '../../author';

test('always runs every step, near freezes when far, background round-robins with its accumulated time', () => {
  const tiers = createUpdateTiers({nearRadius: 10, farRadius: 12, slots: 3});
  const pos = new Map([
    [1, {x: 0, z: 0}],
    [2, {x: 100, z: 0}],
    [3, {x: 100, z: 0}],
    [4, {x: 100, z: 0}],
  ]);
  tiers.track(1, 'near');
  tiers.track(2, 'near');
  tiers.track(3, 'background');
  tiers.track(4, 'always');
  const seen = {3: 0, 2: 0};
  for (let i = 0; i < 7; i++) {
    tiers.step(0.1, id => pos.get(id) ?? null, [{x: 0, z: 0}]);
    assert.equal(tiers.due(1), 0.1);
    assert.equal(tiers.due(4), 0.1);
    seen[2] += tiers.due(2);
    seen[3] += tiers.due(3);
  }
  assert.equal(seen[2], 0, 'a far near-policy entity is frozen');
  assert.ok(Math.abs(seen[3] - 0.7) < 1e-12, 'background time is conserved: slots 0, 3 and 6 delivered 7 steps');
  assert.equal(tiers.due(99), 0.1, 'untracked entities get the full step');
});

test('hysteresis keeps an entity near until the far radius; returning near delivers owed time; large steps are refused', () => {
  const tiers = createUpdateTiers({nearRadius: 10, farRadius: 15, slots: 4, maxCatchUp: 0.5});
  let x = 9;
  tiers.track(7, 'background');
  tiers.step(0.1, () => ({x, z: 0}), [{x: 0, z: 0}]);
  assert.equal(tiers.due(7), 0.1);
  x = 14;
  tiers.step(0.1, () => ({x, z: 0}), [{x: 0, z: 0}]);
  assert.equal(tiers.due(7), 0.1, 'still near inside the far radius');
  x = 50;
  // Steps 2 and 3 are not slot 0: time is owed.
  for (let i = 0; i < 2; i++) tiers.step(0.1, () => ({x, z: 0}), [{x: 0, z: 0}]);
  assert.equal(tiers.due(7), 0);
  x = 0;
  tiers.step(0.1, () => ({x, z: 0}), [{x: 0, z: 0}]);
  assert.ok(Math.abs(tiers.due(7) - 0.3) < 1e-12, 'returning near delivers owed time with the step');
  assert.throws(() => tiers.step(0.2, () => null, []), /maxCatchUp/);
});

test('a throwing position callback leaves the tiers unchanged', () => {
  const tiers = createUpdateTiers({nearRadius: 1, slots: 1});
  tiers.track(1, 'background');
  tiers.track(2, 'background');
  tiers.step(0.1, () => null, []);
  const before = tiers.stats();
  assert.throws(() =>
    tiers.step(
      0.1,
      id => {
        if (id === 2) throw Error('no position');
        return null;
      },
      [],
    ),
  );
  assert.deepEqual(tiers.stats(), before);
  assert.equal(tiers.due(2), 0.1);
});

test('slots balance on track and untrack, limits are enforced, invalid input refused', () => {
  const tiers = createUpdateTiers({nearRadius: 1, slots: 2, maxTracked: 3});
  assert.equal(tiers.track(1, 'background'), 'tracked');
  assert.equal(tiers.track(1, 'near'), 'duplicate');
  tiers.track(2, 'background');
  tiers.track(3, 'background');
  assert.equal(tiers.track(4, 'always'), 'full');
  let ran = 0;
  for (let i = 0; i < 2; i++) {
    tiers.step(0.5, () => null, []);
    ran += [1, 2, 3].filter(id => tiers.due(id) > 0).length;
  }
  assert.equal(ran, 3, 'each background entity ran once per two-slot cycle');
  assert.equal(tiers.untrack(2), true);
  assert.equal(tiers.untrack(2), false);
  assert.throws(() => createUpdateTiers({nearRadius: 0}), RangeError);
  assert.throws(() => createUpdateTiers({nearRadius: 5, farRadius: 4}), RangeError);
  assert.throws(() => createUpdateTiers({nearRadius: 5, slots: 65}), RangeError);
  assert.throws(() => tiers.step(Number.NaN, () => null, []), RangeError);
  assert.throws(() => tiers.step(0.5, () => ({x: Number.NaN, z: 0}), [{x: 0, z: 0}]), RangeError);
  assert.throws(() => tiers.track(-1, 'near'), RangeError);
});

test('a fixed-step ECS system integrates only due entities and keeps background distance travelled exact', () => {
  const world = new World();
  const tiers = createUpdateTiers({nearRadius: 5, slots: 4});
  const near = world.spawn(Transform({x: 0})),
    far = world.spawn(Transform({x: 100})),
    sleeper = world.spawn(Transform({x: 100}));
  tiers.track(near, 'near');
  tiers.track(far, 'background');
  tiers.track(sleeper, 'near');
  const speed = 2;
  const runner = createSystemRunner(
    [
      {
        id: 'population-tiers',
        run(_ctx: null, dt: number) {
          tiers.step(
            dt,
            id => {
              const t = world.get(id, Transform);
              return t ? {x: t.x, z: t.z} : null;
            },
            [{x: 0, z: 0}],
          );
        },
      },
      {
        id: 'drift',
        run() {
          for (const [e, t] of world.query(Transform)) t.z += speed * tiers.due(e);
        },
      },
    ],
    {step: 1 / 60, maxSteps: 1000},
  );
  runner.frame(null, 1); // 60 fixed steps
  assert.ok(Math.abs(world.get(near, Transform)!.z - 2) < 1e-9);
  // 60 steps across 4 slots: 15 updates delivered the time of the first 57 steps; 3 steps are still owed.
  assert.ok(Math.abs(world.get(far, Transform)!.z - (2 * 57) / 60) < 1e-9);
  assert.equal(world.get(sleeper, Transform)!.z, 0);
});
