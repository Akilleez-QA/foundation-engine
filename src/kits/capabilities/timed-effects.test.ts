import test from 'node:test';
import assert from 'node:assert/strict';
import { defineScene, defineSystem, testScene } from '../../author';
import { createTimedEffects, type TimedEffectInput, type EffectAdmission } from './timed-effects';

const effect = (key = 'source', expiresAt = 3): TimedEffectInput => ({ key, expiresAt, modifiers: [{ stat: 'speed', add: 2, multiply: 1 }] });
const admitted = (result: EffectAdmission) => { assert.equal(result.kind, 'applied'); if (result.kind !== 'applied') throw Error(); return result.effect; };

test('effect limits reject forged array lengths without coercion or partial admission', () => {
  const owner = createTimedEffects({base:{speed:1},now:0,maxModifiers:1});
  let coercions=0;
  for (const length of [NaN, -1, .5, Infinity, {valueOf(){coercions++;return 0;}}]) {
    const modifiers = new Proxy([{stat:'speed',add:1,multiply:1},{stat:'speed',add:1,multiply:1}], {
      get(target,key,receiver) {return key==='length'?length:Reflect.get(target,key,receiver);},
    });
    assert.throws(()=>owner.apply({key:'forged',expiresAt:3,modifiers},'stack'),/contribution limit/);
    assert.equal(owner.size,0);assert.equal(owner.values().speed,1);
  }
  assert.equal(coercions,0);
});

test('effects make conflict policy explicit and retain immutable source facts', () => {
  const owner = createTimedEffects({ base: { speed: 10 }, now: 0 });
  const source = effect();
  const first = admitted(owner.apply(source, 'stack'));
  (source.modifiers[0] as { add: number }).add = 500;
  assert.equal(owner.values().speed, 12);
  assert.equal(owner.apply(effect(), 'reject').kind, 'conflict');
  admitted(owner.apply(effect(), 'stack'));
  assert.equal(owner.values().speed, 14);
  const replacement = admitted(owner.apply(effect('source', 4), 'replace'));
  assert.equal(owner.size, 1);
  assert.equal(owner.values().speed, 12);
  assert.equal(owner.cancel(first.handle), false);
  assert.equal(owner.cancel({ ...replacement.handle }), false);
  assert.equal(owner.cancel(replacement.handle), true);
  assert.equal(owner.cancel(replacement.handle), false);
  assert.equal(owner.values().speed, 10);
  assert.ok(Object.isFrozen(first.modifiers[0]));
  assert.ok(Object.isFrozen(first.handle));
  assert.ok(Object.isFrozen(owner.values()));
  assert.ok(Object.isFrozen(owner.snapshot()));
  const other = createTimedEffects({ base: { speed: 10 }, now: 0 });
  admitted(other.apply(effect(), 'stack'));
  assert.equal(other.cancel(first.handle), false, 'previous session handles are not accepted');
});

test('expiry and cancellation rebuild from base and deadline is inclusive', () => {
  const owner = createTimedEffects({ base: { speed: 10 }, now: -1 });
  admitted(owner.apply(effect('second', 2), 'stack'));
  admitted(owner.apply(effect('first', 2), 'stack'));
  assert.deepEqual(owner.advance(1), []);
  assert.equal(owner.values().speed, 14);
  assert.deepEqual(owner.advance(2).map(e => e.key), ['first', 'second']);
  assert.equal(owner.values().speed, 10);
  assert.equal(owner.apply(effect('late', 2), 'stack').kind, 'expired');
  for (const value of [1, NaN, Infinity]) assert.throws(() => owner.advance(value));
  assert.equal(owner.now, 2);
  assert.throws(() => owner.apply(effect('bad', NaN), 'stack'));
  admitted(owner.apply(effect(), 'stack'));
  assert.equal(owner.cancelAll().length, 1);
  assert.equal(owner.cancelAll().length, 0);
});

test('bounds and invalid contributions leave state unchanged with explicit capacity', () => {
  const owner = createTimedEffects({ base: { speed: 10 }, now: 0, maxEffects: 1, maxModifiers: 1 });
  const first = admitted(owner.apply(effect(), 'stack'));
  assert.equal(owner.apply(effect('other'), 'stack').kind, 'capacity');
  assert.equal(owner.apply(effect(), 'stack').kind, 'capacity');
  assert.throws(() => owner.apply({ ...effect(), modifiers: [{ stat: 'missing', add: 1, multiply: 1 }] }, 'replace'));
  assert.throws(() => owner.apply(effect(), undefined as never));
  assert.equal(owner.snapshot()[0], first);
  assert.equal(owner.values().speed, 12);
  for (const maxModifiers of [0, 65, NaN, 1.5]) assert.throws(() => createTimedEffects({ base: {}, now: 0, maxModifiers }));
  for (const maxEffects of [0, 4097, NaN, 1.5]) assert.throws(() => createTimedEffects({ base: {}, now: 0, maxEffects }));
  assert.throws(() => createTimedEffects({ base: { speed: NaN }, now: 0 }));
});

test('failed expiry or cancellation arithmetic preserves time, handles and values; whole clear recovers', () => {
  const owner = createTimedEffects({ base: { speed: 1e308 }, now: 0 });
  const reduced = admitted(owner.apply({ key: 'reduce', expiresAt: 1, modifiers: [{ stat: 'speed', add: 0, multiply: .5 }] }, 'stack'));
  admitted(owner.apply({ key: 'increase', expiresAt: 2, modifiers: [{ stat: 'speed', add: 0, multiply: 2 }] }, 'stack'));
  assert.equal(owner.values().speed, 1e308);
  assert.throws(() => owner.advance(1), /overflow/);
  assert.equal(owner.now, 0);
  assert.throws(() => owner.cancel(reduced.handle), /overflow/);
  assert.equal(owner.size, 2);
  assert.equal(owner.values().speed, 1e308);
  assert.equal(owner.advance(2).length, 2, 'batch retirement does not evaluate unsafe intermediate removal');
  assert.equal(owner.values().speed, 1e308);
  assert.throws(() => owner.apply({ key: 'overflow', expiresAt: 3, modifiers: [{ stat: 'speed', add: 0, multiply: 2 }] }, 'stack'), /overflow/);
  assert.equal(owner.size, 0);
});

test('capture does not execute array methods and reentrant getters cannot mutate the owner', () => {
  const owner = createTimedEffects({ base: { speed: 10 }, now: 0 });
  let reads = 0;
  const values = [{ get stat() { reads++; assert.throws(() => owner.advance(1), /reentrant/); return 'speed'; }, add: 2, multiply: 1 }];
  values.map = () => { throw Error('caller method'); };
  values.some = () => { throw Error('caller method'); };
  admitted(owner.apply({ ...effect(), modifiers: values }, 'stack'));
  assert.equal(reads, 1);
  assert.equal(owner.now, 0);
  assert.throws(() => owner.apply({ ...effect(), get expiresAt() { owner.cancelAll(); return 3; } }, 'replace'), /reentrant/);
  assert.equal(owner.size, 1);
});

test('headless scene consumes derived speed and retires temporary contributions on exit', async () => {
  const effects = createTimedEffects({ base: { speed: 2 }, now: 0 });
  const active = admitted(effects.apply({ key: 'calibration', expiresAt: .5, modifiers: [{ stat: 'speed', add: 2, multiply: 1 }] }, 'reject'));
  let distance = 0;
  const scene = await testScene(defineScene({ id: 'effects-consumer', title: 'effects.title',
    systems: [defineSystem({ id: 'effects-consumer', phase: 'frame', run(ctx, dt) {
      effects.advance(ctx.time.t);
      distance += effects.values().speed * dt;
    } })], exit() { effects.cancelAll(); },
  }));
  scene.run(.25);
  assert.ok(Math.abs(distance - 1) < 1e-12);
  scene.run(.3);
  assert.ok(distance > 1);
  assert.equal(effects.values().speed, 2);
  assert.equal(effects.cancel(active.handle), false);
  admitted(effects.apply({ ...effect(), expiresAt: 2 }, 'stack'));
  scene.dispose();
  assert.equal(effects.size, 0);
  assert.equal(effects.values().speed, 2);
});

test('source-key ordering is independent of admission order and total contributions are bounded', () => {
  const inputs = [
    { key: 'a', expiresAt: 5, modifiers: [{ stat: 'speed', add: 1e16, multiply: 1 }] },
    { key: 'b', expiresAt: 5, modifiers: [{ stat: 'speed', add: -1e16, multiply: 1 }] },
    { key: 'c', expiresAt: 5, modifiers: [{ stat: 'speed', add: 1, multiply: 1 }] },
  ];
  const forward = createTimedEffects({ base: { speed: 0 }, now: 0 });
  const reverse = createTimedEffects({ base: { speed: 0 }, now: 0 });
  for (const input of inputs) admitted(forward.apply(input, 'stack'));
  for (const input of [...inputs].reverse()) admitted(reverse.apply(input, 'stack'));
  assert.equal(forward.values().speed, 1);
  assert.deepEqual(reverse.values(), forward.values());
  const bounded = createTimedEffects({ base: { speed: 0 }, now: 0, maxModifiers: 1, maxEffects: 5 });
  admitted(bounded.apply(inputs[0], 'stack'));
  assert.equal(bounded.apply(inputs[1], 'stack').kind, 'capacity');
  admitted(bounded.apply({ ...inputs[1], key: 'a' }, 'replace'));
  assert.equal(bounded.size, 1);
  assert.equal(bounded.values().speed, -1e16);
});
