import test from 'node:test';
import assert from 'node:assert/strict';
import {createDistanceField, type FieldSearch, type NavigationField, type FieldPhase} from './field';
import {createNavigationGraph, createPathSearch, type NavigationGraph} from './search';

function finish(search: FieldSearch, budget = 7): {field: NavigationField; work: number} {
  let work = 0;
  while (search.result.status === 'pending') {
    const step = search.step(budget);
    assert.ok(step.work > 0 && step.work <= budget);
    work += step.work;
    assert.ok(work < 1_000_000, 'construction terminates');
  }
  const result = search.result;
  assert.equal(result.status, 'complete');
  if (result.status !== 'complete') throw Error('field did not complete');
  return {field: result.field, work};
}

/** Independent dense relaxation oracle, used only with small exactly represented integer costs. */
function oracle(graph: NavigationGraph, goals: readonly string[]) {
  const ids = graph.nodes.map(n => n.id);
  const d = ids.map((_, i) => ids.map((_, j) => (i === j ? 0 : Infinity)));
  for (let i = 0; i < ids.length; i++)
    for (const e of graph.nodes[i]!.edges) d[i]![ids.indexOf(e.to)] = Math.min(d[i]![ids.indexOf(e.to)]!, e.cost);
  for (let k = 0; k < ids.length; k++)
    for (let i = 0; i < ids.length; i++)
      for (let j = 0; j < ids.length; j++) d[i]![j] = Math.min(d[i]![j]!, d[i]![k]! + d[k]![j]!);
  return ids.map((_, i) => Math.min(...goals.map(g => d[i]![ids.indexOf(g)]!)));
}

function check(graph: NavigationGraph, goals: readonly string[], field: NavigationField) {
  const expected = oracle(graph, goals);
  graph.nodes.forEach((node, i) => {
    const label = field.get(node.id);
    assert.ok(label);
    if (expected[i] === Infinity) {
      assert.equal(label.status, 'unreachable');
      return;
    }
    assert.notEqual(label.status, 'unreachable');
    if (label.status === 'unreachable') return;
    assert.equal(label.distance, expected[i]);
    let id = node.id;
    const seen = new Set<string>();
    while (true) {
      assert.ok(!seen.has(id), 'no successor cycle');
      seen.add(id);
      const current = field.get(id)!;
      if (current.status === 'goal') {
        assert.ok(goals.includes(id));
        break;
      }
      assert.equal(current.status, 'reachable');
      if (current.status !== 'reachable') throw Error('broken chain');
      const edge = graph.nodes.find(n => n.id === id)!.edges.find(e => e.to === current.next);
      assert.ok(edge, 'successor follows original directed edge');
      const successor = field.get(current.next)!;
      assert.notEqual(successor.status, 'unreachable');
      if (successor.status === 'unreachable') throw Error('broken successor');
      assert.ok(successor.rank < current.rank);
      assert.equal(current.distance, edge.cost + successor.distance);
      id = current.next;
    }
    assert.ok(seen.size <= graph.nodes.length);
  });
}

test('shared fields match an independent directed multi-goal oracle including zero cycles and disconnected nodes', () => {
  for (let seed = 1; seed <= 40; seed++) {
    let state = seed;
    const random = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0);
    const graph = createNavigationGraph(
      Array.from({length: 9}, (_, i) => ({
        id: String(i),
        edges: Array.from({length: 9}, (_, j) => j)
          .filter(() => random() % 4 === 0)
          .map(j => ({to: String(j), cost: random() % 5})),
      })),
    );
    const goals = ['2', '7'];
    const a = finish(createDistanceField(graph, goals), 1);
    const b = finish(
      createDistanceField(
        createNavigationGraph([...graph.nodes].reverse().map(n => ({...n, edges: [...n.edges].reverse()}))),
        [...goals].reverse(),
      ),
      37,
    );
    check(graph, goals, a.field);
    assert.deepEqual(
      graph.nodes.map(n => a.field.get(n.id)),
      graph.nodes.map(n => b.field.get(n.id)),
    );
    assert.equal(a.work, b.work);
  }
  const graph = createNavigationGraph([
    {id: 'a', edges: [{to: 'b', cost: 0}]},
    {
      id: 'b',
      edges: [
        {to: 'a', cost: 0},
        {to: 'g', cost: 0},
      ],
    },
    {id: 'g', edges: [{to: 'g', cost: 0}]},
    {id: 'isolated', edges: []},
  ]);
  check(graph, ['g'], finish(createDistanceField(graph, ['g'])).field);
});

test('admission, zero work, cancellation in every phase and completed publication are explicit', () => {
  const graph = createNavigationGraph([
    {id: 'a', edges: [{to: 'b', cost: 1}]},
    {id: 'b', edges: []},
  ]);
  for (const goals of [[], ['missing'], ['a', 'a'], ['a', 'b', 'c']])
    assert.throws(() => createDistanceField(graph, goals));
  const oversized = new Proxy(['a', 'b', 'c'], {
    get(target, key, receiver) {
      if (key === '0') throw Error('must refuse count before traversal');
      return Reflect.get(target, key, receiver);
    },
  });
  assert.throws(() => createDistanceField(graph, oversized), /goal count/);
  for (const phase of ['index', 'reverse', 'seed', 'search', 'publish'] satisfies FieldPhase[]) {
    const search = createDistanceField(graph, ['b']);
    while (search.phase !== phase) search.step(1);
    const before = search.result;
    assert.deepEqual(search.step(0), {result: before, work: 0});
    for (const bad of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => search.step(bad));
    assert.equal(search.result, before);
    search.cancel();
    search.cancel();
    assert.deepEqual(search.result, {status: 'cancelled'});
    assert.deepEqual(search.step(9), {result: search.result, work: 0});
  }
  const search = createDistanceField(graph, ['b']);
  const {field} = finish(search);
  search.cancel();
  assert.equal(search.result.status, 'complete');
  assert.ok(Object.isFrozen(field) && Object.isFrozen(field.goals) && Object.isFrozen(field.get('a')));
  assert.equal(field.get('missing'), null);
  assert.equal(field.graph, graph);
});

test('overflow refuses publication while finite reverse accumulation has its documented order', () => {
  const chain = (costs: number[]) =>
    createNavigationGraph([
      ...costs.map((cost, i) => ({id: String(i), edges: [{to: String(i + 1), cost}]})),
      {id: String(costs.length), edges: []},
    ]);
  const bad = createDistanceField(chain([Number.MAX_VALUE, Number.MAX_VALUE]), ['2']);
  assert.throws(() => finish(bad), /overflow/);
  assert.equal(bad.result.status, 'cancelled');
  const graph = chain([1e16, 1, 1]);
  const label = finish(createDistanceField(graph, ['3'])).field.get('0');
  assert.ok(label && label.status === 'reachable');
  assert.equal(label.distance, 1e16 + (1 + 1));
  const forward = createPathSearch(graph, '0', '3');
  while (forward.result.status === 'pending') forward.step(100);
  assert.ok(forward.result.status === 'arrived');
  assert.equal(forward.result.cost, 1e16 + 1 + 1);
  assert.notEqual(label.distance, forward.result.cost, 'do not promise reverse/forward bit parity');
});

test('sharing amortizes repeated logical work but a field need not beat one short route', () => {
  const graph = createNavigationGraph(
    Array.from({length: 16}, (_, i) => ({
      id: String(i),
      edges: i < 15 ? [{to: String(i + 1), cost: 1 + (i % 3)}] : [],
    })),
  );
  const shared = finish(createDistanceField(graph, ['15']));
  let repeated = 0;
  for (let i = 0; i < 15; i++) {
    const route = createPathSearch(graph, String(i), '15');
    while (route.result.status === 'pending') repeated += route.step(100).work;
  }
  assert.ok(shared.work < repeated, 'different logical counters, not a wall-time ratio');
  const one = createPathSearch(graph, '14', '15');
  let oneWork = 0;
  while (one.result.status === 'pending') oneWork += one.step(100).work;
  assert.ok(oneWork < shared.work, 'single short route is cheaper than preparing all labels');
});

test('maximum admitted node population publishes incrementally without exposing partial labels', () => {
  const graph = createNavigationGraph(Array.from({length: 8192}, (_, i) => ({id: String(i), edges: []})));
  const search = createDistanceField(graph, ['0']);
  while (search.phase !== 'publish') search.step(1);
  for (let i = 0; i < 8191; i++) {
    assert.equal(search.step(1).work, 1);
    assert.equal(search.result.status, 'pending');
  }
  assert.equal(search.step(1).work, 1);
  assert.equal(search.result.status, 'complete');
  if (search.result.status === 'complete') {
    assert.equal(search.result.field.get('0')?.status, 'goal');
    assert.equal(search.result.field.get('8191')?.status, 'unreachable');
  }
});
