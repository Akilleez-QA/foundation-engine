import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createAssignments} from './assignments.mjs';
import {serviceRequests, worksiteSlots} from './fixtures.mjs';

const actor = (ledger, id) => {
  const r = ledger.addActor(id);
  assert.equal(r.status, 'added');
  return r.handle;
};
const target = (ledger, id, capacity = 1) => {
  const r = ledger.addTarget(id, capacity);
  assert.equal(r.status, 'added');
  return r.handle;
};
const claim = (ledger, a, t, units = 1) => {
  const r = ledger.claim(a, t, units);
  assert.equal(r.status, 'claimed');
  return r.token;
};

test('two consumers exercise one-shot requests and weighted worksite occupancy', () => {
  const services = serviceRequests();
  assert.equal(services.targets.length, 0);
  assert.equal(services.claims.length, 0);
  const sites = worksiteSlots();
  assert.deepEqual(
    sites.refused.targets.map(t => t.used),
    [2, 1],
  );
  assert.deepEqual(
    sites.transferred.targets.map(t => t.used),
    [0, 2],
  );
  assert.equal(sites.removed.claims.length, 0);
  assert.ok(sites.removed.actors.every(a => !a.assigned));
});

test('exclusive request and actor claims; independent completion and cancellation conserve capacity', () => {
  const l = createAssignments();
  const a = actor(l, 'a'),
    b = actor(l, 'b'),
    c = actor(l, 'c');
  const shared = target(l, 'shared', 3),
    single = target(l, 'single');
  const ca = claim(l, a, shared, 2),
    cb = claim(l, b, shared);
  assert.equal(l.claim(a, single).status, 'busy');
  assert.equal(l.claim(c, shared).status, 'full');
  assert.equal(l.complete(ca).status, 'completed');
  assert.equal(l.cancel(cb).status, 'cancelled');
  assert.equal(l.complete(ca).status, 'stale');
  const cc = claim(l, c, single);
  assert.equal(l.claim(a, single).status, 'full');
  assert.equal(l.cancel(cc).status, 'cancelled');
  assert.ok(l.snapshot().targets.every(t => t.used === 0));
});

test('failed transfer preserves the original token and exact state', () => {
  const l = createAssignments();
  const a = actor(l, 'a'),
    b = actor(l, 'b');
  const old = target(l, 'old', 3),
    next = target(l, 'next', 2);
  const token = claim(l, a, old, 2);
  claim(l, b, next);
  const before = l.snapshot();
  assert.equal(l.transfer(token, next, 2).status, 'full');
  assert.equal(l.transfer(token, next, NaN).status, 'invalid');
  assert.equal(l.transfer(token, {}).status, 'stale');
  assert.deepEqual(l.snapshot(), before);
  assert.equal(l.complete(token).status, 'completed');
  assert.deepEqual(
    l.snapshot().targets.map(t => t.used),
    [0, 1],
  );
});

test('transfer replaces a token even at claim limit; same-target resize credits old capacity', () => {
  const l = createAssignments({maxClaims: 1});
  const a = actor(l, 'a'),
    t = target(l, 't', 3),
    next = target(l, 'next', 3);
  const initial = claim(l, a, t, 2);
  const resize = l.transfer(initial, t, 3);
  assert.equal(resize.status, 'claimed');
  assert.equal(l.cancel(initial).status, 'stale');
  const move = l.transfer(resize.token, next, 2);
  assert.equal(move.status, 'claimed');
  assert.equal(l.complete(resize.token).status, 'stale');
  assert.deepEqual(
    l.snapshot().targets.map(t => t.used),
    [0, 2],
  );
  assert.equal(l.complete(move.token).status, 'completed');
});

test('handles and tokens are local capabilities; copies and hostile objects are refused', () => {
  const l = createAssignments(),
    other = createAssignments();
  const a = actor(l, 'a'),
    t = target(l, 't');
  const oa = actor(other, 'a'),
    ot = target(other, 't');
  const token = claim(l, a, t);
  const hostile = new Proxy(
    {},
    {
      get() {
        throw Error('caller getter invoked');
      },
    },
  );
  for (const fake of [{...token}, hostile, null, undefined, claim(other, oa, ot)])
    assert.equal(l.complete(fake).status, 'stale');
  assert.equal(l.claim(oa, t).status, 'stale');
  assert.equal(l.transfer(token, ot).status, 'stale');
  assert.equal(l.removeActor({...a}).status, 'stale');
  assert.equal(l.removeTarget(hostile).status, 'stale');
  assert.equal(l.complete(token).status, 'completed');
});

test('actor deletion and same-id recreation cannot accept a late completion', () => {
  const l = createAssignments();
  const a = actor(l, 'a'),
    t = target(l, 't');
  const old = claim(l, a, t);
  assert.equal(l.removeActor(a).status, 'removed');
  const replacement = actor(l, 'a');
  assert.ok(replacement.generation > a.generation);
  const current = claim(l, replacement, t);
  assert.equal(l.complete(old).status, 'stale');
  assert.equal(l.claim(a, t).status, 'stale');
  assert.equal(l.removeActor(a).status, 'stale');
  assert.equal(l.snapshot().targets[0].used, 1);
  assert.equal(l.complete(current).status, 'completed');
});

test('target removal withdraws every weighted claim and invalidates a recycled target', () => {
  const l = createAssignments();
  const a = actor(l, 'a'),
    b = actor(l, 'b'),
    t = target(l, 't', 3);
  const ca = claim(l, a, t, 2),
    cb = claim(l, b, t);
  assert.equal(l.removeTarget(t).status, 'removed');
  const replacement = target(l, 't', 3);
  assert.ok(replacement.generation > t.generation);
  const current = claim(l, a, replacement, 3);
  assert.equal(l.complete(ca).status, 'stale');
  assert.equal(l.retry(cb).status, 'stale');
  assert.equal(l.removeTarget(t).status, 'stale');
  assert.equal(l.claim(b, t).status, 'stale');
  assert.equal(l.snapshot().targets[0].used, 3);
  assert.equal(l.complete(current).status, 'completed');
});

test('retry budget is per actor generation, bounded and never reset by cancellation', () => {
  const l = createAssignments({maxRetries: 2});
  const a = actor(l, 'a'),
    t = target(l, 't');
  for (let i = 0; i < 2; i++) {
    const token = claim(l, a, t);
    assert.equal(l.retry(token).status, 'ready');
    assert.equal(l.retry(token).status, 'stale');
  }
  const cancelled = claim(l, a, t);
  assert.equal(l.cancel(cancelled).status, 'cancelled');
  const last = claim(l, a, t);
  assert.equal(l.retry(last).status, 'retry-exhausted');
  assert.equal(l.snapshot().targets[0].used, 0);
  assert.equal(l.snapshot().actors[0].retries, 2);
  assert.equal(l.claim(a, t).status, 'retry-exhausted');
  l.removeActor(a);
  assert.equal(l.claim(actor(l, 'a'), t).status, 'claimed');
});

test('zero retry budget releases a failed claim without keeping pending work', () => {
  const l = createAssignments({maxRetries: 0});
  const a = actor(l, 'a'),
    t = target(l, 't');
  assert.equal(l.retry(claim(l, a, t)).status, 'retry-exhausted');
  assert.equal(l.snapshot().claims.length, 0);
  assert.equal(l.snapshot().actors[0].exhausted, true);
});

test('configured admission bounds are captured and saturation is recoverable', () => {
  const options = {maxActors: 2, maxTargets: 1, maxClaims: 1, maxCapacity: 2};
  const l = createAssignments(options);
  options.maxActors = options.maxTargets = options.maxClaims = options.maxCapacity = 4096;
  const a = actor(l, 'a'),
    b = actor(l, 'b'),
    t = target(l, 't', 2);
  assert.equal(l.addActor('c').status, 'saturated');
  assert.equal(l.addTarget('u', 1).status, 'saturated');
  assert.equal(l.addTarget('u', 3).status, 'invalid');
  const token = claim(l, a, t);
  assert.equal(l.claim(b, t).status, 'saturated');
  l.complete(token);
  assert.equal(l.claim(b, t).status, 'claimed');
  l.removeActor(a);
  assert.equal(l.addActor('c').status, 'added');
});

test('invalid bounds, IDs and units are rejected without changing accepted state', () => {
  for (const n of [NaN, Infinity, -1, 1.5, 4097, Number.MAX_SAFE_INTEGER])
    for (const key of ['maxActors', 'maxTargets', 'maxClaims', 'maxCapacity'])
      assert.throws(() => createAssignments({[key]: n}), RangeError);
  for (const n of [NaN, Infinity, -1, 1.5, 65]) assert.throws(() => createAssignments({maxRetries: n}), RangeError);
  const l = createAssignments();
  for (const id of ['', 'UPPER', 'x'.repeat(65), null, {}, 3]) assert.equal(l.addActor(id).status, 'invalid');
  const a = actor(l, 'a'),
    t = target(l, 't');
  const before = l.snapshot();
  assert.equal(l.addActor('a').status, 'duplicate');
  assert.equal(l.addTarget('t', 1).status, 'duplicate');
  for (const units of [0, -1, 1.5, NaN, Infinity, 65, '1']) assert.equal(l.claim(a, t, units).status, 'invalid');
  assert.deepEqual(l.snapshot(), before);
});

test('snapshots are detached, frozen descriptions, not completion capabilities', () => {
  const l = createAssignments();
  const a = actor(l, 'a'),
    t = target(l, 't'),
    token = claim(l, a, t);
  const before = l.snapshot();
  assert.throws(() => {
    before.targets[0].used = 99;
  }, TypeError);
  assert.throws(() => {
    before.claims.push(token);
  }, TypeError);
  assert.equal(l.complete(before.claims[0]).status, 'stale');
  l.complete(token);
  assert.equal(before.targets[0].used, 1);
  assert.equal(l.snapshot().targets[0].used, 0);
});

test('disposal is idempotent, clears retained state and refuses every mutation', () => {
  const l = createAssignments();
  const a = actor(l, 'a'),
    t = target(l, 't'),
    token = claim(l, a, t);
  l.dispose();
  l.dispose();
  for (const r of [
    l.addActor('b'),
    l.addTarget('u', 1),
    l.claim(a, t),
    l.transfer(token, t),
    l.retry(token),
    l.complete(token),
    l.cancel(token),
    l.removeActor(a),
    l.removeTarget(t),
  ])
    assert.equal(r.status, 'disposed');
  assert.deepEqual(l.snapshot(), {disposed: true, actors: [], targets: [], claims: []});
});

test('bounded churn retires tokens without retaining terminal history', () => {
  const l = createAssignments({maxActors: 1, maxTargets: 1, maxClaims: 1});
  let previous = 0;
  let first;
  for (let i = 0; i < 1000; i++) {
    const a = actor(l, 'a'),
      t = target(l, 't'),
      token = claim(l, a, t);
    first ??= token;
    assert.ok(token.generation > previous);
    previous = token.generation;
    l.removeActor(a);
    l.removeTarget(t);
  }
  assert.equal(l.complete(first).status, 'stale');
  assert.deepEqual(l.snapshot(), {disposed: false, actors: [], targets: [], claims: []});
});

test('600 mixed commands agree with an independent allocation model after every step', () => {
  const l = createAssignments({maxActors: 5, maxTargets: 3, maxClaims: 5, maxCapacity: 5});
  const aa = Array.from({length: 5}, (_, i) => actor(l, `a${i}`));
  const capacities = [2, 3, 5];
  const tt = capacities.map((c, i) => target(l, `t${i}`, c));
  const model = new Map(),
    tokens = new Map();
  let seed = 712367;
  const next = n => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % n;
  };
  for (let step = 0; step < 600; step++) {
    const a = next(5),
      t = next(3),
      units = next(4) + 1,
      op = next(3);
    const old = model.get(a);
    const used = [...model.entries()].reduce(
      (sum, [id, v]) => sum + (v.target === t && !(op === 1 && id === a) ? v.units : 0),
      0,
    );
    if (op === 0) {
      const expected = old ? 'busy' : used + units > capacities[t] ? 'full' : 'claimed';
      const r = l.claim(aa[a], tt[t], units);
      assert.equal(r.status, expected);
      if (r.status === 'claimed') {
        model.set(a, {target: t, units});
        tokens.set(a, r.token);
      }
    } else if (op === 1) {
      const expected = !old ? 'stale' : used + units > capacities[t] ? 'full' : 'claimed';
      const r = l.transfer(tokens.get(a), tt[t], units);
      assert.equal(r.status, expected);
      if (r.status === 'claimed') {
        model.set(a, {target: t, units});
        tokens.set(a, r.token);
      }
    } else {
      assert.equal(l.cancel(tokens.get(a)).status, old ? 'cancelled' : 'stale');
      model.delete(a);
      tokens.delete(a);
    }
    const state = l.snapshot();
    assert.equal(state.claims.length, model.size);
    assert.deepEqual(
      state.actors.map(a => a.assigned),
      aa.map((_, i) => model.has(i)),
    );
    for (let i = 0; i < tt.length; i++)
      assert.equal(
        state.targets[i].used,
        [...model.values()].filter(v => v.target === i).reduce((sum, v) => sum + v.units, 0),
      );
  }
});
