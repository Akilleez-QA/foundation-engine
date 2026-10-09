import assert from 'node:assert/strict';
import {test} from 'node:test';
import {assignments, createAssignments, type Assignments, type AssignmentToken} from './index';

function actor(l: Assignments, id: string) {
  const value = l.addActor(id);
  assert.equal(value.status, 'added');
  return value.handle;
}
function target(l: Assignments, id: string, capacity = 1) {
  const value = l.addTarget(id, capacity);
  assert.equal(value.status, 'added');
  return value.handle;
}
function claim(l: Assignments, a: unknown, t: unknown, units = 1): AssignmentToken {
  const value = l.claim(a, t, units);
  assert.equal(value.status, 'claimed');
  return value.token;
}

test('optional kit has no installed scheduler or dependencies', () => {
  assert.equal(assignments().id, 'assignments');
});

test('claim authority is replaced only after successful weighted transfer', () => {
  const l = createAssignments({maxClaims: 2});
  const a = actor(l, 'a'),
    b = actor(l, 'b');
  const first = target(l, 'first', 2),
    next = target(l, 'next', 2);
  const token = claim(l, a, first, 2),
    occupied = claim(l, b, next);
  const before = l.snapshot();
  assert.equal(l.transfer(token, next, 2).status, 'full');
  assert.deepEqual(l.snapshot(), before);
  assert.ok(l.check(token));
  l.cancel(occupied);
  const moved = l.transfer(token, next, 2);
  assert.equal(moved.status, 'claimed');
  assert.equal(l.check(token), false);
  assert.equal(l.complete(token).status, 'stale');
  assert.ok(l.check(moved.token));
  assert.equal(l.complete(moved.token).status, 'completed');
  assert.equal(l.check(moved.token), false);
  assert.deepEqual(
    l.snapshot().targets.map(t => t.used),
    [0, 0],
  );
});

test('same labels in a new actor, target or ledger do not restore retired authority', () => {
  const l = createAssignments();
  const a = actor(l, 'a'),
    t = target(l, 't'),
    token = claim(l, a, t);
  l.removeActor(a);
  l.removeTarget(t);
  const freshActor = actor(l, 'a'),
    freshTarget = target(l, 't');
  const fresh = claim(l, freshActor, freshTarget);
  for (const old of [token, {...fresh}, l.snapshot().claims[0]]) assert.equal(l.check(old), false);
  assert.equal(l.claim(a, freshTarget).status, 'stale');
  assert.equal(l.removeTarget(t).status, 'stale');
  assert.equal(createAssignments().check(fresh), false);
  assert.ok(l.check(fresh));
  l.dispose();
  assert.equal(l.check(fresh), false);
  assert.equal(l.complete(fresh).status, 'disposed');
});

test('captured limits refuse saturation and malformed data before mutation', () => {
  const options = {maxActors: 2, maxTargets: 1, maxClaims: 1, maxCapacity: 2};
  const l = createAssignments(options);
  options.maxClaims = 10;
  const a = actor(l, 'a'),
    b = actor(l, 'b'),
    t = target(l, 't', 2);
  claim(l, a, t);
  const before = l.snapshot();
  assert.equal(l.claim(b, t).status, 'saturated');
  assert.equal(l.addActor('c').status, 'saturated');
  assert.equal(l.addTarget('u', 2).status, 'saturated');
  for (const invalid of [NaN, Infinity, -1, 0, 0.5, 3, '1']) assert.equal(l.claim(b, t, invalid).status, 'invalid');
  for (const invalid of ['', 'x'.repeat(65), null, 5]) assert.equal(l.addActor(invalid).status, 'invalid');
  assert.deepEqual(l.snapshot(), before);
  for (const invalid of [NaN, Infinity, -1, 0, 0.5, 4097]) assert.throws(() => createAssignments({maxActors: invalid}));
  assert.throws(() => createAssignments({maxRetries: 65}));
});

test('retry exhaustion clears capacity and is scoped to the explicit actor lifetime', () => {
  const l = createAssignments({maxRetries: 1});
  const a = actor(l, 'a'),
    t = target(l, 't');
  const first = claim(l, a, t);
  assert.equal(l.retry(first).status, 'ready');
  assert.equal(l.check(first), false);
  assert.equal(l.retry(first).status, 'stale');
  const second = claim(l, a, t);
  assert.equal(l.retry(second).status, 'retry-exhausted');
  assert.equal(l.claim(a, t).status, 'retry-exhausted');
  assert.equal(l.snapshot().targets[0]!.used, 0);
  l.removeActor(a);
  assert.ok(l.check(claim(l, actor(l, 'a'), t)));
});

test('target removal clears all claims without cancelling unrelated assignments', () => {
  const l = createAssignments();
  const a = actor(l, 'a'),
    b = actor(l, 'b'),
    c = actor(l, 'c');
  const t = target(l, 't', 3),
    u = target(l, 'u');
  const first = claim(l, a, t, 2),
    second = claim(l, b, t),
    kept = claim(l, c, u);
  l.removeTarget(t);
  assert.equal(l.check(first), false);
  assert.equal(l.check(second), false);
  assert.ok(l.check(kept));
  assert.equal(l.snapshot().claims.length, 1);
});

test('a hostile handle is never inspected; snapshots are frozen descriptions', () => {
  const l = createAssignments();
  const hostile = new Proxy(
    {},
    {
      get() {
        throw Error('unexpected property read');
      },
    },
  );
  assert.equal(l.check(hostile), false);
  assert.equal(l.complete(hostile).status, 'stale');
  const a = actor(l, 'a'),
    t = target(l, 't'),
    token = claim(l, a, t);
  const before = l.snapshot();
  assert.ok(Object.isFrozen(before.targets[0]));
  assert.ok(Object.isFrozen(before.claims));
  l.complete(token);
  assert.equal(before.targets[0]!.used, 1);
  assert.equal(l.snapshot().targets[0]!.used, 0);
});
