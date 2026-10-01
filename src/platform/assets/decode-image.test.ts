// Off-thread decode: the texture cache's images are decoded by createImageBitmap in a worker job, with
// three.js's <img> defaults baked in; capability fallback and transient capacity waits stay bounded.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkerHost } from '../workers/host.ts';
import { createFakeTimers, fakeWorkerFactory } from '../workers/fake-worker.ts';
import { WorkerJobError, type JobRequest, type JobResult } from '../workers/job.ts';
import { jobLoaders } from '../workers/job-rows.ts';
import { isAbortError } from './lease-cache';
import {
  DECODE_IMAGE_JOB_ID,
  IMAGE_BITMAP_OPTIONS,
  createImageDecoder,
  decodeImageJob,
  fetchImageBitmap,
  type DecodeHost,
} from './decode-image';

class FakeBitmap {
  closed = false;
  constructor(readonly width: number, readonly height: number) {}
  close() { this.closed = true; }
}
const bitmap = (w = 4, h = 2) => new FakeBitmap(w, h) as unknown as ImageBitmap;
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

test('the decode bakes in three.js\'s <img> upload defaults: flipped, not premultiplied, no colour conversion', () => {
  assert.deepEqual(IMAGE_BITMAP_OPTIONS, { imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
});

test('the job kind is a registered row with a sliced cancellation and a release that closes the bitmap', async () => {
  assert.equal(decodeImageJob.id, DECODE_IMAGE_JOB_ID);
  assert.equal(decodeImageJob.cancellation.mode, 'sliced');
  assert.equal(decodeImageJob.fallback.mode, 'unavailable');
  const b = bitmap();
  decodeImageJob.release?.(b);
  assert.equal((b as unknown as FakeBitmap).closed, true);
  const loader = jobLoaders[DECODE_IMAGE_JOB_ID];
  assert.ok(loader, 'the worker can load the module');
  assert.equal(typeof (await loader()).run, 'function');
});

test('fetchImageBitmap: fetch, then createImageBitmap with the bitmap options; HTTP errors and aborts reject', async () => {
  const calls: unknown[] = [];
  const io = {
    fetch: (async (url: string) => {
      calls.push(url);
      return url.endsWith('missing.jpg') ? new Response('', { status: 404 }) : new Response(new Blob(['x']));
    }) as unknown as typeof fetch,
    createImageBitmap: (async (_blob: Blob, options: ImageBitmapOptions) => {
      calls.push(options);
      return bitmap();
    }) as unknown as typeof createImageBitmap,
  };
  const out = await fetchImageBitmap('https://game.test/textures/a.jpg', undefined, io);
  assert.equal(out.width, 4);
  assert.deepEqual(calls, ['https://game.test/textures/a.jpg', IMAGE_BITMAP_OPTIONS]);
  await assert.rejects(fetchImageBitmap('https://game.test/missing.jpg', undefined, io), /HTTP 404/);
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(fetchImageBitmap('https://game.test/textures/a.jpg', aborted.signal, io), isAbortError);
});

/** A host that answers every job with the given outcome, recording the requests. */
function scriptedHost(answer: (req: JobRequest<unknown, unknown>) => Promise<JobResult<unknown>>) {
  const requests: JobRequest<unknown, unknown>[] = [];
  const host: DecodeHost = {
    run: <I, O>(req: JobRequest<I, O>) => {
      requests.push(req as unknown as JobRequest<unknown, unknown>);
      return answer(req as unknown as JobRequest<unknown, unknown>) as Promise<JobResult<O>>;
    },
  };
  return { host, requests };
}

test('a decode runs as a foreground job with an absolute URL and the variant\'s decoded bytes reserved', async () => {
  const b = bitmap();
  const { host, requests } = scriptedHost(async () => ({ status: 'done', output: b }));
  const fallbacks: string[] = [];
  const decode = createImageDecoder({
    host: async () => host,
    resolve: url => new URL(url, 'https://game.test/app/').href,
    fallback: async url => { fallbacks.push(url); return bitmap(); },
  });
  assert.equal(await decode('/textures/stone/wall-4096.jpg', new AbortController().signal, { width: 4096, height: 2048 }), b);
  assert.equal(requests.length, 1);
  const req = requests[0]!;
  assert.equal(req.kind, decodeImageJob);
  assert.equal(req.class, 'foreground');
  assert.deepEqual(req.bytes, { input: 0, output: 4096 * 2048 * 4, scratch: 0 });
  assert.deepEqual(req.materialise().input, { url: 'https://game.test/textures/stone/wall-4096.jpg' });
  assert.deepEqual(fallbacks, []);
});

test('exhausted capacity retries reject; unavailable hosts retain bounded fallback and failed files reject', async () => {
  for (const outcome of ['saturated', 'preempted', 'oversized'] as const) {
    const { host } = scriptedHost(async () => ({ status: outcome }));
    const fallbacks: string[] = [];
    const decode = createImageDecoder({ host: async () => host, maxCapacityRetries: 1, capacityRetryDelayMs: 1, resolve: u => u, fallback: async url => { fallbacks.push(url); return bitmap(); } });
    await assert.rejects(decode('a.jpg', new AbortController().signal), new RegExp(outcome));
    assert.deepEqual(fallbacks, [], outcome);
  }
  for (const reason of ['unavailable', 'spawn', 'terminated'] as const) {
    const { host } = scriptedHost(async () => { throw new WorkerJobError(reason, DECODE_IMAGE_JOB_ID); });
    const fallbacks: string[] = [];
    const decode = createImageDecoder({ host: async () => host, maxCapacityRetries: 1, capacityRetryDelayMs: 1, resolve: u => u, fallback: async url => { fallbacks.push(url); return bitmap(); } });
    await decode('b.jpg', new AbortController().signal);
    assert.deepEqual(fallbacks, ['b.jpg'], reason);
  }
  const noChunk = createImageDecoder({ host: () => Promise.reject(new Error('chunk failed')), resolve: u => u, fallback: async () => bitmap(9) });
  assert.equal((await noChunk('c.jpg', new AbortController().signal)).width, 9);

  const { host } = scriptedHost(async () => { throw new WorkerJobError('threw', DECODE_IMAGE_JOB_ID, 'HTTP 404'); });
  const fallbacks: string[] = [];
  const decode = createImageDecoder({ host: async () => host, maxCapacityRetries: 1, capacityRetryDelayMs: 1, resolve: u => u, fallback: async url => { fallbacks.push(url); return bitmap(); } });
  await assert.rejects(decode('missing.jpg', new AbortController().signal), /HTTP 404/);
  assert.deepEqual(fallbacks, [], 'a file that failed in the worker is not fetched again');
});

test('an abort rejects with AbortError and closes a bitmap that arrived too late', async () => {
  const late = bitmap();
  let finish!: (r: JobResult<unknown>) => void;
  const { host } = scriptedHost(() => new Promise(resolve => { finish = resolve; }));
  const decode = createImageDecoder({ host: async () => host, resolve: u => u, fallback: async () => assert.fail('no fallback') });
  const owner = new AbortController();
  const pending = decode('a.jpg', owner.signal);
  await settle();
  owner.abort();
  finish({ status: 'done', output: late });
  await assert.rejects(pending, isAbortError);
  assert.equal((late as unknown as FakeBitmap).closed, true);

  const cancelled = scriptedHost(async () => ({ status: 'cancelled' }));
  const decode2 = createImageDecoder({ host: async () => cancelled.host, resolve: u => u, fallback: async () => assert.fail('no fallback') });
  await assert.rejects(decode2('a.jpg', new AbortController().signal), isAbortError);
});

test('through the real host: the bitmap from the worker is delivered, and a cancelled decode is released once', async () => {
  const timers = createFakeTimers();
  const { workers, create } = fakeWorkerFactory();
  const host = createWorkerHost({ hardwareConcurrency: 4, createWorker: create, timers });
  const decode = createImageDecoder({ host: async () => host, resolve: u => u, fallback: async () => assert.fail('no fallback') });

  const b = bitmap();
  const first = decode('https://game.test/a.jpg', new AbortController().signal, { width: 4, height: 2 });
  await settle();
  const run = workers[0]!.lastRun()!;
  assert.equal(run.kind, DECODE_IMAGE_JOB_ID);
  assert.deepEqual(run.input, { url: 'https://game.test/a.jpg' });
  workers[0]!.complete(b);
  assert.equal(await first, b);

  const owner = new AbortController();
  const second = decode('https://game.test/b.jpg', owner.signal);
  await settle();
  owner.abort();
  await assert.rejects(second, isAbortError);
  const orphan = bitmap();
  workers[0]!.complete(orphan);
  assert.equal((orphan as unknown as FakeBitmap).closed, true, 'an undelivered bitmap is closed by the row\'s release');
  host.dispose();
});


test('all capability fallbacks share admission until cancelled work actually settles', async () => {
  let finish!: (b: ImageBitmap) => void;
  const decode = createImageDecoder({ host: async () => { throw Error('unavailable'); },
    maxPendingBytes: 32, unknownImageBytes: 32, maxConcurrent: 1, maxQueued: 0,
    fallback: () => new Promise(resolve => { finish = resolve; }) });
  const owner = new AbortController();
  const first = decode('a', owner.signal); await settle(); owner.abort();
  await assert.rejects(decode('b', new AbortController().signal), /admission/);
  const late = bitmap(); finish(late); await assert.rejects(first, isAbortError);
  assert.equal((late as unknown as FakeBitmap).closed, true);
  const next = decode('c', new AbortController().signal); await settle(); finish(bitmap()); await next;
});

test('invalid hints reject before host acquisition and oversized decoded results are closed', async () => {
  let starts = 0;
  const b = bitmap(8, 8);
  const {host} = scriptedHost(async () => { starts++; return {status: 'done', output: b}; });
  const decode = createImageDecoder({host: async () => host});
  for (const width of [-1, 0, Infinity, NaN, 1.5])
    await assert.rejects(decode('a', new AbortController().signal, {width}), /dimensions/);
  assert.equal(starts, 0);
  await assert.rejects(decode('a', new AbortController().signal, {width: 4, height: 2}), /reservation/);
  assert.equal((b as unknown as FakeBitmap).closed, true);
});


test('partial dimensions reserve the unknown allowance without assuming a square', async () => {
  const { host, requests } = scriptedHost(async () => ({ status: 'done', output: bitmap(512, 1024) }));
  const decode = createImageDecoder({host: async () => host, unknownImageBytes: 4 * 1024 * 1024});
  for (const hint of [{width:512}, {height:1024}, undefined]) {
    const result = await decode('portrait', new AbortController().signal, hint);
    assert.equal(result.height, 1024);
    assert.equal(requests.at(-1)!.bytes.output, 4 * 1024 * 1024);
  }
  await assert.rejects(decode('bad', new AbortController().signal, {height:0}), /dimensions/);
  const tooSmall = createImageDecoder({host: async () => host, unknownImageBytes: 32});
  await assert.rejects(tooSmall('portrait', new AbortController().signal, {width:512}), /reservation/);
});

test('bounded FIFO admission lets a fifth distinct decode complete without exceeding active capacity', async () => {
  const finishes: Array<(value: JobResult<unknown>) => void> = [];
  const {host,requests} = scriptedHost(() => new Promise(resolve => finishes.push(resolve)));
  const decode = createImageDecoder({host: async () => host, maxConcurrent:4, maxQueued:1});
  const pending = Array.from({length:5}, (_,i) => decode(String(i),new AbortController().signal));
  await settle(); assert.equal(requests.length,4);
  await assert.rejects(decode('overflow',new AbortController().signal), /queue exceeded/);
  finishes[0]!({status:'done',output:bitmap()}); await pending[0]; await settle();
  assert.equal(requests.length,5);
  for(const finish of finishes.slice(1)) finish({status:'done',output:bitmap()});
  await Promise.all(pending);
});

test('queued cancellation and admission timeout release descriptors without starting work', async () => {
  let finish!: (value: JobResult<unknown>) => void;
  const {host,requests} = scriptedHost(() => new Promise(resolve => {finish=resolve;}));
  const decode = createImageDecoder({host: async () => host,maxConcurrent:1,maxQueued:1,admissionTimeoutMs:10});
  const first=decode('first',new AbortController().signal); await settle();
  const life=new AbortController();const cancelled=decode('cancelled',life.signal);
  life.abort();await assert.rejects(cancelled,isAbortError);
  await assert.rejects(decode('timeout',new AbortController().signal),/timed out/);
  assert.equal(requests.length,1);
  finish({status:'done',output:bitmap()});await first;
});

test('worker saturation retries are bounded, abortable and never use fallback to evade limits', async () => {
  let calls=0;
  const {host}=scriptedHost(async()=>++calls < 3 ? {status:'saturated'} : {status:'done',output:bitmap()});
  const decode=createImageDecoder({host:async()=>host,maxCapacityRetries:2,capacityRetryDelayMs:1,fallback:async()=>assert.fail('no fallback')});
  await decode('eventually',new AbortController().signal);assert.equal(calls,3);
  const busy=scriptedHost(async()=>({status:'saturated'}));
  const exhausted=createImageDecoder({host:async()=>busy.host,maxCapacityRetries:2,capacityRetryDelayMs:1});
  await assert.rejects(exhausted('bounded',new AbortController().signal),/saturated/);
  assert.equal(busy.requests.length,3);
  const life=new AbortController();
  const cancelling=createImageDecoder({host:async()=>busy.host,capacityRetryDelayMs:50});
  const pending=cancelling('cancel',life.signal);await settle();life.abort();
  await assert.rejects(pending,isAbortError);const count=busy.requests.length;
  await new Promise(resolve=>setTimeout(resolve,60));assert.equal(busy.requests.length,count,'abort removes retry timer');
});


test('byte-limited admission stays FIFO and cancellation unblocks a smaller queued request', async () => {
  const finishes: Array<(value: JobResult<unknown>) => void> = [];
  const {host,requests}=scriptedHost(()=>new Promise(resolve=>finishes.push(resolve)));
  const decode=createImageDecoder({host:async()=>host,maxPendingBytes:16,unknownImageBytes:8,maxConcurrent:4,maxQueued:2});
  const first=decode('first',new AbortController().signal);await settle();
  const life=new AbortController();
  const large=decode('large',life.signal,{width:2,height:2});
  const small=decode('small',new AbortController().signal);
  await settle();assert.equal(requests.length,1,'smaller request does not jump the FIFO head');
  life.abort();await assert.rejects(large,isAbortError);await settle();
  assert.equal(requests.length,2);
  assert.equal((requests[1]!.materialise().input as {url:string}).url,'small');
  await assert.rejects(decode('too-large',new AbortController().signal,{width:3,height:2}),/oversized/);
  for(const finish of finishes)finish({status:'done',output:bitmap(1,2)});
  await Promise.all([first,small]);
});
