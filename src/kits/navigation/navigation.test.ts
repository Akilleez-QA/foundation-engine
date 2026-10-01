import test from 'node:test';
import assert from 'node:assert/strict';
import { createNavigationGraph, createPathSearch, type PathSearch } from './search';
const graph = () => createNavigationGraph([
  { id: 'a', edges: [{ to: 'c', cost: 1 }, { to: 'b', cost: 1 }] },
  { id: 'b', edges: [{ to: 'd', cost: 2 }] },
  { id: 'c', edges: [{ to: 'd', cost: 2 }] },
  { id: 'd', edges: [] }, { id: 'island', edges: [] },
]);
function finish(search: PathSearch, budget = 1) {
  for (let i = 0; i < 10000 && search.result.status === 'pending'; i++) assert.ok(search.step(budget).work <= budget);
  assert.notEqual(search.result.status, 'pending');
  return search.result;
}
test('immutable topology snapshots isolate caller edits and simultaneous requests', () => {
  const input = [{ id: 'a', edges: [{ to: 'b', cost: 1 }] }, { id: 'b', edges: [] }];
  const g = createNavigationGraph(input); input[0]!.edges[0]!.cost = 99;
  assert.equal(g.nodes[0]!.edges[0]!.cost, 1);
  assert.ok(Object.isFrozen(g.nodes[0]!.edges[0]));
  const forward = createPathSearch(g, 'a', 'b'), backwards = createPathSearch(g, 'b', 'a');
  forward.step(1); backwards.step(1);
  assert.deepEqual(finish(forward), { status: 'arrived', path: ['a', 'b'], cost: 1 });
  assert.deepEqual(finish(backwards), { status: 'no-route' });
});
test('ties are deterministic across source order and stepping budgets', () => {
  const g = graph();
  const reversed = createNavigationGraph([...g.nodes].reverse().map(n => ({ id: n.id, edges: [...n.edges].reverse() })));
  const expected = { status: 'arrived', path: ['a', 'b', 'd'], cost: 3 };
  assert.deepEqual(finish(createPathSearch(g, 'a', 'd')), expected);
  assert.deepEqual(finish(createPathSearch(reversed, 'a', 'd'), 100), expected);
  assert.deepEqual(finish(createPathSearch(g, 'a', 'd', { a: 3, b: 2, c: 2, d: 0, island: 0 })), expected);
});
test('high-degree nodes yield between edges instead of completing a whole expansion', () => {
  const g = createNavigationGraph([{ id: 's', edges: Array.from({ length: 100 }, (_, i) => ({ to: `n${i}`, cost: 1 })) }, ...Array.from({ length: 100 }, (_, i) => ({ id: `n${i}`, edges: [] }))]);
  const s = createPathSearch(g, 's', 'n0');
  assert.equal(s.step(1).result.status, 'pending');
  assert.equal(s.step(99).result.status, 'pending');
  assert.equal(s.step(1).result.status, 'pending');
  assert.deepEqual(finish(s), { status: 'arrived', path: ['s', 'n0'], cost: 1 });
});
test('reconstruction yields too, and terminal outcomes remain stable', () => {
  const s = createPathSearch(graph(), 'a', 'a');
  assert.equal(s.step(0).work, 0);
  assert.equal(s.step(1).result.status, 'pending');
  assert.equal(s.step(1).result.status, 'pending');
  assert.deepEqual(s.step(1).result, { status: 'arrived', path: ['a'], cost: 0 });
  const terminal = s.result; s.cancel(); assert.equal(s.result, terminal); assert.equal(s.step(20).work, 0);
});
test('cancellation is isolated and idempotent, including during reconstruction', () => {
  const a = createPathSearch(graph(), 'a', 'd'), b = createPathSearch(graph(), 'a', 'd');
  a.step(2); a.cancel(); a.cancel();
  assert.deepEqual(a.step(100), { work: 0, result: { status: 'cancelled' } });
  assert.equal(finish(b).status, 'arrived');
  const c = createPathSearch(graph(), 'a', 'a'); c.step(2); c.cancel(); assert.equal(c.result.status, 'cancelled');
});
test('decrease-key and zero-cost cycles preserve shortest paths', () => {
  const g = createNavigationGraph([
    { id: 'a', edges: [{ to: 'b', cost: 9 }, { to: 'c', cost: 1 }] },
    { id: 'c', edges: [{ to: 'b', cost: 1 }, { to: 'a', cost: 0 }] },
    { id: 'b', edges: [{ to: 'd', cost: 0 }, { to: 'c', cost: 0 }] },
    { id: 'd', edges: [] },
  ]);
  assert.deepEqual(finish(createPathSearch(g, 'a', 'd')), { status: 'arrived', path: ['a', 'c', 'b', 'd'], cost: 2 });
});
test('routes match independently relaxed distances on deterministic cyclic graphs', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const rows = Array.from({ length: 12 }, (_, i) => ({ id: String(i), edges: Array.from({ length: 12 }, (_, j) => ({ to: String(j), cost: (i * 7 + j * 3 + seed) % 9 })).filter((_, j) => i !== j && (i * 5 + j * 11 + seed) % 4 === 0) }));
    const distances = Array<number>(12).fill(Infinity); distances[0] = 0;
    for (let pass = 0; pass < 11; pass++) for (let i = 0; i < 12; i++) for (const e of rows[i]!.edges) distances[Number(e.to)] = Math.min(distances[Number(e.to)]!, distances[i]! + e.cost);
    const g = createNavigationGraph(rows);
    for (let goal = 0; goal < 12; goal++) {
      const result = finish(createPathSearch(g, '0', String(goal)), seed);
      if (distances[goal] === Infinity) assert.equal(result.status, 'no-route');
      else { assert.equal(result.status, 'arrived'); if (result.status === 'arrived') assert.equal(result.cost, distances[goal]); }
    }
  }
});
test('invalid graph, endpoints, heuristics and work budgets fail explicitly', () => {
  for (const cost of [-1, NaN, Infinity]) assert.throws(() => createNavigationGraph([{ id: 'a', edges: [{ to: 'a', cost }] }]));
  assert.throws(() => createNavigationGraph([{ id: '', edges: [] }]));
  assert.throws(() => createNavigationGraph([{ id: 'a', edges: [] }, { id: 'a', edges: [] }]));
  assert.throws(() => createNavigationGraph([{ id: 'a', edges: [{ to: 'missing', cost: 0 }] }]));
  assert.throws(() => createNavigationGraph([{ id: 'a', edges: [{ to: 'a', cost: 0 }, { to: 'a', cost: 1 }] }]));
  assert.throws(() => createPathSearch(graph(), 'unknown', 'd'));
  for (const estimates of [{ a: 4 }, { a: -1 }, { a: NaN }, { d: 1 }] as Record<string, number>[]) assert.throws(() => createPathSearch(graph(), 'a', 'd', estimates));
  for (const budget of [-1, 0.5, Infinity, NaN]) assert.throws(() => createPathSearch(graph(), 'a', 'd').step(budget));
});
test('numeric overflow cancels the request instead of corrupting heap order', () => {
  const g = createNavigationGraph([
    { id: 'a', edges: [{ to: 'b', cost: Number.MAX_VALUE }] },
    { id: 'b', edges: [{ to: 'c', cost: Number.MAX_VALUE }] }, { id: 'c', edges: [] },
  ]);
  const request = createPathSearch(g, 'a', 'c');
  assert.throws(() => request.step(100), /overflow/);
  assert.equal(request.result.status, 'cancelled');
  assert.equal(request.step(100).work, 0);
});
