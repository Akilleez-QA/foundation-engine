import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defineComponent, defineScene, defineSystem, testScene, Transform} from '../../author';
import {mulberry32} from '../../core/rng';
import {createQueryResult, createSpatialGrid, spatial, GRID_CEILING, type GridLimits, type SpatialGrid} from './index';

const base: GridLimits = {
  cellSize: 10,
  minX: 0,
  minY: 0,
  maxX: 100,
  maxY: 100,
  maxEntries: 64,
  maxCells: 100,
  maxCellsPerQuery: 100,
};
const grid = (o: Partial<GridLimits> = {}) => createSpatialGrid({...base, ...o});
const ids = (out: Float64Array, count: number) => [...out.subarray(0, count)].sort((a, b) => a - b);

test('spatial kit: registration declares no dependencies, systems or definitions', () => {
  const kit = spatial();
  assert.deepEqual(
    {id: kit.id, requires: kit.requires, defs: kit.defs, modules: kit.modules},
    {id: 'spatial', requires: [], defs: [], modules: []},
  );
});

test('limits are validated, copied and frozen before any allocation', () => {
  for (const bad of [
    {cellSize: 0},
    {cellSize: -1},
    {cellSize: NaN},
    {cellSize: Infinity},
    {minX: 100},
    {maxY: 0},
    {minY: NaN},
    {maxX: Infinity},
    {maxEntries: 0},
    {maxEntries: 1.5},
    {maxEntries: GRID_CEILING.maxEntries + 1},
    {maxCells: 0},
    {maxCells: GRID_CEILING.maxCells + 1},
    {maxCells: 99},
    {maxCellsPerQuery: 0},
    {maxCellsPerQuery: -3},
  ] as Partial<GridLimits>[])
    assert.throws(() => grid(bad), RangeError, JSON.stringify(bad));
  assert.throws(() => createSpatialGrid({...base, extra: 1} as GridLimits), TypeError);
  assert.throws(() => createSpatialGrid(null as unknown as GridLimits), TypeError);
  // A tiny cell over a huge rectangle is refused by maxCells instead of allocating.
  assert.throws(() => grid({cellSize: 1e-9, maxCells: GRID_CEILING.maxCells}), RangeError);
  const input = {...base};
  const g = createSpatialGrid(input);
  input.cellSize = 1;
  assert.equal(g.limits.cellSize, 10);
  assert.ok(Object.isFrozen(g.limits));
  assert.ok(Object.isFrozen(g));
  assert.deepEqual(g.stats, {size: 0, maxEntries: 64, columns: 10, rows: 10, revision: 0, closed: false});
});

test('malformed arguments throw without changing state; refusals are named and change nothing', () => {
  const g = grid({maxEntries: 2});
  assert.equal(g.insert(1, 5, 5), 'inserted');
  const before = g.stats;
  for (const f of [
    () => g.insert(-1, 1, 1),
    () => g.insert(1.5, 1, 1),
    () => g.insert(2, NaN, 1),
    () => g.insert(2, 1, Infinity),
    () => g.move(1, NaN, 0),
    () => g.remove(Number.MAX_SAFE_INTEGER + 1),
    () => g.queryRect(5, 0, 4, 10, new Float64Array(4)),
    () => g.queryCircle(0, 0, -1, new Float64Array(4)),
    () => g.queryCircle(0, 0, Infinity, new Float64Array(4)),
    () => g.queryNearest(0, 0, NaN, new Float64Array(4)),
    () => g.queryNearest(0, 0, 1, new Float64Array(4), -2),
    () => g.queryRect(0, 0, 1, 1, null as never),
  ])
    assert.throws(f);
  // Narrow typed arrays would wrap ids into other, real entities (70000 -> 4464 in a Uint16Array): rejected.
  for (const narrow of [new Uint16Array(4), new Int32Array(4), new Uint32Array(4), new Float32Array(4)]) {
    assert.throws(() => g.queryCircle(5, 5, 1, narrow as never), TypeError);
    assert.throws(() => g.queryNearest(5, 5, 1, narrow as never), TypeError);
  }
  assert.throws(() => g.queryRect(0, 0, 1, 1, new Float64Array(1), Object.freeze(createQueryResult())), TypeError);
  assert.deepEqual(g.stats, before);
  assert.equal(g.insert(1, 50, 50), 'duplicate');
  assert.equal(g.insert(2, -0.001, 50), 'out-of-bounds');
  assert.equal(g.insert(2, 50, 100.001), 'out-of-bounds');
  assert.equal(g.move(1, 101, 5), 'out-of-bounds');
  assert.equal(g.move(9, 5, 5), 'absent');
  assert.equal(g.remove(9), 'absent');
  assert.deepEqual(g.stats, before);
  assert.deepEqual(g.position(1), {x: 5, y: 5});
  assert.equal(g.insert(2, 100, 100), 'inserted', 'the max corner is inside');
  assert.equal(g.insert(3, 0, 0), 'saturated');
  assert.equal(g.stats.size, 2);
  assert.equal(g.remove(1), 'removed');
  assert.equal(g.insert(3, 0, 0), 'inserted', 'a released slot is reusable');
  assert.equal(g.has(1), false);
  assert.equal(g.position(1), undefined);
});

test('randomised operations match a brute-force oracle, including cell edges and corners', () => {
  const random = mulberry32(7),
    g = grid({maxEntries: 200, maxCellsPerQuery: 100}),
    live = new Map<number, [number, number]>();
  const coord = () => {
    const r = random();
    return r < 0.2 ? Math.round(random() * 10) * 10 : r < 0.25 ? 100 : random() * 100;
  };
  const out = new Float64Array(256);
  for (let step = 0; step < 4000; step++) {
    const op = random(),
      id = Math.floor(random() * 250);
    if (op < 0.4) {
      const x = coord(),
        y = coord(),
        status = g.insert(id, x, y);
      assert.equal(status, live.has(id) ? 'duplicate' : live.size >= 200 ? 'saturated' : 'inserted');
      if (status === 'inserted') live.set(id, [x, y]);
    } else if (op < 0.7) {
      const x = coord(),
        y = coord();
      assert.equal(g.move(id, x, y), live.has(id) ? 'moved' : 'absent');
      if (live.has(id)) live.set(id, [x, y]);
    } else if (op < 0.8) {
      assert.equal(g.remove(id), live.delete(id) ? 'removed' : 'absent');
    } else {
      const x = coord(),
        y = coord(),
        r = random() * 30;
      const circle = g.queryCircle(x, y, r, out);
      const expected = [...live]
        .filter(([, [px, py]]) => (px - x) ** 2 + (py - y) ** 2 <= r * r)
        .map(([i]) => i)
        .sort((a, b) => a - b);
      assert.equal(circle.status, 'complete');
      assert.deepEqual(ids(out, circle.count), expected);
      const x1 = Math.min(100, x + r),
        y1 = Math.min(100, y + r);
      const rect = g.queryRect(x, y, x1, y1, out);
      assert.deepEqual(
        ids(out, rect.count),
        [...live]
          .filter(([, [px, py]]) => px >= x && px <= x1 && py >= y && py <= y1)
          .map(([i]) => i)
          .sort((a, b) => a - b),
      );
      const near = g.queryNearest(x, y, r, out.subarray(0, 5), id);
      const nearest = [...live]
        .filter(([i]) => i !== id)
        .map(([i, [px, py]]) => [i, (px - x) ** 2 + (py - y) ** 2] as const)
        .filter(([, d]) => d <= r * r)
        .sort((a, b) => a[1] - b[1] || a[0] - b[0])
        .slice(0, 5)
        .map(([i]) => i);
      assert.deepEqual([...out.subarray(0, near.count)], nearest);
    }
    assert.equal(g.stats.size, live.size);
  }
});

test('too-wide queries are refused before any work and leave the buffer untouched', () => {
  const g = grid({maxCellsPerQuery: 4});
  g.insert(1, 5, 5);
  const out = new Float64Array([42, 42]);
  for (const r of [g.queryRect(0, 0, 25, 15, out), g.queryCircle(5, 5, 15, out), g.queryNearest(5, 5, 15, out)]) {
    assert.deepEqual(
      {status: r.status, count: r.count, cells: r.cellsVisited, examined: r.entriesExamined},
      {status: 'too-wide', count: 0, cells: 0, examined: 0},
    );
  }
  assert.deepEqual([...out], [42, 42]);
  // Exactly at the bound is allowed; a query clipped by the rectangle counts only the cells inside it.
  assert.equal(g.queryRect(0, 0, 15, 15, out).status, 'complete');
  assert.equal(g.queryRect(-1e9, -1e9, 5, 5, out).cellsVisited, 1);
  assert.deepEqual(g.queryRect(200, 200, 300, 300, out), {
    status: 'complete',
    count: 0,
    cellsVisited: 0,
    entriesExamined: 0,
    revision: g.stats.revision,
  });
});

test('a full buffer reports truncated (an incomplete set) and stops scanning', () => {
  const g = grid();
  for (let i = 0; i < 10; i++) g.insert(i, 1 + i, 1);
  const out = new Float64Array(3),
    r = g.queryRect(0, 0, 20, 20, out);
  assert.equal(r.status, 'truncated');
  assert.equal(r.count, 3);
  assert.ok(r.entriesExamined <= 4);
  assert.equal(g.queryCircle(1, 1, 50, new Float64Array(0)).status, 'truncated');
  assert.equal(
    g.queryCircle(90, 90, 1, new Float64Array(0)).status,
    'complete',
    'no match: an empty buffer is not truncated',
  );
  assert.equal(g.queryRect(0, 0, 100, 100, new Float64Array(10)).status, 'complete', 'exactly enough room');
});

test('nearest ordering is by distance then id, independent of insertion history', () => {
  const a = grid(),
    b = grid(),
    points: [number, number, number][] = [
      [5, 50, 49],
      [3, 50, 51],
      [9, 51, 50],
      [1, 49, 50],
      [7, 60, 60],
      [2, 50, 50],
    ];
  for (const [i, x, y] of points) a.insert(i, x, y);
  for (const [i, x, y] of [...points].reverse()) b.insert(i, x, y);
  const outA = new Float64Array(4),
    outB = new Float64Array(4);
  const ra = a.queryNearest(50, 50, 20, outA, 2),
    rb = b.queryNearest(50, 50, 20, outB, 2);
  assert.deepEqual([...outA.subarray(0, ra.count)], [1, 3, 5, 9]);
  assert.deepEqual([...outB.subarray(0, rb.count)], [1, 3, 5, 9]);
  const all = new Array<number>(10).fill(-1),
    r = a.queryNearest(50, 50, 20, all);
  assert.deepEqual(all.slice(0, r.count), [2, 1, 3, 5, 9, 7]);
  assert.equal(a.queryNearest(50, 50, 20, []).count, 0, 'k = 0');
});

test('clear keeps capacity; dispose is terminal, idempotent and reports closed', () => {
  const g = grid({maxEntries: 1});
  g.insert(1, 1, 1);
  g.clear();
  assert.equal(g.stats.size, 0);
  assert.equal(g.queryCircle(1, 1, 5, new Float64Array(1)).count, 0);
  assert.equal(g.insert(2, 1, 1), 'inserted');
  g.dispose();
  g.dispose();
  assert.equal(g.stats.closed, true);
  assert.equal(g.stats.size, 0);
  assert.equal(g.insert(3, 1, 1), 'closed');
  assert.equal(g.move(2, 1, 1), 'closed');
  assert.equal(g.remove(2), 'closed');
  assert.equal(g.has(2), false);
  assert.equal(g.position(2), undefined);
  for (const r of [
    g.queryRect(0, 0, 1, 1, new Float64Array(1)),
    g.queryCircle(0, 0, 1, new Float64Array(1)),
    g.queryNearest(0, 0, 1, new Float64Array(1)),
  ])
    assert.equal(r.status, 'closed');
  g.clear();
  assert.throws(() => g.insert(-1, 0, 0), TypeError, 'malformed input still throws after disposal');
});

test('revision advances on every accepted mutation and stamps query results', () => {
  const g = grid();
  const out = new Float64Array(4);
  g.insert(1, 1, 1);
  g.move(1, 2, 2);
  g.move(1, 50, 50);
  g.remove(1);
  g.clear();
  assert.equal(g.stats.revision, 5);
  g.insert(1, 200, 0);
  g.move(4, 0, 0);
  assert.equal(g.queryCircle(0, 0, 1, out).revision, 5, 'refusals do not advance it');
});

// A representative consumer: per-observer interest sets maintained from ECS Transform (x/z ground plane) by an
// ordinary scene system. The creator owns the visibility rule (here: a radius) and what "visible" discloses.
test('ECS consumer: per-observer interest sets follow moving entities and fail closed on truncation', async () => {
  const Unit = defineComponent('spatial-test-unit', {team: 0});
  const Observer = defineComponent('spatial-test-observer', {radius: 0, visible: [] as number[], complete: true});
  const g: SpatialGrid = createSpatialGrid({
    cellSize: 8,
    minX: -64,
    minY: -64,
    maxX: 64,
    maxY: 64,
    maxEntries: 32,
    maxCells: 256,
    maxCellsPerQuery: 16,
  });
  const buffer = new Float64Array(8),
    result = createQueryResult(),
    indexed = new Set<number>();
  const interest = defineSystem({
    id: 'spatial-test-interest',
    run(ctx) {
      // Despawned entities leave the index; an entity outside the grid is removed, never left at a stale position.
      for (const e of indexed)
        if (!ctx.world.exists(e)) {
          g.remove(e);
          indexed.delete(e);
        }
      for (const [e, , tr] of ctx.world.query(Unit, Transform)) {
        let status: string = g.move(e, tr.x, tr.z);
        if (status === 'absent') status = g.insert(e, tr.x, tr.z);
        if (status === 'moved' || status === 'inserted') indexed.add(e);
        else {
          g.remove(e);
          indexed.delete(e);
        }
      }
      for (const [e, obs, tr] of ctx.world.query(Observer, Transform)) {
        const r = g.queryCircle(tr.x, tr.z, obs.radius, buffer, result);
        assert.equal(r, result, 'the reused record is returned');
        obs.complete = r.status === 'complete';
        obs.visible = obs.complete ? ids(buffer, r.count).filter(id => id !== e) : [];
      }
    },
  });
  const mover = defineSystem({
    id: 'spatial-test-move',
    run(ctx) {
      for (const [, unit, tr] of ctx.world.query(Unit, Transform)) if (unit.team === 1) tr.x += 0.5;
    },
  });
  const s = await testScene(
    defineScene({
      id: 'spatial-consumer',
      title: 'spatial.consumer',
      systems: [mover, interest],
      entities: [
        [Transform({x: 0, z: 0}), Unit({team: 0}), Observer({radius: 10})],
        [Transform({x: 4, z: 0}), Unit({team: 0})],
        [Transform({x: -20, z: 0}), Unit({team: 1})],
      ],
    }),
  );
  s.run(1 / 60);
  const [observer] = [...s.world.query(Observer)];
  assert.deepEqual(observer![1].visible, [2]);
  s.run(0.5); // the team-1 unit crosses into range
  assert.deepEqual(observer![1].visible, [2, 3]);
  s.world.despawn(2);
  s.run(1 / 60);
  assert.deepEqual(observer![1].visible, [3], 'a despawned entity is no longer disclosed');
  assert.equal(g.has(2), false);
  const far = [...s.world.query(Unit, Transform)].find(([e]) => e === 3)![2];
  far.x = 500;
  far.z = 0;
  s.run(1 / 60); // leaves the grid rectangle: removed, not left at its last position
  assert.equal(g.has(3), false);
  assert.deepEqual(observer![1].visible, []);
  far.x = 0;
  far.z = 2;
  s.run(1 / 60); // and is indexed again when it returns
  assert.deepEqual(observer![1].visible, [3]);
  for (let i = 0; i < 12; i++) s.world.spawn(Transform({x: 1, z: 1}), Unit({team: 0}));
  s.run(1 / 60);
  assert.equal(observer![1].complete, false);
  assert.deepEqual(observer![1].visible, [], 'an incomplete set discloses nothing');
  s.dispose();
  g.dispose();
});

test('ids beyond 32 bits round-trip exactly; a reused result record avoids per-query allocation', () => {
  const g = grid(),
    big = 2 ** 40 + 3,
    out = new Float64Array(2),
    arr = [0, 0],
    r = createQueryResult();
  g.insert(big, 5, 5);
  g.insert(70000, 6, 5);
  assert.equal(g.queryNearest(5, 5, 5, out, undefined, r), r);
  assert.deepEqual([...out], [big, 70000]);
  assert.equal(g.queryCircle(5, 5, 5, arr, r).count, 2);
  assert.deepEqual(
    arr.sort((a, b) => a - b),
    [70000, big],
  );
  assert.equal(g.queryRect(0, 0, 10, 10, out, r), r);
  assert.deepEqual({...r}, {status: 'complete', count: 2, cellsVisited: 4, entriesExamined: 2, revision: 2});
  g.dispose();
  assert.equal(g.queryCircle(5, 5, 5, out, r).status, 'closed');
  assert.equal(r.count, 0);
});
