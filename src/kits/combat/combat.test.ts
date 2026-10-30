import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sweep, resolveAction, createShots} from './index';
test('relative sweep catches fast crossing and stable nearest target independent of order', () => {
  const targets = [
    {id: 'b', from: [5, 0, 0] as [number, number, number], to: [5, 0, 0] as [number, number, number], radius: 1},
    {id: 'a', from: [5, 0, 0] as [number, number, number], to: [5, 0, 0] as [number, number, number], radius: 1},
  ];
  assert.equal(sweep([0, 0, 0], [10, 0, 0], 0, targets)!.id, 'a');
  assert.ok(Math.abs(sweep([0, 0, 0], [10, 0, 0], 0, targets.reverse())!.time - 0.4) < 1e-12);
  assert.ok(sweep([0, 0, 0], [0, 0, 0], 1, [{id: 'moving', from: [-5, 0, 0], to: [5, 0, 0], radius: 1}]));
  assert.equal(sweep([0, 0, 0], [1, 0, 0], 0, [{id: 'far', from: [5, 0, 0], to: [5, 0, 0], radius: 1}]), null);
});
test('eligibility gates hit/mitigation and committed result requires no effects', () => {
  const calls: string[] = [];
  const result = resolveAction(
    {id: 'a', target: 'b', amount: 10},
    {
      eligible: () => false,
      hit: () => {
        calls.push('hit');
        return true;
      },
      mitigate: n => {
        calls.push('mitigate');
        return n;
      },
      commit: r => {
        calls.push('commit');
        assert.equal(r.applied, 0);
        return true;
      },
    },
  );
  assert.ok(result);
  assert.deepEqual(calls, ['commit']);
});
test('resolved/expired/cancelled shots cannot hit twice or resurrect; admission bounded', () => {
  const s = createShots(3);
  s.launch('one', 'pilot', 10);
  assert.equal(s.resolve('one', 1), true);
  assert.equal(s.resolve('one', 2), false);
  s.launch('two', 'pilot', 10);
  s.cancelOwner('pilot');
  assert.equal(s.resolve('two', 1), false);
  s.launch('three', 'other', 10);
  assert.equal(s.resolve('three', 10), false);
  assert.equal(s.launch('four', 'other', 20), false);
  assert.equal(s.launch('one', 'pilot', 20), false);
});
