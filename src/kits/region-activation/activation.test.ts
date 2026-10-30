import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mulberry32} from '../../core/rng';
import {
  createRegionActivation,
  createRegionUpdateResult,
  type RegionActivation,
  type RegionActivationLimits,
  type RegionUpdateResult,
} from './index';

// 10 x 10 regions of 10 units over [0, 100].
const base: RegionActivationLimits = {
  cellSize: 10,
  minX: 0,
  minY: 0,
  maxX: 100,
  maxY: 100,
  maxRegions: 100,
  activateRadius: 3,
  releaseRadius: 12,
  lingerUpdates: 2,
  maxObservers: 4,
  maxActive: 40,
  maxPins: 4,
  maxActivationsPerUpdate: 40,
  maxDeactivationsPerUpdate: 40,
  maxCellsPerObserver: 36,
};
function setup(o: Partial<RegionActivationLimits> = {}) {
  const limits = {...base, ...o};
  return {acts: createRegionActivation(limits), out: createRegionUpdateResult(limits)};
}
const activated = (r: RegionUpdateResult) => [...r.activated.subarray(0, r.activatedCount)];
const deactivated = (r: RegionUpdateResult) => [...r.deactivated.subarray(0, r.deactivatedCount)];
const actives = (a: RegionActivation) =>
  Array.from({length: a.columns * a.rows}, (_, i) => i).filter(i => a.isActive(i));

test('limits are validated before construction; unknown keys and oversized scans are refused', () => {
  assert.throws(() => createRegionActivation({...base, cellSize: 0}), RangeError);
  assert.throws(() => createRegionActivation({...base, maxX: 0}), RangeError);
  assert.throws(() => createRegionActivation({...base, maxRegions: 99}), /exceed maxRegions/);
  assert.throws(() => createRegionActivation({...base, releaseRadius: 2}), /releaseRadius/);
  assert.throws(() => createRegionActivation({...base, activateRadius: Number.NaN}), RangeError);
  assert.throws(() => createRegionActivation({...base, lingerUpdates: -1}), RangeError);
  assert.throws(() => createRegionActivation({...base, maxActive: 101}), RangeError);
  assert.throws(() => createRegionActivation({...base, maxActivationsPerUpdate: 41}), RangeError);
  assert.throws(() => createRegionActivation({...base, maxCellsPerObserver: 35}), /can touch 36/);
  assert.throws(() => createRegionActivation({...base, extra: 1} as RegionActivationLimits), /unknown limit 'extra'/);
  assert.throws(() => createRegionUpdateResult({maxActivationsPerUpdate: 0, maxDeactivationsPerUpdate: 1}), RangeError);
  const {acts, out} = setup();
  assert.throws(() => acts.addObserver(-1, 0, 0), TypeError);
  assert.throws(() => acts.addObserver(1, Number.POSITIVE_INFINITY, 0), TypeError);
  assert.throws(() => acts.pin(100), RangeError);
  assert.throws(() => acts.update(Object.freeze({...out})), TypeError);
  assert.throws(
    () => acts.update(createRegionUpdateResult({maxActivationsPerUpdate: 1, maxDeactivationsPerUpdate: 1})),
    TypeError,
  );
  assert.equal(acts.stats.observers, 0, 'refusals change nothing');
});

test('grid addressing covers the inclusive rectangle', () => {
  const {acts} = setup();
  assert.equal(acts.regionAt(0, 0), 0);
  assert.equal(acts.regionAt(100, 100), 99, 'max corner belongs to the last region');
  assert.equal(acts.regionAt(15, 25), 21);
  assert.equal(acts.regionAt(-0.1, 5), -1);
  assert.equal(acts.regionIndex(9, 9), 99);
  assert.equal(acts.regionIndex(10, 0), -1);
});

test('an observer activates nearby regions, keeps them within the release radius, then they linger and go dormant', () => {
  const {acts, out} = setup();
  assert.equal(acts.addObserver(7, 15, 15), 'added');
  acts.update(out);
  assert.equal(out.status, 'complete');
  // Point (15,15) is inside region 11; its neighbours are 5 units away, beyond activateRadius 3.
  assert.deepEqual(activated(out), [11]);
  assert.deepEqual([...out.dormantFor.subarray(0, 1)], [-1], 'never active before');
  const e0 = acts.epochOf(11);
  // Move 6 units: region 11 is still within release (12); region 12 starts at x=20, 1 unit away: activates.
  acts.moveObserver(7, 21, 15);
  acts.update(out);
  assert.deepEqual(activated(out), [12]);
  assert.equal(acts.stateOf(11), 'active');
  // Move far: both unkept; they linger for 2 updates and deactivate on the third.
  acts.moveObserver(7, 85, 85);
  acts.update(out);
  assert.deepEqual(activated(out), [88]);
  assert.equal(acts.stateOf(11), 'lingering');
  assert.equal(acts.isActive(11), true, 'lingering regions are still simulated');
  acts.update(out);
  assert.deepEqual(deactivated(out), []);
  acts.update(out);
  assert.deepEqual(deactivated(out), [11, 12]);
  assert.equal(acts.stateOf(11), 'dormant');
  assert.equal(acts.epochOf(11), e0 + 1, 'stale asynchronous work for the old activation can be refused');
});

test('dormantFor reports the dormant span; a returning observer cancels lingering without events', () => {
  const {acts, out} = setup({lingerUpdates: 3});
  acts.addObserver(1, 15, 15);
  acts.update(out); // update 1: 11 active
  acts.moveObserver(1, 85, 85);
  acts.update(out); // 2: 11 lingering (unkept 1)
  acts.moveObserver(1, 15, 15);
  acts.update(out); // 3: kept again
  assert.equal(acts.stateOf(11), 'active');
  assert.deepEqual(activated(out), []);
  assert.deepEqual(deactivated(out), []);
  acts.moveObserver(1, 85, 85);
  for (let i = 0; i < 4; i++) acts.update(out); // 4..7: deactivates at 7 (unkept 4 > 3)
  assert.deepEqual(deactivated(out), [11]);
  acts.update(out); // 8
  acts.moveObserver(1, 15, 15);
  acts.update(out); // 9
  assert.deepEqual(activated(out), [11]);
  assert.deepEqual([...out.dormantFor.subarray(0, 1)], [2]);
});

test('pins keep regions active and wake dormant ones before any observer-wanted region', () => {
  const {acts, out} = setup({maxActivationsPerUpdate: 1});
  acts.addObserver(1, 15, 15);
  const p = acts.pin(99);
  assert.equal(p.status, 'pinned');
  acts.update(out);
  assert.deepEqual(activated(out), [99], 'the pin outranks the nearer observer region');
  assert.equal(out.status, 'deferred');
  assert.equal(out.deferredActivations, 1);
  acts.update(out);
  assert.deepEqual(activated(out), [11]);
  acts.removeObserver(1);
  for (let i = 0; i < 5; i++) acts.update(out);
  assert.equal(acts.isActive(99), true, 'pinned region never lingers out');
  assert.equal(acts.isActive(11), false);
  if (p.status !== 'pinned') throw Error('unreachable');
  assert.equal(acts.unpin(p.pin), 'unpinned');
  assert.equal(acts.unpin(p.pin), 'absent', 'only the live exact pin is accepted');
  assert.equal(acts.unpin({region: 99}), 'absent');
  for (let i = 0; i < 2; i++) acts.update(out);
  assert.equal(acts.stateOf(99), 'lingering');
  acts.update(out);
  assert.deepEqual(deactivated(out), [99]);
});

test('budgets defer nearest-first activations and longest-unkept deactivations; maxActive saturates', () => {
  const {acts, out} = setup({
    activateRadius: 12,
    releaseRadius: 12,
    maxActivationsPerUpdate: 2,
    maxDeactivationsPerUpdate: 1,
    lingerUpdates: 0,
  });
  acts.addObserver(1, 45, 45); // centre of region 44; 3x3 neighbours within 12 (corner distance ~7.07)
  acts.update(out);
  assert.equal(activated(out)[0], 44, 'the containing region is nearest');
  assert.equal(out.activatedCount, 2);
  assert.equal(out.status, 'deferred');
  assert.equal(out.deferredActivations, 7);
  for (let i = 0; i < 4; i++) acts.update(out);
  assert.equal(acts.stats.active, 9);
  assert.equal(out.status, 'complete');
  acts.removeObserver(1);
  acts.update(out);
  assert.deepEqual(deactivated(out), [33]);
  assert.equal(out.deferredDeactivations, 8);
  assert.equal(out.status, 'deferred');

  const sat = setup({
    activateRadius: 12,
    releaseRadius: 12,
    maxActive: 3,
    maxActivationsPerUpdate: 3,
    maxDeactivationsPerUpdate: 3,
  });
  sat.acts.addObserver(1, 45, 45);
  sat.acts.update(sat.out);
  assert.equal(sat.out.activatedCount, 3);
  sat.acts.update(sat.out);
  assert.equal(sat.out.status, 'saturated');
  assert.equal(sat.out.activatedCount, 0);
  assert.equal(sat.out.deferredActivations, 6);
});

test('observer and pin tables are bounded; disposal is terminal and idempotent', () => {
  const {acts, out} = setup({maxObservers: 1, maxPins: 1});
  assert.equal(acts.addObserver(1, 5, 5), 'added');
  assert.equal(acts.addObserver(1, 5, 5), 'duplicate');
  assert.equal(acts.addObserver(2, 5, 5), 'saturated');
  assert.equal(acts.moveObserver(3, 5, 5), 'absent');
  assert.equal(acts.pin(0).status, 'pinned');
  assert.equal(acts.pin(1).status, 'saturated');
  acts.update(out);
  assert.equal(acts.isActive(0), true);
  acts.dispose();
  acts.dispose();
  assert.equal(acts.update(out).status, 'closed');
  assert.equal(out.update, 0);
  assert.equal(acts.isActive(0), false);
  assert.equal(acts.addObserver(5, 5, 5), 'closed');
  assert.equal(acts.pin(0).status, 'closed');
  assert.equal(acts.stats.active, 0);
});

/** Independent reference: recompute every rule by brute force over all regions and observers. */
function referenceModel(l: RegionActivationLimits) {
  const columns = Math.ceil((l.maxX - l.minX) / l.cellSize),
    rows = Math.ceil((l.maxY - l.minY) / l.cellSize),
    n = columns * rows;
  const state: ('d' | 'a' | 'l')[] = Array(n).fill('d');
  const unkept = Array(n).fill(0),
    epoch = Array(n).fill(0),
    lastOff = Array(n).fill(-1);
  const observers = new Map<number, [number, number]>();
  const pins: number[] = [];
  let updates = 0;
  const dist2 = (i: number, x: number, y: number) => {
    const c = i % columns,
      r = Math.floor(i / columns);
    const x0 = l.minX + c * l.cellSize,
      y0 = l.minY + r * l.cellSize;
    const dx = Math.max(x0 - x, 0, x - (x0 + l.cellSize)),
      dy = Math.max(y0 - y, 0, y - (y0 + l.cellSize));
    return dx * dx + dy * dy;
  };
  return {
    observers,
    pins,
    state,
    epoch,
    update() {
      updates++;
      const near = (i: number, radius: number) => {
        let best = Infinity;
        for (const [x, y] of observers.values()) {
          const d = dist2(i, x, y);
          if (d <= radius * radius && d < best) best = d;
        }
        return best;
      };
      const kept = (i: number) => pins.includes(i) || near(i, l.releaseRadius) < Infinity;
      const due: number[] = [];
      for (let i = 0; i < n; i++) {
        if (state[i] === 'd') continue;
        if (kept(i)) {
          state[i] = 'a';
          unkept[i] = 0;
          continue;
        }
        state[i] = 'l';
        if (++unkept[i] > l.lingerUpdates) due.push(i);
      }
      due.sort((a, b) => unkept[b] - unkept[a] || a - b); // longest unkept first
      const off = due.slice(0, l.maxDeactivationsPerUpdate);
      for (const i of off) {
        state[i] = 'd';
        unkept[i] = 0;
        epoch[i]++;
        lastOff[i] = updates;
      }
      const wanted: [number, number][] = [];
      for (let i = 0; i < n; i++) {
        if (state[i] !== 'd' || off.includes(i)) continue;
        const d = pins.includes(i) ? -1 : near(i, l.activateRadius);
        if (d < Infinity) wanted.push([d, i]);
      }
      wanted.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const active = state.filter(s => s !== 'd').length;
      const on = wanted.slice(0, Math.max(0, Math.min(l.maxActivationsPerUpdate, l.maxActive - active)));
      const dormantFor = on.map(([, i]) => (lastOff[i] < 0 ? -1 : updates - lastOff[i]));
      for (const [, i] of on) {
        state[i] = 'a';
        unkept[i] = 0;
        epoch[i]++;
      }
      const room = l.maxActive - active;
      const status =
        wanted.length > on.length && room < Math.min(l.maxActivationsPerUpdate, wanted.length)
          ? 'saturated'
          : wanted.length > on.length || due.length > off.length
            ? 'deferred'
            : 'complete';
      return {
        on: on.map(([, i]) => i),
        off,
        dormantFor,
        deferredOn: wanted.length - on.length,
        deferredOff: due.length - off.length,
        status,
      };
    },
  };
}

test('a 3,000-step randomised run matches an independent brute-force model', () => {
  const limits: RegionActivationLimits = {
    ...base,
    activateRadius: 7,
    releaseRadius: 14,
    lingerUpdates: 3,
    maxObservers: 5,
    maxActive: 30,
    maxPins: 3,
    maxActivationsPerUpdate: 4,
    maxDeactivationsPerUpdate: 3,
    maxCellsPerObserver: 36,
  };
  const acts = createRegionActivation(limits),
    out = createRegionUpdateResult(limits),
    ref = referenceModel(limits);
  const rand = mulberry32(20261009);
  const livePins: {pin: import('./index').RegionPin; region: number}[] = [];
  const coord = () => Math.round(rand() * 1040 - 20) / 10; // includes off-grid and exact edges
  for (let step = 0; step < 3000; step++) {
    const op = rand();
    const id = Math.floor(rand() * 7);
    if (op < 0.15) {
      const x = coord(),
        y = coord();
      const r = acts.addObserver(id, x, y);
      if (r === 'added') ref.observers.set(id, [x, y]);
      else assert.equal(r, ref.observers.has(id) ? 'duplicate' : 'saturated');
    } else if (op < 0.45) {
      const x = coord(),
        y = coord();
      const r = acts.moveObserver(id, x, y);
      assert.equal(r, ref.observers.has(id) ? 'moved' : 'absent');
      if (r === 'moved') ref.observers.set(id, [x, y]);
    } else if (op < 0.55) {
      assert.equal(acts.removeObserver(id), ref.observers.delete(id) ? 'removed' : 'absent');
    } else if (op < 0.6) {
      const region = Math.floor(rand() * 100);
      const r = acts.pin(region);
      if (r.status === 'pinned') {
        livePins.push({pin: r.pin, region});
        ref.pins.push(region);
      } else assert.equal(livePins.length, limits.maxPins);
    } else if (op < 0.65 && livePins.length) {
      const k = Math.floor(rand() * livePins.length);
      const [p] = livePins.splice(k, 1);
      assert.equal(acts.unpin(p!.pin), 'unpinned');
      ref.pins.splice(ref.pins.indexOf(p!.region), 1);
    } else {
      acts.update(out);
      const want = ref.update();
      assert.deepEqual(activated(out), want.on, `activations at step ${step}`);
      assert.deepEqual(deactivated(out), want.off, `deactivations at step ${step}`);
      assert.deepEqual([...out.dormantFor.subarray(0, out.activatedCount)], want.dormantFor);
      assert.equal(out.deferredActivations, want.deferredOn);
      assert.equal(out.deferredDeactivations, want.deferredOff);
      assert.equal(out.status, want.status, `status at step ${step}`);
      assert.equal(acts.stats.active, ref.state.filter(x => x !== 'd').length);
      assert.equal(acts.stats.lingering, ref.state.filter(x => x === 'l').length);
      for (let i = 0; i < 100; i++) {
        const s = ref.state[i];
        assert.equal(
          acts.stateOf(i),
          s === 'a' ? 'active' : s === 'l' ? 'lingering' : 'dormant',
          `region ${i} at ${step}`,
        );
        assert.equal(acts.epochOf(i), ref.epoch[i]);
      }
    }
  }
  assert.ok(actives(acts).length <= limits.maxActive);
});

test('off-grid positions are "no region": gating queries do not throw', () => {
  const {acts, out} = setup();
  acts.addObserver(1, 150, -40); // far off-grid
  acts.update(out);
  assert.equal(out.activatedCount, 0);
  const r = acts.regionAt(150, 5);
  assert.equal(r, -1);
  assert.equal(acts.isActive(r), false);
  assert.equal(acts.stateOf(r), 'dormant');
  assert.equal(acts.epochOf(r), -1);
  assert.throws(() => acts.isActive(-2), RangeError);
});

test('the grid extent covers the last partial column; enumeration and aliasing guard', () => {
  const l = {...base, maxX: 95, maxY: 95};
  const acts = createRegionActivation(l),
    out = createRegionUpdateResult(l);
  assert.equal(acts.regionAt(99, 50), 59, 'inside the last column even though x > maxX');
  assert.equal(acts.regionAt(100.5, 50), -1);
  acts.addObserver(1, 99, 55);
  acts.update(out);
  const list = new Int32Array(8);
  const n = acts.activeRegions(list);
  assert.deepEqual(
    [...list.subarray(0, n)].sort((a, b) => a - b),
    activated(out).sort((a, b) => a - b),
  );
  const shared = createRegionUpdateResult(l);
  const aliased = {...shared, deactivated: shared.activated};
  assert.throws(() => acts.update(aliased), /must not share memory/);
  assert.throws(() => Reflect.apply(acts.activeRegions, acts, [[]]), TypeError);
});

test('non-dyadic geometry at exact radius boundaries matches the exact distance rule', () => {
  const rand = mulberry32(7);
  for (let trial = 0; trial < 2000; trial++) {
    const cellSize = [0.7, 1.1, 0.3, 3.3][trial % 4]!,
      minX = Math.round((rand() * 200 - 100) * 10) / 10,
      minY = Math.round((rand() * 200 - 100) * 10) / 10;
    const radius = [0, cellSize, 2 * cellSize, 1.4][Math.floor(rand() * 4)]!;
    const l: RegionActivationLimits = {
      ...base,
      cellSize,
      minX,
      minY,
      maxX: minX + cellSize * 8,
      maxY: minY + cellSize * 8,
      maxRegions: 100,
      activateRadius: radius,
      releaseRadius: radius,
      maxActive: 1,
      maxActivationsPerUpdate: 1,
      maxDeactivationsPerUpdate: 1,
      maxCellsPerObserver: 100,
    };
    // Size the budgets to the grid (8 or 9 regions per axis, depending on rounding) so nothing is deferred.
    const probe = createRegionActivation(l),
      all = probe.columns * probe.rows;
    Object.assign(l, {maxActive: all, maxActivationsPerUpdate: all, maxDeactivationsPerUpdate: all});
    const acts = createRegionActivation(l),
      out = createRegionUpdateResult(l);
    const c = Math.floor(rand() * 8),
      r = Math.floor(rand() * 8);
    // Observer exactly a radius outside a region edge (plus a random offset along the edge).
    const x = minX + c * cellSize + (rand() < 0.5 ? -radius : cellSize + radius),
      y = minY + r * cellSize + rand() * cellSize;
    acts.addObserver(1, x, y);
    acts.update(out);
    const want: number[] = [];
    for (let i = 0; i < acts.columns * acts.rows; i++) {
      const x0 = minX + (i % acts.columns) * cellSize,
        y0 = minY + Math.floor(i / acts.columns) * cellSize;
      const dx = Math.max(x0 - x, 0, x - (x0 + cellSize)),
        dy = Math.max(y0 - y, 0, y - (y0 + cellSize));
      if (dx * dx + dy * dy <= radius * radius) want.push(i);
    }
    assert.deepEqual(
      activated(out).sort((a, b) => a - b),
      want,
      `trial ${trial}`,
    );
  }
});
