import {test} from 'node:test';
import assert from 'node:assert/strict';
import {clearCamera} from './clearance';
test('camera rejects finite endpoints whose segment or footprint arithmetic overflows', () => {
  const big = Number.MAX_VALUE;
  assert.throws(() => clearCamera({position: [big, 0, 0], target: [-big, 0, 0]}, () => null));
  assert.throws(() => clearCamera({position: [big, 0, 1], target: [big, 0, 0]}, () => null, big));
});
test('camera snapshots its pose before an obstruction callback can mutate caller state', () => {
  const pose = {position: [0, 0, 10] as [number, number, number], target: [0, 0, 0] as [number, number, number]};
  const safe = clearCamera(pose, () => {
    pose.target[0] = NaN;
    return null;
  });
  assert.deepEqual(safe.position, [0, 0, 10]);
  assert.deepEqual(safe.target, [0, 0, 0]);
});
