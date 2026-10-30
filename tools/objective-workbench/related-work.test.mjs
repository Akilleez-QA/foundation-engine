import test from 'node:test';
import assert from 'node:assert/strict';
import {createRelatedWork, createWorkSource} from './related-work.mjs';
const fact = {id: 'one', event: 'work', amount: 1};
test('two exact leases share one listener; one cancellation retains sibling and final release revokes late callback', () => {
  const source = createWorkSource();
  let captured;
  const input = {
    read: source.read,
    subscribe(fn) {
      captured = fn;
      return source.subscribe(fn);
    },
  };
  const work = createRelatedWork(input),
    seen = [];
  const a = work.acquire(v => {
      seen.push(['a', v.id]);
      return true;
    }),
    b = work.acquire(v => {
      seen.push(['b', v.id]);
      return true;
    });
  assert.equal(source.listeners(), 1);
  assert.equal(work.acquire(() => true).reason, 'capacity');
  assert.equal(work.release(a.lease), true);
  assert.equal(source.listeners(), 1);
  assert.equal(work.release(a.lease), false);
  source.emit(fact);
  assert.deepEqual(seen, [['b', 'one']]);
  assert.equal(source.listeners(), 0);
  assert.equal(work.release(b.lease), true);
  assert.equal(captured({id: 'late', event: 'work', amount: 1}), false);
  assert.deepEqual(seen, [['b', 'one']]);
});
test('already completed source avoids listener; refusal retains recipient fact independently', () => {
  const source = createWorkSource();
  source.emit(fact);
  const work = createRelatedWork(source);
  let accepts = false,
    a = 0,
    b = 0;
  work.acquire(() => {
    a++;
    return accepts;
  });
  work.acquire(() => {
    b++;
    return true;
  });
  assert.equal(source.listeners(), 0);
  assert.equal(b, 1);
  assert.equal(work.stats().delivered, 1);
  accepts = true;
  work.reconcile();
  assert.equal(b, 1);
  assert.equal(work.stats().delivered, 2);
  assert.ok(a >= 2);
  work.close();
});
test('attach failure publishes no lease; synchronous completion is captured after attach; cleanup reentry is inert', () => {
  const bad = createRelatedWork({
    read: () => null,
    subscribe() {
      throw Error('attach');
    },
  });
  assert.equal(bad.acquire(() => true).reason, 'attach');
  assert.equal(bad.stats().consumers, 0);
  let callbacks = 0,
    cleanups = 0,
    retained;
  const work = createRelatedWork({
    read: () => null,
    subscribe(fn) {
      retained = fn;
      fn(fact);
      return () => {
        cleanups++;
        assert.equal(fn({id: 'reentrant', event: 'work', amount: 1}), false);
      };
    },
  });
  assert.equal(
    work.acquire(() => {
      callbacks++;
      return true;
    }).status,
    'admitted',
  );
  assert.equal(callbacks, 1);
  assert.equal(cleanups, 1);
  work.close();
  assert.equal(retained(fact), false);
});
test('release and retirement revoke before throwing creator cleanup and before reentrant delivery', () => {
  let callback,
    calls = 0;
  const work = createRelatedWork({
    read: () => null,
    subscribe(fn) {
      callback = fn;
      return () => {
        fn(fact);
        throw Error('cleanup');
      };
    },
  });
  const lease = work.acquire(() => {
    calls++;
    return true;
  }).lease;
  assert.throws(() => work.release(lease), /cleanup/);
  assert.equal(work.stats().consumers, 0);
  assert.equal(callback(fact), false);
  assert.equal(calls, 0);
  work.close();
  assert.equal(work.acquire(() => true).reason, 'retired');
});
test('read/attach reentry retires admission and disposes a just-returned subscription', () => {
  for (const phase of ['read', 'subscribe']) {
    let work,
      attached = 0,
      removed = 0;
    work = createRelatedWork({
      read() {
        if (phase === 'read') work.close();
        return null;
      },
      subscribe() {
        attached++;
        work.close();
        return () => removed++;
      },
    });
    const result = work.acquire(() => true);
    assert.equal(result.status, 'refused');
    assert.equal(work.stats().consumers, 0);
    assert.equal(work.stats().listeners, 0);
    assert.equal(removed, attached);
    assert.equal(work.stats().retired, true);
  }
});
test('old producer callback cannot revive after final release and same-source reacquisition', () => {
  const callbacks = [];
  let hits = 0;
  const work = createRelatedWork({
    read: () => null,
    subscribe(fn) {
      callbacks.push(fn);
      return () => {};
    },
  });
  const first = work.acquire(() => true);
  work.release(first.lease);
  work.acquire(() => {
    hits++;
    return true;
  });
  assert.equal(callbacks[0](fact), false);
  assert.equal(hits, 0);
  callbacks[1](fact);
  assert.equal(hits, 1);
  work.close();
});
test('producer cleanup throw cannot strand already captured result delivery', () => {
  let callback,
    hits = 0;
  const work = createRelatedWork({
    read: () => null,
    subscribe(fn) {
      callback = fn;
      return () => {
        throw Error('cleanup');
      };
    },
  });
  work.acquire(() => {
    hits++;
    return true;
  });
  assert.equal(callback(fact), true);
  assert.equal(hits, 1);
  assert.equal(work.stats().cleanupErrors, 1);
  assert.equal(work.stats().listeners, 0);
  work.close();
});
test('fact getters that retire the source cannot publish a result or lease after retirement', () => {
  let callback;
  const work = createRelatedWork({
    read: () => null,
    subscribe(fn) {
      callback = fn;
      return () => {};
    },
  });
  work.acquire(() => true);
  assert.equal(
    callback({
      get id() {
        work.close();
        return 'late';
      },
      event: 'work',
      amount: 1,
    }),
    false,
  );
  assert.equal(work.stats().completed, false);
  let ready;
  ready = createRelatedWork({
    read: () => ({
      get id() {
        ready.close();
        return 'cached';
      },
      event: 'work',
      amount: 1,
    }),
    subscribe() {
      throw Error('unexpected');
    },
  });
  assert.equal(ready.acquire(() => true).status, 'refused');
  assert.equal(ready.stats().consumers, 0);
});
test('accessor-driven nested emission cannot split the one-result source', () => {
  const source = createWorkSource(),
    work = createRelatedWork(source),
    seen = [];
  let inner;
  work.acquire(v => {
    seen.push(v.id);
    return true;
  });
  assert.equal(
    source.emit({
      get id() {
        inner = source.emit({id: 'inner', event: 'work', amount: 1});
        return 'outer';
      },
      event: 'work',
      amount: 2,
    }).status,
    'emitted',
  );
  assert.deepEqual(inner, {status: 'refused', reason: 'busy'});
  assert.equal(source.read().id, 'outer');
  work.acquire(v => {
    seen.push(v.id);
    return true;
  });
  assert.deepEqual(seen, ['outer', 'outer']);
  const fresh = createRelatedWork(source);
  fresh.acquire(v => {
    seen.push(v.id);
    return true;
  });
  assert.deepEqual(seen, ['outer', 'outer', 'outer']);
  work.close();
  fresh.close();
  const retry = createWorkSource();
  assert.throws(
    () =>
      retry.emit({
        get id() {
          throw Error('capture');
        },
      }),
    /capture/,
  );
  assert.equal(retry.emit({id: 'valid', event: 'work', amount: 1}).status, 'emitted');
});
