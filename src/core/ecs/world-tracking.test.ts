import test from 'node:test';
import assert from 'node:assert/strict';
import {component, World, type Entity} from './world';
import {added, changed, type ObserverEvent} from './world-tracking';
import {createSystemRunner, sinceLastRun} from './systems';

const A = component('a', {n: 0});
const B = component('b', {n: 0});

const ids = (rows: Iterable<readonly unknown[]>): unknown[] => [...rows].map(r => r[0]);

test('change ticks: add marks added and changed; replace and markChanged mark changed only', () => {
  const w = new World();
  w.trackChanges(A);
  const before = w.spawn(A());
  const since = w.changeCursor();
  const fresh = w.spawn(A());
  w.add(before, A({n: 2})); // replace
  assert.deepEqual(ids(w.queryFiltered(since, [added(A)], A)), [fresh]);
  assert.deepEqual(ids(w.queryFiltered(since, [changed(A)], A)), [before, fresh]);
  since.advance();
  assert.deepEqual(ids(w.queryFiltered(since, [changed(A)], A)), []);
  assert.equal(w.markChanged(before, A), true);
  assert.deepEqual(ids(w.queryFiltered(since, [changed(A)], A)), [before]);
  assert.deepEqual(ids(w.queryFiltered(since, [added(A)], A)), []);
  // Removing and re-adding is a new add.
  w.remove(fresh, A);
  w.add(fresh, A());
  assert.deepEqual(ids(w.queryFiltered(since, [added(A)], A)), [fresh]);
  // A filter on a component the entity lacks excludes it; no filters is the plain query.
  w.trackChanges(B);
  assert.deepEqual(ids(w.queryFiltered(since, [changed(B)])), []);
  assert.deepEqual(ids(w.queryFiltered(since, [], A)), ids(w.query(A)));
});

test('change ticks: trackChanges counts existing holders at one tick; a fromStart cursor sees them', () => {
  const w = new World();
  const e1 = w.spawn(A()),
    e2 = w.spawn(A(), B());
  const early = w.changeCursor();
  w.trackChanges(A, A); // idempotent within and across calls
  w.trackChanges(A);
  assert.equal(w.changeTick, 1);
  assert.deepEqual(ids(w.queryFiltered(early, [added(A)], A)), [e1, e2]);
  const late = w.changeCursor();
  assert.deepEqual(ids(w.queryFiltered(late, [added(A)], A)), []);
  const all = w.changeCursor({fromStart: true});
  assert.deepEqual(ids(w.queryFiltered(all, [added(A)], A)), [e1, e2]);
  assert.equal(w.isTracked(A), true);
  assert.equal(w.isTracked(B), false);
});

test('change ticks: untracked filters and foreign or disposed cursors are refused', () => {
  const w = new World(),
    other = new World();
  w.trackChanges(A);
  const c = w.changeCursor();
  assert.throws(() => w.queryFiltered(c, [changed(B)], A), /'b' is not tracked/);
  assert.throws(() => w.queryFiltered(other.changeCursor(), [changed(A)], A), /cursor of this world/);
  assert.throws(
    () => w.queryFiltered({tick: 0, overflowed: false, disposed: false, advance() {}, dispose() {}}, []),
    /cursor/,
  );
  c.dispose();
  assert.throws(() => w.queryFiltered(c, [], A), /disposed/);
  assert.throws(() => c.advance(), /disposed/);
  assert.throws(() => w.configureTracking({maxCursors: 2}), /before the first/);
  const bounded = new World();
  bounded.configureTracking({maxCursors: 2});
  bounded.changeCursor();
  const second = bounded.changeCursor();
  assert.throws(() => bounded.changeCursor(), RangeError);
  second.dispose();
  bounded.changeCursor(); // a disposed cursor frees its slot
});

test('change ticks: a rebase overflows only the cursors it passes; they see a superset until advanced', () => {
  const w = new World();
  w.configureTracking({maxTick: 8}); // rebase keeps at least half: shift by max(oldest cursor, tick - 4)
  w.trackChanges(A);
  const atZero = w.changeCursor();
  const es: Entity[] = [];
  for (let i = 0; i < 3; i++) es.push(w.spawn(A())); // ticks 1..3
  const atThree = w.changeCursor();
  es.push(w.spawn(A())); // tick 4
  const atFour = w.changeCursor();
  for (let i = 0; i < 4; i++) es.push(w.spawn(A())); // ticks 5..8
  assert.equal(w.trackingStats().rebases, 0);
  es.push(w.spawn(A())); // tick 9 needs a rebase: base = max(0, 8 - 4) = 4
  const stats = w.trackingStats();
  assert.equal(stats.rebases, 1);
  assert.equal(stats.cursorsOverflowed, 2);
  assert.equal(stats.changeTick, 6, 'ticks shift by base - 1 = 3, so the new change is 9 - 3');
  assert.equal(atZero.overflowed, true);
  assert.equal(atThree.overflowed, true);
  assert.equal(atFour.overflowed, false);
  // Overflowed cursors miss nothing (the change at tick 4 is not lost); the in-range cursor stays exact.
  assert.deepEqual(ids(w.queryFiltered(atThree, [added(A)], A)), es);
  assert.deepEqual(ids(w.queryFiltered(atFour, [added(A)], A)), es.slice(4));
  atThree.advance();
  assert.equal(atThree.overflowed, false);
  assert.deepEqual(ids(w.queryFiltered(atThree, [added(A)], A)), []);
  w.markChanged(es[0]!, A);
  assert.deepEqual(ids(w.queryFiltered(atThree, [changed(A)], A)), [es[0]]);
});

test('change ticks: with no cursor a rebase restarts counting without losing later changes', () => {
  const w = new World();
  w.configureTracking({maxTick: 8});
  w.trackChanges(A);
  const e = w.spawn(A());
  for (let i = 0; i < 20; i++) w.markChanged(e, A);
  assert.ok(w.trackingStats().rebases >= 2);
  assert.ok(w.changeTick <= 8);
  const c = w.changeCursor();
  w.markChanged(e, A);
  assert.deepEqual(ids(w.queryFiltered(c, [changed(A)], A)), [e]);
});

test('change ticks: a fromStart cursor created after rebases still sees every present component', () => {
  const w = new World();
  w.configureTracking({maxTick: 8});
  w.trackChanges(A);
  const first = w.spawn(A());
  for (let i = 0; i < 12; i++) w.markChanged(w.spawn(A()), A); // several rebases with no live cursor
  assert.ok(w.trackingStats().rebases >= 2);
  const all = w.changeCursor({fromStart: true});
  assert.equal(all.overflowed, false);
  assert.deepEqual(ids(w.queryFiltered(all, [added(A)], A)), ids(w.query(A)));
  assert.ok(ids(w.queryFiltered(all, [changed(A)], A)).includes(first));
  const now = w.changeCursor();
  assert.deepEqual(ids(w.queryFiltered(now, [changed(A)], A)), [], 'a cursor at the current tick sees nothing old');
  // A later sinceLastRun system on this world sees everything on its first run.
  const seen: Entity[][] = [];
  sinceLastRun<World>({
    id: 'late',
    world: x => x,
    run: (x, _dt, since) => void seen.push(ids(x.queryFiltered(since, [added(A)], A)) as Entity[]),
  }).run(w, 0);
  assert.equal(seen[0]!.length, 13);
});

test('change ticks: disposing a cursor during a filtered pass stops the pass with an error', () => {
  const w = new World();
  w.trackChanges(A);
  const c = w.changeCursor({fromStart: true});
  w.spawn(A());
  w.spawn(A());
  assert.throws(() => {
    for (const _ of w.queryFiltered(c, [added(A)], A)) c.dispose();
  }, /disposed during iteration/);
});

test('markChanged: refuses without the component and changes nothing; otherwise counts as a touch', () => {
  const w = new World();
  const e = w.spawn(A());
  const v = w.version;
  assert.equal(w.markChanged(e, B), false);
  assert.equal(w.markChanged(999, A), false);
  assert.equal(w.version, v);
  assert.equal(w.markChanged(e, A), true);
  assert.equal(w.version, v + 1);
  assert.equal(w.changeTick, 0, 'an untracked type records no tick');
});

test('observers: queued until flush, in mutation then registration order; despawn reports removes then despawn', () => {
  const w = new World();
  const log: string[] = [];
  const rec = (tag: string) => (ev: ObserverEvent) => log.push(`${tag}:${ev.entity}:${ev.type?.id ?? '-'}`);
  w.observe({on: 'add', type: A, run: rec('add1')});
  w.observe({on: 'add', type: A, run: rec('add2')});
  w.observe({on: 'remove', type: A, run: rec('rm')});
  w.observe({on: 'remove', type: B, run: rec('rm')});
  w.observe({on: 'change', type: A, run: rec('ch')});
  w.observe({on: 'despawn', run: rec('gone')});
  const e = w.spawn(A(), B());
  w.add(e, A({n: 1}));
  w.markChanged(e, A);
  let removedValue: object | undefined;
  w.observe({on: 'remove', type: B, run: ev => (removedValue = ev.value)});
  const b = w.get(e, B);
  w.despawn(e);
  assert.deepEqual(log, [], 'nothing runs before the flush');
  const report = w.flushObservers();
  assert.deepEqual(log, [
    `add1:${e}:a`,
    `add2:${e}:a`,
    `ch:${e}:a`,
    `ch:${e}:a`,
    `rm:${e}:a`,
    `rm:${e}:b`,
    `gone:${e}:-`,
  ]);
  assert.equal(removedValue, b, 'remove events carry the removed value');
  assert.deepEqual(report, {delivered: 8, dropped: 0, deferred: 0, reentrant: false});
});

test('observers: mutations made by an observer are delivered in the same flush; a nested flush does nothing', () => {
  const w = new World();
  const log: string[] = [];
  let nested: unknown;
  w.observe({
    on: 'add',
    type: A,
    run: ev => {
      log.push(`a${ev.entity}`);
      if (w.get(ev.entity, A)!.n < 2) w.add(w.spawn(), A({n: w.get(ev.entity, A)!.n + 1}));
      nested = w.flushObservers();
    },
  });
  w.spawn(A());
  assert.equal(w.flushObservers().delivered, 3);
  assert.deepEqual(log, ['a1', 'a2', 'a3']);
  assert.deepEqual(nested, {delivered: 0, dropped: 0, deferred: 0, reentrant: true});
});

test('observers: unsubscribing during a flush stops that observer at once', () => {
  const w = new World();
  const log: number[] = [];
  const o = w.observe({
    on: 'add',
    type: A,
    run: ev => {
      log.push(ev.entity);
      o.unsubscribe();
    },
  });
  w.spawn(A());
  w.spawn(A());
  w.flushObservers();
  assert.deepEqual(log, [1]);
  assert.equal(o.active, false);
  o.unsubscribe(); // idempotent
  assert.equal(w.trackingStats().observers, 0);
});

test('observers: a full queue drops events and reports them once per flush', () => {
  const w = new World();
  w.configureTracking({maxQueued: 3});
  const seen: number[] = [],
    overflow: number[] = [];
  const o = w.observe({on: 'add', type: A, run: ev => seen.push(ev.entity), overflow: n => overflow.push(n)});
  for (let i = 0; i < 5; i++) w.spawn(A());
  assert.equal(o.dropped, 2);
  const r = w.flushObservers();
  assert.deepEqual(seen, [1, 2, 3]);
  assert.deepEqual(overflow, [2]);
  assert.equal(r.dropped, 2);
  assert.equal(w.flushObservers().dropped, 0);
  assert.deepEqual(overflow, [2]);
  assert.equal(w.trackingStats().dropped, 2);
});

test('observers: an unsubscribed observer releases its queued events from the bound', () => {
  const w = new World();
  w.configureTracking({maxQueued: 2});
  const seen: number[] = [];
  const gone = w.observe({on: 'add', type: A, run: () => assert.fail('unsubscribed')});
  w.spawn(A());
  w.spawn(A());
  assert.equal(w.trackingStats().queued, 2);
  gone.unsubscribe();
  assert.equal(w.trackingStats().queued, 0);
  w.observe({on: 'add', type: A, run: ev => seen.push(ev.entity)});
  w.spawn(A());
  w.spawn(A());
  const r = w.flushObservers();
  assert.deepEqual(seen, [3, 4]);
  assert.equal(r.dropped, 0);
  assert.equal(gone.dropped, 0);
});

test('observers: an idle flush returns one shared frozen report', () => {
  const w = new World();
  const idle = w.flushObservers();
  assert.ok(Object.isFrozen(idle));
  w.observe({on: 'despawn', run: () => {}});
  assert.equal(w.flushObservers(), idle);
  w.despawn(w.spawn());
  assert.deepEqual(w.flushObservers(), {delivered: 1, dropped: 0, deferred: 0, reentrant: false});
  assert.equal(w.flushObservers(), idle);
});

test('observers: the per-flush delivery bound defers the rest to the next flush', () => {
  const w = new World();
  w.configureTracking({maxDeliveriesPerFlush: 2});
  const seen: number[] = [];
  w.observe({on: 'add', type: A, run: ev => seen.push(ev.entity)});
  for (let i = 0; i < 5; i++) w.spawn(A());
  assert.deepEqual(w.flushObservers(), {delivered: 2, dropped: 0, deferred: 3, reentrant: false});
  w.flushObservers();
  w.flushObservers();
  assert.deepEqual(seen, [1, 2, 3, 4, 5]);
});

test('observers: errors are collected, siblings still run, and the flush throws them together', () => {
  const w = new World();
  const seen: string[] = [];
  w.observe({
    on: 'add',
    type: A,
    run: () => {
      throw Error('first');
    },
  });
  w.observe({on: 'add', type: A, run: () => seen.push('second')});
  w.spawn(A());
  w.spawn(A());
  assert.throws(
    () => w.flushObservers(),
    (e: unknown) => e instanceof AggregateError && e.errors.length === 2,
  );
  assert.deepEqual(seen, ['second', 'second']);
  assert.equal(w.trackingStats().observerErrors, 2);
  assert.equal(w.trackingStats().queued, 0);
});

test('observers: invalid specs and the observer bound are refused', () => {
  const w = new World();
  const run = () => {};
  assert.throws(() => w.observe({on: 'add', run}), /needs a type/);
  assert.throws(() => w.observe({on: 'despawn', type: A, run}), /no type/);
  assert.throws(() => w.observe({on: 'moved' as 'add', type: A, run}), /must be one of/);
  assert.throws(() => w.observe({on: 'add', type: A} as never), /run must be a function/);
  const bounded = new World();
  bounded.configureTracking({maxObservers: 1});
  const o = bounded.observe({on: 'despawn', run});
  assert.throws(() => bounded.observe({on: 'despawn', run}), RangeError);
  o.unsubscribe();
  bounded.observe({on: 'despawn', run});
});

test('cached query: same rows and order as query, maintained across structural changes', () => {
  const w = new World();
  const e1 = w.spawn(A(), B()),
    e2 = w.spawn(A()),
    e3 = w.spawn(B(), A());
  const q = w.cachedQuery(A, B);
  assert.deepEqual([...q], [...w.query(A, B)]);
  w.add(e2, B()); // joins out of order (below e3)
  w.remove(e1, A);
  const e4 = w.spawn(A(), B());
  assert.deepEqual([...q], [...w.query(A, B)]);
  assert.deepEqual(ids(q), [e2, e3, e4]);
  assert.equal(q.size, 3);
  assert.equal(q.has(e1), false);
  w.add(e3, A({n: 9})); // replace: still a member, new value
  assert.equal([...q].find(r => r[0] === e3)![1].n, 9);
});

test('cached query: an entity that left before the pass and rejoins during it is not visited', () => {
  const w = new World();
  const es = [w.spawn(A()), w.spawn(A()), w.spawn(A())];
  const q = w.cachedQuery(A);
  w.remove(es[1]!, A); // leaves before the pass
  const seen: Entity[] = [];
  for (const [e] of q) {
    seen.push(e);
    if (e === es[0]) w.add(es[1]!, A()); // rejoins before it would be reached
  }
  assert.deepEqual(seen, [es[0], es[2]]);
  assert.deepEqual(
    seen,
    ids(w.query(A)).filter(e => e !== es[1]),
  );
  assert.deepEqual(ids(q), es, 'the next pass sees it');
});

test('cached query: despawn and removal during iteration are skipped; spawns wait for the next pass', () => {
  const w = new World();
  const es = Array.from({length: 5}, () => w.spawn(A()));
  const q = w.cachedQuery(A);
  const seen: Entity[] = [];
  for (const [e, a] of q) {
    assert.ok(a);
    seen.push(e);
    if (e === es[0]) {
      w.despawn(es[1]!);
      w.remove(es[2]!, A);
      w.spawn(A());
      w.despawn(e);
    }
    if (e === es[3]) {
      w.remove(es[2]!, A); // already gone
      w.add(es[2]!, A()); // rejoins after its turn in the pass: not revisited
    }
  }
  assert.deepEqual(seen, [es[0], es[3], es[4]]);
  assert.deepEqual(ids(q), ids(w.query(A)));
});

test('cached query: dispose ends an iteration in progress; later use throws; bounds are checked', () => {
  const w = new World();
  for (let i = 0; i < 4; i++) w.spawn(A());
  const q = w.cachedQuery(A);
  const seen: Entity[] = [];
  for (const [e] of q) {
    seen.push(e);
    if (seen.length === 2) q.dispose();
  }
  assert.deepEqual(seen, [1, 2]);
  assert.equal(q.disposed, true);
  assert.throws(() => q[Symbol.iterator](), /disposed/, 'refused when the iterator is created');
  q.dispose(); // idempotent
  w.spawn(A()); // no longer maintained, no error
  assert.equal(q.size, 0);
  assert.throws(() => w.cachedQuery(), /at least one/);
  const bounded = new World();
  bounded.configureTracking({maxCachedQueries: 1});
  const one = bounded.cachedQuery(A);
  assert.throws(() => bounded.cachedQuery(B), RangeError);
  one.dispose();
  assert.equal(bounded.trackingStats().cachedQueries, 0);
  bounded.cachedQuery(B);
});

test('configureTracking: limits are positive safe integers, maxTick at least 8', () => {
  for (const bad of [
    {maxQueued: 0},
    {maxObservers: 1.5},
    {maxTick: 7},
    {maxCursors: -1},
    {maxTick: Number.MAX_SAFE_INTEGER},
  ])
    assert.throws(() => new World().configureTracking(bad), RangeError);
  new World().configureTracking({maxTick: 8, maxQueued: 1});
});

test('runner: afterSystem runs after each system; an error it throws is reported under that system id', () => {
  const order: string[] = [];
  const reported: string[] = [];
  const runner = createSystemRunner(
    [
      {id: 'one', run: () => order.push('one')},
      {
        id: 'two',
        run: () => {
          throw Error('system');
        },
      },
      {id: 'three', phase: 'frame', run: () => order.push('three')},
    ],
    {
      step: 1,
      report: id => reported.push(id),
      afterSystem: id => {
        order.push(`after-${id}`);
        if (id === 'one') throw Error('hook');
      },
    },
  );
  runner.frame(null, 1);
  assert.deepEqual(order, ['one', 'after-one', 'after-two', 'three', 'after-three']);
  assert.deepEqual(reported, ['one', 'two']);
  assert.equal(runner.stats.errors, 2);
});

test('runner: a system failure and its afterSystem failure are reported once, together', () => {
  const reported: [string, unknown][] = [];
  const runner = createSystemRunner(
    [
      {
        id: 'both',
        run: () => {
          throw Error('system');
        },
      },
    ],
    {
      step: 1,
      report: (id, error) => reported.push([id, error]),
      afterSystem: () => {
        throw Error('hook');
      },
    },
  );
  runner.frame(null, 1);
  assert.equal(reported.length, 1);
  assert.equal(runner.stats.errors, 1);
  const [id, error] = reported[0]!;
  assert.equal(id, 'both');
  assert.ok(error instanceof AggregateError);
  assert.deepEqual(
    error.errors.map((e: Error) => e.message),
    ['system', 'hook'],
  );
});

test('sinceLastRun: first run sees everything; then changes since its last successful run; a throw repeats them', () => {
  const w = new World();
  w.trackChanges(A);
  const e = w.spawn(A());
  let fail = false;
  const seen: Entity[][] = [];
  const system = sinceLastRun<World>({
    id: 'watch',
    world: ctx => ctx,
    run(ctx, _dt, since) {
      seen.push(ids(ctx.queryFiltered(since, [changed(A)], A)) as Entity[]);
      if (fail) throw Error('later');
    },
  });
  assert.equal(system.phase, 'fixed');
  system.run(w, 0); // first run: the earlier spawn counts
  system.run(w, 0);
  w.markChanged(e, A);
  fail = true;
  assert.throws(() => system.run(w, 0));
  fail = false;
  system.run(w, 0);
  system.run(w, 0);
  assert.deepEqual(seen, [[e], [], [e], [e], []]);
  const other = new World();
  other.trackChanges(A);
  other.spawn(A());
  system.run(other, 0);
  system.run(other, 0);
  assert.deepEqual(seen.slice(-2), [[1], []], 'a separate cursor per world');
  assert.equal(other.trackingStats().cursors, 1);
  assert.equal(w.trackingStats().cursors, 1);
});
