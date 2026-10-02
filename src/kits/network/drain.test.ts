import test from 'node:test';
import assert from 'node:assert/strict';
import { createClosePolicy, createConnectionDrain, createDrainFollower, createRetrySchedule, DRAIN_CLOSE_CODE,
  MAX_DRAIN_KEYS } from './index.ts';
import { createRng } from '../../core/rng.ts';

const base = { maxKeys: 8, maxNoticeMs: 5000, maxReconnectAfterMs: 10000, maxActionsPerPoll: 16 };
const lifetime = { maxLifetimeMs: 1000, jitterMs: 200, noticeMs: 100, reconnectAfterMs: 50 };
const fixed = (value: number) => () => value;

test('drain limits are validated, bounded and captured; lifetime needs a random port', () => {
  const limits = { ...base, lifetime: { ...lifetime } };
  const drain = createConnectionDrain({ limits, random: fixed(0) });
  limits.lifetime.maxLifetimeMs = 5;
  assert.equal(drain.read().limits.lifetime?.maxLifetimeMs, 1000);
  assert.ok(Object.isFrozen(drain.read().limits) && Object.isFrozen(drain.read().limits.lifetime));
  for (const bad of [
    { ...base, maxKeys: 0 }, { ...base, maxKeys: MAX_DRAIN_KEYS + 1 }, { ...base, maxNoticeMs: -1 },
    { ...base, maxNoticeMs: 86_400_001 }, { ...base, maxActionsPerPoll: 1 }, { ...base, maxActionsPerPoll: 2.5 },
    { ...base, extra: 1 }, { ...base, lifetime: { ...lifetime, jitterMs: 900 } },
    { ...base, lifetime: { ...lifetime, maxLifetimeMs: 0 } }, { ...base, lifetime: { ...lifetime, dither: 1 } },
    { ...base, lifetime: { ...lifetime, noticeMs: Number.NaN } }, null,
  ]) assert.throws(() => createConnectionDrain({ limits: bad as never, random: fixed(0) }), /connection drain/, JSON.stringify(bad));
  assert.throws(() => createConnectionDrain({ limits: { ...base, lifetime } }), /random port/);
  assert.throws(() => createConnectionDrain({ limits: base, random: 1 as never }), /configuration/);
  assert.throws(() => createConnectionDrain({ limits: base, extra: 1 } as never), /configuration/);
});

test('without drain or lifetime nothing is ever instructed: opting out changes no behaviour', () => {
  const drain = createConnectionDrain({ limits: base });
  assert.deepEqual(drain.track('a', 0), { status: 'tracked', closeAtMs: null });
  assert.equal(drain.admits('a'), true);
  assert.deepEqual(drain.poll(1e12), []);
  assert.equal(drain.admits('a'), true);
});

test('operator drain: notify at once, stop admitting new work, close at the notice deadline; new connections refused until resume', () => {
  const drain = createConnectionDrain({ limits: base });
  drain.track('a', 0); drain.track('b', 0);
  assert.deepEqual(drain.drain(100, { noticeMs: 500, reconnectAfterMs: 2000 }), { status: 'draining', connections: 2, closeByMs: 600 });
  assert.equal(drain.admits('a'), true, 'admission stops when the notice is issued');
  const notices = drain.poll(100);
  assert.deepEqual(notices.map(a => [a.key, a.action]), [['a', 'notify'], ['b', 'notify']]);
  assert.deepEqual((notices[0] as { notice: unknown }).notice, { cause: 'planned', closeInMs: 500, reconnectAfterMs: 2000 });
  assert.equal(drain.admits('a'), false);
  assert.deepEqual(drain.track('c', 120), { status: 'refused', reason: 'draining' });
  // Client ignoring the notice: nothing happens before the deadline, then the close is instructed regardless.
  assert.deepEqual(drain.poll(599), []);
  assert.deepEqual(drain.poll(600).map(a => [a.key, a.action]), [['a', 'close'], ['b', 'close']]);
  assert.deepEqual(drain.poll(10_000), [], 'a close is instructed once');
  assert.deepEqual(drain.read().closing, 2);
  drain.forget('a'); drain.forget('b');
  assert.equal(drain.resume(), true);
  assert.equal(drain.resume(), false);
  assert.equal(drain.track('c', 10_000).status, 'tracked');
  assert.equal(drain.admits('c'), true);
  assert.deepEqual(drain.read().counts, { notices: 2, closes: 2, refusedDraining: 1, refusedCapacity: 0 });
});

test('drain during in-flight work: the helper never revokes admitted work; only new admission stops', () => {
  const drain = createConnectionDrain({ limits: base });
  drain.track('peer', 0);
  const queued: string[] = [], dispatched: string[] = [];
  const submit = (id: string) => { if (drain.admits('peer')) queued.push(id); };
  submit('w1'); submit('w2');
  drain.drain(10, { noticeMs: 100, reconnectAfterMs: 0 });
  drain.poll(10);
  submit('w3');
  assert.deepEqual(queued, ['w1', 'w2'], 'work after the notice is not admitted');
  // The host keeps serving admitted work until its close; the helper holds no reference to it.
  while (queued.length) dispatched.push(queued.shift() as string);
  assert.deepEqual(dispatched, ['w1', 'w2']);
  assert.deepEqual(drain.poll(110).map(a => a.action), ['close']);
});

test('double drain: the close only moves earlier, the return only lengthens, and a changed notice is re-sent once', () => {
  const drain = createConnectionDrain({ limits: { ...base, lifetime }, random: fixed(0) });
  drain.track('a', 0); // lifetime close at 1000, notice at 900
  drain.drain(100, { noticeMs: 600, reconnectAfterMs: 300 });
  const first = drain.poll(100);
  assert.deepEqual(first.map(a => a.action), ['notify']);
  assert.deepEqual((first[0] as { notice: unknown }).notice, { cause: 'planned', closeInMs: 600, reconnectAfterMs: 300 });
  // A longer, shorter-return second drain changes nothing the client was told: no second notice, no postponement.
  assert.equal(drain.drain(200, { noticeMs: 4000, reconnectAfterMs: 1 }).status, 'draining');
  assert.deepEqual(drain.poll(699), [], 'a longer second drain does not postpone the close');
  assert.deepEqual(drain.poll(700).map(a => [a.action, (a as { cause?: string }).cause]), [['close', 'planned']]);
  assert.equal(drain.read().counts.notices, 1);
  // A shorter later drain brings an already-notified close earlier and says so once.
  const early = createConnectionDrain({ limits: base });
  early.track('z', 0);
  early.drain(0, { noticeMs: 1000, reconnectAfterMs: 0 });
  assert.equal(early.poll(0).length, 1);
  early.drain(100, { noticeMs: 100, reconnectAfterMs: 0 });
  assert.deepEqual(early.poll(100).map(a => (a as { notice?: unknown }).notice),
    [{ cause: 'planned', closeInMs: 100, reconnectAfterMs: 0 }]);
  assert.equal(early.admits('z'), false, 'a superseding notice never reopens admission');
  assert.deepEqual(early.poll(199), []);
  assert.deepEqual(early.poll(200).map(a => a.action), ['close']);
  assert.equal(early.read().counts.notices, 2);
  // A drain longer than the remaining lifetime keeps the earlier close but announces the planned cause now.
  const other = createConnectionDrain({ limits: { ...base, lifetime }, random: fixed(0) });
  other.track('b', 0);
  other.drain(500, { noticeMs: 5000, reconnectAfterMs: 9 });
  assert.deepEqual(other.poll(500).map(a => (a as { notice?: unknown }).notice),
    [{ cause: 'planned', closeInMs: 500, reconnectAfterMs: 50 }]);
  assert.deepEqual(other.poll(1000).map(a => [a.action, (a as { cause?: string }).cause]), [['close', 'planned']]);
});

test('an operator drain reaches a connection already notified of its lifetime close (no herd into a draining host)', () => {
  const drain = createConnectionDrain({ limits: { ...base, maxReconnectAfterMs: 60_000,
    lifetime: { maxLifetimeMs: 100_000, jitterMs: 0, noticeMs: 30_000, reconnectAfterMs: 0 } }, random: fixed(0) });
  drain.track('a', 0);
  const lifetimeNotice = drain.poll(70_000);
  assert.deepEqual(lifetimeNotice.map(a => (a as { notice?: unknown }).notice),
    [{ cause: 'lifetime', closeInMs: 30_000, reconnectAfterMs: 0 }]);
  drain.drain(71_000, { noticeMs: 5000, reconnectAfterMs: 45_000 });
  const superseding = drain.poll(71_000);
  assert.deepEqual(superseding.map(a => (a as { notice?: unknown }).notice),
    [{ cause: 'planned', closeInMs: 5000, reconnectAfterMs: 45_000 }]);
  assert.deepEqual(drain.poll(76_000).map(a => [a.action, (a as { cause?: string }).cause]), [['close', 'planned']]);
  // The follower on the other end merges both notices and holds for the planned return.
  const follower = createDrainFollower({ limits: { maxNoticeMs: 60_000, maxReconnectAfterMs: 60_000 } });
  follower.notice((lifetimeNotice[0] as { notice: unknown }).notice, 70_000);
  assert.deepEqual(follower.notice((superseding[0] as { notice: unknown }).notice, 71_000),
    { status: 'updated', cause: 'planned', closeByMs: 76_000, reconnectAfterMs: 45_000 });
  assert.deepEqual(follower.closed(76_000), { status: 'hold', untilMs: 121_000, cause: 'planned' });
});

test('emission lag: a scheduled close is capped, but emission waits for a poll and the per-poll instruction cap', () => {
  const limits = { ...base, maxKeys: 20, maxActionsPerPoll: 2,
    lifetime: { maxLifetimeMs: 1000, jitterMs: 0, noticeMs: 0, reconnectAfterMs: 0 } };
  const drain = createConnectionDrain({ limits, random: fixed(0) });
  for (let i = 0; i < 20; i++) assert.equal((drain.track(`c${i}`, 0) as { closeAtMs: number }).closeAtMs, 1000);
  const closedAt: number[] = [];
  for (let now = 0; now <= 2000; now += 10)
    for (const action of drain.poll(now)) if (action.action === 'close') closedAt.push(now);
  assert.equal(closedAt.length, 20);
  assert.equal(Math.min(...closedAt), 1000);
  // 40 instructions at 2 per 10 ms poll: the last close is emitted 190 ms after its scheduled time. The documented
  // bound is pollIntervalMs * (ceil(2 * simultaneous / maxActionsPerPoll) - 1).
  assert.equal(Math.max(...closedAt), 1190);
  assert.ok(Math.max(...closedAt) - 1000 <= 10 * (Math.ceil((2 * 20) / 2) - 1));
});

test('drain requests are bounded by the configured maximum notice and return delay', () => {
  const drain = createConnectionDrain({ limits: base });
  for (const request of [{ noticeMs: 5001, reconnectAfterMs: 0 }, { noticeMs: 0, reconnectAfterMs: 10001 },
    { noticeMs: -1, reconnectAfterMs: 0 }, { noticeMs: 1.5, reconnectAfterMs: 0 }, { noticeMs: 1 }, null,
    { noticeMs: 1, reconnectAfterMs: 1, extra: 1 }])
    assert.deepEqual(drain.drain(0, request as never), { status: 'refused', reason: 'invalid' }, JSON.stringify(request));
  assert.equal(drain.read().draining, false, 'a refused request does not start a drain');
  assert.deepEqual(drain.drain(0, { noticeMs: 0, reconnectAfterMs: 0 }), { status: 'draining', connections: 0, closeByMs: 0 });
});

test('capped lifetime: closes never later than maxLifetimeMs, never earlier than maxLifetimeMs - jitterMs, notice first', () => {
  for (const [sample, closeAt] of [[0, 1000], [0.999999, 800], [0.5, 900]] as const) {
    const drain = createConnectionDrain({ limits: { ...base, lifetime }, random: fixed(sample) });
    assert.deepEqual(drain.track('a', 0), { status: 'tracked', closeAtMs: closeAt });
    assert.deepEqual(drain.poll(closeAt - 101), []);
    const notify = drain.poll(closeAt - 100);
    assert.deepEqual(notify.map(a => (a as { notice?: unknown }).notice),
      [{ cause: 'lifetime', closeInMs: 100, reconnectAfterMs: 50 }]);
    assert.deepEqual(drain.poll(closeAt - 1), []);
    assert.deepEqual(drain.poll(closeAt).map(a => [a.action, (a as { cause?: string }).cause]), [['close', 'lifetime']]);
  }
});

test('lifetime jitter distribution: 2,000 seeded connections opened together spread their closes across the window', () => {
  const rng = createRng('nw08-lifetime');
  const limits = { ...base, maxKeys: 2000, maxActionsPerPoll: 4096,
    lifetime: { maxLifetimeMs: 1_800_000, jitterMs: 180_000, noticeMs: 30_000, reconnectAfterMs: 0 } };
  const drain = createConnectionDrain({ limits, random: () => rng.next() });
  const closes: number[] = [];
  for (let i = 0; i < 2000; i++) closes.push((drain.track(`c${i}`, 0) as { closeAtMs: number }).closeAtMs);
  assert.ok(closes.every(t => t >= 1_620_000 && t <= 1_800_000));
  const buckets = new Array(10).fill(0);
  for (const t of closes) buckets[Math.min(9, Math.floor((t - 1_620_000) / 18_000))]++;
  // Uniform expectation 200 per 18 s bucket; a synchronized rotation would put all 2,000 in one.
  for (const count of buckets) assert.ok(count > 140 && count < 260, `bucket ${count} of ${buckets}`);
  assert.ok(Math.max(...buckets) < 2000 * 0.15);
});

test('lifetime expiry under load: the per-poll cap spreads instructions, earliest first, and none is lost or reordered', () => {
  const limits = { ...base, maxKeys: 1000, maxActionsPerPoll: 50, lifetime: { ...lifetime, jitterMs: 0 } };
  const drain = createConnectionDrain({ limits, random: fixed(0) });
  for (let i = 0; i < 1000; i++) drain.track(i % 2 ? `k${i}` : { i }, 0);
  const seen = new Map<unknown, string[]>();
  let polls = 0, now = 1000; // every notice and close is already due
  for (;;) {
    const actions = drain.poll(now);
    if (!actions.length) break;
    polls++;
    assert.ok(actions.length <= 50);
    for (const a of actions) {
      seen.set(a.key, [...(seen.get(a.key) ?? []), a.action]);
      if (a.action === 'notify') assert.equal(a.notice.closeInMs, 0, 'a late notice does not postpone the close');
    }
    now += 1;
  }
  assert.equal(seen.size, 1000);
  for (const sequence of seen.values()) assert.deepEqual(sequence, ['notify', 'close']);
  assert.equal(polls, 40);
  assert.deepEqual({ notices: drain.read().counts.notices, closes: drain.read().counts.closes }, { notices: 1000, closes: 1000 });
});

test('tracking is bounded and keyed; forget is idempotent; invalid time throws before work', () => {
  const drain = createConnectionDrain({ limits: { ...base, maxKeys: 2 } });
  const key = {};
  assert.equal(drain.track(key, 0).status, 'tracked');
  assert.deepEqual(drain.track(key, 0), { status: 'refused', reason: 'duplicate' });
  assert.equal(drain.track('b', 0).status, 'tracked');
  assert.deepEqual(drain.track('c', 0), { status: 'refused', reason: 'capacity' });
  for (const bad of ['', 'x'.repeat(257), 1, null]) assert.deepEqual(drain.track(bad as never, 0), { status: 'refused', reason: 'invalid-key' });
  assert.equal(drain.forget(key), true);
  assert.equal(drain.forget(key), false);
  assert.equal(drain.admits('unknown'), false);
  drain.poll(50);
  for (const bad of [49, -1, Number.NaN, Infinity]) assert.throws(() => drain.poll(bad), RangeError);
});

test('disposal mid-drain clears every connection; later calls refuse or return nothing', () => {
  const drain = createConnectionDrain({ limits: base });
  drain.track('a', 0);
  drain.drain(0, { noticeMs: 1000, reconnectAfterMs: 0 });
  drain.poll(0);
  drain.dispose(); drain.dispose();
  assert.deepEqual(drain.poll(5000), []);
  assert.equal(drain.admits('a'), false);
  assert.deepEqual(drain.track('b', 5000), { status: 'refused', reason: 'retired' });
  assert.deepEqual(drain.drain(5000, { noticeMs: 0, reconnectAfterMs: 0 }), { status: 'refused', reason: 'retired' });
  assert.equal(drain.resume(), false);
  assert.equal(drain.forget('a'), false);
  assert.deepEqual({ tracked: drain.read().tracked, retired: drain.read().retired }, { tracked: 0, retired: 'disposed' });
});

test('a failing, invalid or reentrant random port retires the drain instead of producing a bad lifetime', () => {
  for (const [random, reason] of [[() => { throw Error('x'); }, 'random-failed'], [fixed(1), 'random-invalid'],
    [fixed(Number.NaN), 'random-invalid']] as const) {
    const drain = createConnectionDrain({ limits: { ...base, lifetime }, random });
    assert.deepEqual(drain.track('a', 0), { status: 'refused', reason: 'retired' });
    assert.equal(drain.read().retired, reason);
  }
  let nested: unknown;
  const drain = createConnectionDrain({ limits: { ...base, lifetime }, random: () => {
    nested = [drain.track('n', 0), drain.drain(0, { noticeMs: 0, reconnectAfterMs: 0 }), drain.poll(0), drain.forget('a')];
    return 0;
  } });
  assert.equal(drain.track('a', 0).status, 'tracked');
  assert.deepEqual(nested, [{ status: 'refused', reason: 'busy' }, { status: 'refused', reason: 'busy' }, [], false]);
  let disposing!: ReturnType<typeof createConnectionDrain>;
  disposing = createConnectionDrain({ limits: { ...base, lifetime }, random: () => { disposing.dispose(); return 0; } });
  assert.deepEqual(disposing.track('a', 0), { status: 'refused', reason: 'retired' });
});

const followerLimits = { maxNoticeMs: 5000, maxReconnectAfterMs: 10000 };

test('follower: notice validation against the client bounds; a notice never extends past them', () => {
  const follower = createDrainFollower({ limits: followerLimits });
  for (const bad of [null, {}, { cause: 'planned', closeInMs: 5001, reconnectAfterMs: 0 },
    { cause: 'planned', closeInMs: 0, reconnectAfterMs: 10001 }, { cause: 'other', closeInMs: 0, reconnectAfterMs: 0 },
    { cause: 'planned', closeInMs: -1, reconnectAfterMs: 0 }, { cause: 'planned', closeInMs: 1, reconnectAfterMs: 1, x: 1 },
    { cause: 'planned', closeInMs: '1', reconnectAfterMs: 1 }])
    assert.deepEqual(follower.notice(bad, 0), { status: 'invalid' }, JSON.stringify(bad));
  assert.equal(follower.admits(), true, 'an invalid notice changes nothing');
  for (const bad of [{ maxNoticeMs: -1, maxReconnectAfterMs: 0 }, { maxNoticeMs: 1 }, { maxNoticeMs: 1, maxReconnectAfterMs: 1, x: 1 }])
    assert.throws(() => createDrainFollower({ limits: bad as never }), /drain follower/);
});

test('follower: drain stops new work, signals one cooperative close, holds until the announced return, then releases once', () => {
  const follower = createDrainFollower({ limits: followerLimits });
  assert.deepEqual(follower.closed(0), { status: 'unplanned' }, 'a close without a notice is ordinary loss');
  assert.deepEqual(follower.notice({ cause: 'planned', closeInMs: 400, reconnectAfterMs: 1000 }, 100),
    { status: 'draining', cause: 'planned', closeByMs: 500, reconnectAfterMs: 1000 });
  assert.equal(follower.admits(), false);
  // Double drain: a notice that would postpone the close or shorten the return changes nothing.
  assert.deepEqual(follower.notice({ cause: 'lifetime', closeInMs: 4000, reconnectAfterMs: 0 }, 150), { status: 'duplicate', closeByMs: 500 });
  // One that lengthens the return is merged; the earlier close stands.
  assert.deepEqual(follower.notice({ cause: 'planned', closeInMs: 4000, reconnectAfterMs: 1500 }, 150),
    { status: 'updated', cause: 'planned', closeByMs: 500, reconnectAfterMs: 1500 });
  assert.equal(follower.closeDue(499), false);
  assert.equal(follower.closeDue(500), true);
  assert.equal(follower.closeDue(501), false);
  assert.deepEqual(follower.closed(520), { status: 'hold', untilMs: 2020, cause: 'planned' });
  assert.deepEqual(follower.closed(530), { status: 'hold', untilMs: 2020, cause: 'planned' }, 'a second close report keeps the hold');
  assert.equal(follower.release(2019), false);
  assert.equal(follower.release(2020), true);
  assert.equal(follower.release(2021), false);
  assert.equal(follower.admits(), true);
  assert.throws(() => follower.closed(10), RangeError);
});

test('follower disposal mid-drain: no release, no further notices', () => {
  const follower = createDrainFollower({ limits: followerLimits });
  follower.notice({ cause: 'lifetime', closeInMs: 0, reconnectAfterMs: 0 }, 0);
  follower.closed(0);
  follower.dispose(); follower.dispose();
  assert.equal(follower.release(10), false);
  assert.deepEqual(follower.closed(10), { status: 'retired' });
  assert.deepEqual(follower.notice({ cause: 'planned', closeInMs: 0, reconnectAfterMs: 0 }, 10), { status: 'retired' });
  assert.equal(follower.admits(), false);
  follower.reset();
  assert.equal(follower.read().state, 'retired');
});

test('drain closes are transient under the default close policy', () => {
  const policy = createClosePolicy();
  for (const reason of ['drain', 'lifetime', null]) assert.equal(policy.classify({ code: DRAIN_CLOSE_CODE, reason }), 'transient');
});

test('reconnect after host return honours the retry schedule: jittered from the hold, then budget-empty and exhaustion', () => {
  const retry = createRetrySchedule({
    limits: { baseMs: 100, capMs: 800, maxAttempts: 3, budget: { capacity: 4, refillEveryMs: 60_000 } },
    random: (() => { const rng = createRng('nw08-follow'); return () => rng.next(); })(),
  });
  const follower = createDrainFollower({ limits: followerLimits });
  follower.notice({ cause: 'planned', closeInMs: 0, reconnectAfterMs: 2000 }, 0);
  const hold = follower.closed(10) as { untilMs: number };
  assert.equal(follower.release(hold.untilMs - 1), false);
  assert.equal(retry.read().tokens, 4, 'the hold spends no retry token');
  assert.equal(follower.release(hold.untilMs), true);
  const wait = retry.next(hold.untilMs);
  assert.equal(wait.status, 'wait');
  assert.ok((wait as { untilMs: number }).untilMs >= 2010, 'no attempt before the announced return');
  // Host still away: each refused attempt is ordinary transient loss, paced and bounded by the same schedule.
  let now = (wait as { untilMs: number }).untilMs, attempts = 1;
  assert.equal(retry.due(now), true);
  for (;;) {
    const next = retry.next(now);
    if (next.status !== 'wait') { assert.equal(next.status, 'exhausted'); break; }
    now = next.untilMs; attempts++;
    assert.equal(retry.due(now), true);
  }
  assert.equal(attempts, 3);
  retry.cancel();
  // A second drain episode within the refill window finds one token, then budget-empty: no spinning.
  follower.reset();
  follower.notice({ cause: 'lifetime', closeInMs: 0, reconnectAfterMs: 0 }, now);
  follower.closed(now);
  assert.equal(follower.release(now), true);
  assert.equal(retry.next(now).status, 'wait');
  retry.due(Number.MAX_SAFE_INTEGER / 2);
  assert.equal(retry.next(Number.MAX_SAFE_INTEGER / 2).status, 'wait', 'refilled after a long time');
});

test('host return: 1,000 seeded followers with the same announced return spread their first attempts', () => {
  const arrivals: number[] = [];
  for (let i = 0; i < 1000; i++) {
    const rng = createRng(`nw08-client-${i}`);
    const retry = createRetrySchedule({ limits: { baseMs: 2000, capMs: 2000, maxAttempts: 3, budget: { capacity: 3, refillEveryMs: 60_000 } },
      random: () => rng.next() });
    const follower = createDrainFollower({ limits: followerLimits });
    follower.notice({ cause: 'planned', closeInMs: 500, reconnectAfterMs: 5000 }, 0);
    const hold = follower.closed(500) as { untilMs: number };
    follower.release(hold.untilMs);
    arrivals.push((retry.next(hold.untilMs) as { untilMs: number }).untilMs);
  }
  assert.ok(arrivals.every(t => t >= 5500 && t <= 7500));
  const buckets = new Array(8).fill(0);
  for (const t of arrivals) buckets[Math.min(7, Math.floor((t - 5500) / 250))]++;
  for (const count of buckets) assert.ok(count > 80 && count < 170, `bucket ${count} of ${buckets}`);
});
