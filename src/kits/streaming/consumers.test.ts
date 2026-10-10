import {test} from 'node:test';
import assert from 'node:assert/strict';
import {World, component} from '../../core/ecs/world';
import {createSystemRunner} from '../../core/ecs/systems';
import {LeaseCache} from '../../platform/assets/lease-cache';
import {createStreamQueue, createStreamResult, leasePort, modelPort, promisePort, type StreamLimits} from './index';

const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test('consumer 1: a lease cache behind the queue loads once per key, charges its own byte measure and keeps released values warm', async () => {
  // A loader in the shape of the texture/model libraries: fetch -> upload -> bytes, with a warm residency budget.
  const fetched: string[] = [];
  const disposed: string[] = [];
  let resolveFetch = new Map<string, () => void>();
  const cache = new LeaseCache<string, {key: string; size: number}>(
    {
      fetch: (key, signal) =>
        new Promise<string>((resolve, reject) => {
          fetched.push(key);
          resolveFetch.set(key, () => resolve(key));
          signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), {name: 'AbortError'})));
        }),
      upload: key => ({key, size: key.length * 100}),
      discard: () => {},
      dispose: r => void disposed.push(r.key),
      bytes: r => r.size,
    },
    {warmBytes: 1000},
  );
  const limits: StreamLimits = {maxEntries: 16, maxConcurrent: 2, maxBytes: 2000};
  const q = createStreamQueue(
    leasePort<{key: string; size: number}, {value: {key: string; size: number}; release(): void}>(
      (key, signal) => cache.acquire(key, signal),
      (_lease, key) => cache.info(key)!.bytes,
    ),
    limits,
  );
  const out = createStreamResult(limits);
  const near = q.request('clip.walk', {priority: 10, bytes: 1000});
  q.request('clip.run', {priority: 5, bytes: 1000});
  const far = q.request('clip.swim', {priority: 1, bytes: 1000});
  q.pump(0, out);
  assert.deepEqual(fetched, ['clip.walk', 'clip.run'], 'two at a time, highest priority first');
  resolveFetch.get('clip.walk')!();
  resolveFetch.get('clip.run')!();
  await tick();
  q.pump(1, out);
  assert.equal(q.state('clip.walk'), 'ready');
  assert.equal(q.stats().bytes, 900 + 800, 'charged with the cache measure, not the estimate');
  assert.equal(q.state('clip.swim'), 'queued', 'swim (estimate 1000) does not fit beside 1,700 charged bytes');
  // The far request goes away before it starts: nothing is fetched for it.
  q.cancel(far.handle);
  q.pump(2, out);
  assert.equal(fetched.length, 2);
  // Releasing walk returns it to the cache, which keeps it warm (900 <= 1000 warm bytes).
  q.cancel(near.handle);
  assert.equal(cache.refs('clip.walk'), 0);
  assert.deepEqual(disposed, []);
  // Asking again is a cache hit: no second fetch.
  resolveFetch = new Map();
  q.request('clip.walk', {priority: 10, bytes: 1000});
  q.pump(3, out);
  await tick();
  q.pump(4, out);
  assert.equal(q.get('clip.walk')?.key, 'clip.walk');
  assert.equal(fetched.filter(k => k === 'clip.walk').length, 1);
  assert.equal(cache.stats.hits, 1);
  q.dispose();
  assert.equal(cache.refs('clip.walk'), 0);
  assert.equal(cache.refs('clip.run'), 0);
});

test('consumer 2: a fixed-step system streams model assets through the model owner, nearest first', () => {
  const world = new World();
  const Model = component('model', {asset: '', visible: true});
  const state = new Map<number, 'loading' | 'ready' | 'failed'>();
  const loading = new Set<number>();
  const port = modelPort({
    world,
    components: asset => [Model({asset, visible: false})],
    modelState: e => ({status: world.exists(e) ? (state.get(e) ?? 'loading') : 'absent'}),
    bytes: () => 5_000_000,
  });
  const limits: StreamLimits = {maxEntries: 32, maxConcurrent: 2, maxBytes: 12_000_000, maxStartsPerPump: 1};
  const q = createStreamQueue(port, limits),
    out = createStreamResult(limits);
  const zones = [
    {asset: 'zone.a', distance: 5},
    {asset: 'zone.b', distance: 50},
    {asset: 'zone.c', distance: 20},
  ];
  const handles = new Map<string, number>();
  let now = 0;
  const log: string[] = [];
  const runner = createSystemRunner<null>(
    [
      {
        id: 'stream',
        run() {
          now++;
          for (const z of zones) {
            const h = handles.get(z.asset);
            if (h === undefined)
              handles.set(z.asset, q.request(z.asset, {priority: -z.distance, bytes: 5_000_000}).handle);
            else q.setPriority(h, -z.distance);
          }
          q.pump(now, out);
          for (let i = 0; i < out.count; i++) log.push(`${out.kinds[i]} ${out.keys[i]}`);
          for (const e of world.query(Model)) if (!state.has(e[0])) loading.add(e[0]);
        },
      },
    ],
    {step: 1 / 60, maxSteps: 4},
  );
  runner.frame(null, 1 / 60);
  runner.frame(null, 1 / 60);
  assert.deepEqual(log, ['started zone.a', 'started zone.c'], 'one start per pump, nearest first');
  // The model owner finishes zone.a; zone.c fails once and is retried later.
  const [ea, ec] = [...loading];
  state.set(ea!, 'ready');
  state.set(ec!, 'failed');
  runner.frame(null, 1 / 60);
  assert.deepEqual(
    log.slice(2),
    ['ready zone.a', 'retrying zone.c', 'started zone.b'],
    'the failure frees bytes for b',
  );
  assert.equal(world.exists(ec!), false, 'a failed model entity is removed');
  assert.equal(world.get(q.get('zone.a')!, Model)!.visible, false, 'the value is the hidden model entity');
  // zone.c's retry comes due after 30 ticks but 5 MB ready + 5 MB running + 5 MB would exceed 12 MB.
  for (let i = 0; i < 40; i++) runner.frame(null, 1 / 60);
  assert.equal(q.state('zone.c'), 'queued');
  assert.equal(q.stats().bytes, 10_000_000);
  // The player leaves zone.a: its model entity goes and zone.c starts on the next step.
  const ha = handles.get('zone.a')!;
  zones.splice(0, 1);
  q.cancel(ha);
  runner.frame(null, 1 / 60);
  assert.equal(log.at(-1), 'started zone.c');
  // Leaving: cancelling every request despawns every model entity.
  for (const [k, h] of handles) if (k !== 'zone.a') q.cancel(h);
  for (const e of [...world.query(Model)]) state.set(e[0], 'ready');
  q.pump(++now, out);
  assert.equal(world.count, 0, 'no hidden model entity outlives its requests');
});

test('consumer 3: promisePort releases a value that resolves after cancellation and treats aborts as final', async () => {
  let release = 0;
  let resolve!: (v: {value: string; bytes: number; release(): void}) => void;
  const port = promisePort<string>((_key, signal) => {
    assert.equal(signal.aborted, false);
    return new Promise(r => (resolve = r));
  });
  const limits: StreamLimits = {maxEntries: 4, maxConcurrent: 1, maxBytes: 10};
  const q = createStreamQueue(port, limits),
    out = createStreamResult(limits);
  const h = q.request('k', {priority: 0, bytes: 1}).handle;
  q.pump(0, out);
  q.cancel(h);
  resolve({value: 'late', bytes: 1, release: () => void release++});
  await tick();
  assert.equal(release, 1, 'released by the port as soon as it arrives');
  q.pump(1, out);
  assert.equal(q.stats().retiring, 0);
  assert.equal(release, 1, 'and only once');
  const aborting = createStreamQueue(
    promisePort<string>(() => Promise.reject(Object.assign(new Error('stop'), {name: 'AbortError'}))),
    limits,
  );
  aborting.request('x', {priority: 0, bytes: 1});
  aborting.pump(0, out);
  await tick();
  aborting.pump(1, out);
  assert.equal(aborting.state('x'), 'failed', 'an abort is not retried');
});
