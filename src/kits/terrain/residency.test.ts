import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createResidency} from './residency';
const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
test('publication holds old coverage, budgets bytes and releases after successful swap', async () => {
  const freed: number[] = [];
  const r = createResidency<number>({requests: 2, resident: 2, bytes: 40}, v => freed.push(v));
  assert.equal(
    r.request('a', 1, 10, async () => 1),
    'accepted',
  );
  await settle();
  assert.equal(
    r.publish(1, 9, () => true),
    0,
  );
  assert.equal(
    r.publish(1, 10, () => true),
    1,
  );
  r.request('a', 2, 10, async () => 2);
  await settle();
  assert.equal(r.get('a'), 1);
  assert.equal(
    r.publish(1, 10, () => false),
    0,
  );
  assert.equal(r.get('a'), 1);
  r.publish(1, 10, () => true);
  assert.equal(r.get('a'), 2);
  assert.deepEqual(freed, [1]);
  r.close();
  r.close();
  assert.deepEqual(freed, [1, 2]);
  assert.equal(r.stats().bytes, 0);
});
test('cancellation retains running admission and disposes late results without publication', async () => {
  const freed: number[] = [];
  let resolve!: (n: number) => void;
  const r = createResidency<number>({requests: 1, resident: 1, bytes: 10}, v => freed.push(v));
  r.request('a', 1, 10, () => new Promise(r => (resolve = r)));
  await settle();
  r.cancel('a');
  assert.equal(
    r.request('a', 2, 10, async () => 2),
    'saturated',
  );
  r.close();
  resolve(1);
  await settle();
  assert.deepEqual(freed, [1]);
  assert.equal(r.stats().requests, 0);
  assert.equal(r.stats().bytes, 0);
  assert.equal(
    r.publish(1, 10, () => true),
    0,
  );
});
test('failed jobs release reservations and can retry; stale versions cannot replace resident values', async () => {
  const r = createResidency({requests: 1, resident: 1, bytes: 20}, () => {});
  r.request('a', 1, 10, async () => {
    throw Error('bad');
  });
  await settle();
  assert.equal(r.stats().bytes, 0);
  assert.equal(
    r.request('a', 1, 10, async () => 1),
    'accepted',
  );
  await settle();
  r.publish(1, 10, () => true);
  assert.equal(
    r.request('a', 1, 10, async () => 9),
    'stale',
  );
  assert.equal(
    r.request('b', 1, 10, async () => 3),
    'saturated',
  );
  r.evict('a');
  assert.equal(r.stats().bytes, 0);
  assert.equal(
    r.request('b', 1, 30, async () => 3),
    'saturated',
  );
});
test('eviction cancels replacement so late work cannot resurrect absent coverage', async () => {
  const freed: number[] = [];
  let resolve!: (n: number) => void;
  const r = createResidency<number>({requests: 1, resident: 1, bytes: 30}, v => freed.push(v));
  r.request('a', 1, 10, async () => 1);
  await settle();
  r.publish(1, 10, () => true);
  r.request('a', 2, 10, () => new Promise(r => (resolve = r)));
  await settle();
  r.evict('a');
  assert.equal(r.get('a'), undefined);
  assert.equal(r.stats().bytes, 10);
  resolve(2);
  await settle();
  assert.equal(
    r.publish(1, 30, () => true),
    0,
  );
  assert.deepEqual(freed, [1, 2]);
  assert.equal(r.stats().bytes, 0);
});
test('throwing disposal cannot retain admission, retry disposal or leak an unhandled completion', async () => {
  let calls = 0;
  const r = createResidency<number>({requests: 1, resident: 1, bytes: 20}, () => {
    calls++;
    throw Error('adapter failure');
  });
  r.request('a', 1, 10, async () => 1);
  await settle();
  r.publish(1, 10, () => true);
  r.close();
  r.close();
  assert.equal(calls, 1);
  assert.equal(r.stats().releaseErrors, 1);
  assert.equal(r.stats().bytes, 0);
});
