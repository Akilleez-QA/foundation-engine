import test from 'node:test';
import assert from 'node:assert/strict';
import { createRateAdmission, type RateAdmission, type RateAdmissionResult } from './index';

const admitted = (r: RateAdmissionResult) => r.status === 'admitted';
function burst(owner: RateAdmission, key: object | string, now: number, attempts: number): number {
  let n = 0;
  for (let i = 0; i < attempts; i++) if (admitted(owner.admit(key, now))) n++;
  return n;
}
/** Deterministic test sequence; no global randomness. */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

test('NW05: a full bucket admits exactly its capacity at one instant, then limits with a retry hint', () => {
  const owner = createRateAdmission({ maxKeys: 4, capacity: 32, refillPerSecond: 32 });
  const key = {};
  assert.equal(burst(owner, key, 1000, 100), 32);
  const limited = owner.admit(key, 1000);
  assert.deepEqual(limited, { status: 'limited', reason: 'rate', retryAfterMs: 32 });
  assert.equal(owner.read(key)?.tokens, 0);
  assert.equal(owner.stats().admitted, 32);
  assert.equal(owner.stats().limitedRate, 69);
  // A limited call consumed nothing: one interval later exactly one token is available.
  assert.equal(owner.admit(key, 1031).status, 'limited');
  assert.equal(owner.admit(key, 1031.25).status, 'admitted');
  assert.equal(owner.admit(key, 1031.25).status, 'limited');
});

test('NW05: refill is exact under a fake clock and never exceeds capacity after long idle', () => {
  const owner = createRateAdmission({ maxKeys: 1, capacity: 4, refillPerSecond: 4 });
  const key = 'peer-a';
  assert.equal(burst(owner, key, 0, 4), 4);
  for (const [t, expected] of [[249.999, 0], [250, 1], [500, 2], [999, 3], [1000, 4], [1e7, 4]] as const)
    assert.equal(owner.read(key, t)?.tokens, expected, `tokens at ${t}`);
  assert.equal(burst(owner, key, 1e7, 10), 4, 'idle refill is capped by capacity');
  // Fractional rate: 0.5 tokens/second means one token per 2000 ms.
  const slow = createRateAdmission({ maxKeys: 1, capacity: 1, refillPerSecond: 0.5 });
  assert.equal(slow.admit(key, 0).status, 'admitted');
  assert.deepEqual(slow.admit(key, 1999), { status: 'limited', reason: 'rate', retryAfterMs: 1 });
  assert.equal(slow.admit(key, 2000).status, 'admitted');
  // Non-representable interval (1000/3 ms) accumulates no boundary drift over many refills.
  const third = createRateAdmission({ maxKeys: 1, capacity: 1, refillPerSecond: 3 });
  let count = 0;
  for (let i = 0; i < 30000; i++) if (admitted(third.admit(key, (i * 1000) / 3))) count++;
  assert.equal(count, 30000);
});

test('NW05: no 2x burst at a boundary; any interval T admits at most capacity + rate*T', () => {
  const N = 32;
  const owner = createRateAdmission({ maxKeys: 1, capacity: N, refillPerSecond: N });
  // A lazily anchored 1000 ms fixed window admits N at 999 ms and N more at 1000 ms (2N in 1 ms).
  owner.admit('k', 0); // anchors and spends one token, as a window opened by a first frame would
  const before = burst(owner, 'k', 999, 100), after = burst(owner, 'k', 1000, 100);
  assert.ok(before + after <= N + 1, `admitted ${before + after} within 1 ms`);
  // Randomized sliding-window bound against arrival timestamps.
  const random = lcg(7), times: number[] = [], bucket = createRateAdmission({ maxKeys: 1, capacity: 8, refillPerSecond: 20 });
  let t = 0;
  for (let i = 0; i < 4000; i++) {
    t += Math.floor(random() * 40);
    if (admitted(bucket.admit('k', t))) times.push(t);
  }
  for (let i = 0; i < times.length; i++)
    for (let j = i; j < times.length && times[j] - times[i] <= 2000; j++)
      assert.ok(j - i + 1 <= 8 + Math.floor((20 * (times[j] - times[i])) / 1000) + 1e-9,
        `interval [${times[i]}, ${times[j]}] admitted ${j - i + 1}`);
});

test('NW05: admission matches an integer token-bucket reference model', () => {
  // interval 250 ms, capacity 3, costs 1..3, integer-millisecond arrivals.
  const owner = createRateAdmission({ maxKeys: 1, capacity: 3, refillPerSecond: 4 });
  const random = lcg(11);
  let credit = 750, last = 0, now = 0; // credit in milliseconds of refill, capped at capacity * interval
  for (let i = 0; i < 20000; i++) {
    now += Math.floor(random() * 300);
    const cost = 1 + Math.floor(random() * 3);
    credit = Math.min(750, credit + (now - last));
    last = now;
    const expect = credit >= cost * 250;
    if (expect) credit -= cost * 250;
    const result = owner.admit('k', now, cost);
    assert.equal(result.status, expect ? 'admitted' : 'limited', `step ${i} at ${now} cost ${cost}`);
    if (expect) assert.equal((result as { remaining: number }).remaining, Math.floor(credit / 250));
  }
});

test('NW05: a clock going backwards grants no refill and is counted, not thrown', () => {
  const owner = createRateAdmission({ maxKeys: 2, capacity: 2, refillPerSecond: 1 });
  assert.equal(burst(owner, 'k', 5000, 2), 2);
  assert.equal(owner.admit('k', 1000).status, 'limited', 'regression to an earlier time');
  assert.equal(owner.admit('k', 0).status, 'limited');
  assert.equal(owner.stats().clockRegressions, 2);
  assert.equal(owner.read('k', 0)?.tokens, 0, 'read never reports refill earlier than observed time');
  assert.equal(owner.admit('k', 5999).status, 'limited');
  assert.equal(owner.admit('k', 6000).status, 'admitted', 'refill resumes from the high-water time');
  for (const bad of [NaN, Infinity, -1, '1' as unknown as number]) assert.deepEqual(owner.admit('k', bad), { status: 'refused', reason: 'invalid-time' });
  assert.equal(owner.read('k', NaN), null);
});

test('NW05: key cardinality is bounded; only idle full buckets are reclaimed, so churn cannot reset a limit', () => {
  const owner = createRateAdmission({ maxKeys: 3, capacity: 2, refillPerSecond: 1, maxInFlight: 1 });
  const keys = [{}, {}, {}];
  for (const k of keys) assert.equal(owner.admit(k, 0).status, 'admitted'); // each holds a lease
  assert.deepEqual(owner.admit({}, 0), { status: 'refused', reason: 'key-capacity' });
  assert.equal(owner.stats().keys, 3);
  // Many unknown keys never grow state.
  for (let i = 0; i < 1000; i++) owner.admit(`churn-${i}`, 10);
  assert.equal(owner.stats().keys, 3);
  assert.equal(owner.stats().refusedKeyCapacity, 1001);
  // A drained bucket with no lease is still not reclaimable until it refills fully.
  const plain = createRateAdmission({ maxKeys: 1, capacity: 2, refillPerSecond: 1 });
  assert.equal(burst(plain, 'a', 0, 2), 2);
  assert.equal(plain.admit('b', 1000).status, 'refused');
  assert.equal(plain.admit('b', 2000).status, 'admitted', 'a full idle bucket is reclaimed losslessly');
  assert.equal(plain.stats().reclaimed, 1);
  assert.equal(plain.read('a'), null);
  // Readmitting the reclaimed key starts full, which is identical to its reclaimed state.
  assert.equal(plain.admit('a', 2000).status, 'refused', '"b" is not yet full again');
  // Invalid keys are refused without state.
  for (const bad of ['', 'x'.repeat(257), 1, null, undefined]) assert.deepEqual(plain.admit(bad as never, 3000), { status: 'refused', reason: 'invalid-key' });
  const short = createRateAdmission({ maxKeys: 1, capacity: 1, refillPerSecond: 1, maxKeyLength: 4 });
  assert.equal(short.admit('abcde', 0).status, 'refused');
  assert.equal(short.admit('abcd', 0).status, 'admitted');
});

test('NW05: concurrency slots are released when work fails, and a double release cannot over-credit', () => {
  const owner = createRateAdmission({ maxKeys: 2, capacity: 100, refillPerSecond: 100, maxInFlight: 2 });
  const key = {};
  async function guarded(work: () => Promise<void>) {
    const r = owner.admit(key, 0);
    if (r.status !== 'admitted') return r.status;
    try { await work(); return 'done'; } finally { r.lease!.release(); }
  }
  return (async () => {
    await assert.rejects(guarded(async () => { throw Error('work failed'); }));
    assert.equal(owner.read(key)?.inFlight, 0, 'failure released the slot');
    const a = owner.admit(key, 0), b = owner.admit(key, 0);
    assert.ok(admitted(a) && admitted(b));
    const tokens = owner.read(key)!.tokens;
    assert.deepEqual(owner.admit(key, 0), { status: 'limited', reason: 'concurrency', retryAfterMs: null });
    assert.equal(owner.read(key)!.tokens, tokens, 'a concurrency-limited call consumes no tokens');
    const leaseA = (a as { lease: { release(): boolean } }).lease;
    assert.equal(leaseA.release(), true);
    assert.equal(leaseA.release(), false, 'double release');
    assert.equal(leaseA.release(), false);
    assert.equal(owner.read(key)?.inFlight, 1);
    assert.equal(owner.stats().inFlight, 1);
    assert.equal(admitted(owner.admit(key, 0)), true);
    assert.equal(owner.admit(key, 0).status, 'limited', 'double release did not grant a third slot');
  })();
});

test('NW05: forget and dispose make outstanding leases stale; disposal is idempotent and refuses admission', () => {
  const owner = createRateAdmission({ maxKeys: 2, capacity: 4, refillPerSecond: 1, maxInFlight: 1 });
  const key = {};
  const first = owner.admit(key, 0) as { status: 'admitted'; lease: { release(): boolean } };
  assert.equal(owner.forget(key), true);
  assert.equal(owner.forget(key), false);
  assert.equal(owner.stats().inFlight, 0);
  const second = owner.admit(key, 0) as { status: 'admitted'; lease: { release(): boolean } };
  assert.equal(second.status, 'admitted', 'forget is the owner retirement path; a new identity starts fresh');
  assert.equal(first.lease.release(), false, 'stale lease cannot release the new state');
  assert.equal(owner.read(key)?.inFlight, 1);
  owner.dispose();
  owner.dispose();
  assert.equal(second.lease.release(), false);
  assert.deepEqual(owner.admit(key, 1), { status: 'refused', reason: 'disposed' });
  assert.deepEqual(owner.stats(), { keys: 0, inFlight: 0, admitted: 2, limitedRate: 0, limitedConcurrency: 0,
    refusedKeyCapacity: 0, reclaimed: 0, clockRegressions: 0, disposed: true });
});

test('NW05: costs and limits are validated; construction errors throw, overload never does', () => {
  const owner = createRateAdmission({ maxKeys: 1, capacity: 4, refillPerSecond: 2 });
  assert.equal(owner.admit('k', 0, 4).status, 'admitted');
  assert.deepEqual(owner.admit('k', 0, 1), { status: 'limited', reason: 'rate', retryAfterMs: 500 });
  for (const bad of [0, -1, 1.5, 5, NaN]) assert.deepEqual(owner.admit('k', 0, bad), { status: 'refused', reason: 'invalid-cost' });
  assert.equal(owner.read('k')?.tokens, 0);
  const no = admitted(owner.admit('k', 2000)) ? (owner.admit('k', 2000) as { lease: unknown }).lease : undefined;
  assert.equal(no, null, 'no lease without a concurrency bound');
  for (const limits of [
    { maxKeys: 0, capacity: 1, refillPerSecond: 1 }, { maxKeys: 1, capacity: 1.5, refillPerSecond: 1 },
    { maxKeys: 1, capacity: 1, refillPerSecond: 0 }, { maxKeys: 1, capacity: 1, refillPerSecond: Infinity },
    { maxKeys: 1, capacity: 1, refillPerSecond: 2e9 }, { maxKeys: 1, capacity: 1, refillPerSecond: 1e6 + 1 },
    { maxKeys: 1, capacity: 1e9 + 1, refillPerSecond: 1 }, { maxKeys: 1, capacity: 1, refillPerSecond: 1, maxInFlight: 0 },
    { maxKeys: 1, capacity: 1, refillPerSecond: 1, maxKeyLength: -1 },
  ]) assert.throws(() => createRateAdmission(limits));
  assert.ok(Object.isFrozen(owner) && Object.isFrozen(owner.stats()) && Object.isFrozen(owner.admit('k', 9000)));
});

test('NW05: epoch-magnitude timestamps with a non-dyadic interval keep exact burst and refill', () => {
  const t0 = 1.7e12;
  for (const rate of [7, 11, 13, 1e5]) {
    const single = createRateAdmission({ maxKeys: 1, capacity: 1, refillPerSecond: rate });
    let count = 0;
    for (let i = 0; i < 1000; i++) if (admitted(single.admit('k', t0 + i * 997))) count++;
    assert.equal(count, 1000, `capacity 1 at rate ${rate}, arrivals slower than refill`);
  }
  for (let i = 0; i < 200; i++) {
    const owner = createRateAdmission({ maxKeys: 1, capacity: 256, refillPerSecond: 7 });
    const t = t0 + i * 0.37;
    assert.equal(burst(owner, 'k', t, 300), 256, `burst at ${t}`);
    assert.equal(owner.read('k')?.tokens, 0);
    // Arrivals exactly at refill instants are always admitted; one extra per instant never is.
    for (let n = 1; n <= 50; n++) {
      assert.equal(owner.admit('k', t + (n * 1000) / 7).status, 'admitted');
      assert.equal(owner.admit('k', t + (n * 1000) / 7).status, 'limited');
    }
  }
  // Uptime-scale performance.now() readings (~28 hours and more) with the reference host configurations.
  for (const base of [1e8, 3e8, 1e9]) for (const c of [13, 32, 128, 256]) {
    const owner = createRateAdmission({ maxKeys: 1, capacity: c, refillPerSecond: c });
    assert.equal(burst(owner, 'k', base + 1.234567, c + 5), c, `capacity ${c} at ${base}`);
  }
});

test('NW05: the maximum refill rate cannot fail open', () => {
  for (const capacity of [1, 4, 256]) {
    const owner = createRateAdmission({ maxKeys: 1, capacity, refillPerSecond: 1e6 });
    for (const t of [0, 123456.789, 1.7e12]) assert.equal(burst(owner, `k${t}`, t, 5000) <= capacity, true);
    const fresh = createRateAdmission({ maxKeys: 1, capacity, refillPerSecond: 1e6 });
    assert.equal(burst(fresh, 'k', 1.7e12, 5000), capacity);
    // Offered at 2x the rate for 50 ms (timestamps quantized at this magnitude): never above capacity + rate * T.
    let count = 0;
    for (let i = 1; i <= 100000; i++) if (admitted(fresh.admit('k', 1.7e12 + i * 0.0005))) count++;
    assert.ok(count <= 50000 + capacity, `admitted ${count}`);
  }
});

test('NW05: timestamps near 2^53 stay exact; beyond the safe-integer range time is refused', () => {
  for (const t of [2 ** 52, Number.MAX_SAFE_INTEGER - 2000]) {
    const owner = createRateAdmission({ maxKeys: 1, capacity: 4, refillPerSecond: 7 });
    assert.equal(burst(owner, 'k', t, 100), 4, `burst at ${t}`);
    assert.equal(owner.admit('k', t + 142).status, 'limited');
    assert.equal(owner.admit('k', t + 143).status, 'admitted');
    assert.equal(owner.admit('k', t + 143).status, 'limited');
  }
  const owner = createRateAdmission({ maxKeys: 1, capacity: 2, refillPerSecond: 128 });
  for (const bad of [Number.MAX_SAFE_INTEGER + 2, 2 ** 60, 1e300])
    assert.deepEqual(owner.admit('k', bad), { status: 'refused', reason: 'invalid-time' });
  assert.equal(owner.stats().keys, 0);
});

test('NW05: one far-future reading grants at most a full bucket and then fails closed, never open', () => {
  const owner = createRateAdmission({ maxKeys: 4, capacity: 8, refillPerSecond: 128 });
  assert.equal(burst(owner, 'k', 5, 100), 8);
  // A bogus reading inside the valid range repays at most the whole backlog: one more bucket, not unlimited.
  assert.equal(burst(owner, 'k', Number.MAX_SAFE_INTEGER, 100), 8);
  assert.equal(burst(owner, 'other', Number.MAX_SAFE_INTEGER, 100), 8, 'a new key also starts with one bucket only');
  // Later normal readings are regressions below the high-water mark: no refill, so limiting stays in force.
  let later = 0;
  for (let i = 0; i < 1000; i++) if (admitted(owner.admit('k', 10 + i * 100))) later++;
  assert.equal(later, 0);
  assert.equal(owner.stats().clockRegressions, 1000);
  // Recovery is explicit: the owner disposes and constructs a new admission object.
  owner.dispose();
  const replacement = createRateAdmission({ maxKeys: 4, capacity: 8, refillPerSecond: 128 });
  assert.equal(burst(replacement, 'k', 100000, 100), 8);
});
