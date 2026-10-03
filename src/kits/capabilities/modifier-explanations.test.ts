import test from 'node:test';
import assert from 'node:assert/strict';
import {createModifiers} from './modifiers';
import {createTimedEffects} from './timed-effects';
test('explanation shares aggregate arithmetic and original unfiltered source indices', () => {
  const owner = createModifiers({speed: 10, other: 1});
  owner.set('z', [
    {stat: 'other', add: 9, multiply: 1},
    {stat: 'speed', add: 3, multiply: 0.5},
  ]);
  owner.set('a', [{stat: 'speed', add: 2, multiply: 2}]);
  const trace = owner.explain('speed')!;
  assert.deepEqual(trace, {
    stat: 'speed',
    base: 10,
    additive: 5,
    multiplier: 1,
    value: 15,
    contributions: [
      {source: 'a', row: 0, stat: 'speed', add: 2, multiply: 2},
      {source: 'z', row: 1, stat: 'speed', add: 3, multiply: 0.5},
    ],
  });
  assert.equal(trace.value, owner.values().speed);
  assert.ok(Object.isFrozen(trace));
  assert.ok(Object.isFrozen(trace.contributions));
  assert.ok(trace.contributions.every(Object.isFrozen));
  owner.set('a', [{stat: 'speed', add: -2, multiply: 0}]);
  assert.equal(owner.explain('speed')!.value, 0);
  assert.equal(trace.value, 15);
  owner.remove('a');
  assert.equal(owner.explain('speed')!.value, 6.5);
  assert.equal(owner.explain('missing'), null);
  assert.equal(owner.explain('toString'), null);
});
test('explanations do not coerce identifiers or expose candidate mutations through getter reentry', () => {
  const owner = createModifiers({value: 1});
  let conversions = 0;
  assert.throws(() =>
    owner.explain({
      toString() {
        conversions++;
        owner.set('bad', []);
        return 'value';
      },
    } as never),
  );
  assert.equal(conversions, 0);
  owner.set('accepted', [{stat: 'value', add: 2, multiply: 1}]);
  const trace = owner.explain('value');
  assert.throws(() =>
    owner.set('next', [
      {
        stat: 'value',
        get add() {
          assert.deepEqual(owner.explain('value'), trace);
          owner.remove('accepted');
          return 4;
        },
        multiply: 1,
      },
    ]),
  );
  assert.deepEqual(owner.explain('value'), trace);
  const raw = {stat: 'value', add: 5, multiply: 1};
  owner.set('next', [raw]);
  raw.add = 999;
  assert.equal(owner.explain('value')!.value, 8);
});
test('trace arithmetic preserves source order, floating point behavior and refused removal', () => {
  const owner = createModifiers({value: 0});
  owner.set('a', [{stat: 'value', add: 1e308, multiply: 1}]);
  owner.set('b', [{stat: 'value', add: -1e308, multiply: 1}]);
  owner.set('c', [{stat: 'value', add: 1e308, multiply: 1}]);
  const trace = owner.explain('value');
  assert.equal(trace!.value, 1e308);
  assert.throws(() => owner.remove('b'), /overflow/);
  assert.deepEqual(owner.explain('value'), trace);
  const reversed = createModifiers({value: 0});
  for (const row of [...trace!.contributions].reverse())
    reversed.set(row.source, [{stat: row.stat, add: row.add, multiply: row.multiply}]);
  assert.deepEqual(reversed.explain('value'), trace);
});
test('timed explanations retain exact handles and effect-local rows across equal-key stacks', () => {
  const owner = createTimedEffects({base: {value: 10, other: 1}, now: 0});
  const a = owner.apply(
    {
      key: 'same',
      expiresAt: 5,
      modifiers: [
        {stat: 'other', add: 1, multiply: 1},
        {stat: 'value', add: 2, multiply: 2},
      ],
    },
    'stack',
  );
  const b = owner.apply({key: 'same', expiresAt: 6, modifiers: [{stat: 'value', add: 3, multiply: 0.5}]}, 'stack');
  assert.equal(a.kind, 'applied');
  assert.equal(b.kind, 'applied');
  if (a.kind !== 'applied' || b.kind !== 'applied') return;
  const trace = owner.explain('value')!;
  assert.equal(trace.value, 15);
  assert.equal(trace.now, 0);
  assert.deepEqual(
    trace.contributions.map(r => [r.row, r.effectRow, r.key, r.expiresAt]),
    [
      [1, 1, 'same', 5],
      [2, 0, 'same', 6],
    ],
  );
  assert.equal(trace.contributions[0]!.handle, a.effect.handle);
  assert.equal(trace.contributions[1]!.handle, b.effect.handle);
  assert.ok(Object.isFrozen(trace));
  assert.ok(Object.isFrozen(trace.contributions));
  assert.ok(trace.contributions.every(Object.isFrozen));
  assert.equal(owner.cancel({...trace.contributions[0]!.handle}), false);
  assert.equal(owner.cancel(trace.contributions[0]!.handle), true);
  assert.equal(trace.value, 15);
  assert.equal(owner.explain('value')!.value, 6.5);
  const c = owner.apply({key: 'same', expiresAt: 8, modifiers: [{stat: 'value', add: 1, multiply: 1}]}, 'replace');
  assert.equal(c.kind, 'applied');
  assert.equal(owner.explain('value')!.contributions.length, 1);
  owner.advance(8);
  assert.equal(owner.explain('value')!.now, 8);
  assert.equal(owner.explain('value')!.value, 10);
  assert.equal(owner.explain('unknown'), null);
  assert.throws(
    () =>
      owner.explain({
        toString() {
          throw Error('must not coerce');
        },
      } as never),
    /stat must/,
  );
});
test('refused expiry preserves accepted time, effect provenance and explanation until explicit recovery', () => {
  const owner = createTimedEffects({base: {value: 0}, now: 0});
  for (const [key, add, expiresAt] of [
    ['a', 1e308, 10],
    ['b', -1e308, 1],
    ['c', 1e308, 10],
  ] as const)
    assert.equal(
      owner.apply({key, expiresAt, modifiers: [{stat: 'value', add, multiply: 1}]}, 'stack').kind,
      'applied',
    );
  const trace = owner.explain('value')!,
    snapshot = owner.snapshot();
  assert.throws(() => owner.advance(1), /overflow/);
  assert.deepEqual(owner.explain('value'), trace);
  assert.deepEqual(owner.snapshot(), snapshot);
  assert.equal(owner.now, 0);
  owner.cancelAll();
  assert.equal(owner.explain('value')!.value, 0);
  assert.equal(owner.explain('value')!.now, 0);
  owner.advance(1);
  assert.equal(owner.explain('value')!.now, 1);
});
