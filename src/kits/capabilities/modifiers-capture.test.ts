import test from 'node:test';
import assert from 'node:assert/strict';
import { createModifiers, type Modifier } from './modifiers';

test('modifier capture uses indexed primitive facts, not array callbacks or iterators', () => {
  const owner = createModifiers({ value: 10 }); let reads = 0;
  const input: Modifier[] = [{ stat: 'value', get add() { reads++; return reads === 1 ? 2 : 999; }, multiply: 1 }];
  Object.defineProperty(input, 'some', { value() { throw Error('caller some'); } });
  Object.defineProperty(input, Symbol.iterator, { value() { throw Error('caller iterator'); } });
  owner.set('source', input); assert.equal(reads, 1); assert.equal(owner.values().value, 12);
});

test('forged modifier length cannot evade the contribution bound', () => {
  const owner = createModifiers({ value: 10 }); let coercions = 0;
  const input = new Proxy([{ stat: 'value', add: 2, multiply: 1 }], { get(target, key, receiver) {
    return key === 'length' ? { valueOf() { coercions++; return 1; } } : Reflect.get(target, key, receiver);
  } });
  assert.throws(() => owner.set('source', input), /invalid contribution/);
  assert.equal(coercions, 0); assert.equal(owner.values().value, 10);
});

test('modifier getter cannot remove accepted sources or bypass source capacity', () => {
  const owner = createModifiers({ value: 10 }, 1); owner.set('source', [{ stat: 'value', add: 2, multiply: 1 }]);
  assert.throws(() => owner.set('source', [{ stat: 'value', get add() { owner.remove('source'); return 5; }, multiply: 1 }]), /reentrant/);
  assert.equal(owner.values().value, 12);
  assert.throws(() => owner.set('second', [{ stat: 'value', add: 1, multiply: 1 }]), /invalid contribution/);
  owner.remove('source'); assert.equal(owner.values().value, 10);
});
