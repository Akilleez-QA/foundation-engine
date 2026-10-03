import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mulberry32} from '../../core/rng';
import {
  createInterestResult,
  createInterestSets,
  createSpatialGrid,
  INTEREST_CEILING,
  type GridLimits,
  type InterestLimits,
  type InterestResult,
} from './index';

const gridLimits: GridLimits = {
  cellSize: 10,
  minX: 0,
  minY: 0,
  maxX: 200,
  maxY: 200,
  maxEntries: 512,
  maxCells: 400,
  maxCellsPerQuery: 49,
};
const interestLimits: InterestLimits = {
  enterRadius: 20,
  exitRadius: 25,
  holdUpdates: 0,
  maxObservers: 4,
  maxRelevant: 8,
  maxCandidates: 256,
  maxPrioritized: 16,
};
function setup(o: Partial<InterestLimits> = {}, g: Partial<GridLimits> = {}) {
  const grid = createSpatialGrid({...gridLimits, ...g});
  const limits = {...interestLimits, ...o};
  return {grid, sets: createInterestSets(grid, limits), out: createInterestResult(limits)};
}
const list = (b: Float64Array, n: number) => [...b.subarray(0, n)];
const view = (r: InterestResult) => ({
  status: r.status,
  relevant: list(r.relevant, r.relevantCount),
  entered: list(r.entered, r.enteredCount),
  left: list(r.left, r.leftCount),
  dropped: r.dropped,
});

test('limits are validated, copied and frozen; the exit scan must fit the grid cell bound', () => {
  const grid = createSpatialGrid(gridLimits);
  for (const bad of [
    {enterRadius: -1},
    {enterRadius: NaN},
    {exitRadius: 19},
    {exitRadius: Infinity},
    {holdUpdates: -1},
    {holdUpdates: 1.5},
    {holdUpdates: INTEREST_CEILING.holdUpdates + 1},
    {maxObservers: 0},
    {maxRelevant: 0},
    {maxObservers: 1 << 12, maxRelevant: 1 << 11},
    {maxCandidates: 0},
    {maxCandidates: INTEREST_CEILING.maxCandidates + 1},
    {maxPrioritized: 0},
    {exitRadius: 30}, // floor(60 / 10) + 2 = 8 -> 64 cells > 49
    {exitRadius: 1e200}, // square not finite
  ] as Partial<InterestLimits>[])
    assert.throws(() => createInterestSets(grid, {...interestLimits, ...bad}), RangeError, JSON.stringify(bad));
  assert.throws(() => createInterestSets(grid, {...interestLimits, extra: 1} as InterestLimits), TypeError);
  assert.throws(() => createInterestSets({} as never, interestLimits), TypeError);
  const input = {...interestLimits},
    sets = createInterestSets(grid, input);
  input.enterRadius = 1;
  assert.equal(sets.limits.enterRadius, 20);
  assert.ok(Object.isFrozen(sets.limits));
  assert.ok(Object.isFrozen(sets));
  assert.throws(() => createInterestResult({maxRelevant: 0}), RangeError);
});

test('malformed arguments throw without changing state; undersized or frozen results are rejected', () => {
  const {grid, sets, out} = setup();
  grid.insert(1, 50, 50);
  sets.addObserver(7, 50, 50);
  for (const f of [
    () => sets.addObserver(-1, 0, 0),
    () => sets.addObserver(8, NaN, 0),
    () => sets.addObserver(8, 0, 0, 1.5),
    () => sets.moveObserver(7, Infinity, 0),
    () => sets.removeObserver(0.5),
    () => sets.setPriority(1, 0.5),
    () => sets.setPriority(-1, 1),
    () => sets.update(7, createInterestResult({maxRelevant: 4})),
    () => sets.update(7, Object.freeze(createInterestResult(interestLimits))),
    () => sets.update(7, {...out, relevant: new Uint32Array(8)} as never),
    () => sets.members(7, new Int32Array(4) as never),
  ])
    assert.throws(f);
  assert.deepEqual(sets.stats, {observers: 1, prioritized: 0, closed: false});
  assert.deepEqual(view(sets.update(7, out)), {status: 'complete', relevant: [1], entered: [1], left: [], dropped: 0});
});

test('hysteresis: enter inside enterRadius, stay until beyond exitRadius, re-enter only inside enterRadius', () => {
  const {grid, sets, out} = setup();
  sets.addObserver(1, 100, 100);
  grid.insert(10, 122, 100); // 22: inside exit, outside enter
  assert.deepEqual(view(sets.update(1, out)), {status: 'complete', relevant: [], entered: [], left: [], dropped: 0});
  grid.move(10, 119, 100);
  assert.deepEqual(view(sets.update(1, out)).entered, [10]);
  grid.move(10, 124, 100); // in the band: stays, no events
  assert.deepEqual(view(sets.update(1, out)), {status: 'complete', relevant: [10], entered: [], left: [], dropped: 0});
  grid.move(10, 125, 100); // exactly exitRadius: inclusive, stays
  assert.deepEqual(view(sets.update(1, out)).relevant, [10]);
  grid.move(10, 125.01, 100);
  assert.deepEqual(view(sets.update(1, out)), {status: 'complete', relevant: [], entered: [], left: [10], dropped: 0});
  grid.move(10, 121, 100); // back in the band but not inside enterRadius: stays out
  assert.deepEqual(view(sets.update(1, out)).relevant, []);
  sets.moveObserver(1, 105, 100); // the observer moves closer instead
  assert.deepEqual(view(sets.update(1, out)).entered, [10]);
});

test('holdUpdates keeps a departed member for N updates; removal from the grid leaves at once', () => {
  const {grid, sets, out} = setup({holdUpdates: 2});
  sets.addObserver(1, 100, 100);
  grid.insert(10, 100, 110);
  grid.insert(11, 100, 90);
  assert.deepEqual(view(sets.update(1, out)).entered, [10, 11]);
  grid.move(10, 100, 160);
  grid.remove(11);
  assert.deepEqual(view(sets.update(1, out)), {
    status: 'complete',
    relevant: [10],
    entered: [],
    left: [11],
    dropped: 0,
  });
  assert.deepEqual(view(sets.update(1, out)).relevant, [10], 'second held update');
  assert.deepEqual(view(sets.update(1, out)).left, [10], 'hold exhausted');
  grid.insert(11, 100, 105);
  grid.move(10, 100, 110); // seen again: the miss counter resets
  sets.update(1, out);
  grid.move(10, 100, 160);
  sets.update(1, out);
  sets.update(1, out);
  assert.deepEqual(view(sets.update(1, out)).left, [10]);
});

test('budget: ranked by tier, then distance, then id, independent of insertion order; dropped is reported', () => {
  const points: [number, number, number][] = [
    [5, 100, 101],
    [3, 101, 100],
    [9, 100, 99],
    [1, 99, 100],
    [7, 100, 110],
    [2, 100, 100],
    [8, 115, 100],
    [4, 100, 85],
    [6, 90, 100],
    [12, 100, 105],
  ];
  const run = (order: typeof points) => {
    const {grid, sets} = setup({maxRelevant: 5}),
      out = createInterestResult({maxRelevant: 5});
    for (const [id, x, y] of order) grid.insert(id, x, y);
    sets.addObserver(1, 100, 100, 2);
    sets.setPriority(8, 1);
    sets.setPriority(6, -1);
    return view(sets.update(1, out));
  };
  const expected = {status: 'over-budget', relevant: [8, 1, 3, 5, 9], entered: [8, 1, 3, 5, 9], left: [], dropped: 4};
  assert.deepEqual(run(points), expected, 'self (2) excluded; tier 1 first; tier -1 (6) last');
  assert.deepEqual(run([...points].reverse()), expected);
});

test('priority bookkeeping is bounded', () => {
  const {sets} = setup({maxPrioritized: 2});
  assert.equal(sets.setPriority(1, 5), 'set');
  assert.equal(sets.setPriority(2, -5), 'set');
  assert.equal(sets.setPriority(3, 1), 'saturated');
  assert.equal(sets.setPriority(1, 7), 'set', 'updating an existing id is allowed');
  assert.equal(sets.setPriority(2, 0), 'set');
  assert.equal(sets.stats.prioritized, 1, 'tier 0 is the default and frees the slot');
  assert.equal(sets.clearPriority(1), 'cleared');
  assert.equal(sets.clearPriority(1), 'absent');
});

test('fail closed: a truncated scan admits nothing new and drops unseen members, keeping seen ones', () => {
  const {grid, sets, out} = setup({maxCandidates: 3});
  sets.addObserver(1, 100, 100);
  grid.insert(10, 100, 101);
  grid.insert(11, 100, 102);
  assert.deepEqual(view(sets.update(1, out)).relevant, [10, 11]);
  for (let i = 0; i < 5; i++) grid.insert(20 + i, 100, 103 + i);
  const r = view(sets.update(1, out));
  assert.equal(r.status, 'incomplete');
  assert.deepEqual(r.entered, []);
  assert.ok(r.relevant.every(id => id === 10 || id === 11));
  assert.deepEqual(
    [...r.relevant, ...r.left].sort((a, b) => a - b),
    [10, 11],
    'each member is either kept (seen) or left (unseen)',
  );
});

test('a closed grid makes every member leave; observers, members() and dispose', () => {
  const {grid, sets, out} = setup({maxObservers: 2});
  assert.equal(sets.addObserver(1, 100, 100), 'added');
  assert.equal(sets.addObserver(1, 0, 0), 'duplicate');
  assert.equal(sets.addObserver(2, 0, 0), 'added');
  assert.equal(sets.addObserver(3, 0, 0), 'saturated');
  grid.insert(10, 100, 100);
  grid.insert(11, 101, 100);
  sets.update(1, out);
  const buf = [0, 0, 0];
  assert.equal(sets.members(1, buf), 2);
  assert.deepEqual(buf.slice(0, 2), [10, 11]);
  assert.equal(sets.update(9, out).status, 'absent');
  grid.dispose();
  assert.deepEqual(view(sets.update(1, out)), {
    status: 'unavailable',
    relevant: [],
    entered: [],
    left: [10, 11],
    dropped: 0,
  });
  assert.equal(sets.removeObserver(2), 'removed');
  assert.equal(sets.removeObserver(2), 'absent');
  assert.equal(sets.addObserver(3, 0, 0), 'added', 'a removed slot is reusable');
  sets.dispose();
  sets.dispose();
  assert.equal(sets.update(1, out).status, 'closed');
  assert.equal(sets.addObserver(5, 0, 0), 'closed');
  assert.equal(sets.members(1, buf), 0);
  assert.equal(sets.stats.closed, true);
});

// Independent reference model: recompute the same rules from scratch with plain arrays.
test('randomised observers and entities match a brute-force reference model, including hold and budget', () => {
  const random = mulberry32(11),
    limits: InterestLimits = {
      enterRadius: 20,
      exitRadius: 25,
      holdUpdates: 2,
      maxObservers: 3,
      maxRelevant: 6,
      maxCandidates: 512,
      maxPrioritized: 64,
    };
  const {grid, sets} = setup(limits),
    out = createInterestResult(limits);
  const pos = new Map<number, [number, number]>(),
    tier = new Map<number, number>();
  const obs = [
    [1, 100, 100, 0],
    [2, 60, 140, 5],
    [3, 150, 50, -1],
  ] as [number, number, number, number][];
  const model = new Map<number, {id: number; miss: number}[]>();
  for (const [id, x, y, own] of obs) {
    sets.addObserver(id, x, y, own < 0 ? undefined : own);
    model.set(id, []);
  }
  const coord = () => 40 + random() * 120;
  for (let step = 0; step < 3000; step++) {
    const op = random(),
      id = Math.floor(random() * 40);
    if (op < 0.3) {
      const x = coord(),
        y = coord();
      if (grid.insert(id, x, y) === 'inserted') pos.set(id, [x, y]);
    } else if (op < 0.6) {
      const x = coord(),
        y = coord();
      if (grid.move(id, x, y) === 'moved') pos.set(id, [x, y]);
    } else if (op < 0.65) {
      if (grid.remove(id) === 'removed') pos.delete(id);
    } else if (op < 0.7) {
      const t = Math.floor(random() * 3) - 1;
      sets.setPriority(id, t);
      if (t) tier.set(id, t);
      else tier.delete(id);
    } else if (op < 0.75) {
      const o = obs[Math.floor(random() * 3)]!;
      o[1] = coord();
      o[2] = coord();
      sets.moveObserver(o[0], o[1], o[2]);
    } else {
      const [oid, x, y, own] = obs[Math.floor(random() * 3)]!,
        prev = model.get(oid)!;
      const d2 = (id: number) => {
        const [px, py] = pos.get(id)!;
        return (px - x) ** 2 + (py - y) ** 2;
      };
      const qual: {id: number; miss: number}[] = [];
      for (const id of pos.keys()) {
        if (id === own) continue;
        const member = prev.find(m => m.id === id),
          d = d2(id);
        if (d <= 400 || (member && d <= 625)) qual.push({id, miss: 0});
        else if (member && member.miss + 1 <= 2) qual.push({id, miss: member.miss + 1});
      }
      qual.sort((a, b) => (tier.get(b.id) ?? 0) - (tier.get(a.id) ?? 0) || d2(a.id) - d2(b.id) || a.id - b.id);
      const next = qual.slice(0, 6);
      const r = view(sets.update(oid, out));
      assert.deepEqual(
        r.relevant,
        next.map(m => m.id),
        `step ${step}`,
      );
      assert.deepEqual(
        r.entered,
        next.filter(m => !prev.some(p => p.id === m.id)).map(m => m.id),
      );
      assert.deepEqual(
        r.left,
        prev.filter(p => !next.some(m => m.id === p.id)).map(p => p.id),
      );
      assert.equal(r.dropped, qual.length - next.length);
      assert.equal(r.status, qual.length > 6 ? 'over-budget' : 'complete');
      model.set(oid, next);
    }
  }
});
