import test from 'node:test';
import assert from 'node:assert/strict';
import {component, World, type Entity} from './world';

const A = component('a', {n: 0});
const B = component('b', {n: 0});

/** Every row has a defined value for each listed component. */
function assertComplete(row: readonly unknown[]): void {
  for (const v of row.slice(1))
    assert.notEqual(v, undefined, `row for entity ${String(row[0])} has an undefined value`);
}

function world(count: number, ...inits: ((i: number) => ReturnType<typeof A>)[]): {w: World; ids: Entity[]} {
  const w = new World();
  const ids: Entity[] = [];
  for (let i = 0; i < count; i++) ids.push(w.spawn(...inits.map(f => f(i))));
  return {w, ids};
}

test('query(A): an entity despawned by an earlier row is skipped, never yielded with undefined', () => {
  const {w, ids} = world(4, i => A({n: i}));
  const seen: Entity[] = [];
  for (const row of w.query(A)) {
    assertComplete(row);
    seen.push(row[0]);
    if (row[0] === ids[0]) w.despawn(ids[2]!); // after the cursor
  }
  assert.deepEqual(seen, [ids[0], ids[1], ids[3]]);
});

test('query(A): removing A from a later entity skips it; removing it from the yielding entity is harmless', () => {
  const {w, ids} = world(4, i => A({n: i}));
  const seen: Entity[] = [];
  for (const [e, a] of w.query(A)) {
    assert.ok(a);
    seen.push(e);
    w.remove(e, A); // the yielding entity
    if (e === ids[1]) w.remove(ids[3]!, A); // after the cursor
  }
  assert.deepEqual(seen, [ids[0], ids[1], ids[2]]);
});

test('query(A): despawning the yielding entity or an earlier one does not disturb the rest', () => {
  const {w, ids} = world(5, i => A({n: i}));
  const seen: Entity[] = [];
  for (const row of w.query(A)) {
    assertComplete(row);
    seen.push(row[0]);
    w.despawn(row[0]); // the yielding entity
    if (row[0] === ids[2]) w.despawn(ids[0]!); // before the cursor (already despawned: no-op)
    if (row[0] === ids[3]) w.despawn(ids[1]!); // before the cursor
  }
  assert.deepEqual(seen, ids);
  assert.equal(w.count, 0);
});

test('query(A, B): despawn or removal of either component on a later entity skips it', () => {
  // B is the smaller store, so it drives iteration; removal from either store must be honoured.
  const {w, ids} = world(
    6,
    i => A({n: i}),
    i => B({n: i}),
  );
  for (let i = 0; i < 4; i++) w.spawn(A({n: 100 + i})); // make A the larger store
  const seen: Entity[] = [];
  for (const row of w.query(A, B)) {
    assertComplete(row);
    const [e, a, b] = row;
    assert.equal(a.n, b.n);
    seen.push(e);
    if (e === ids[0]) {
      w.remove(ids[1]!, A); // the larger (filter) store
      w.remove(ids[2]!, B); // the smaller (driving) store
      w.despawn(ids[3]!);
    }
    if (e === ids[4]) w.remove(e, B); // the yielding entity
  }
  assert.deepEqual(seen, [ids[0], ids[4], ids[5]]);
});

test('query(A, B): removal before the cursor and re-adding a component before it is reached', () => {
  const {w, ids} = world(
    4,
    i => A({n: i}),
    i => B({n: i}),
  );
  const seen: [Entity, number][] = [];
  for (const [e, a, b] of w.query(A, B)) {
    assert.ok(a && b);
    seen.push([e, b.n]);
    if (e === ids[1]) {
      w.remove(ids[0]!, A); // before the cursor: no effect on this iteration
      w.remove(ids[2]!, B);
      w.add(ids[2]!, B({n: 42})); // re-added before reached: visited with the current value
    }
  }
  assert.deepEqual(seen, [
    [ids[0], 0],
    [ids[1], 1],
    [ids[2], 42],
    [ids[3], 3],
  ]);
});

test('query: entities spawned, or that start matching, after iteration begins are not visited', () => {
  const {w, ids} = world(3, i => A({n: i}));
  const partial = w.spawn(B()); // has B only
  const seen: Entity[] = [];
  let spawned: Entity | undefined;
  for (const [e] of w.query(A, B)) seen.push(e);
  assert.equal(seen.length, 0, 'A and B never meet');

  for (const [e] of w.query(A)) {
    seen.push(e);
    if (e === ids[0]) {
      spawned = w.spawn(A({n: 9}));
      w.add(partial, A()); // now matches A, but did not when iteration began
    }
  }
  assert.deepEqual(seen, ids);
  assert.ok(spawned !== undefined && w.has(spawned, A));
  assert.deepEqual(
    [...w.query(A)].map(([e]) => e),
    [...ids, partial, spawned],
    'a later query sees them',
  );

  const order: Entity[] = [];
  for (const [e] of w.query()) {
    order.push(e);
    if (e === ids[0]) {
      w.spawn(A());
      w.despawn(ids[2]!);
    }
  }
  assert.deepEqual(order, [ids[0], ids[1], partial, spawned], 'query(): spawned skipped, despawned skipped');
});

test('query: gaining a component mid-iteration does not make a non-matching entity appear', () => {
  const {w, ids} = world(
    3,
    i => A({n: i}),
    i => B({n: i}),
  );
  const lonely = w.spawn(A({n: 7})); // A only
  for (let i = 0; i < 3; i++) w.spawn(B()); // make B the larger store, so A drives iteration
  const seen: Entity[] = [];
  for (const [e] of w.query(A, B)) {
    seen.push(e);
    if (e === ids[0]) w.add(lonely, B({n: 7}));
  }
  assert.deepEqual(seen, ids);
});

test('first(): stops at the first live match after earlier removals', () => {
  const {w, ids} = world(3, i => A({n: i}));
  w.despawn(ids[0]!);
  assert.equal(w.first(A)?.[0], ids[1]);
});
