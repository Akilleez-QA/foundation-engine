import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkerHost, type WorkerHostOptions } from './host.ts';
import { drainSlices, WorkerJobError, type JobClass, type JobKind, type JobOwner, type JobRequest } from './job.ts';
import { createFakeTimers, createInProcessWorker, fakeWorkerFactory } from './fake-worker.ts';

const MiB = 1024 * 1024;

function sumSlices(input: { n: number }) {
  return (function* () { let s = 0; for (let i = 1; i <= input.n; i++) { s += i; yield; } return s; })();
}

function kind(id: string, extra: Partial<JobKind<{ n: number }, number>> = {}) {
  const released: number[] = [];
  const k: JobKind<{ n: number }, number> = {
    id,
    cancellation: { mode: 'sliced', deadlineMs: 50 },
    fallback: { mode: 'main-thread', slices: sumSlices },
    release: (o) => released.push(o),
    ...extra,
  };
  return { k, released };
}

function owner(id = 'owner.a') { const c = new AbortController(); return { owner: { id, signal: c.signal } as JobOwner, end: () => c.abort() }; }

let materialised = 0;
function req(k: JobKind<{ n: number }, number>, o: JobOwner, extra: Partial<JobRequest<{ n: number }, number>> = {}): JobRequest<{ n: number }, number> {
  return {
    kind: k, owner: o, version: 1, class: 'foreground' as JobClass,
    bytes: { input: 1 * MiB, output: 1 * MiB, scratch: 0 },
    materialise: () => { materialised++; return { input: { n: 3 } }; },
    ...extra,
  };
}

function track<T>(p: Promise<T>) {
  const s: { settled: boolean; value?: T; error?: unknown } = { settled: false };
  p.then((v) => { s.settled = true; s.value = v; }, (e) => { s.settled = true; s.error = e; });
  return s;
}
const tick = () => new Promise<void>((r) => setImmediate(r));

function host(opts: Partial<WorkerHostOptions> & { slots?: number; pending?: number; bytes?: number } = {}) {
  const timers = createFakeTimers();
  const fake = fakeWorkerFactory();
  const reports: WorkerJobError[] = [];
  const h = createWorkerHost({
    hardwareConcurrency: 32,
    profile: { maxSlots: opts.slots ?? 2, maxPending: opts.pending ?? 8, maxReservedBytes: opts.bytes ?? 64 * MiB },
    createWorker: fake.create,
    timers,
    report: (e) => reports.push(e),
    ...opts,
  });
  return { h, timers, workers: fake.workers, reports };
}

test('admission bound holds: slots, pending count and reserved bytes; refused requests are never materialised', async () => {
  const { h } = host({ slots: 1, pending: 2 });
  const { k } = kind('job.test.sum');
  const { owner: o } = owner();
  const sig = new AbortController().signal;
  materialised = 0;
  const jobs = [0, 1, 2].map(() => track(h.run(req(k, o), sig)));
  const refused = await h.run(req(k, o), sig);
  assert.deepEqual(refused, { status: 'saturated' });
  assert.equal(materialised, 1, 'only the dispatched job built its payload');
  assert.deepEqual({ running: h.stats().running, pending: h.stats().pending }, { running: 1, pending: 2 });
  assert.ok(jobs.every((j) => !j.settled));

  const bytes = host({ slots: 1, bytes: 10 * MiB }).h;
  materialised = 0;
  assert.deepEqual(await bytes.run(req(k, o, { bytes: { input: 8 * MiB, output: 2 * MiB, scratch: 1 } }), sig), { status: 'oversized' });
  const a = track(bytes.run(req(k, o, { bytes: { input: 4 * MiB, output: 0, scratch: 0 } }), sig));
  const b = track(bytes.run(req(k, o, { bytes: { input: 4 * MiB, output: 0, scratch: 0 } }), sig));
  assert.deepEqual(await bytes.run(req(k, o, { bytes: { input: 4 * MiB, output: 0, scratch: 0 } }), sig), { status: 'saturated' });
  assert.equal(bytes.stats().reservedBytes, 8 * MiB);
  assert.equal(materialised, 1);
  assert.ok(!a.settled && !b.settled);
});

test('background never takes the last foreground slot; foreground evicts pending background before refusing', async () => {
  const { h, workers } = host({ slots: 2, pending: 1 });
  const { k } = kind('job.test.sum');
  const { owner: o } = owner();
  const sig = new AbortController().signal;
  const bg1 = track(h.run(req(k, o, { class: 'background' }), sig));
  const bg2 = track(h.run(req(k, o, { class: 'background' }), sig));
  assert.equal(workers.length, 1, 'second background waits: the last slot is reserved');
  assert.equal(h.stats().pending, 1);
  const fg = track(h.run(req(k, o), sig));
  await tick();
  assert.deepEqual(bg2.value, { status: 'preempted' }, 'pending background coalesced away for current work');
  assert.equal(workers.length, 2);
  assert.equal(workers[1]!.lastRun()?.kind, 'job.test.sum');
  assert.ok(!bg1.settled && !fg.settled);
});

test('one-slot port: running background is retired for foreground work', async () => {
  const { h, workers } = host({ slots: 1 });
  const { k } = kind('job.test.sum', { cancellation: { mode: 'unsliced' } });
  const { owner: o } = owner();
  const sig = new AbortController().signal;
  const bg = track(h.run(req(k, o, { class: 'background' }), sig));
  const fg = track(h.run(req(k, o), sig));
  await tick();
  assert.deepEqual(bg.value, { status: 'preempted' });
  assert.equal(workers[0]!.terminated, true);
  assert.equal(workers.length, 2);
  workers[1]!.complete(6);
  await tick();
  assert.deepEqual(fg.value, { status: 'done', output: 6 });
});

test('a cancelled job\'s result is dropped and released once; its slot frees only when execution stops', async () => {
  const { h, workers } = host({ slots: 1 });
  const { k, released } = kind('job.test.sum');
  const { owner: o } = owner();
  const ctl = new AbortController();
  const job = track(h.run(req(k, o), ctl.signal));
  const next = track(h.run(req(k, o), new AbortController().signal));
  ctl.abort();
  await tick();
  assert.deepEqual(job.value, { status: 'cancelled' }, 'delivery invalidated at once');
  assert.equal(workers[0]!.cancels(), 1, 'sliced job told to stop');
  assert.equal(h.stats().running, 1, 'slot still occupied until the worker stops');
  assert.equal(workers[0]!.received.filter((r) => r.message.type === 'run').length, 1);
  workers[0]!.complete(6); // the result raced the cancel
  await tick();
  assert.deepEqual(released, [6], 'late output released exactly once');
  assert.deepEqual(job.value, { status: 'cancelled' }, 'settled once');
  assert.equal(workers[0]!.lastRun()?.job, 2, 'slot reused for the next job');
  assert.ok(!next.settled);

  // A sliced job that misses its deadline is terminated and replaced.
  const ctl2 = new AbortController();
  const { h: h2, workers: w2, timers: t2 } = host({ slots: 1 });
  const slow = track(h2.run(req(k, o), ctl2.signal));
  ctl2.abort();
  t2.advance(49);
  assert.equal(w2[0]!.terminated, false);
  t2.advance(1);
  assert.equal(w2[0]!.terminated, true);
  assert.equal(h2.stats().running, 0);
  await tick();
  assert.deepEqual(slow.value, { status: 'cancelled' });

  // Unsliced: terminated immediately; ending the owner lifetime cancels too.
  const { k: u } = kind('job.test.unsliced', { cancellation: { mode: 'unsliced' } });
  const { h: h3, workers: w3 } = host({ slots: 1 });
  const life = owner();
  const j3 = track(h3.run(req(u, life.owner), new AbortController().signal));
  life.end();
  await tick();
  assert.deepEqual(j3.value, { status: 'cancelled' });
  assert.equal(w3[0]!.terminated, true);
  assert.equal(h3.stats().reservedBytes, 0);
});

test('a stale key is superseded; keys are scoped by owner lifetime and kind', async () => {
  const { h, workers } = host({ slots: 4 });
  const { k, released } = kind('job.test.sum');
  const a = owner('same-id'), b = owner('same-id');
  const sig = new AbortController().signal;
  const v1 = track(h.run(req(k, a.owner, { key: 'plan', version: 1 }), sig));
  const other = track(h.run(req(k, b.owner, { key: 'plan', version: 1 }), sig));
  const v2 = track(h.run(req(k, a.owner, { key: 'plan', version: 2 }), sig));
  await tick();
  assert.deepEqual(v1.value, { status: 'superseded' });
  assert.ok(!other.settled, 'an equal key from another owner lifetime is untouched');
  materialised = 0;
  assert.deepEqual(await h.run(req(k, a.owner, { key: 'plan', version: 1 }), sig), { status: 'superseded' }, 'an older version is stale on arrival');
  assert.equal(materialised, 0);
  workers[0]!.complete(1); // v1's late result
  workers[2]!.complete(2);
  workers[1]!.complete(3);
  await tick();
  assert.deepEqual(released, [1]);
  assert.deepEqual(v2.value, { status: 'done', output: 2 });
  assert.deepEqual(other.value, { status: 'done', output: 3 });

  // A keyed queue keeps only the newest pending request.
  const { h: q } = host({ slots: 1 });
  const busy = track(q.run(req(k, a.owner), sig));
  const p = [3, 4, 5].map((version) => track(q.run(req(k, a.owner, { key: 'grid', version }), sig)));
  await tick();
  assert.equal(q.stats().pending, 1);
  assert.deepEqual(p.map((x) => x.value), [{ status: 'superseded' }, { status: 'superseded' }, undefined]);
  assert.ok(!busy.settled);
});

test('the pool releases idle workers beyond the warm minimum after 30 s', async () => {
  const { h, workers, timers } = host({ slots: 6 });
  assert.deepEqual({ cap: h.size.cap, warm: h.size.warm }, { cap: 6, warm: 4 });
  const { k } = kind('job.test.sum');
  const { owner: o } = owner();
  const jobs = Array.from({ length: 6 }, () => track(h.run(req(k, o), new AbortController().signal)));
  assert.equal(workers.length, 6);
  for (const w of workers) w.complete(1);
  await tick();
  assert.ok(jobs.every((j) => j.settled));
  timers.advance(29_999);
  assert.equal(h.stats().workers, 6);
  timers.advance(1);
  assert.equal(h.stats().workers, 4);
  assert.equal(workers.filter((w) => w.terminated).length, 2);
  timers.advance(60_000);
  assert.equal(h.stats().workers, 4, 'the warm minimum stays');
  h.dispose();
  assert.equal(workers.filter((w) => w.terminated).length, 6);
});

test('fallback: without workers a declared main-thread job runs one bounded slice per task', async () => {
  const timers = createFakeTimers();
  const reports: WorkerJobError[] = [];
  const h = createWorkerHost({ hardwareConcurrency: 8, createWorker: null, timers, report: (e) => reports.push(e) });
  let slicesRun = 0;
  const { k } = kind('job.test.sum', {
    fallback: { mode: 'main-thread', slices: (i) => (function* () { let s = 0; for (let n = 1; n <= i.n; n++) { s += n; slicesRun++; yield; } return s; })() },
  });
  const { owner: o } = owner();
  const job = track(h.run(req(k, o), new AbortController().signal));
  assert.equal(slicesRun, 0, 'nothing runs synchronously: the frame never waits');
  timers.flush();
  await tick();
  assert.deepEqual(job.value, { status: 'done', output: 6 });
  assert.equal(slicesRun, 3);

  // Cancelled mid-way: stops at the next slice, never delivers.
  slicesRun = 0;
  const ctl = new AbortController();
  const c = track(h.run(req(k, o, { materialise: () => ({ input: { n: 100 } }) }), ctl.signal));
  timers.setTimeout(() => ctl.abort(), 0);
  timers.flush();
  await tick();
  assert.deepEqual(c.value, { status: 'cancelled' });
  assert.ok(slicesRun < 5, `stopped after ${slicesRun} slices`);

  // An 'unavailable' kind is a recoverable, reported failure: never a fabricated result.
  const { k: u } = kind('job.test.unavailable', { fallback: { mode: 'unavailable' } });
  await assert.rejects(h.run(req(u, o), new AbortController().signal), (e: unknown) => e instanceof WorkerJobError && e.reason === 'unavailable');
  assert.equal(reports.at(-1)?.reason, 'unavailable');
  assert.equal(h.stats().reservedBytes, 0);

  // A spawn failure switches to the fallback and is reported.
  const spawnReports: WorkerJobError[] = [];
  const t2 = createFakeTimers();
  const h2 = createWorkerHost({ hardwareConcurrency: 8, timers: t2, createWorker: () => { throw new Error('blocked by policy'); }, report: (e) => spawnReports.push(e) });
  const s = track(h2.run(req(k, o), new AbortController().signal));
  t2.flush();
  await tick();
  assert.deepEqual(s.value, { status: 'done', output: 6 });
  assert.equal(spawnReports[0]?.reason, 'spawn');
  assert.equal(h2.stats().workersAvailable, false);
});

test('a job that throws or a worker that crashes rejects with a named error', async () => {
  const { h, workers, reports } = host({ slots: 1 });
  const { k } = kind('job.test.sum');
  const { owner: o } = owner();
  const threw = h.run(req(k, o), new AbortController().signal);
  workers[0]!.throwInJob('bad input');
  await assert.rejects(threw, (e: unknown) => e instanceof WorkerJobError && e.reason === 'threw' && e.name === 'WorkerJobError');
  const crashed = h.run(req(k, o), new AbortController().signal);
  workers[0]!.crash();
  await assert.rejects(crashed, (e: unknown) => e instanceof WorkerJobError && e.reason === 'terminated');
  assert.equal(workers[0]!.terminated, true);
  assert.deepEqual(reports.map((r) => r.reason), ['threw', 'terminated']);
  assert.deepEqual({ workers: h.stats().workers, reserved: h.stats().reservedBytes }, { workers: 0, reserved: 0 });
});

test('transferables named by the payload travel with the run message', () => {
  const { h, workers } = host({ slots: 1 });
  const { k } = kind('job.test.sum');
  const { owner: o } = owner();
  const buf = new ArrayBuffer(16);
  void h.run(req(k, o, { materialise: () => ({ input: { n: 1 }, transfer: [buf] }) }), new AbortController().signal);
  assert.deepEqual(workers[0]!.received[0]!.transfer, [buf]);
});

test('in-process worker running the real runtime: sliced cancellation is seen at a task checkpoint', async () => {
  const timers = createFakeTimers();
  let slicesRun = 0;
  const loaders = {
    'job.test.sum': async () => ({
      run: async (input: unknown, ctx: Parameters<typeof drainSlices>[1]) => {
        const out = await drainSlices((function* () { let s = 0; for (let i = 1; i <= (input as { n: number }).n; i++) { s += i; slicesRun++; yield; } return s; })(), ctx);
        return { output: out };
      },
    }),
  };
  const spawned: ReturnType<typeof createInProcessWorker>[] = [];
  const h = createWorkerHost({
    hardwareConcurrency: 8, profile: { maxSlots: 1, maxPending: 4, maxReservedBytes: 64 * MiB }, timers,
    createWorker: () => { const w = createInProcessWorker(loaders, timers); spawned.push(w); return w; },
  });
  const { k, released } = kind('job.test.sum');
  const { owner: o } = owner();
  const done = track(h.run(req(k, o, { materialise: () => ({ input: { n: 4 } }) }), new AbortController().signal));
  for (let i = 0; i < 50 && !done.settled; i++) { timers.flush(); await tick(); }
  assert.deepEqual(done.value, { status: 'done', output: 10 });

  slicesRun = 0;
  const ctl = new AbortController();
  const big = track(h.run(req(k, o, { materialise: () => ({ input: { n: 1_000_000 } }) }), ctl.signal));
  for (let i = 0; i < 5; i++) { timers.flush(); await tick(); }
  ctl.abort();
  for (let i = 0; i < 20; i++) { timers.flush(); await tick(); }
  assert.deepEqual(big.value, { status: 'cancelled' });
  assert.ok(slicesRun < 100, `worker stopped after ${slicesRun} slices`);
  assert.equal(h.stats().running, 0, 'slot released by the cancel acknowledgement');
  assert.equal(spawned[0]!.terminated, false, 'a sliced job stops without termination');
  assert.deepEqual(released, []);
});

test('results arrive through promises, never synchronously inside the calling frame', () => {
  const { h, workers } = host({ slots: 1 });
  const { k } = kind('job.test.sum');
  const { owner: o } = owner();
  const p = track(h.run(req(k, o), new AbortController().signal));
  workers[0]!.complete(6);
  assert.equal(p.settled, false, 'the result is picked up by a later task, never inside the calling frame');
});

test('distinct key history stays bounded while known keys retain monotonic versions after completion', async () => {
  const { h, workers } = host({ slots: 1, maxKeysPerOwner: 2 });
  const { k } = kind('job.test.history');
  const a = owner(), b = owner();
  const signal = new AbortController().signal;
  try {
    for (const key of ['a', 'b']) {
      const result = h.run(req(k, a.owner, { key, version: 2 }), signal);
      workers[0]!.complete(6);
      assert.deepEqual(await result, { status: 'done', output: 6 });
    }
    materialised = 0;
    for (let i = 0; i < 100; i++) {
      assert.deepEqual(await h.run(req(k, a.owner, { key: `excess-${i}` }), signal), { status: 'saturated' });
    }
    assert.equal(materialised, 0);
    assert.deepEqual(await h.run(req(k, a.owner, { key: 'a', version: 1 }), signal), { status: 'superseded' });
    const known = h.run(req(k, a.owner, { key: 'a', version: 3 }), signal);
    workers[0]!.complete(7);
    assert.deepEqual(await known, { status: 'done', output: 7 });
    const independent = h.run(req(k, b.owner, { key: 'excess-0' }), signal);
    workers[0]!.complete(8);
    assert.deepEqual(await independent, { status: 'done', output: 8 });
  } finally { h.dispose(); }
});

test('history capacity preserves cancellation and late-result release for replacement keys', async () => {
  const { h, workers } = host({ slots: 1, maxKeysPerOwner: 1 });
  const { k, released } = kind('job.test.history');
  const lifetime = owner();
  const signal = new AbortController().signal;
  try {
    const first = h.run(req(k, lifetime.owner, { key: 'stable', version: 1 }), signal);
    assert.deepEqual(await h.run(req(k, lifetime.owner, { key: 'other' }), signal), { status: 'saturated' });
    assert.equal(workers[0]!.cancels(), 0, 'unknown overflow cannot cancel current work');
    const next = h.run(req(k, lifetime.owner, { key: 'stable', version: 2 }), signal);
    assert.deepEqual(await first, { status: 'superseded' });
    workers[0]!.complete(11);
    assert.deepEqual(released, [11], 'stale completion is retired before queued replacement');
    lifetime.end();
    assert.deepEqual(await next, { status: 'cancelled' });
    workers[0]!.complete(12);
    assert.deepEqual(released, [11, 12]);
    assert.equal(h.stats().reservedBytes, 0);
  } finally { h.dispose(); }
});

test('execution saturation keeps observed version history but metadata overflow records nothing', async () => {
  const { h, workers } = host({ slots: 1, bytes: 2 * MiB, maxKeysPerOwner: 1 });
  const { k } = kind('job.test.history');
  const { owner: lifetime } = owner();
  const signal = new AbortController().signal;
  try {
    const occupied = h.run(req(k, lifetime), signal);
    assert.deepEqual(await h.run(req(k, lifetime, { key: 'observed', version: 9 }), signal), { status: 'saturated' });
    assert.deepEqual(await h.run(req(k, lifetime, { key: 'rejected', version: 99 }), signal), { status: 'saturated' });
    workers[0]!.complete(6);
    await occupied;
    assert.deepEqual(await h.run(req(k, lifetime, { key: 'observed', version: 8 }), signal), { status: 'superseded' });
    assert.deepEqual(await h.run(req(k, lifetime, { key: 'rejected', version: 1 }), signal), { status: 'saturated' }, 'rejected identity has no recorded version');
    const accepted = h.run(req(k, lifetime, { key: 'observed', version: 9 }), signal);
    workers[0]!.complete(6);
    assert.deepEqual(await accepted, { status: 'done', output: 6 });
  } finally { h.dispose(); }
});

test('key-history limit validates configuration and zero leaves unkeyed work available', async () => {
  for (const maxKeysPerOwner of [-1, 0.5, Infinity, NaN]) assert.throws(() => createWorkerHost({ maxKeysPerOwner }), /nonnegative safe integer/);
  const { h, workers } = host({ maxKeysPerOwner: 0 });
  const { k } = kind('job.test.history');
  const { owner: lifetime } = owner();
  const signal = new AbortController().signal;
  try {
    assert.deepEqual(await h.run(req(k, lifetime, { key: 'keyed' }), signal), { status: 'saturated' });
    const result = h.run(req(k, lifetime), signal);
    workers[0]!.complete(6);
    assert.deepEqual(await result, { status: 'done', output: 6 });
  } finally { h.dispose(); }
});

test('same-key version advance survives execution admission failure without forgetting its tombstone', async () => {
  const { h, workers } = host({ slots: 1, bytes: 2 * MiB, maxKeysPerOwner: 1 });
  const { k, released } = kind('job.test.history');
  const { owner: lifetime } = owner();
  const signal = new AbortController().signal;
  try {
    const first = h.run(req(k, lifetime, { key: 'stable', version: 1 }), signal);
    assert.deepEqual(await h.run(req(k, lifetime, { key: 'stable', version: 2 }), signal), { status: 'saturated' });
    assert.deepEqual(await first, { status: 'superseded' });
    assert.equal(h.stats().reservedBytes, 2 * MiB, 'cancelled physical work still owns execution bytes');
    workers[0]!.complete(11);
    assert.deepEqual(released, [11]);
    assert.deepEqual(await h.run(req(k, lifetime, { key: 'stable', version: 1 }), signal), { status: 'superseded' });
    const retry = h.run(req(k, lifetime, { key: 'stable', version: 2 }), signal);
    workers[0]!.complete(12);
    assert.deepEqual(await retry, { status: 'done', output: 12 });
  } finally { h.dispose(); }
});

test('invalid keyed versions cannot poison history; finite fractional and negative versions remain ordered', async () => {
  const { h, workers } = host({ slots: 1, maxKeysPerOwner: 1 });
  const { k } = kind('job.test.history');
  const { owner: lifetime } = owner();
  const signal = new AbortController().signal;
  try {
    for (const version of [NaN, Infinity, -Infinity]) {
      assert.throws(() => h.run(req(k, lifetime, { key: 'invalid', version }), signal), /version must be finite/);
    }
    for (const version of [-2.5, -0.5, 0.25]) {
      const result = h.run(req(k, lifetime, { key: 'finite', version }), signal);
      workers[0]!.complete(6);
      assert.deepEqual(await result, { status: 'done', output: 6 });
    }
    assert.deepEqual(await h.run(req(k, lifetime, { key: 'finite', version: -0.5 }), signal), { status: 'superseded' });
  } finally { h.dispose(); }
});

for (const cancellation of ['caller', 'owner', 'dispose', 'supersede'] as const) {
  for (const inline of [false, true]) {
    test(`materialise ${cancellation} cannot dispatch stale work or double-release reservations (${inline ? 'inline' : 'worker'})`, async () => {
      const f = host({ slots: 1, ...(inline ? { createWorker: null } : {}) });
      const life = owner(), caller = new AbortController();
      let sliceFactories = 0;
      const { k } = kind(`materialise.${cancellation}`, {
        fallback: { mode: 'main-thread', slices(input) { sliceFactories++; return sumSlices(input); } },
      });
      let newer: Promise<unknown> | undefined;
      const initial = f.h.run(req(k, life.owner, {
        key: 'same', version: 1,
        bytes: { input: 8, output: 8, scratch: 0 },
        materialise() {
          if (cancellation === 'caller') caller.abort();
          else if (cancellation === 'owner') life.end();
          else if (cancellation === 'dispose') f.h.dispose();
          else newer = f.h.run(req(k, life.owner, {
            key: 'same', version: 2, bytes: { input: 8, output: 8, scratch: 0 },
            materialise: () => ({ input: { n: 4 } }),
          }), new AbortController().signal);
          return { input: { n: 3 } };
        },
      }), caller.signal);
      assert.deepEqual(await initial, { status: cancellation === 'supersede' ? 'superseded' : 'cancelled' });
      const runs = f.workers.flatMap(w => w.received.filter(r => r.message.type === 'run'));
      assert.equal(runs.length, !inline && newer ? 1 : 0);
      assert.equal(f.h.stats().reservedBytes, newer ? 16 : 0);
      if (newer) {
        if (inline) f.timers.flush(); else f.workers[0].complete(10);
        assert.deepEqual(await newer, { status: 'done', output: 10 });
      }
      assert.equal(sliceFactories, inline && newer ? 1 : 0);
      assert.equal(f.h.stats().reservedBytes, 0);
      assert.equal(f.h.stats().running, 0);
      assert.equal(f.h.stats().pending, 0);
      assert.deepEqual(f.reports, []);
      // A cancelled entry must not damage admission/accounting of the next independent owner.
      if (cancellation !== 'dispose') {
        const nextLife = owner('next.owner');
        const next = f.h.run(req(k, nextLife.owner, { bytes: { input: 8, output: 8, scratch: 0 } }), new AbortController().signal);
        assert.equal(f.h.stats().reservedBytes, 16);
        if (inline) f.timers.flush(); else f.workers[0].complete(6);
        assert.deepEqual(await next, { status: 'done', output: 6 });
        assert.equal(f.h.stats().reservedBytes, 0);
      } else assert.ok(f.workers.every(w => w.terminated));
      f.h.dispose();
      assert.equal(f.h.stats().reservedBytes, 0);
      assert.equal(f.timers.pending(), 0);
    });
  }
}

test('throwing worker reporter preserves job errors and dispatches queued successors', async () => {
  for (const crash of [false, true]) {
    const reports: WorkerJobError[] = [];
    const { h, workers } = host({ slots: 1, report(error) { reports.push(error); throw Error('reporter failed'); } });
    const { k } = kind('job.test.report-worker');
    const { owner: o } = owner();
    const signal = new AbortController().signal;
    const failed = h.run(req(k, o), signal);
    const rejection = assert.rejects(failed, error => error === reports[0] && error instanceof WorkerJobError && error.reason === (crash ? 'terminated' : 'threw'));
    const next = h.run(req(k, o), signal);
    assert.doesNotThrow(() => crash ? workers[0].crash() : workers[0].throwInJob('original failure'));
    await rejection;
    assert.equal(h.stats().pending, 0);
    assert.equal(h.stats().running, 1);
    assert.equal(h.stats().reservedBytes, 2 * MiB);
    workers.at(-1)!.complete(6);
    assert.deepEqual(await next, { status: 'done', output: 6 });
    assert.equal(h.stats().reservedBytes, 0);
    h.dispose();
  }
});

test('throwing inline reporter cannot strand the inline lane or its reservation', async () => {
  const reports: WorkerJobError[] = [];
  const { h, timers } = host({ createWorker: null, report(error) { reports.push(error); throw Error('reporter failed'); } });
  const { k } = kind('job.test.report-inline', { fallback: { mode: 'main-thread', slices: () => (function* () { throw Error('slice failed'); yield; return 0; })() } });
  const { k: healthy } = kind('job.test.report-success');
  const { owner: o } = owner();
  const signal = new AbortController().signal;
  const failed = h.run(req(k, o), signal);
  const rejection = assert.rejects(failed, error => error === reports[0] && error instanceof WorkerJobError && error.reason === 'threw');
  const next = h.run(req(healthy, o), signal);
  assert.doesNotThrow(() => timers.flush());
  await rejection;
  assert.deepEqual(await next, { status: 'done', output: 6 });
  assert.equal(h.stats().reservedBytes, 0);
  assert.equal(h.stats().running, 0);
  h.dispose();
});

test('throwing spawn reporter still reaches fallback and settles unavailable jobs', async () => {
  const reports: WorkerJobError[] = [];
  const { h, timers } = host({ createWorker() { throw Error('spawn denied'); }, report(error) { reports.push(error); throw Error('reporter failed'); } });
  const { k } = kind('job.test.report-fallback');
  const { owner: o } = owner();
  const signal = new AbortController().signal;
  const first = h.run(req(k, o), signal);
  timers.flush();
  assert.deepEqual(await first, { status: 'done', output: 6 });
  assert.equal(reports[0].reason, 'spawn');
  const { k: unavailable } = kind('job.test.report-unavailable', { fallback: { mode: 'unavailable' } });
  await assert.rejects(h.run(req(unavailable, o), signal), error => error === reports[1] && error instanceof WorkerJobError && error.reason === 'unavailable');
  assert.equal(h.stats().reservedBytes, 0);
  assert.equal(h.stats().running, 0);
  h.dispose();
});

test('reporter teardown cannot replace the original failure', async () => {
  let reports = 0;
  const { h, workers } = host({ slots: 1, report() { reports++; h.dispose(); throw Error('reporter failed'); } });
  const { k } = kind('job.test.report-dispose');
  const { owner: o } = owner();
  const failed = h.run(req(k, o), new AbortController().signal);
  const rejection = assert.rejects(failed, error => error instanceof WorkerJobError && error.reason === 'threw');
  assert.doesNotThrow(() => workers[0].throwInJob('original failure'));
  await rejection;
  assert.equal(reports, 1);
  assert.equal(h.stats().reservedBytes, 0);
  assert.equal(h.stats().running, 0);
});

for (const inline of [false, true]) {
  for (const teardown of ['none', 'release', 'report'] as const) {
    test(`output release failure preserves cancellation and capacity (${inline ? 'inline' : 'worker'}, ${teardown})`, async () => {
      const ctl = new AbortController();
      let attempts = 0;
      const releaseFailure = { reason: 'release failed' };
      const reports: WorkerJobError[] = [];
      const { h, timers, workers } = host({
        slots: 1,
        ...(inline ? { createWorker: null } : {}),
        report(error) {
          reports.push(error);
          if (teardown === 'report') h.dispose();
          throw Error('report failed');
        },
      });
      const { k } = kind('job.test.release-failure', {
        fallback: { mode: 'main-thread', slices: () => (function* () { ctl.abort(); return 42; })() },
        release(output) {
          assert.equal(output, 42);
          attempts++;
          if (teardown === 'release') h.dispose();
          throw releaseFailure;
        },
      });
      const { k: healthy } = kind('job.test.release-success');
      const { owner: o } = owner();
      const cancelled = h.run(req(k, o), ctl.signal);
      const next = h.run(req(healthy, o), o.signal);
      if (inline) assert.doesNotThrow(() => timers.flush());
      else {
        ctl.abort();
        assert.doesNotThrow(() => workers[0].complete(42));
        if (teardown === 'none') {
          assert.equal(workers[0].lastRun()!.kind, healthy.id);
          workers[0].complete(6);
        }
      }
      assert.deepEqual(await cancelled, { status: 'cancelled' });
      assert.deepEqual(await next, teardown === 'none' ? { status: 'done', output: 6 } : { status: 'cancelled' });
      assert.equal(attempts, 1);
      assert.equal(reports.length, 1);
      assert.equal(reports[0].kind, k.id);
      assert.equal(reports[0].cause, releaseFailure);
      assert.match(reports[0].message, /output release failed/);
      assert.equal(h.stats().reservedBytes, 0);
      assert.equal(h.stats().running, 0);
      assert.equal(h.stats().pending, 0);
      h.dispose();
    });
  }
}

test('unmatched late output cleanup cannot retire the worker current job', async () => {
  const { h, workers, reports } = host({ slots: 1 });
  let attempts = 0;
  const { k } = kind('job.test.late-release', { release() { attempts++; throw null; } });
  const { owner: o } = owner();
  const first = h.run(req(k, o), o.signal);
  const old = workers[0].lastRun()!;
  workers[0].complete(1);
  assert.deepEqual(await first, { status: 'done', output: 1 });
  const next = h.run(req(k, o), o.signal);
  assert.doesNotThrow(() => workers[0].onmessage!({ data: { type: 'done', job: old.job, kind: old.kind, output: 2 } }));
  assert.equal(attempts, 1);
  assert.equal(reports.length, 1);
  assert.equal(h.stats().reservedBytes, 2 * MiB);
  assert.equal(h.stats().running, 1);
  workers[0].complete(3);
  assert.deepEqual(await next, { status: 'done', output: 3 });
  assert.equal(h.stats().reservedBytes, 0);
  h.dispose();
});

for (const cancellation of ['caller', 'owner', 'dispose'] as const) {
  for (const reporterDisposes of [false, true]) {
    test(`throwing generator cleanup retires inline capacity (${cancellation}, reporter disposes ${reporterDisposes})`, async () => {
      const ctl = new AbortController(), lifetime = new AbortController();
      const cleanupFailure = { reason: 'finally failed' };
      const reports: WorkerJobError[] = [];
      let attempts = 0;
      const { h, timers } = host({
        createWorker: null,
        report(error) {
          reports.push(error);
          if (reporterDisposes) h.dispose();
          throw Error('report failed');
        },
      });
      const { k } = kind('job.test.generator-cleanup', {
        fallback: { mode: 'main-thread', slices: () => (function* () {
          try {
            if (cancellation === 'caller') ctl.abort();
            else if (cancellation === 'owner') lifetime.abort();
            else h.dispose();
            yield;
            return 1;
          } finally {
            attempts++;
            throw cleanupFailure;
          }
        })() },
      });
      const { k: healthy } = kind('job.test.generator-success');
      const { owner: healthyOwner } = owner();
      const cancelled = h.run(req(k, { id: 'owner.cleanup', signal: lifetime.signal }), ctl.signal);
      const next = h.run(req(healthy, healthyOwner), healthyOwner.signal);
      assert.doesNotThrow(() => timers.flush());
      assert.deepEqual(await cancelled, { status: 'cancelled' });
      assert.deepEqual(await next, cancellation === 'dispose' || reporterDisposes
        ? { status: 'cancelled' } : { status: 'done', output: 6 });
      assert.equal(attempts, 1);
      assert.equal(reports.length, 1);
      assert.equal(reports[0].cause, cleanupFailure);
      assert.match(reports[0].message, /fallback cleanup failed/);
      assert.equal(h.stats().reservedBytes, 0);
      assert.equal(h.stats().running, 0);
      assert.equal(h.stats().pending, 0);
      h.dispose();
      timers.flush();
      assert.equal(attempts, 1, 'cleanup is never retried');
    });
  }
}

test('cancellation makes one close attempt without draining a yielding finally block', async () => {
  const ctl = new AbortController();
  let cleanupStarted = 0, cleanupFinished = 0;
  const { h, timers } = host({ createWorker: null });
  const { k } = kind('job.test.generator-yield', {
    fallback: { mode: 'main-thread', slices: () => (function* () {
      try { ctl.abort(); yield; return 1; }
      finally { cleanupStarted++; yield; cleanupFinished++; }
    })() },
  });
  const { k: healthy } = kind('job.test.generator-success');
  const { owner: o } = owner();
  const cancelled = h.run(req(k, o), ctl.signal);
  const next = h.run(req(healthy, o), o.signal);
  timers.flush();
  assert.deepEqual(await cancelled, { status: 'cancelled' });
  assert.deepEqual(await next, { status: 'done', output: 6 });
  assert.equal(cleanupStarted, 1);
  assert.equal(cleanupFinished, 0);
  assert.equal(h.stats().reservedBytes, 0);
  assert.equal(h.stats().running, 0);
  h.dispose();
});

for (const cancellation of ['caller', 'owner', 'dispose'] as const) {
 test(`admission rechecks incoming lifetime after supersession dispatch (${cancellation})`, async()=>{
  const {h,workers}=host({slots:1});
  const ctl=new AbortController(),lifetime=new AbortController();
  const incomingOwner={id:'owner.incoming',signal:lifetime.signal};
  const {owner:otherOwner}=owner('owner.other');
  const {k}=kind('job.test.admission-reentry',{cancellation:{mode:'unsliced'}});
  const first=h.run(req(k,incomingOwner,{key:'replace',version:1}),incomingOwner.signal);
  const queued=h.run(req(k,otherOwner,{materialise(){
   if(cancellation==='caller')ctl.abort();
   else if(cancellation==='owner')lifetime.abort();
   else h.dispose();
   return {input:{n:3}};
  }}),otherOwner.signal);
  let allocations=0;
  const incoming=h.run(req(k,incomingOwner,{key:'replace',version:2,materialise(){allocations++;return {input:{n:3}};}}),ctl.signal);
  assert.equal(h.stats().pending,0,'already-ended incoming request must not enter queue');
  assert.deepEqual(await incoming,{status:'cancelled'});
  assert.deepEqual(await first,{status:'superseded'});
  assert.equal(allocations,0);
  if(cancellation!=='dispose'){
   assert.equal(h.stats().reservedBytes,2*MiB,'only independently owned queued work remains');
   workers.at(-1)!.complete(6);
   assert.deepEqual(await queued,{status:'done',output:6});
  }else assert.deepEqual(await queued,{status:'cancelled'});
  assert.equal(h.stats().reservedBytes,0);
  if(cancellation==='caller'){
   assert.deepEqual(await h.run(req(k,incomingOwner,{key:'replace',version:1}),incomingOwner.signal),{status:'superseded'},'observed version high-water mark remains');
  }
  h.dispose();
 });
}

for (const nestedVersion of [2,3]) {
 test(`reentrant accepted version ${nestedVersion} retains ownership over older admission call`,async()=>{
  const {h,workers}=host({slots:1});
  const {owner:o}=owner();
  const {k}=kind('job.test.version-reentry',{cancellation:{mode:'unsliced'}});
  const first=h.run(req(k,o,{key:'replace',version:1}),o.signal);
  let nested:Promise<unknown>|undefined,allocations=0;
  const queued=h.run(req(k,o,{materialise(){
   nested=h.run(req(k,o,{key:'replace',version:nestedVersion}),o.signal);
   return {input:{n:3}};
  }}),o.signal);
  const outer=h.run(req(k,o,{key:'replace',version:2,materialise(){allocations++;return {input:{n:3}};}}),o.signal);
  assert.deepEqual(await outer,{status:'superseded'});
  assert.deepEqual(await first,{status:'superseded'});
  assert.equal(h.stats().pending,1);
  assert.equal(allocations,0);
  const latest=h.run(req(k,o,{key:'replace',version:4}),o.signal);
  assert.deepEqual(await nested,{status:'superseded'},'later request cancels the actual current nested entry');
  workers.at(-1)!.complete(6);await queued;
  workers.at(-1)!.complete(6);await latest;
  assert.equal(h.stats().reservedBytes,0);h.dispose();
 });
}
