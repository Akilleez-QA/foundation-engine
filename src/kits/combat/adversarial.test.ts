import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveAction} from './index';
test('combat snapshots validated intent before rule callbacks mutate caller data', () => {
  const input = {id: 'a', target: 't', amount: 2};
  const result = resolveAction(input, {
    eligible: () => {
      input.amount = NaN;
      input.target = 'wrong';
      return true;
    },
    hit: () => true,
    mitigate: n => n,
    commit: () => true,
  });
  assert.equal(result?.applied, 2);
  assert.equal(result?.target, 't');
  assert.ok(Object.isFrozen(result));
});
test('sweep scaling preserves separation below the unscaled quadratic underflow threshold', async () => {
  const {sweep} = await import('./index');
  assert.equal(
    sweep([0, 0, 0], [0, 0, 0], 0, [{id: 'tiny', from: [1e-250, 0, 0], to: [1e-250, 0, 0], radius: 0}]),
    null,
  );
});
