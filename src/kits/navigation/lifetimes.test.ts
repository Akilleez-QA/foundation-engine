import test from 'node:test';
import assert from 'node:assert/strict';
import { createLifetimeRouteQueue, type RouteOwner } from './lifetimes';
import { createRouteQueue } from './queue';
import { createNavigationGraph } from './search';
const graph = createNavigationGraph([{ id: 'a', edges: [] }]);
const request = { id: 'route', generation: 0, graph, start: 'a', goal: 'a' };
function open(q: ReturnType<typeof createLifetimeRouteQueue>, label = 'actor', signal?: AbortSignal): RouteOwner {
  const result = q.openOwner({ label, signal });
  assert.equal(result.status, 'accepted');
  if (result.status !== 'accepted') throw Error('not admitted');
  return result.owner;
}
test('long-lived queue keeps B progressing across repeated A lifetimes without stale handle aliasing', () => {
  const q = createLifetimeRouteQueue({ maxOwners: 2, maxRequests: 2, maxNodes: 101 });
  const b = open(q, 'B');
  const long = createNavigationGraph(Array.from({ length: 100 }, (_, i) => ({ id: String(i), edges: i < 99 ? [{ to: String(i + 1), cost: 1 }] : [] })));
  b.offer({ ...request, graph: long, start: '0', goal: '99' });
  const old: RouteOwner[] = [];
  for (let i = 0; i < 12; i++) {
    const a = open(q);
    assert.equal(a.offer(request), 'accepted');
    for (const retired of old) {
      assert.equal(retired.offer(request), 'retired');
      retired.release('route'); retired.retire();
      assert.equal(retired.result('route'), null);
    }
    assert.equal(a.result('route')?.status, 'pending');
    assert.equal(q.pump(2), 2);
    assert.equal(b.result('route')?.status, 'pending');
    a.retire(); old.push(a);
    assert.deepEqual(q.stats, { requests: 1, nodes: 100, owners: 1, slots: 2, closed: false });
  }
  q.pump(1000);
  assert.equal(b.result('route')?.status, 'arrived');
  q.dispose();
  assert.equal(q.stats.nodes, 0);
});
test('owner and shared request/node bounds are separate; supersession and malformed admission are transactional', () => {
  const q = createLifetimeRouteQueue({ maxOwners: 3, maxRequests: 1, maxNodes: 1 });
  const a = open(q), b = open(q), c = open(q);
  assert.equal(q.openOwner({ label: 'fourth' }).status, 'saturated');
  assert.equal(a.offer(request), 'accepted');
  assert.equal(a.offer(request), 'duplicate');
  assert.equal(b.offer(request), 'saturated');
  assert.equal(a.offer({ ...request, id: 'new', generation: 1 }), 'accepted');
  assert.equal(a.offer(request), 'stale');
  assert.throws(() => a.offer({ ...request, id: 'bad', generation: 2, start: 'missing' }));
  assert.equal(a.result('new')?.status, 'pending');
  assert.equal(a.offer({ ...request, id: 'new', generation: 1 }), 'duplicate');
  a.retire();
  assert.equal(b.offer(request), 'accepted'); b.retire();
  assert.equal(c.offer(request), 'accepted');
  assert.equal(q.stats.requests, 1); q.dispose();
});
test('abort, pre-aborted owners and disposal cannot revive a lifetime', () => {
  const q = createLifetimeRouteQueue({ maxOwners: 1, maxRequests: 1, maxNodes: 1 });
  const controller = new AbortController(); controller.abort();
  assert.equal(q.openOwner({ label: 'old', signal: controller.signal }).status, 'retired');
  assert.equal(q.stats.slots, 0);
  const live = new AbortController(), a = open(q, 'same', live.signal);
  a.offer(request); live.abort();
  assert.equal(q.stats.requests, 0);
  const b = open(q, 'same'); b.offer(request);
  a.release('route'); a.retire();
  assert.equal(b.result('route')?.status, 'pending');
  q.dispose(); q.dispose();
  assert.equal(b.offer(request), 'closed'); assert.equal(b.result('route'), null);
  assert.equal(q.openOwner({ label: 'new' }).status, 'closed');
});
test('abort or dispose during structural graph preparation leaves no admitted orphan', () => {
  for (const dispose of [false, true]) {
    const q = createLifetimeRouteQueue({ maxOwners: 1, maxRequests: 1, maxNodes: 1 });
    const controller = new AbortController(), a = open(q, 'actor', controller.signal);
    const structural = { get nodes() { if (dispose) q.dispose(); else controller.abort(); return graph.nodes; } };
    assert.equal(a.offer({ ...request, graph: structural }), dispose ? 'closed' : 'retired');
    assert.equal(q.stats.requests, 0); assert.equal(q.stats.nodes, 0); assert.equal(q.stats.owners, 0);
  }
});
test('stock string-owner queue retains its deliberate bounded cohort contract', () => {
  const q = createRouteQueue({ maxRequests: 1, maxNodes: 1 });
  q.offer({ ...request, owner: 'old' }); q.release('route');
  assert.equal(q.offer({ ...request, owner: 'new' }), 'saturated');
  assert.deepEqual(q.stats, { requests: 0, nodes: 0, owners: 1 }); q.dispose();
});
test('node admission is shared across handles and released independently', () => {
  const q = createLifetimeRouteQueue({ maxOwners: 2, maxRequests: 3, maxNodes: 1 });
  const a = open(q), b = open(q);
  assert.equal(a.offer(request), 'accepted');
  assert.equal(b.offer(request), 'saturated');
  a.release('route');
  assert.equal(b.offer(request), 'accepted');
  assert.equal(q.stats.nodes, 1);
  q.dispose();
  for (const maxOwners of [0, -1, 1.5, Infinity]) assert.throws(() => createLifetimeRouteQueue({ maxOwners, maxRequests: 1, maxNodes: 1 }));
});
test('request accessors cannot retire and reopen a slot before outer admission', () => {
  for (const property of ['id', 'generation', 'graph', 'start', 'goal'] as const) {
    const q = createLifetimeRouteQueue({ maxOwners: 1, maxRequests: 2, maxNodes: 2 });
    const a = open(q);
    let reads = 0;
    const input = { ...request };
    Object.defineProperty(input, property, { get() {
      reads++; a.retire();
      assert.throws(() => q.openOwner({ label: 'actor' }), /reentrant/);
      return request[property];
    } });
    assert.equal(a.offer(input), 'retired');
    assert.equal(reads, 1);
    const b = open(q);
    q.pump(5);
    assert.equal(b.result('route'), null);
    assert.equal(b.offer(request), 'accepted');
    a.release('route'); a.retire();
    assert.equal(b.result('route')?.status, 'pending');
    q.dispose();
  }
});
test('owner accessors are guarded and disposal during open cannot publish a handle', () => {
  for (const property of ['label', 'signal'] as const) {
    const q = createLifetimeRouteQueue({ maxOwners: 1, maxRequests: 1, maxNodes: 1 });
    const input = { label: 'actor', signal: new AbortController().signal };
    Object.defineProperty(input, property, { get() {
      assert.throws(() => q.openOwner({ label: 'nested' }), /reentrant/);
      q.dispose();
      return property === 'label' ? 'actor' : undefined;
    } });
    assert.equal(q.openOwner(input).status, 'closed');
    assert.equal(q.stats.owners, 0); assert.equal(q.stats.slots, 0);
  }
});
test('request fields are snapshotted once; malformed IDs cannot run coercion callbacks', () => {
  const q = createLifetimeRouteQueue({ maxOwners: 1, maxRequests: 1, maxNodes: 1 });
  const a = open(q), reads = new Map<string, number>();
  const input = Object.fromEntries(Object.entries(request));
  for (const key of Object.keys(request) as (keyof typeof request)[]) Object.defineProperty(input, key, { get() {
    reads.set(key, (reads.get(key) ?? 0) + 1); return request[key];
  } });
  assert.equal(a.offer(input as typeof request), 'accepted');
  assert.equal([...reads.values()].every(n => n === 1), true);
  const id = { toJSON() { throw Error('must not execute'); } } as unknown as string;
  assert.throws(() => a.result(id), /invalid request id/);
  assert.throws(() => a.release(id), /invalid request id/);
  assert.equal(a.result('route')?.status, 'pending'); q.dispose();
});
test('signal registration uses native lifetime operations without invoking replaced methods', () => {
  const q = createLifetimeRouteQueue({ maxOwners: 1, maxRequests: 1, maxNodes: 1 });
  const controller = new AbortController();
  Object.defineProperty(controller.signal, 'addEventListener', { value() { throw Error('replaced add'); } });
  Object.defineProperty(controller.signal, 'removeEventListener', { value() { throw Error('replaced remove'); } });
  const a = open(q, 'actor', controller.signal);
  a.offer(request); controller.abort();
  assert.equal(a.offer(request), 'retired'); assert.equal(q.stats.requests, 0);
  q.dispose();
});
