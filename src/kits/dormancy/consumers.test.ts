import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createUpdateTiers} from '../population/index';
import {
  createRegionActivation,
  createRegionUpdateResult,
  type RegionActivationLimits,
} from '../region-activation/index';
import {createDormancy, dormantAsFar, type ViewVolume} from './index';

test('composition: dormancy feeds real population update tiers through dormantAsFar', () => {
  const tiers = createUpdateTiers({nearRadius: 100, slots: 2});
  const dormancy = createDormancy({maxEntities: 8, minAwakeSteps: 0});
  // All three stand within the tiers' near radius of the observer; only the view decides dormancy.
  const pos = new Map([
    [1, {x: 0, z: 10}], // in view
    [2, {x: 0, z: -30}], // behind the camera
    [3, {x: 0, z: -30}], // behind, but a background-tier entity
  ]);
  tiers.track(1, 'near');
  tiers.track(2, 'near');
  tiers.track(3, 'background');
  for (const id of [1, 2, 3]) dormancy.track(id, {policy: 'view'});
  const view: ViewVolume = {x: 0, z: 0, yaw: 0, far: 40, halfWidth: 10};
  const position = (id: number) => pos.get(id) ?? null;
  let simulated3 = 0;
  for (let t = 0; t < 5; t++) {
    dormancy.step({views: [view], position});
    tiers.step(0.1, dormantAsFar(dormancy, position), [{x: 0, z: 0}]);
    assert.ok(Math.abs(tiers.due(1) - 0.1) < 1e-12, 'awake and near: every step');
    assert.equal(tiers.due(2), 0, 'dormant reads as far: a near-tier entity is frozen');
    simulated3 += tiers.due(3);
  }
  assert.ok(Math.abs(simulated3 - 0.5) < 1e-9, 'a dormant background-tier entity keeps round-robin time, conserved');
  // Turning the camera around wakes entity 2; the tiers deliver it on that same step.
  const back: ViewVolume = {...view, yaw: Math.PI};
  const s = dormancy.step({views: [back], position});
  assert.deepEqual(s.woke, [2, 3]);
  assert.deepEqual(s.slept, [1]);
  tiers.step(0.1, dormantAsFar(dormancy, position), [{x: 0, z: 0}]);
  assert.ok(Math.abs(tiers.due(2) - 0.1) < 1e-12);
  assert.equal(tiers.due(1), 0);
});

test('composition: zones are real region-activation regions; region transitions wake and sleep their entities', () => {
  const limits: RegionActivationLimits = {
    cellSize: 32,
    minX: 0,
    minY: 0,
    maxX: 128,
    maxY: 32,
    maxRegions: 4,
    activateRadius: 0,
    releaseRadius: 0,
    lingerUpdates: 0,
    maxObservers: 1,
    maxActive: 4,
    maxPins: 1,
    maxActivationsPerUpdate: 4,
    maxDeactivationsPerUpdate: 4,
    maxCellsPerObserver: 16,
  };
  const regions = createRegionActivation(limits);
  const out = createRegionUpdateResult(limits);
  const active = new Int32Array(limits.maxActive);
  const dormancy = createDormancy({zones: regions.stats.regions, maxEntities: 16, minAwakeSteps: 0});
  // Two entities per 32-unit region along x; their zone is the region containing them.
  const entityX = new Map<number, number>();
  for (let id = 0; id < 8; id++) {
    const x = 8 + id * 16;
    entityX.set(id, x);
    dormancy.track(id, {policy: 'zone', zones: [regions.regionAt(x, 16)]});
  }
  regions.addObserver(1, 16, 16);
  const tick = (x: number) => {
    regions.moveObserver(1, x, 16);
    regions.update(out);
    const n = regions.activeRegions(active);
    return dormancy.step({activeZones: active.subarray(0, n)});
  };
  assert.deepEqual(tick(16).woke, [0, 1], 'region 0 active');
  // Standing on the edge between regions 0 and 1 keeps both active (distance 0 to each rectangle).
  const edge = tick(32);
  assert.deepEqual(edge.woke, [2, 3]);
  assert.deepEqual(edge.slept, []);
  const r2 = tick(80);
  assert.deepEqual(r2.slept, [0, 1, 2, 3]);
  assert.deepEqual(r2.woke, [4, 5]);
  regions.removeObserver(1);
  const none = tick(80);
  assert.deepEqual(none.slept, [4, 5]);
  assert.equal(none.awake, 0);
  // A region pin (a scripted keep-alive) keeps its entities awake without an observer.
  const pinned = regions.pin(regions.regionAt(120, 16));
  assert.equal(pinned.status, 'pinned');
  assert.deepEqual(tick(0).woke, [6, 7]);
  assert.ok(entityX.size === 8);
});
