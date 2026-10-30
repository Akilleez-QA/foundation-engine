import test from 'node:test';
import assert from 'node:assert/strict';
import {createRng} from '../../core/rng';
import {createRetrySchedule, type RetryScheduleLimits, type RetryScheduleNext} from './retry-schedule';

const limits: RetryScheduleLimits = {
  baseMs: 100,
  capMs: 1600,
  maxAttempts: 6,
  budget: {capacity: 10, refillEveryMs: 1000},
};
const make = (overrides: Partial<RetryScheduleLimits> = {}, random: () => number = createRng(7).next) =>
  createRetrySchedule({limits: {...limits, ...overrides}, random});
const waitOf = (result: RetryScheduleNext) => {
  assert.equal(result.status, 'wait');
  return result as Extract<RetryScheduleNext, {status: 'wait'}>;
};

test('NW04 retry schedule: rejects invalid, unbounded or misspelled limits before any work', () => {
  const random = () => 0.5;
  const bad: unknown[] = [
    undefined,
    null,
    {},
    {...limits, baseMs: 0},
    {...limits, baseMs: 1.5},
    {...limits, capMs: -1},
    {...limits, baseMs: 200, capMs: 100},
    {...limits, maxAttempts: 0},
    {...limits, maxAttempts: Infinity},
    {...limits, capMs: Number.MAX_SAFE_INTEGER + 1},
    {...limits, budget: {capacity: 0, refillEveryMs: 1}},
    {...limits, budget: {capacity: 1, refillEveryMs: Number.NaN}},
    {...limits, budget: {capacity: 1, refillPerMs: 1}},
    {...limits, budget: {capacity: 1, refillEveryMs: 1, extra: 1}},
    {...limits, jitter: 'none'},
    {...limits, budget: null},
  ];
  for (const value of bad)
    assert.throws(() => createRetrySchedule({limits: value as RetryScheduleLimits, random}), /retry schedule: invalid/);
  assert.throws(() => createRetrySchedule({limits, random: 3 as unknown as () => number}), /invalid configuration/);
  assert.throws(() => createRetrySchedule(null as never), /invalid configuration/);
  const captured = {...limits, budget: {...limits.budget}};
  const schedule = createRetrySchedule({limits: captured, random});
  captured.capMs = 1;
  captured.budget.capacity = 1;
  assert.equal(schedule.read().limits.capMs, 1600);
  assert.equal(schedule.read().limits.budget.capacity, 10);
  assert.ok(Object.isFrozen(schedule.read().limits.budget));
});

test('NW04 retry schedule: full jitter stays within [0, min(cap, base*2^n)] and reaches both ends', () => {
  for (const [sample, attemptCeilings] of [
    [0, [0, 0, 0, 0, 0, 0]],
    [1 - 2 ** -53, [100, 200, 400, 800, 1600, 1600]],
  ] as const) {
    const s = make({}, () => sample);
    let now = 0;
    attemptCeilings.forEach((expected, index) => {
      const w = waitOf(s.next(now));
      assert.equal(w.attempt, index + 1);
      assert.equal(w.delayMs, expected);
      assert.equal(w.untilMs, now + expected);
      assert.ok(Number.isSafeInteger(w.delayMs));
      now = w.untilMs;
      assert.equal(s.due(now), true);
    });
  }
  // 20,000 attempts in one episode: large attempt counts saturate at the cap (2 ** attempt becomes Infinity).
  const s = make(
    {maxAttempts: 1_000_000, capMs: 1600, budget: {capacity: 1_000_000, refillEveryMs: 1}},
    createRng(11).next,
  );
  const seen = new Map<number, number>();
  let now = 0;
  for (let i = 0; i < 20_000; i++) {
    const w = waitOf(s.next(now)),
      ceiling = Math.min(1600, 100 * 2 ** (w.attempt - 1));
    assert.ok(w.delayMs >= 0 && w.delayMs <= ceiling, `attempt ${w.attempt} delay ${w.delayMs}`);
    if (ceiling === 1600) seen.set(w.delayMs >= 800 ? 1 : 0, (seen.get(w.delayMs >= 800 ? 1 : 0) ?? 0) + 1);
    now = w.untilMs;
    s.due(now);
  }
  assert.ok(
    Math.abs((seen.get(0) ?? 0) - (seen.get(1) ?? 0)) < 0.05 * 20_000,
    'upper and lower halves of the capped range are both used',
  );
});

test('NW04 retry schedule: episode exhaustion is explicit, terminal until success, and success resets attempts', () => {
  const s = make({maxAttempts: 3});
  let now = 0;
  for (let i = 0; i < 3; i++) {
    const w = waitOf(s.next(now));
    now = w.untilMs;
    assert.equal(s.due(now), true);
  }
  assert.deepEqual(s.next(now), {status: 'exhausted', attempts: 3});
  assert.equal(s.read().state, 'exhausted');
  assert.deepEqual(s.next(now + 10_000), {status: 'exhausted', attempts: 3}, 'exhaustion does not silently restart');
  assert.equal(s.due(now + 10_000), false);
  s.succeeded(now + 10_000);
  assert.deepEqual([s.read().state, s.read().attempt], ['idle', 0]);
  assert.equal(waitOf(s.next(now + 10_000)).attempt, 1);
});

test('NW04 retry schedule: the retry budget spans episodes, refills by elapsed time and reports when it refills', () => {
  const s = make({maxAttempts: 100, budget: {capacity: 3, refillEveryMs: 1000}}, () => 0);
  for (let i = 0; i < 3; i++) {
    waitOf(s.next(0));
    assert.equal(s.due(0), true);
    s.succeeded(0);
  }
  assert.equal(s.read().tokens, 0);
  assert.deepEqual(s.next(0), {status: 'budget-empty', refillAtMs: 1000});
  assert.deepEqual(s.next(999), {status: 'budget-empty', refillAtMs: 1000});
  assert.equal(s.read().attempt, 0, 'an empty budget consumes no attempt');
  assert.equal(waitOf(s.next(1000)).attempt, 1);
  assert.deepEqual(s.next(1000), s.next(1000), 'a second failure report during a wait coalesces');
  assert.equal(s.read().tokens, 0);
  s.cancel(); // Cancelling an episode refunds nothing.
  assert.deepEqual(s.next(1500), {status: 'budget-empty', refillAtMs: 2000});
  // Long idle refills only to capacity: no stored burst beyond `capacity`.
  s.next(1_000_000);
  assert.equal(s.read().tokens, 2);
  s.cancel();
  s.next(1_000_000);
  s.cancel();
  assert.equal(s.read().tokens, 1);
  s.next(1_000_000);
  s.cancel();
  assert.equal(s.next(1_000_000).status, 'budget-empty');
});

test('NW04 retry schedule: total retries over any window are bounded by capacity + elapsed/refill (no unbounded growth)', () => {
  const s = make({maxAttempts: 4, budget: {capacity: 5, refillEveryMs: 500}}, createRng(3).next);
  let issued = 0,
    now = 0;
  for (let i = 0; i < 200_000; i++) {
    const r = s.next(now);
    if (r.status === 'wait') {
      issued++;
      now = r.untilMs;
      assert.equal(s.due(now), true);
    } else if (r.status === 'exhausted') s.cancel(); // A hostile consumer restarting episodes as fast as possible.
    now += 1;
    const keys = Object.keys(s.read());
    assert.equal(keys.length, 6);
  }
  assert.ok(issued <= 5 + Math.floor(now / 500), `issued ${issued} over ${now} ms`);
  assert.ok(issued > 0);
});

test('NW04 retry schedule: dispose during a wait cancels it; late calls are inert and terminal', () => {
  const s = make();
  const w = waitOf(s.next(0));
  s.dispose();
  s.dispose();
  assert.equal(s.due(w.untilMs + 1), false);
  assert.deepEqual(s.next(w.untilMs + 1), {status: 'retired', reason: 'disposed'});
  s.succeeded(w.untilMs + 1);
  s.cancel();
  assert.deepEqual(s.read(), {
    state: 'retired',
    attempt: 1,
    tokens: 9,
    untilMs: null,
    reason: 'disposed',
    limits: s.read().limits,
  });
  // A disposed owner accepts even nonsense time without throwing: there is nothing left to schedule.
  assert.equal(s.next(-1).status, 'retired');
});

test('NW04 retry schedule: due fires exactly once and never early; cancel abandons the outstanding wait', () => {
  const s = make({}, () => 0.5);
  const w = waitOf(s.next(10));
  assert.equal(w.delayMs, 50);
  assert.equal(s.due(59), false);
  assert.equal(s.due(60), true);
  assert.equal(s.due(61), false);
  assert.equal(s.read().state, 'attempting');
  const second = waitOf(s.next(70));
  assert.equal(second.attempt, 2);
  s.cancel();
  assert.equal(s.due(second.untilMs), false);
  assert.deepEqual([s.read().state, s.read().attempt, s.read().untilMs], ['idle', 0, null]);
});

test('NW04 retry schedule: time must be finite, nonnegative and nondecreasing', () => {
  const s = make();
  for (const bad of [-1, Number.NaN, Infinity, '5' as unknown as number]) assert.throws(() => s.next(bad), RangeError);
  s.next(100);
  assert.throws(() => s.due(99), RangeError);
  assert.throws(() => s.succeeded(50), RangeError);
  assert.equal(s.read().attempt, 1, 'rejected time does no work');
});

test('NW04 retry schedule: a failing, invalid or reentrant random port retires instead of producing a bad delay', () => {
  for (const [random, reason] of [
    [
      () => {
        throw Error('boom');
      },
      'random-failed',
    ],
    [() => 1, 'random-invalid'],
    [() => -0.1, 'random-invalid'],
    [() => Number.NaN, 'random-invalid'],
    [() => '0.5' as unknown as number, 'random-invalid'],
  ] as const) {
    const s = make({}, random);
    assert.deepEqual(s.next(0), {status: 'retired', reason});
    assert.equal(s.read().tokens, 10, 'no token is consumed by a failed sample');
  }
  let schedule: ReturnType<typeof make> | null = null;
  const nested: unknown[] = [];
  schedule = make({}, () => {
    nested.push(schedule!.next(0), schedule!.due(0));
    schedule!.succeeded(0);
    schedule!.cancel();
    return 0.25;
  });
  assert.equal(waitOf(schedule.next(0)).attempt, 1);
  assert.deepEqual(nested, [{status: 'busy'}, false]);
  const disposing: {s: ReturnType<typeof make> | null} = {s: null};
  disposing.s = make({}, () => {
    disposing.s!.dispose();
    return 0.25;
  });
  assert.deepEqual(disposing.s.next(0), {status: 'retired', reason: 'disposed'});
  assert.equal(disposing.s.read().attempt, 0);
});

test('NW04 retry schedule: identical seeds replay identical schedules; results are frozen', () => {
  const run = (seed: number) => {
    const s = make({maxAttempts: 50, budget: {capacity: 50, refillEveryMs: 10}}, createRng(seed).next),
      out: number[] = [];
    let now = 0;
    for (let i = 0; i < 50; i++) {
      const w = waitOf(s.next(now));
      assert.ok(Object.isFrozen(w));
      out.push(w.delayMs);
      now = w.untilMs;
      s.due(now);
    }
    return out;
  };
  assert.deepEqual(run(42), run(42));
  assert.notDeepEqual(run(42), run(43));
  assert.ok(Object.isFrozen(make().read()));
});

test('NW04 retry schedule: seeded host-restart simulation spreads reconnects instead of a synchronized spike', () => {
  const clients = 1000,
    bucketMs = 100;
  const histogram = (jitter: boolean) => {
    const buckets = new Map<number, number>();
    for (let c = 0; c < clients; c++) {
      const random = jitter ? createRng(`client-${c}`).next : () => 1 - 2 ** -53;
      const s = make({baseMs: 1000, capMs: 1000}, random);
      const w = waitOf(s.next(0)); // Every client observes the host loss at the same instant.
      const bucket = Math.floor(w.untilMs / bucketMs);
      buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
    }
    return buckets;
  };
  const spike = histogram(false),
    spread = histogram(true);
  assert.equal(Math.max(...spike.values()), clients, 'without jitter every client retries in the same bucket');
  assert.ok(spread.size >= 10, `jittered arrivals occupy ${spread.size} buckets`);
  // Uniform over 1001 ms gives ~100 per 100 ms bucket; allow generous statistical slack, still far below a spike.
  assert.ok(Math.max(...spread.values()) <= 160, `largest bucket ${Math.max(...spread.values())}`);
});
