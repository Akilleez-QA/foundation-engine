import test from 'node:test';
import assert from 'node:assert/strict';
import {createTimedEffects} from './timed-effects';
import {defineSaveSection} from '../../author';
import {authorSaveHandle} from '../../author/save-handle';
import {createSaveStore} from '../../core/save/store';
import {MemoryBackend} from '../../core/save/storage-port';

const config = {base: {amount: 1}, now: 0, maxEffects: 4, maxModifiers: 8};
const input = (key = 'calibration', expiresAt = 5, add = 1) => ({
  key,
  expiresAt,
  modifiers: [{stat: 'amount', add, multiply: 1}],
});
const populate = () => {
  const owner = createTimedEffects(config);
  owner.apply(input(), 'stack');
  owner.apply(input('calibration', 8, 2), 'stack');
  owner.advance(2);
  return owner;
};
test('portable checkpoint preserves ordering, configuration and fresh cancellation identity', () => {
  const owner = populate();
  const old = owner.snapshot()[0]!.handle;
  const saved = owner.checkpoint();
  assert.equal(Object.isFrozen(saved.effects[0]!.modifiers[0]), true);
  assert.equal('handle' in saved.effects[0]!, false);
  const other = createTimedEffects(config);
  const fresh = other.restore(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(other.checkpoint(), saved);
  assert.equal(other.cancel(old), false);
  assert.equal(other.cancel({...fresh[0]!.handle}), false);
  owner.restore(saved);
  assert.equal(owner.cancel(old), false);
  assert.equal(other.cancel(fresh[0]!.handle), true);
  assert.equal(other.values().amount, 3);
});
test('checkpoint continuation agrees before, at and after exact expiry including stacked keys', () => {
  const owner = populate(),
    restored = createTimedEffects(config);
  restored.restore(owner.checkpoint());
  for (const time of [4.99, 5, 5.01, 7.99, 8, 8.01]) {
    assert.deepEqual(
      restored.advance(time).map(x => x.key),
      owner.advance(time).map(x => x.key),
    );
    assert.deepEqual(restored.values(), owner.values());
    assert.deepEqual(restored.checkpoint(), owner.checkpoint());
  }
});
test('restoration validates final aggregate once, avoiding unsafe admission prefixes', () => {
  const owner = createTimedEffects({base: {amount: 1e308}, now: 0});
  owner.apply({key: 'z', expiresAt: 9, modifiers: [{stat: 'amount', add: 0, multiply: 0.1}]}, 'stack');
  owner.apply({key: 'a', expiresAt: 9, modifiers: [{stat: 'amount', add: 0, multiply: 10}]}, 'stack');
  const restored = createTimedEffects({base: {amount: 1e308}, now: 20});
  assert.throws(() => restored.apply({...owner.checkpoint().effects[0]!, expiresAt: 30}, 'stack'), /overflow/);
  restored.restore(owner.checkpoint());
  assert.equal(restored.now, 0);
  assert.equal(restored.values().amount, 1e308);
  assert.equal(restored.advance(9).length, 2);
});
test('malformed, oversized, incompatible and overflowing checkpoints preserve current state and handles', () => {
  const owner = populate(),
    saved = owner.checkpoint(),
    handle = owner.snapshot()[0]!.handle;
  const copy = () => JSON.parse(JSON.stringify(saved));
  const malformed = [
    {...saved, version: 2},
    {...saved, now: NaN},
    {...saved, now: 5},
    {...saved, maxEffects: 5},
    {...saved, base: {amount: 2}},
    {...saved, effects: Array(5).fill(saved.effects[0])},
    {...saved, effects: [{...saved.effects[0], modifiers: Array(9).fill(saved.effects[0]!.modifiers[0])}]},
    {...saved, effects: [{...saved.effects[0], modifiers: [{stat: 'absent', add: 0, multiply: 1}]}]},
    {...saved, effects: [{...saved.effects[0], modifiers: [{stat: 'amount', add: 1e308, multiply: 1e308}]}]},
  ];
  const hole = copy();
  delete hole.effects[0];
  malformed.push(hole);
  const accessor = copy();
  Object.defineProperty(accessor.effects[0], 'key', {
    get() {
      throw Error('must not invoke');
    },
  });
  malformed.push(accessor);
  const iterator = copy();
  iterator.effects[Symbol.iterator] = function* () {
    throw Error('must not invoke');
  };
  malformed.push(iterator);
  for (const value of malformed) {
    assert.throws(() => owner.restore(value));
    assert.deepEqual(owner.checkpoint(), saved);
    assert.equal(owner.snapshot()[0]!.handle, handle);
  }
  assert.equal(owner.cancel(handle), true);
});
test('successful empty restoration clears contributions and retires old handles', () => {
  const owner = populate(),
    old = owner.snapshot()[0]!.handle;
  owner.restore({...owner.checkpoint(), now: -1, effects: []});
  assert.equal(owner.now, -1);
  assert.equal(owner.size, 0);
  assert.equal(owner.values().amount, 1);
  assert.equal(owner.cancel(old), false);
});
test('restore rejects reentrant proxy mutation without changing accepted state', () => {
  const owner = populate(),
    saved = owner.checkpoint();
  const proxy = new Proxy(saved, {
    ownKeys(target) {
      owner.cancelAll();
      return Reflect.ownKeys(target);
    },
  });
  assert.throws(() => owner.restore(proxy), /reentrant/);
  assert.deepEqual(owner.checkpoint(), saved);
});
test('real SaveStore envelope resumes contribution projection and keeps acknowledged operations from replay', () => {
  // The amount projection uses the finite action consumer configuration.
  // Receipt ownership is deliberately in this creator envelope, not in the effect owner.
  const owner = populate();
  const section = defineSaveSection({id: 'effect-test.run', scope: 'device', initial: {json: ''}});
  const backend = new MemoryBackend();
  const open = (tab: number) =>
    createSaveStore({
      local: backend.port(tab),
      session: new MemoryBackend().port(tab, 'session'),
      namespace: 'effect-test',
      build: 'test',
      timers: {set: () => 0, clear: () => {}, now: () => 0},
    });
  const first = open(0);
  const checkpoint = {effects: owner.checkpoint(), receipt: 'accepted-1', resource: 4};
  assert.equal(
    authorSaveHandle(first, section).update(
      draft => {
        draft.json = JSON.stringify(checkpoint);
      },
      {now: true},
    ),
    'saved',
  );
  backend.failSet = () => true;
  const refused = authorSaveHandle(first, section).update(
    draft => {
      draft.json = JSON.stringify({...checkpoint, resource: 99});
    },
    {now: true},
  );
  assert.notEqual(refused, 'saved');
  first.dispose(); // The failed newer write must not replace the last durable envelope.
  backend.failSet = () => false;
  const second = open(1);
  const loaded: {effects: unknown; receipt: string; resource: number} = JSON.parse(
    authorSaveHandle(second, section).get().json,
  );
  const resumed = createTimedEffects(config);
  resumed.restore(loaded.effects);
  const deliver = (id: string) => {
    if (loaded.receipt === id) return false;
    loaded.resource += resumed.values().amount!;
    loaded.receipt = id;
    return true;
  };
  assert.equal(deliver('accepted-1'), false);
  assert.equal(loaded.resource, 4);
  for (const time of [4, 5, 8]) {
    owner.advance(time);
    resumed.advance(time);
    assert.deepEqual(resumed.values(), owner.values());
  }
  second.dispose();
});
