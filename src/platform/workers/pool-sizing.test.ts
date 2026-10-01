import test from 'node:test';
import assert from 'node:assert/strict';
import { PROVISIONAL_WORKER_PROFILE, sizePool } from './pool-sizing.ts';

test('cap is hardwareConcurrency − 2 clamped to at least 1 and to the declared profile; warm never exceeds cap', () => {
  const p = PROVISIONAL_WORKER_PROFILE;
  assert.deepEqual([sizePool(32, p).cap, sizePool(32, p).warm], [30, 4]);
  assert.deepEqual([sizePool(3, p).cap, sizePool(3, p).warm], [1, 1]);
  assert.equal(sizePool(2, p).cap, 1);
  assert.equal(sizePool(undefined, p).cap, 1);
  assert.equal(sizePool(Number.NaN, p).cap, 1);
  assert.equal(sizePool(64, { ...p, maxSlots: 8 }).cap, 8, 'hardware concurrency is only a ceiling');
  assert.equal(sizePool(32, p).idleReleaseMs, 30_000);
});

test('profile limits must be positive', () => {
  assert.throws(() => sizePool(8, { maxSlots: 0, maxPending: 1, maxReservedBytes: 1 }), RangeError);
  assert.throws(() => sizePool(8, { maxSlots: 1, maxPending: 0, maxReservedBytes: 1 }), RangeError);
  assert.throws(() => sizePool(8, { maxSlots: 1, maxPending: 1, maxReservedBytes: -1 }), RangeError);
});
