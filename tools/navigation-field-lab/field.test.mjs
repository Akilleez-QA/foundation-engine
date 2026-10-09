import test from 'node:test';
import assert from 'node:assert/strict';
import {createNavigationGraph, createPathSearch} from '../../src/kits/navigation/search.ts';
import {prepareFieldTopology, createReverseField} from './field.mjs';
const finish = s => {
  for (let i = 0; i < 100000; i++) {
    s.step(7);
    if ((s.status ?? s.result.status) !== 'pending') return s;
  }
  throw Error('unbounded');
};
const verify = (g, goal) => {
  const field = finish(createReverseField(prepareFieldTopology(g, 3), goal));
  for (const node of g.nodes) {
    const expected = finish(createPathSearch(g, node.id, goal)).result;
    const actual = field.route(node.id, 3);
    assert.equal(actual.status, expected.status);
    if (actual.status === 'arrived') {
      assert.equal(actual.cost, expected.cost);
      let cost = 0;
      for (let i = 1; i < actual.path.length; i++) {
        const edge = g.nodes.find(n => n.id === actual.path[i - 1]).edges.find(e => e.to === actual.path[i]);
        assert.ok(edge, 'must follow a directed edge');
        cost += edge.cost;
      }
      assert.equal(cost, actual.cost);
      assert.equal(actual.path.at(-1), goal);
      assert.equal(new Set(actual.path).size, actual.path.length, 'no zero-cost cycle');
    }
  }
  return field;
};
test('reverse field agrees with independent searches on directed weighted graphs and zero-cost cycles', () => {
  for (let seed = 1; seed <= 20; seed++) {
    let rng = seed;
    const random = () => {
      rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
      return rng / 4294967296;
    };
    const nodes = Array.from({length: 24}, (_, i) => ({id: String(i), edges: []}));
    for (let a = 0; a < nodes.length; a++)
      for (let b = 0; b < nodes.length; b++)
        if (a !== b && random() < 0.12) nodes[a].edges.push({to: String(b), cost: Math.floor(random() * 5)});
    const g = createNavigationGraph(nodes);
    verify(g, '0');
    verify(g, '23');
  }
});
test('large costs, unreachable nodes, revision mismatch and cancellation are explicit', () => {
  const g = createNavigationGraph([
    {id: 'a', edges: [{to: 'b', cost: 70000}]},
    {id: 'b', edges: [{to: 'c', cost: 70000}]},
    {id: 'c', edges: []},
    {id: 'island', edges: []},
  ]);
  const f = verify(g, 'c');
  assert.equal(f.route('a', 3).cost, 140000);
  assert.equal(f.route('a', 4).status, 'stale');
  const next = createReverseField(prepareFieldTopology(g, 4), 'c');
  next.step(1);
  next.cancel();
  assert.equal(next.step(99).work, 0);
  assert.equal(next.route('a', 4).status, 'cancelled');
});
test('high degree yields per edge; source mutation and different budgets do not alter result', () => {
  const nodes = [
    {id: 'goal', edges: []},
    ...Array.from({length: 200}, (_, i) => ({id: String(i), edges: [{to: 'goal', cost: 1}]})),
  ];
  const g = createNavigationGraph(nodes),
    t = prepareFieldTopology(g, 2);
  nodes[1].edges[0].cost = 99;
  const f = createReverseField(t, 'goal');
  assert.equal(f.step(1).work, 1);
  assert.equal(f.step(1).status, 'pending');
  assert.equal(f.route('1', 2).status, 'pending');
  while (f.status === 'pending') assert.ok(f.step(1).work <= 1);
  assert.equal(f.route('1', 2).cost, 1);
  assert.equal(f.typedBytes, 201 * 21);
  for (const bad of [-1, NaN, Infinity, 1.5]) assert.throws(() => f.step(bad));
});
test('overflow fails rather than publishing a disconnected or partial field', () => {
  const g = createNavigationGraph([
    {id: 'a', edges: [{to: 'b', cost: Number.MAX_SAFE_INTEGER}]},
    {id: 'b', edges: [{to: 'c', cost: Number.MAX_SAFE_INTEGER}]},
    {id: 'c', edges: []},
  ]);
  const f = createReverseField(prepareFieldTopology(g, 0), 'c');
  assert.throws(() => finish(f), /overflow/);
  assert.equal(f.route('a', 0).status, 'failed');
});

test('integer domain is explicit and completed/failed outcomes survive cancellation', () => {
  for (const cost of [0.1, 0.2, 0.3, Number.MAX_VALUE]) {
    const g = createNavigationGraph([
      {id: 'a', edges: [{to: 'b', cost}]},
      {id: 'b', edges: []},
    ]);
    assert.throws(() => prepareFieldTopology(g, 0), /safe integer/);
  }
  const g = createNavigationGraph([{id: 'a', edges: []}]);
  const f = finish(createReverseField(prepareFieldTopology(g, 0), 'a'));
  f.cancel();
  assert.equal(f.route('a', 0).status, 'arrived');
  const bad = createNavigationGraph([
    {id: 'a', edges: [{to: 'b', cost: Number.MAX_SAFE_INTEGER}]},
    {id: 'b', edges: [{to: 'a', cost: Number.MAX_SAFE_INTEGER}]},
  ]);
  const overflow = createReverseField(prepareFieldTopology(bad, 0), 'a');
  assert.throws(() => finish(overflow), /overflow/);
  overflow.cancel();
  assert.equal(overflow.status, 'failed');
});
