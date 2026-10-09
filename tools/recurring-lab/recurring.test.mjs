import test from 'node:test';
import assert from 'node:assert/strict';
import {initialPhase, restorePhase, planDue, deadline} from './phase.ts';
import {createStation, createAlerts} from './consumers.mjs';
import {createClock} from '../../src/core/clock.ts';
import {defineSaveSection} from '../../src/author/index.ts';
import {authorSaveHandle} from '../../src/author/save-handle.ts';
import {createSaveStore} from '../../src/core/save/store.ts';
import {MemoryBackend} from '../../src/core/save/storage-port.ts';
const definition = {id: 'pulse', revision: 1, firstAt: 2, period: 3, maxBatch: 2};
const section = defineSaveSection({id: 'recurring-test.run', scope: 'device', initial: {json: ''}});
const open = (backend, tab = 0) =>
  createSaveStore({
    local: backend.port(tab),
    session: new MemoryBackend().port(tab, 'session'),
    namespace: 'recurring-test',
    build: 'test',
    timers: {set: () => 0, clear: () => {}, now: () => 0},
  });
const setup = (factory, {backend = new MemoryBackend(), tab = 0, at = 0, policy = 'coalesce', capacity = 32} = {}) => {
  const runtime = createClock({realNow: () => 0, state: {ut: at, lastRealMs: null}});
  const store = open(backend, tab),
    save = authorSaveHandle(store, section);
  const owner = factory({clock: runtime.clock, save, definition, policy, capacity});
  return {...runtime, store, save, owner, backend};
};
test('exact phase boundaries, skip and coalesce preserve the original period', () => {
  const start = initialPhase(definition);
  assert.equal(planDue(start, 1.999, 'coalesce').firings.length, 0);
  assert.equal(planDue(start, 2, 'coalesce').firings[0].ordinal, 0);
  const coalesced = planDue(start, 12, 'coalesce');
  assert.equal(coalesced.due, 4);
  assert.equal(coalesced.firings.length, 1);
  assert.equal(coalesced.firings[0].at, 11);
  assert.equal(coalesced.firings[0].count, 4);
  assert.equal(deadline(coalesced.phase), 14);
  const skipped = planDue(start, 12, 'skip');
  assert.equal(skipped.firings.length, 0);
  assert.equal(skipped.phase.lastCommitted, null);
  assert.equal(deadline(skipped.phase), 14);
});
test('large jumps perform bounded replay with explicit backlog and no elapsed-period loop', () => {
  const start = initialPhase(definition);
  const replay = planDue(start, 1e12, 'replay');
  assert.equal(replay.firings.length, 2);
  assert.equal(replay.phase.next, 2);
  assert.equal(deadline(replay.phase), 8);
  assert.ok(replay.due > 1e10);
  const next = planDue(replay.phase, 1e12, 'replay');
  assert.deepEqual(
    next.firings.map(x => x.ordinal),
    [2, 3],
  );
  assert.equal(planDue(start, 1e12, 'coalesce').firings.length, 1);
});
test('malformed phase, changed definitions and arithmetic exhaustion fail without mutating input', () => {
  const start = initialPhase(definition),
    before = JSON.stringify(start);
  for (const raw of [
    {...start, next: -1},
    {...start, next: 1.5},
    {...start, lastCommitted: 0},
    {...start, definition: {...definition, revision: 2}},
    {...start, extra: 1},
  ])
    assert.throws(() => restorePhase(definition, raw));
  assert.throws(() => planDue(start, Infinity, 'skip'));
  assert.throws(() => planDue(start, 12, 'default'));
  const huge = initialPhase({...definition, firstAt: Number.MAX_SAFE_INTEGER});
  assert.throws(() => planDue(huge, Number.MAX_SAFE_INTEGER, 'skip'), /overflow/);
  assert.equal(JSON.stringify(start), before);
  const hostile = {...start};
  Object.defineProperty(hostile, 'next', {
    get() {
      throw Error('invoked');
    },
  });
  assert.throws(() => restorePhase(definition, hostile), /accessor/);
});
test('existing clock pause prevents scheduled station delivery until resumed', () => {
  const {owner, clock, driver, store} = setup(createStation);
  owner.arm();
  clock.pause('overlay');
  for (let i = 0; i < 20; i++) driver.advance(0.25);
  assert.equal(clock.ut, 0);
  assert.equal(owner.read().value, 0);
  clock.resume('overlay');
  for (let i = 0; i < 8; i++) driver.advance(0.25);
  assert.equal(clock.ut, 2);
  assert.equal(owner.read().value, 1);
  assert.equal(owner.read().phase.next, 1);
  owner.dispose();
  store.dispose();
});
test('clock restore plus explicit arm handles large jumps once and never self-rearms', () => {
  const {owner, driver, store} = setup(createStation, {policy: 'replay'});
  driver.restore({ut: 1e12, lastRealMs: null});
  owner.arm();
  driver.advance(0.25);
  assert.equal(owner.read().value, 2);
  for (let i = 0; i < 4; i++) driver.advance(0.25);
  assert.equal(owner.read().value, 2);
  owner.arm();
  driver.advance(0.25);
  assert.equal(owner.read().value, 4);
  owner.dispose();
  store.dispose();
});
test('alert capacity failure preserves phase and receipt while releasing the scheduled attempt', () => {
  const {owner, driver, store} = setup(createAlerts, {at: 100, capacity: 2});
  const before = owner.read();
  owner.arm();
  assert.throws(() => driver.advance(0.25), /capacity/);
  assert.equal(owner.read(), before);
  assert.equal(owner.arm(), true);
  owner.dispose();
  store.dispose();
});
test('old callbacks retire on restore/disposal; malformed restore preserves the active attempt', () => {
  const runtime = createClock({realNow: () => 0, state: {ut: 2, lastRealMs: null}});
  const callbacks = [],
    schedule = runtime.clock.schedule;
  runtime.clock.schedule = (at, fn, signal) => {
    callbacks.push(fn);
    schedule(at, fn, signal);
  };
  const store = open(new MemoryBackend()),
    save = authorSaveHandle(store, section);
  const owner = createStation({clock: runtime.clock, save, definition, policy: 'coalesce', capacity: 4});
  owner.arm();
  assert.throws(() => owner.restore({...owner.read(), value: -1}));
  assert.equal(owner.arm(), false);
  const old = callbacks[0];
  runtime.driver.restore({ut: 2, lastRealMs: null});
  assert.equal(owner.restore(owner.read()), true);
  owner.arm();
  old();
  assert.equal(owner.read().value, 0);
  runtime.driver.advance(0.25);
  assert.equal(owner.read().value, 1);
  owner.arm();
  const late = callbacks.at(-1);
  owner.dispose();
  late();
  assert.equal(owner.read().value, 1);
  store.dispose();
});
test('reentrant restore is refused and disposal during capture cannot publish', () => {
  const {owner, store} = setup(createStation);
  const original = owner.read();
  const reentrant = new Proxy(original, {
    ownKeys(target) {
      assert.equal(owner.restore(original), false);
      assert.equal(owner.arm(), false);
      return Reflect.ownKeys(target);
    },
  });
  assert.equal(owner.restore(reentrant), true);
  const before = owner.read();
  const retire = new Proxy(
    {...before, value: 1},
    {
      ownKeys(target) {
        owner.dispose();
        return Reflect.ownKeys(target);
      },
    },
  );
  assert.equal(owner.restore(retire), false);
  assert.equal(owner.read(), before);
  store.dispose();
});
test('real SaveStore resumes both consumer phases, preserves receipts and rejects changed definitions', () => {
  for (const factory of [createStation, createAlerts]) {
    const first = setup(factory);
    first.driver.restore({ut: 9, lastRealMs: null});
    first.owner.arm();
    first.driver.advance(0.25);
    assert.equal(first.owner.status, 'staged');
    assert.equal(first.backend.writes, 0);
    assert.equal(first.owner.retrySave(), 'saved');
    const durable = first.owner.read();
    first.owner.dispose();
    first.store.dispose();
    const second = setup(factory, {backend: first.backend, tab: 1, at: durable.time});
    assert.deepEqual(second.owner.read(), durable);
    second.owner.arm();
    second.driver.advance(0.25);
    assert.equal(second.owner.read().value, durable.value);
    second.owner.dispose();
    second.store.dispose();
    const check = open(first.backend, 2);
    assert.throws(
      () =>
        factory({
          clock: first.clock,
          save: authorSaveHandle(check, section),
          definition: {...definition, revision: 2},
          policy: 'coalesce',
          capacity: 32,
        }),
      /incompatible/,
    );
    check.dispose();
  }
});
test('failed durability reloads prior coherent phase/outcome/receipt and retry persists accepted memory', () => {
  const first = setup(createStation);
  first.driver.restore({ut: 2, lastRealMs: null});
  first.owner.arm();
  first.driver.advance(0.25);
  assert.equal(first.owner.retrySave(), 'saved');
  const saved = first.owner.read();
  first.backend.failSet = () => true;
  first.driver.restore({ut: 5, lastRealMs: null});
  first.owner.arm();
  first.driver.advance(0.25);
  assert.notEqual(first.owner.retrySave(), 'saved');
  assert.equal(first.owner.read().value, 2);
  first.owner.dispose();
  first.store.dispose();
  first.backend.failSet = () => false;
  const second = setup(createStation, {backend: first.backend, tab: 1, at: saved.time});
  assert.deepEqual(second.owner.read(), saved);
  second.driver.restore({ut: 5, lastRealMs: null});
  second.owner.arm();
  second.driver.advance(0.25);
  assert.equal(second.owner.read().value, 2);
  assert.equal(second.owner.retrySave(), 'saved');
  second.owner.dispose();
  second.store.dispose();
});

test('mid-period checkpoint saves existing clock time without resetting recurring phase', () => {
  const first = setup(createStation);
  first.driver.restore({ut: 3.5, lastRealMs: null});
  first.owner.arm();
  first.driver.advance(0.25);
  first.driver.advance(0.25);
  assert.equal(first.owner.retrySave(), 'saved');
  const saved = first.owner.read();
  assert.equal(saved.time, 4);
  assert.equal(deadline(saved.phase), 5);
  first.owner.dispose();
  first.store.dispose();
  const second = setup(createStation, {backend: first.backend, tab: 1, at: saved.time});
  second.owner.arm();
  for (let i = 0; i < 3; i++) second.driver.advance(0.25);
  assert.equal(second.owner.read().value, 1);
  second.driver.advance(0.25);
  assert.equal(second.owner.read().value, 2);
  second.owner.dispose();
  second.store.dispose();
});

test('mid-period save while armed preserves both consumer schedules, including failed durability', () => {
  for (const factory of [createStation, createAlerts])
    for (const fail of [false, true]) {
      const {owner, driver, store, backend} = setup(factory);
      owner.arm();
      driver.advance(0.25);
      backend.failSet = () => fail;
      const status = owner.retrySave();
      assert.equal(status === 'saved', !fail);
      for (let i = 0; i < 7; i++) driver.advance(0.25);
      assert.equal(owner.read().value, 1);
      assert.equal(owner.read().phase.next, 1);
      assert.equal(owner.arm(), true);
      owner.dispose();
      store.dispose();
    }
});
