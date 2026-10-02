import test from 'node:test';
import assert from 'node:assert/strict';
import { createSoundFiles, estimateDecodedBytes, soundBudgets } from './sound-files';

const flush = () => new Promise(resolve => setImmediate(resolve));
const decoder = () => {
  const calls: number[] = [];
  return { calls, ctx: { decodeAudioData: async (bytes: ArrayBuffer) => { calls.push(bytes.byteLength); return { length: bytes.byteLength, numberOfChannels: 1, sampleRate: 48000 } as AudioBuffer; } } as unknown as BaseAudioContext };
};

test('a file is fetched once, kept encoded, and decoded on demand from a copy', async () => {
  const fetches: string[] = [], reports: string[] = [];
  let kept: ArrayBuffer | undefined;
  const files = createSoundFiles({ report: m => reports.push(m), fetchBytes: async url => { fetches.push(url); return kept = new ArrayBuffer(100); } });
  assert.equal(await files.fetch('chime', '/s/chime.wav'), true);
  assert.equal(await files.fetch('chime', '/s/chime.wav'), true);
  assert.deepEqual(fetches, ['/s/chime.wav']); assert.equal(files.stats.encodedBytes, 100);
  const { ctx, calls } = decoder();
  const [a, b] = await Promise.all([files.decode('chime', '/s/chime.wav', ctx), files.decode('chime', '/s/chime.wav', ctx)]);
  assert.equal(a, b); assert.deepEqual(calls, [100]); assert.equal(kept!.byteLength, 100, 'the kept bytes are not detached');
  assert.equal(files.buffer('chime'), a); assert.equal(files.stats.decodedBytes, 400);
  assert.deepEqual(reports, []); files.dispose();
});

test('a failed file is reported once and not fetched again until retried', async () => {
  let fetches = 0; const reports: string[] = [];
  const files = createSoundFiles({ report: m => reports.push(m), fetchBytes: async () => { fetches++; throw Error('HTTP 404'); } });
  assert.equal(await files.fetch('gone', '/gone.wav'), false);
  await assert.rejects(files.decode('gone', '/gone.wav', decoder().ctx), /failed earlier/);
  assert.equal(fetches, 1); assert.equal(files.failed('gone'), true);
  assert.deepEqual(reports, ["sound 'gone' failed: HTTP 404"]);
  files.retry('gone'); assert.equal(await files.fetch('gone', '/gone.wav'), false); assert.equal(fetches, 2); assert.equal(reports.length, 2);
  files.dispose();
});

test('oversized, empty and undecodable files are refused within their bounds', async () => {
  const reports: string[] = [];
  const sizes: Record<string, number> = { big: 2048, empty: 0, ok: 10 };
  const files = createSoundFiles({ report: m => reports.push(m), maxFileBytes: 1024, maxDecodedBytes: 30, fetchBytes: async (url, _s, limit) => { assert.equal(limit, 1024); return new ArrayBuffer(sizes[url]!); } });
  assert.equal(await files.fetch('a', 'big'), false); assert.equal(await files.fetch('b', 'empty'), false);
  await assert.rejects(files.decode('c', 'ok', decoder().ctx), /decoded budget/);
  assert.equal(reports.length, 3); assert.equal(files.stats.failures, 3); files.dispose();
});

test('concurrent fetches are bounded and queue in order', async () => {
  let active = 0, peak = 0; const release: (() => void)[] = [];
  const files = createSoundFiles({ report() {}, maxLoads: 2, fetchBytes: () => { active++; peak = Math.max(peak, active); return new Promise(r => release.push(() => { active--; r(new ArrayBuffer(4)); })); } });
  const loads = ['a', 'b', 'c', 'd'].map(id => files.fetch(id, id));
  await flush(); assert.equal(release.length, 2);
  while (release.length) { release.shift()!(); await flush(); await flush(); }
  assert.deepEqual(await Promise.all(loads), [true, true, true, true]); assert.equal(peak, 2); files.dispose();
});

test('encoded and decoded bytes stay within their budgets by least recent use', async () => {
  const files = createSoundFiles({ report() {}, maxEncodedBytes: 250, maxDecodedBytes: 900, compressedRatio: 4, fetchBytes: async () => new ArrayBuffer(100) });
  const { ctx } = decoder();
  for (const id of ['a', 'b', 'c']) await files.decode(id, id, ctx);
  assert.equal(files.stats.encodedBytes, 200); assert.equal(files.stats.decodedBytes, 800);
  assert.equal(files.buffer('a'), undefined, 'the oldest decoded buffer was evicted');
  assert.ok(files.buffer('c')); files.dispose();
});

test('a waiter can leave without cancelling the shared fetch; disposal rejects queued work', async () => {
  let finish!: () => void;
  const files = createSoundFiles({ report: () => assert.fail('no report on cancellation'), maxLoads: 1, fetchBytes: () => new Promise(r => { finish = () => r(new ArrayBuffer(8)); }) });
  const leave = new AbortController();
  const first = files.fetch('a', 'a', leave.signal); const queued = files.decode('b', 'b', decoder().ctx);
  leave.abort(); assert.equal(await first, false);
  finish(); await flush();
  assert.equal(await files.fetch('a', 'a'), true, 'the shared fetch completed for later callers');
  files.dispose();
  await assert.rejects(queued);
  await assert.rejects(files.decode('c', 'c', decoder().ctx), /disposed/);
});

test('invalid limits are refused', () => {
  assert.throws(() => createSoundFiles({ report() {}, maxLoads: 0 }));
  assert.throws(() => createSoundFiles({ report() {}, timeoutMs: Infinity }));
});

/** A minimal PCM WAV: `frames` 16-bit frames of `channels` at `rate`. */
const wav = (frames: number, channels = 1, rate = 22050) => {
  const data = frames * channels * 2, b = new ArrayBuffer(44 + data), v = new DataView(b), w = (at: number, t: string) => [...t].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + data, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, channels, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * channels * 2, true); v.setUint16(32, channels * 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, data, true);
  return b;
};

test('decoded size is estimated before decoding: exact for PCM WAV, a bounded ratio otherwise', () => {
  assert.equal(estimateDecodedBytes(wav(22050, 2), 48000), 48000 * 2 * 4, 'one second of stereo at the context rate');
  assert.equal(estimateDecodedBytes(new ArrayBuffer(1000), 48000), 48000);
  assert.equal(estimateDecodedBytes(new ArrayBuffer(1000), 48000, 10), 10000);
});

test('a file whose estimated decoded size cannot fit is refused before decodeAudioData runs', async () => {
  const reports: string[] = [];
  let decoded = 0;
  const ctx = { sampleRate: 48000, decodeAudioData: async () => { decoded++; return { length: 1, numberOfChannels: 1 } as AudioBuffer; } } as unknown as BaseAudioContext;
  const files = createSoundFiles({ report: m => reports.push(m), maxDecodedBytes: 1024 * 1024, fetchBytes: async () => new ArrayBuffer(64 * 1024) });
  await assert.rejects(files.decode('big', 'big', ctx), /estimated decoded size 3 MiB does not fit/);
  assert.equal(decoded, 0); assert.equal(files.stats.reservedBytes, 0); assert.equal(reports.length, 1);
  files.dispose();
});

test('decodes in flight are bounded and reserve their estimate', async () => {
  let active = 0, peak = 0; const finish: (() => void)[] = [];
  const ctx = { sampleRate: 48000, decodeAudioData: (b: ArrayBuffer) => { active++; peak = Math.max(peak, active); return new Promise<AudioBuffer>(r => finish.push(() => { active--; r({ length: b.byteLength, numberOfChannels: 1 } as AudioBuffer); })); } } as unknown as BaseAudioContext;
  const files = createSoundFiles({ report() {}, maxDecodes: 2, compressedRatio: 4, fetchBytes: async () => new ArrayBuffer(10) });
  const all = ['a', 'b', 'c'].map(id => files.decode(id, id, ctx));
  for (let i = 0; i < 5; i++) await flush();
  assert.equal(finish.length, 2); assert.equal(files.stats.reservedBytes, 80);
  while (finish.length || active) { finish.shift()?.(); for (let i = 0; i < 5; i++) await flush(); }
  await Promise.all(all); assert.equal(peak, 2); assert.equal(files.stats.reservedBytes, 0); assert.equal(files.stats.decodedBytes, 120);
  files.dispose();
});

test('the file cap drops idle or least recently used entries, and reports a refusal only when all are in flight', async () => {
  const reports: string[] = []; const pending: (() => void)[] = [];
  const files = createSoundFiles({ report: m => reports.push(m), maxFiles: 2, fetchBytes: async url => { if (url.startsWith('slow')) await new Promise<void>(r => pending.push(r)); return new ArrayBuffer(4); } });
  assert.equal(await files.fetch('a', 'a'), true); assert.equal(await files.fetch('b', 'b'), true);
  assert.equal(await files.fetch('c', 'c'), true, 'the least recently used held file was dropped');
  assert.equal(files.stats.files, 2);
  const s1 = files.fetch('s1', 'slow1'), s2 = files.fetch('s2', 'slow2');
  await flush();
  assert.equal(await files.fetch('d', 'd'), false); assert.equal(files.stats.refusals, 1); assert.match(reports.at(-1)!, /refused: too many sound files in flight/);
  for (const r of pending) r(); assert.deepEqual(await Promise.all([s1, s2]), [true, true]);
  files.dispose();
});

test('the default fetch streams with a running cap and refuses HTML fallbacks', async () => {
  const previous = globalThis.fetch;
  const body = (chunks: number[]) => new ReadableStream<Uint8Array>({ start(c) { for (const n of chunks) c.enqueue(new Uint8Array(n)); c.close(); } });
  try {
    globalThis.fetch = (async (url: string) => url === 'html' ? new Response('<html>', { headers: { 'content-type': 'text/html' } }) : new Response(body(url === 'big' ? [600, 600] : [100, 100]))) as typeof fetch;
    const files = createSoundFiles({ report() {}, maxFileBytes: 1000 });
    assert.equal(await files.fetch('ok', 'ok'), true); assert.equal(files.stats.encodedBytes, 200);
    assert.equal(await files.fetch('big', 'big'), false); assert.equal(await files.fetch('html', 'html'), false);
    assert.equal(files.stats.failures, 2); files.dispose();
  } finally { globalThis.fetch = previous; }
});

test('budgets follow the minimum device', () => {
  assert.ok(soundBudgets('phone').maxDecodedBytes < soundBudgets('desktop').maxDecodedBytes);
  assert.deepEqual(soundBudgets(), soundBudgets('laptop'));
});
