import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createAssignments} from './index';
import {createNavigationGraph, createLifetimeRouteQueue} from '../navigation';

test('service owner composes route cancellation and assignment authority without a second scheduler', () => {
  const visits = new AbortController();
  const ledger = createAssignments({maxActors: 1, maxTargets: 1, maxClaims: 1});
  visits.signal.addEventListener('abort', () => ledger.dispose(), {once: true});
  const routes = createLifetimeRouteQueue({maxOwners: 1, maxRequests: 1, maxNodes: 2});
  const opened = routes.openOwner({label: 'service-worker', signal: visits.signal});
  const actor = ledger.addActor('worker'),
    target = ledger.addTarget('repair', 1);
  if (opened.status !== 'accepted' || actor.status !== 'added' || target.status !== 'added') throw Error('admission');
  const owner = opened.owner;
  const first = ledger.claim(actor.handle, target.handle);
  if (first.status !== 'claimed') throw Error(first.status);
  const graph = createNavigationGraph([
    {id: 'start', edges: [{to: 'goal', cost: 1}]},
    {id: 'goal', edges: []},
  ]);
  assert.equal(
    owner.offer({id: 'route', generation: first.token.generation, graph, start: 'start', goal: 'goal'}),
    'accepted',
  );
  routes.pump(8);
  assert.equal(owner.result('route')?.status, 'arrived');
  // Capture a result, then cancel both independent owners before adopting it.
  const late = owner.result('route');
  ledger.retry(first.token);
  owner.release('route');
  const next = ledger.claim(actor.handle, target.handle);
  if (next.status !== 'claimed') throw Error(next.status);
  assert.equal(late?.status, 'arrived');
  assert.equal(ledger.check(first.token), false);
  assert.equal(ledger.complete(first.token).status, 'stale');
  assert.ok(ledger.check(next.token));
  assert.equal(
    owner.offer({id: 'route-2', generation: next.token.generation, graph, start: 'start', goal: 'goal'}),
    'accepted',
  );
  visits.abort();
  assert.deepEqual(routes.stats, {requests: 0, nodes: 0, owners: 0, slots: 1, closed: false});
  assert.equal(ledger.check(next.token), false);
  assert.equal(ledger.complete(next.token).status, 'disposed');
  routes.dispose();
});

test('worksite owner uses weighted occupancy and preserves productive assignment on refused transfer', () => {
  const ledger = createAssignments({maxActors: 2, maxTargets: 2, maxClaims: 2, maxCapacity: 3});
  const actor = ledger.addActor('crew'),
    inspector = ledger.addActor('inspector');
  const source = ledger.addTarget('assembly', 3),
    destination = ledger.addTarget('finishing', 2);
  if (
    actor.status !== 'added' ||
    inspector.status !== 'added' ||
    source.status !== 'added' ||
    destination.status !== 'added'
  )
    throw Error('admission');
  const working = ledger.claim(actor.handle, source.handle, 2),
    occupied = ledger.claim(inspector.handle, destination.handle);
  if (working.status !== 'claimed' || occupied.status !== 'claimed') throw Error('claim');
  assert.equal(ledger.transfer(working.token, destination.handle, 2).status, 'full');
  assert.ok(ledger.check(working.token), 'consumer can retain productive occupancy');
  ledger.cancel(occupied.token);
  const transferred = ledger.transfer(working.token, destination.handle, 2);
  if (transferred.status !== 'claimed') throw Error(transferred.status);
  assert.equal(ledger.check(working.token), false);
  assert.deepEqual(
    ledger.snapshot().targets.map(t => t.used),
    [0, 2],
  );
  ledger.removeTarget(destination.handle);
  assert.equal(ledger.complete(transferred.token).status, 'stale');
  assert.equal(ledger.snapshot().claims.length, 0);
  ledger.dispose();
});
