import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  createStreamQueue,
  createStreamResult,
  type StreamLimits,
  type StreamPoll,
  type StreamPort,
  type StreamPumpResult,
} from './index';

/** A port whose works the test settles by hand. */
function manualPort() {
  const works = new Map<
    string,
    {poll: StreamPoll<string>; cancelled: boolean; signal: AbortSignal; released: number; key: string}[]
  >();
  const log: string[] = [];
  const port: StreamPort<string> = {
    start(key, signal) {
      const w = {poll: {status: 'pending'} as StreamPoll<string>, cancelled: false, signal, released: 0, key};
      const list = works.get(key) ?? [];
      list.push(w);
      works.set(key, list);
      log.push(`start ${key}`);
      return {
        poll: () => w.poll,
        cancel() {
          w.cancelled = true;
        },
      };
    },
  };
  const last = (key: string) => works.get(key)!.at(-1)!;
  const ready = (key: string, bytes: number) => {
    const w = last(key);
    w.poll = {status: 'ready', value: `v:${key}`, bytes, release: () => void w.released++};
    return w;
  };
  const fail = (key: string, retry?: boolean) => {
    last(key).poll = {status: 'failed', error: new Error(`boom ${key}`), ...(retry === undefined ? {} : {retry})};
  };
  return {port, works, log, last, ready, fail};
}

const events = (out: StreamPumpResult) => Array.from({length: out.count}, (_, i) => `${out.kinds[i]} ${out.keys[i]}`);

test('validation refuses malformed ports, limits, keys, priorities, ticks and results', () => {
  const {port} = manualPort();
  const ok: StreamLimits = {maxEntries: 8, maxConcurrent: 2, maxBytes: 100};
  assert.throws(() => createStreamQueue({} as never, ok), TypeError);
  assert.throws(() => createStreamQueue(port, {...ok, maxEntries: 0}), RangeError);
  assert.throws(() => createStreamQueue(port, {...ok, maxConcurrent: 257}), RangeError);
  assert.throws(() => createStreamQueue(port, {...ok, maxBytes: 0}), RangeError);
  assert.throws(() => createStreamQueue(port, {...ok, maxStartsPerPump: 3}), RangeError);
  assert.throws(() => createStreamQueue(port, {...ok, maxAttempts: 17}), RangeError);
  assert.throws(() => createStreamQueue(port, {...ok, retryTicks: 10, maxRetryTicks: 5}), RangeError);
  assert.throws(() => createStreamQueue(port, {...ok, preempt: 1 as never}), TypeError);
  const q = createStreamQueue(port, ok);
  assert.throws(() => q.request('', {priority: 1, bytes: 1}), RangeError);
  assert.throws(() => q.request('a', {priority: NaN, bytes: 1}), RangeError);
  assert.throws(() => q.request('a', {priority: 1, bytes: -1}), RangeError);
  assert.equal(q.request('a', {priority: 1, bytes: 101}).status, 'refused-bytes');
  const out = createStreamResult(ok);
  assert.throws(() => q.pump(1, createStreamResult({maxConcurrent: 1})), TypeError);
  q.pump(5, out);
  assert.throws(() => q.pump(4, out), RangeError);
  assert.throws(() => q.pump(5.5, out), RangeError);
  assert.equal(q.stats().entries, 0);
});

test('highest priority starts first within the concurrency limit; completions publish in start order', () => {
  const m = manualPort();
  const limits: StreamLimits = {maxEntries: 8, maxConcurrent: 2, maxBytes: 1000};
  const q = createStreamQueue(m.port, limits),
    out = createStreamResult(limits);
  q.request('a', {priority: 1, bytes: 10});
  q.request('b', {priority: 5, bytes: 10});
  q.request('c', {priority: 3, bytes: 10});
  q.request('d', {priority: 3, bytes: 10});
  assert.equal(q.pump(0, out), 'blocked');
  assert.deepEqual(events(out), ['started b', 'started c']);
  assert.equal(q.state('a'), 'queued');
  assert.equal(q.state('b'), 'running');
  m.ready('c', 7);
  m.ready('b', 9);
  q.pump(1, out);
  assert.deepEqual(
    events(out),
    ['ready b', 'ready c', 'started d', 'started a'],
    'start order, then equal priority by request order',
  );
  assert.equal(q.get('b'), 'v:b');
  assert.equal(q.stats().bytes, 9 + 7 + 10 + 10);
  assert.equal(q.pump(2, out), 'idle');
});

test('byte budget blocks the head; lower priorities never overtake it; a raised priority reorders the queue', () => {
  const m = manualPort();
  const limits: StreamLimits = {maxEntries: 8, maxConcurrent: 4, maxBytes: 100};
  const q = createStreamQueue(m.port, limits),
    out = createStreamResult(limits);
  q.request('held', {priority: 9, bytes: 40});
  q.pump(0, out);
  m.ready('held', 40);
  q.pump(1, out);
  const big = q.request('big', {priority: 5, bytes: 70});
  q.request('small', {priority: 1, bytes: 10});
  assert.equal(q.pump(2, out), 'blocked');
  assert.deepEqual(events(out), [], 'small waits behind big');
  assert.equal(q.setPriority(big.handle, 0), true);
  assert.equal(q.pump(3, out), 'blocked');
  assert.deepEqual(events(out), ['started small'], 'now small is ahead; big still does not fit');
  q.cancel(q.request('held', {priority: 9, bytes: 40}).handle); // a second request of a ready key, then its cancel
  assert.equal(q.state('held'), 'ready', 'the first request still holds it');
  assert.equal(q.stats().requests, 3);
});

test('shared requests load once; the last cancel of running work holds its slot and bytes until it settles, then releases the late value', () => {
  const m = manualPort();
  const limits: StreamLimits = {maxEntries: 8, maxConcurrent: 1, maxBytes: 100};
  const q = createStreamQueue(m.port, limits),
    out = createStreamResult(limits);
  const r1 = q.request('k', {priority: 1, bytes: 30});
  const r2 = q.request('k', {priority: 7, bytes: 50});
  q.request('next', {priority: 0, bytes: 10});
  q.pump(0, out);
  assert.deepEqual(m.log, ['start k']);
  assert.equal(q.stats().bytes, 50, 'the larger estimate of a not-yet-started key is reserved');
  q.cancel(r1.handle);
  assert.equal(q.state('k'), 'running');
  q.cancel(r2.handle);
  assert.equal(q.state('k'), 'absent');
  assert.equal(m.last('k').cancelled, true);
  assert.equal(m.last('k').signal.aborted, true);
  q.pump(1, out);
  assert.deepEqual(events(out), [], 'the slot is still held by the retiring work');
  assert.equal(q.stats().retiring, 1);
  assert.equal(q.stats().bytes, 50);
  const late = m.ready('k', 50);
  q.pump(2, out);
  assert.equal(late.released, 1, 'a value that arrives after cancellation is released, never published');
  assert.deepEqual(events(out), ['started next']);
  assert.equal(q.stats().bytes, 10);
  // A ready value is released exactly once when its last request ends.
  m.ready('next', 8);
  q.pump(3, out);
  const [h] = [...Array(1)].map(() => q.request('next', {priority: 0, bytes: 0}).handle);
  assert.equal(q.get('next'), 'v:next');
  q.cancel(h!);
  assert.equal(m.last('next').released, 0);
});

test('failures retry with deterministic backoff, stop at maxAttempts, and honour non-retryable errors', () => {
  const m = manualPort();
  const limits: StreamLimits = {maxEntries: 8, maxConcurrent: 2, maxBytes: 100, maxAttempts: 3, retryTicks: 10};
  const q = createStreamQueue(m.port, limits),
    out = createStreamResult(limits);
  q.request('flaky', {priority: 1, bytes: 1});
  q.request('fatal', {priority: 1, bytes: 1});
  q.pump(0, out);
  m.fail('flaky');
  m.fail('fatal', false);
  q.pump(1, out);
  assert.deepEqual(events(out), ['retrying flaky', 'failed fatal']);
  assert.equal(q.state('flaky'), 'waiting');
  assert.match(String(q.error('fatal')), /boom fatal/);
  q.pump(10, out);
  assert.deepEqual(events(out), []);
  q.pump(11, out);
  assert.deepEqual(events(out), ['started flaky'], 'retry after 10 ticks');
  m.fail('flaky');
  q.pump(12, out);
  q.pump(31, out);
  assert.deepEqual(events(out), []);
  q.pump(32, out);
  assert.deepEqual(events(out), ['started flaky'], 'second backoff doubles to 20 ticks');
  m.fail('flaky');
  q.pump(33, out);
  assert.deepEqual(events(out), ['failed flaky'], 'third failure exhausts the attempts');
  assert.equal(q.stats().failures, 4);
  assert.equal(q.stats().retries, 2);
});

test('preemption cancels lower-priority running work to start a higher head; a thrown start is a failed attempt', () => {
  const m = manualPort();
  const limits: StreamLimits = {maxEntries: 8, maxConcurrent: 2, maxBytes: 100, preempt: true};
  const q = createStreamQueue(m.port, limits),
    out = createStreamResult(limits);
  q.request('low1', {priority: 1, bytes: 10});
  q.request('low2', {priority: 2, bytes: 10});
  q.pump(0, out);
  q.request('urgent', {priority: 9, bytes: 10});
  q.pump(1, out);
  assert.deepEqual(events(out), ['preempted low1'], 'the retiring work still holds its slot');
  m.ready('low1', 10);
  q.pump(2, out);
  assert.equal(m.works.get('low1')![0]!.released, 1);
  assert.deepEqual(events(out), ['started urgent']);
  assert.equal(q.state('low1'), 'queued', 'a preempted key keeps its requests and queues again');
  m.ready('urgent', 10);
  m.ready('low2', 10);
  q.pump(3, out);
  assert.deepEqual(events(out), ['ready low2', 'ready urgent', 'started low1']);
  assert.equal(q.stats().preemptions, 1);
  const throwing = createStreamQueue<string>(
    {
      start() {
        throw new Error('no network');
      },
    },
    {maxEntries: 2, maxConcurrent: 1, maxBytes: 10, maxAttempts: 1},
  );
  const o2 = createStreamResult({maxConcurrent: 1});
  throwing.request('x', {priority: 0, bytes: 1});
  throwing.pump(0, o2);
  throwing.pump(1, o2);
  assert.equal(throwing.state('x'), 'failed');
  assert.match(String(throwing.error('x')), /no network/);
});

test('actual bytes: over-estimate values are kept if they fit, refused otherwise; dispose releases everything once', () => {
  const m = manualPort();
  const limits: StreamLimits = {maxEntries: 8, maxConcurrent: 3, maxBytes: 100};
  const q = createStreamQueue(m.port, limits),
    out = createStreamResult(limits);
  q.request('a', {priority: 3, bytes: 10});
  q.request('b', {priority: 2, bytes: 10});
  q.request('c', {priority: 1, bytes: 10});
  q.pump(0, out);
  m.ready('a', 60);
  const b = m.ready('b', 60);
  q.pump(1, out);
  assert.deepEqual(
    events(out),
    ['ready a', 'requeued b'],
    'b does not fit beside a now: queued again at its real size',
  );
  assert.equal(b.released, 1);
  assert.equal(q.stats().overEstimate, 1);
  assert.equal(q.stats().resized, 1);
  assert.equal(q.state('b'), 'queued');
  const c = m.ready('c', 150);
  q.pump(2, out);
  assert.deepEqual(events(out), ['failed c'], 'larger than the whole budget: fails without retry');
  assert.equal(c.released, 1);
  assert.equal(q.stats().oversize, 1);
  q.dispose();
  assert.equal(m.last('a').released, 1);
  q.dispose();
  assert.equal(m.last('a').released, 1);
  assert.equal(q.request('z', {priority: 0, bytes: 0}).status, 'closed');
  assert.equal(q.pump(3, out), 'closed');
});

test('randomized: budgets hold, every produced value is released exactly once, and runs replay identically', () => {
  const run = (seed: number) => {
    let s = seed;
    const rnd = () => (s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0) / 2 ** 32;
    const produced: {released: number; held: () => boolean}[] = [];
    const pending: {settle: () => void; cancelled: boolean}[] = [];
    const port: StreamPort<number> = {
      start(key, signal) {
        let poll: StreamPoll<number> = {status: 'pending'};
        let cancelled = false;
        const w = {
          cancelled: false,
          settle() {
            const r = rnd();
            if (r < 0.2) poll = {status: 'failed', retry: r < 0.15};
            else {
              const rec = {released: 0, held: () => false};
              produced.push(rec);
              const bytes = Math.floor(rnd() * 45);
              const throws = rnd() < 0.1;
              const release = () => {
                rec.released++;
                if (throws) throw new Error('release failed');
              };
              if (w.cancelled) {
                // The port releases a value that arrives after cancellation itself.
                try {
                  release();
                } catch {
                  // counted by the record
                }
                poll = {status: 'failed', retry: false};
              } else poll = {status: 'ready', value: bytes, bytes, release};
            }
          },
        };
        pending.push(w);
        void key;
        void signal;
        return {
          // After cancel: pending until execution settles, then a final failure; a late value is released here.
          poll: () => (cancelled && poll.status !== 'pending' ? {status: 'failed', retry: false} : poll),
          cancel() {
            cancelled = true;
            w.cancelled = cancelled;
          },
        };
      },
    };
    const limits: StreamLimits = {
      maxEntries: 24,
      maxConcurrent: 3,
      maxBytes: 120,
      maxAttempts: 2,
      retryTicks: 2,
      preempt: seed % 2 === 0,
    };
    const q = createStreamQueue(port, limits),
      out = createStreamResult(limits);
    const live: number[] = [];
    const log: string[] = [];
    for (let tick = 0; tick < 4000; tick++) {
      const r = rnd();
      if (r < 0.3) {
        const req = q.request(`k${Math.floor(rnd() * 30)}`, {
          priority: Math.floor(rnd() * 5),
          bytes: Math.floor(rnd() * 25),
        });
        if (req.status === 'accepted') live.push(req.handle);
      } else if (r < 0.62 && live.length) {
        q.cancel(live.splice(Math.floor(rnd() * live.length), 1)[0]!);
      } else if (r < 0.67 && live.length) {
        q.setPriority(live[Math.floor(rnd() * live.length)]!, Math.floor(rnd() * 5));
      }
      // Settle some pending works.
      for (let i = pending.length - 1; i >= 0; i--)
        if (rnd() < 0.3) {
          pending[i]!.settle();
          pending.splice(i, 1);
        }
      q.pump(tick, out);
      for (let i = 0; i < out.count; i++) log.push(`${tick}:${out.kinds[i]}:${out.keys[i]}`);
      const st = q.stats();
      assert.ok(st.bytes <= limits.maxBytes, 'byte budget');
      assert.ok(st.running + st.retiring <= limits.maxConcurrent, 'concurrency');
      assert.ok(st.entries + st.retiring <= limits.maxEntries, 'entries');
    }
    // Drain: settle everything, cancel every request, pump until idle.
    for (const h of live) q.cancel(h);
    for (const p of pending) p.settle();
    q.pump(5000, out);
    assert.equal(q.stats().bytes, 0, 'nothing is charged once every request ended and every work settled');
    q.dispose();
    for (const p of produced) assert.equal(p.released, 1, 'every produced value released exactly once');
    return {log, produced: produced.length};
  };
  for (const seed of [1, 2, 3, 4]) {
    const a = run(seed),
      b = run(seed);
    assert.deepEqual(a.log, b.log, 'same seed, same event log');
    assert.ok(a.produced > 25, `coverage (${a.produced} values)`);
  }
});

test('review: preemption cancels nothing when it cannot make the head fit, and never overfills the entry table', () => {
  const m = manualPort();
  const limits: StreamLimits = {maxEntries: 8, maxConcurrent: 2, maxBytes: 100, preempt: true};
  const q = createStreamQueue(m.port, limits),
    out = createStreamResult(limits);
  q.request('held', {priority: 9, bytes: 50});
  q.pump(0, out);
  m.ready('held', 50);
  q.request('a', {priority: 0, bytes: 40});
  q.pump(1, out);
  q.request('c', {priority: 5, bytes: 60});
  assert.equal(q.pump(2, out), 'blocked');
  assert.deepEqual(events(out), [], 'preempting a (40) cannot make room for c (60) beside held (50)');
  assert.equal(q.state('a'), 'running');
  // A full table: preemption would need a fresh entry while the victim retires.
  const m2 = manualPort();
  const small: StreamLimits = {maxEntries: 2, maxConcurrent: 1, maxBytes: 100, preempt: true};
  const q2 = createStreamQueue(m2.port, small),
    o2 = createStreamResult(small);
  q2.request('a', {priority: 0, bytes: 1});
  q2.pump(0, o2);
  q2.request('b', {priority: 5, bytes: 1});
  q2.pump(1, o2);
  assert.deepEqual(events(o2), []);
  assert.ok(q2.stats().entries + q2.stats().retiring <= 2);
});

test('review: bulk cancellation of one key is not quadratic; cancel inside start stops the new work', () => {
  const m = manualPort();
  const limits: StreamLimits = {maxEntries: 4, maxRequests: 200_000, maxConcurrent: 1, maxBytes: 10};
  const q = createStreamQueue(m.port, limits);
  const hs: number[] = [];
  for (let i = 0; i < 100_000; i++) hs.push(q.request('k', {priority: i % 7, bytes: 1}).handle);
  const t0 = performance.now();
  for (const h of hs) q.cancel(h);
  assert.ok(performance.now() - t0 < 2000, 'cancelling 100,000 requests of one key stays fast');
  assert.equal(q.state('k'), 'absent');
  let cancels = 0;
  let handle = -1;
  const re = createStreamQueue<string>(
    {
      start() {
        re.cancel(handle);
        return {poll: () => ({status: 'pending'}), cancel: () => void cancels++};
      },
    },
    {maxEntries: 2, maxConcurrent: 1, maxBytes: 10},
  );
  handle = re.request('x', {priority: 0, bytes: 1}).handle;
  re.pump(0, createStreamResult({maxConcurrent: 1}));
  assert.equal(cancels, 1);
});
