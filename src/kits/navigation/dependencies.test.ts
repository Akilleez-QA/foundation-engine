import test from 'node:test';
import assert from 'node:assert/strict';
import {createLifetimeRouteQueue} from './lifetimes';
import {createNavigationGraph} from './search';
import {createRouteDependencies, type RouteScope} from './dependencies';
import {must} from '../../testing/must';
const scope = (id: string, revision = 0, ready = true, incarnation = 0): RouteScope => ({
  id,
  revision,
  ready,
  incarnation,
});
const graph = createNavigationGraph([
  {id: 'start', edges: [{to: 'finish', cost: 1}]},
  {id: 'finish', edges: []},
]);
const request = (id: string) => ({id, generation: 0, graph, start: 'start', goal: 'finish'});
function setup() {
  const q = createLifetimeRouteQueue({maxOwners: 1, maxRequests: 8, maxNodes: 32});
  const opened = q.openOwner({label: 'actors'});
  if (opened.status !== 'accepted') throw Error();
  const tracker = createRouteDependencies(opened.owner, {
    maxScopes: 4,
    maxRoutes: 4,
    maxDependencies: 8,
    maxIdentityLength: 32,
  });
  return {q, tracker, owner: opened.owner};
}
function ticket(t: ReturnType<typeof setup>['tracker'], id: string, scopes: RouteScope[]) {
  const r = t.offer(request(id), scopes);
  assert.equal(r.status, 'accepted');
  if (!('ticket' in r) || !r.ticket) throw Error();
  return r.ticket;
}
test('west accepted obstacle change retires queued/adopted movement; east continues; replanned actor takes detour', () => {
  const {q, tracker: t} = setup();
  t.acceptScope(scope('west'));
  t.acceptScope(scope('east'));
  const a = ticket(t, 'A', [scope('west')]),
    b = ticket(t, 'B', [scope('east')]);
  q.pump(100);
  const adopted = t.result(a);
  assert.equal(adopted?.status, 'arrived');
  const positions = {A: [0, 0], B: [0, 4]};
  // Preparing or rejecting a replacement makes no accepted-world call.
  assert.equal(t.check(a), 'valid');
  assert.equal(t.check(b), 'valid');
  const accepted = t.acceptScope(scope('west', 1));
  assert.deepEqual(accepted.affected, ['A']);
  // Actual consumer checks every motion, even when a completed path was copied earlier.
  if (t.check(a) === 'valid' && adopted?.status === 'arrived') positions.A = [2, 0];
  if (t.check(b) === 'valid' && t.result(b)?.status === 'arrived') positions.B = [2, 4];
  assert.deepEqual(positions, {A: [0, 0], B: [2, 4]});
  const detour = createNavigationGraph([
    {id: 'start', edges: [{to: 'around', cost: 1}]},
    {id: 'around', edges: [{to: 'finish', cost: 1}]},
    {id: 'finish', edges: []},
  ]);
  const replacement = t.offer({...request('A'), graph: detour}, [scope('west', 1)]);
  assert.equal(replacement.status, 'accepted');
  if (!('ticket' in replacement) || !replacement.ticket) throw Error();
  q.pump(100);
  const result = t.result(replacement.ticket);
  assert.equal(result?.status, 'arrived');
  const coordinates: Record<string, [number, number]> = {start: [0, 0], around: [0, 2], finish: [2, 2]},
    visited: number[][] = [];
  if (result?.status === 'arrived')
    for (const node of result.path) {
      assert.equal(t.check(replacement.ticket), 'valid');
      const target = must(coordinates[node], `coordinates of ${node}`);
      // Independent contact oracle refuses the newly blocked horizontal segment y=0.
      assert.ok(!(positions.A[1] === 0 && target[1] === 0 && target[0] > 0));
      positions.A = [...target];
      visited.push([...target]);
    }
  assert.deepEqual(visited, [
    [0, 0],
    [0, 2],
    [2, 2],
  ]);
  assert.equal(t.result(a), null);
  const queued = ticket(t, 'C', [scope('west', 1)]);
  assert.equal(t.acceptScope(scope('west', 2, false)).status, 'accepted');
  assert.equal(t.check(queued), 'unavailable');
  assert.equal(t.check(replacement.ticket), 'unavailable');
  assert.equal(t.check(b), 'valid');
  assert.equal(q.stats.requests, 1);
});
test('monotonic scope identities reject stale and contradictory notifications; no-op preserves tickets', () => {
  const {tracker: t} = setup();
  t.acceptScope(scope('west', 2));
  const a = ticket(t, 'A', [scope('west', 2)]);
  assert.equal(t.acceptScope(scope('west', 1)).status, 'stale');
  assert.equal(t.acceptScope(scope('west', 2, false)).status, 'conflict');
  assert.equal(t.acceptScope(scope('west', 2)).status, 'unchanged');
  assert.equal(t.check(a), 'valid');
  assert.equal(t.check({...a}), 'stale');
  t.acceptScope(scope('west', 0, true, 1));
  assert.equal(t.check(a), 'stale');
  assert.equal(t.acceptScope(scope('west', 100, true, 0)).status, 'stale');
  t.dispose();
  assert.equal(t.check(a), 'retired');
});
test('bounds, owner loss, generation supersession and getter disposal cannot leak routes', () => {
  const {q, tracker: t, owner} = setup();
  for (const id of ['a', 'b', 'c', 'd']) t.acceptScope(scope(id));
  assert.equal(t.acceptScope(scope('e')).status, 'saturated');
  assert.throws(() => t.offer(request('bad'), [scope('a'), scope('a')]));
  const a = ticket(t, 'A', [scope('a')]);
  const next = t.offer({...request('B'), generation: 1}, [scope('b')]);
  assert.equal(next.status, 'accepted');
  assert.equal(t.check(a), 'stale');
  if (!('ticket' in next) || !next.ticket) throw Error();
  owner.retire();
  assert.equal(t.check(next.ticket), 'unavailable');
  assert.equal(q.stats.requests, 0);
  t.dispose();
  assert.equal(t.stats.routes, 0);
  const fresh = setup();
  assert.equal(
    fresh.tracker.acceptScope({
      ...scope('x'),
      get ready() {
        fresh.tracker.dispose();
        return true;
      },
    }).status,
    'retired',
  );
  assert.equal(fresh.tracker.stats.scopes, 0);
});
test('disposal during graph preparation releases admitted request and old completed tickets cannot alias reuse', () => {
  const {tracker: t, q} = setup();
  t.acceptScope(scope('x'));
  const a = ticket(t, 'same', [scope('x')]);
  q.pump(100);
  t.release(a);
  const b = ticket(t, 'same', [scope('x')]);
  assert.equal(t.check(a), 'retired');
  assert.equal(t.check(b), 'valid');
  const result = t.offer(
    {
      ...request('dispose'),
      graph: {
        get nodes() {
          t.dispose();
          return graph.nodes;
        },
      },
    },
    [],
  );
  assert.equal(result.status, 'retired');
  assert.equal(q.stats.requests, 0);
  assert.equal(t.stats.dependencies, 0);
});
test('route and aggregate dependency admission are independently bounded and recover after release', () => {
  const {owner} = setup();
  const t = createRouteDependencies(owner, {maxScopes: 3, maxRoutes: 2, maxDependencies: 2, maxIdentityLength: 8});
  t.acceptScope(scope('a'));
  t.acceptScope(scope('b'));
  const a = ticket(t, 'A', [scope('a'), scope('b')]);
  assert.equal(t.offer(request('B'), [scope('a')]).status, 'saturated');
  const b = ticket(t, 'B', []);
  assert.equal(t.offer(request('C'), []).status, 'saturated');
  t.release(a);
  assert.equal(t.offer(request('C'), [scope('a')]).status, 'accepted');
  assert.equal(t.check(b), 'valid');
  assert.throws(() => t.acceptScope(scope('too-long-identity')));
  t.dispose();
  assert.deepEqual(t.stats, {scopes: 0, routes: 0, dependencies: 0, closed: true});
});
test('caller array methods cannot retain mutable scopes or inflate bounded dependency capture', () => {
  const {owner, q} = setup();
  const t = createRouteDependencies(owner, {maxScopes: 2, maxRoutes: 2, maxDependencies: 1, maxIdentityLength: 8});
  t.acceptScope(scope('west'));
  t.acceptScope(scope('east'));
  const west = scope('west'),
    expected = [west];
  let mapCalled = false;
  Object.defineProperty(expected, 'map', {
    value: () => {
      mapCalled = true;
      return expected;
    },
  });
  const r = t.offer(request('actor'), expected);
  if (!('ticket' in r) || !r.ticket) throw Error();
  (west as {id: string}).id = 'east';
  q.pump(100);
  const adopted = t.result(r.ticket);
  t.acceptScope(scope('west', 1));
  let x = 0;
  if (t.check(r.ticket) === 'valid' && adopted?.status === 'arrived') x = 1;
  assert.equal(x, 0);
  assert.equal(mapCalled, false);
  assert.equal(t.check(r.ticket), 'stale');
  const changing = [scope('west', 1)];
  Object.defineProperty(changing, '0', {
    get() {
      changing.push(scope('east'));
      return scope('west', 1);
    },
  });
  const second = t.offer(request('second'), changing);
  assert.equal(second.status, 'accepted');
  assert.equal(changing.length, 2);
  assert.equal(t.stats.dependencies, 1);
  assert.equal(t.offer(request('over'), [scope('east')]).status, 'saturated');
});
