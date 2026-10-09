import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createClock} from '../../src/core/clock.ts';
import {World, component} from '../../src/core/ecs/world.ts';
import {createTargetAdapter, TargetState} from './adapters.mjs';
import {createActionController} from './controller.mjs';

const Transform = component('queued-target-position', {x: 2, y: 0, z: 0, scale: 1});
function scene() {
  const world = new World(),
    entity = world.spawn(Transform(), TargetState()),
    targets = createTargetAdapter({world, Transform});
  assert.equal(targets.bind('target', entity).status, 'bound');
  const controller = createActionController({targets});
  return {world, entity, targets, controller};
}
const admit = (controller, id, readyAt) => controller.admit({id, target: 'target', amount: 2, readyAt, expiresAt: 10});
function retire(s) {
  s.controller.dispose();
  s.targets.dispose();
  s.world.despawn(s.entity);
}

test('paused queued delivery validates the captured native target after resume', () => {
  const {clock, driver} = createClock({realNow: () => 0, state: {ut: 0, lastRealMs: null}}),
    s = scene(),
    lifetime = new AbortController(),
    results = [];
  try {
    assert.equal(admit(s.controller, 'queued', 0.5).status, 'admitted');
    clock.schedule(
      0.5,
      () => {
        s.controller.advance(clock.ut);
        results.push(s.controller.resolve('queued'));
      },
      lifetime.signal,
    );
    clock.pause('selection');
    for (let i = 0; i < 8; i++) driver.advance(0.25);
    assert.equal(clock.ut, 0);
    assert.deepEqual(results, []);
    assert.deepEqual(s.controller.read().accepted, {resources: {}, receipts: []});

    // Same entity and authored label, but a replaced eligibility component.
    s.world.add(s.entity, TargetState());
    clock.resume('selection');
    driver.advance(0.25);
    assert.deepEqual(results, []);
    driver.advance(0.25);
    assert.deepEqual(results, [{status: 'refused', reason: 'stale'}]);
    assert.deepEqual(s.controller.read().accepted, {resources: {}, receipts: []});

    // A fresh capture can succeed; a stale refusal did not globally disable delivery.
    assert.equal(admit(s.controller, 'fresh', clock.ut).status, 'admitted');
    assert.equal(s.controller.resolve('fresh').status, 'accepted');
    assert.equal(s.controller.read().accepted.resources.target, 2);
    assert.deepEqual(
      s.controller.read().accepted.receipts.map(row => row.id),
      ['fresh'],
    );
  } finally {
    lifetime.abort();
    retire(s);
  }
  assert.equal(s.world.count, 0);
});

test('retiring a scene cancels queued work without reviving names in its replacement', () => {
  const {clock, driver} = createClock({realNow: () => 0, state: {ut: 0, lastRealMs: null}}),
    old = scene(),
    oldLifetime = new AbortController(),
    calls = [];
  let replacement;
  const deliverOld = id => {
    calls.push(id);
    old.controller.advance(clock.ut);
    return old.controller.resolve(id);
  };
  try {
    for (const [id, time] of [
      ['accepted', 0.25],
      ['queued', 0.5],
    ])
      assert.equal(admit(old.controller, id, time).status, 'admitted');
    clock.schedule(0.25, () => deliverOld('accepted'), oldLifetime.signal);
    const retained = () => deliverOld('queued');
    clock.schedule(0.5, retained, oldLifetime.signal);
    driver.advance(0.25);
    assert.deepEqual(calls, ['accepted']);
    assert.equal(old.controller.read().accepted.resources.target, 2);

    oldLifetime.abort();
    retire(old);
    replacement = scene();
    assert.equal(admit(replacement.controller, 'queued', 0.5).status, 'admitted');
    clock.schedule(0.5, () => {
      replacement.controller.advance(clock.ut);
      assert.equal(replacement.controller.resolve('queued').status, 'accepted');
    });
    driver.advance(0.25);
    assert.deepEqual(calls, ['accepted']); // The clock removed the aborted callback.
    assert.equal(retained().reason, 'retired'); // Retained delivery also lacks authority.
    assert.equal(old.controller.read().accepted.resources.target, 2);
    assert.deepEqual(
      old.controller.read().accepted.receipts.map(row => row.id),
      ['accepted'],
    );
    assert.deepEqual(
      old.controller.read().actions.map(row => row.state),
      ['completed', 'cancelled'],
    );
    assert.equal(replacement.controller.read().accepted.resources.target, 2);
    assert.deepEqual(
      replacement.controller.read().accepted.receipts.map(row => row.id),
      ['queued'],
    );
    assert.equal(replacement.controller.resolve('queued').status, 'duplicate');
    assert.equal(replacement.controller.read().accepted.resources.target, 2);
  } finally {
    oldLifetime.abort();
    retire(old);
    if (replacement) retire(replacement);
  }
  assert.equal(old.world.count, 0);
  assert.equal(replacement.world.count, 0);
});
