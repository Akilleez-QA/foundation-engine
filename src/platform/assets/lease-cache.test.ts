import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AbortError,
  AssetLeases,
  LeaseCache,
  chooseVariant,
  disposeUnowned,
  isAbortError,
  type AssetLoader,
  type LeaseLoader,
} from './lease-cache';
import type { AssetDef, AssetFormat } from './manifest';

/** A fake GPU resource: an object so it has identity, like a THREE.Texture. */
interface Gpu {
  readonly key: string;
  readonly bytes: number;
}

/** A loader whose fetches resolve only when the test says so, recording every upload, discard and dispose. */
function manualLoader(bytes = 64) {
  const pending = new Map<string, { resolve: (v: string) => void; reject: (e: unknown) => void; signal: AbortSignal }[]>();
  const log = { fetched: [] as string[], uploaded: [] as string[], discarded: [] as string[], disposed: [] as string[] };
  const loader: LeaseLoader<string, Gpu> = {
    fetch(key, signal) {
      log.fetched.push(key);
      return new Promise((resolve, reject) => {
        const list = pending.get(key) ?? [];
        list.push({ resolve, reject, signal });
        pending.set(key, list);
      });
    },
    upload(decoded, key) {
      log.uploaded.push(decoded);
      return { key, bytes };
    },
    discard(decoded) {
      log.discarded.push(decoded);
    },
    dispose(resource) {
      log.disposed.push(resource.key);
    },
    bytes: resource => resource.bytes,
  };
  /** Delivers the oldest outstanding fetch for `key`, ignoring its signal like a careless decoder would. */
  const arrive = async (key: string) => {
    const next = pending.get(key)?.shift();
    assert.ok(next, `no pending fetch for ${key}`);
    next.resolve(`${key}:decoded`);
    await settle();
  };
  const fail = async (key: string, error: unknown) => {
    pending.get(key)!.shift()!.reject(error);
    await settle();
  };
  const signalOf = (key: string, i = 0) => pending.get(key)![i].signal;
  return { loader, log, arrive, fail, signalOf };
}

const settle = () => new Promise<void>(r => setTimeout(r, 0));
const live = () => new AbortController();

test('one entry per key: concurrent requesters share one fetch and one upload', async () => {
  const m = manualLoader();
  const cache = new LeaseCache(m.loader, { warmBytes: 1024 });
  const owner = live();
  const a = cache.acquire('wall', owner.signal);
  const b = cache.acquire('wall', owner.signal);
  assert.equal(cache.info('wall')?.state, 'pending');
  await m.arrive('wall');
  const [la, lb] = await Promise.all([a, b]);
  assert.equal(la.value, lb.value);
  assert.deepEqual(m.log.fetched, ['wall']);
  assert.deepEqual(m.log.uploaded, ['wall:decoded']);
  assert.equal(cache.refs('wall'), 2);
  assert.equal(cache.stats.hits, 1);
  la.release();
  la.release(); // idempotent: a double release must not steal b's reference
  assert.equal(cache.refs('wall'), 1);
  lb.release();
  assert.equal(cache.refs('wall'), 0);
  assert.deepEqual(m.log.disposed, [], 'released within budget stays warm');
  const again = cache.acquire('wall', owner.signal);
  assert.equal((await again).value, la.value, 'warm reacquire costs no fetch or upload');
  assert.equal(m.log.fetched.length, 1);
});

test('warm LRU is bounded in bytes: least recently released is disposed first', async () => {
  const m = manualLoader(64);
  const cache = new LeaseCache(m.loader, { warmBytes: 128 });
  const owner = live();
  for (const key of ['a', 'b', 'c']) {
    const p = cache.acquire(key, owner.signal);
    await m.arrive(key);
    (await p).release();
  }
  assert.deepEqual(m.log.disposed, ['a']);
  assert.equal(cache.warmBytes(), 128);
  cache.setWarmBytes(64);
  assert.deepEqual(m.log.disposed, ['a', 'b']);
  cache.evictWarm();
  assert.deepEqual(m.log.disposed, ['a', 'b', 'c']);
  assert.equal(cache.residentBytes(), 0);
});

test('live leases are never evicted, however small the warm budget', async () => {
  const m = manualLoader(1000);
  const cache = new LeaseCache(m.loader, { warmBytes: 0 });
  const p = cache.acquire('big', live().signal);
  await m.arrive('big');
  const lease = await p;
  cache.evictWarm();
  assert.deepEqual(m.log.disposed, []);
  assert.equal(cache.owns(lease.value), true);
  lease.release();
  assert.deepEqual(m.log.disposed, ['big']);
  assert.equal(cache.owns(lease.value), false);
});

test('abort before arrival rejects, aborts the fetch, and a late load after abort never uploads', async () => {
  const m = manualLoader();
  const cache = new LeaseCache(m.loader, { warmBytes: 1024 });
  const owner = live();
  const late = cache.acquire('slow', owner.signal);
  const fetchSignal = m.signalOf('slow');
  owner.abort();
  await assert.rejects(late, AbortError);
  assert.equal(fetchSignal.aborted, true, 'the fetch is told to stop');
  assert.equal(cache.info('slow'), undefined, 'the entry is gone');
  // The decoder ignores the signal and delivers anyway.
  await m.arrive('slow');
  assert.deepEqual(m.log.uploaded, [], 'nothing uploads after its owner is gone');
  assert.deepEqual(m.log.discarded, ['slow:decoded'], 'decoded data is freed');
  assert.equal(cache.stats.lateDrops, 1);
  assert.equal(cache.residentBytes(), 0);
});

test('one requester aborting does not cancel a load another requester still wants', async () => {
  const m = manualLoader();
  const cache = new LeaseCache(m.loader, { warmBytes: 1024 });
  const leaving = live();
  const staying = live();
  const a = cache.acquire('wall', leaving.signal);
  const b = cache.acquire('wall', staying.signal);
  leaving.abort();
  await assert.rejects(a, AbortError);
  assert.equal(m.signalOf('wall').aborted, false);
  await m.arrive('wall');
  const lease = await b;
  assert.deepEqual(m.log.uploaded, ['wall:decoded']);
  assert.equal(cache.refs('wall'), 1);
  lease.release();
});

test('a new requester after a full abort starts a fresh load; the stale arrival is still dropped', async () => {
  const m = manualLoader();
  const cache = new LeaseCache(m.loader, { warmBytes: 1024 });
  const first = live();
  const p1 = cache.acquire('k', first.signal);
  first.abort();
  await assert.rejects(p1, AbortError);
  const second = live();
  const p2 = cache.acquire('k', second.signal);
  await m.arrive('k'); // the first (stale) fetch arrives
  assert.deepEqual(m.log.uploaded, []);
  assert.equal(cache.info('k')?.state, 'pending');
  await m.arrive('k'); // the second fetch arrives
  const lease = await p2;
  assert.deepEqual(m.log.uploaded, ['k:decoded']);
  assert.deepEqual(m.log.discarded, ['k:decoded']);
  lease.release();
});

test('an aborted signal is refused up front, and aborting the owner releases a given lease', async () => {
  const m = manualLoader();
  const cache = new LeaseCache(m.loader, { warmBytes: 0 });
  const dead = live();
  dead.abort();
  await assert.rejects(cache.acquire('x', dead.signal), (e: unknown) => isAbortError(e));
  assert.deepEqual(m.log.fetched, []);
  const owner = live();
  const p = cache.acquire('x', owner.signal);
  await m.arrive('x');
  const lease = await p;
  assert.equal(cache.refs('x'), 1);
  owner.abort();
  assert.equal(cache.refs('x'), 0, 'the owner lifetime releases what it leased');
  assert.deepEqual(m.log.disposed, ['x']);
  lease.release(); // later explicit release is harmless
  assert.equal(cache.stats.disposed, 1);
});

test('a failed fetch rejects every waiter and leaves no entry; the next acquire retries', async () => {
  const m = manualLoader();
  const cache = new LeaseCache(m.loader, { warmBytes: 1024 });
  const owner = live();
  const a = cache.acquire('bad', owner.signal);
  const b = cache.acquire('bad', owner.signal);
  const rejected = Promise.all([assert.rejects(a, /404/), assert.rejects(b, /404/)]);
  await m.fail('bad', new Error('404'));
  await rejected;
  assert.equal(cache.info('bad'), undefined);
  assert.equal(cache.stats.failures, 1);
  const c = cache.acquire('bad', owner.signal);
  await m.arrive('bad');
  (await c).release();
  assert.equal(m.log.fetched.length, 2);
});

test('consumers cannot dispose shared immutables: disposeUnowned skips anything a cache owns', async () => {
  const m = manualLoader();
  const cache = new LeaseCache(m.loader, { warmBytes: 1024 });
  const p = cache.acquire('kit', live().signal);
  await m.arrive('kit');
  const lease = await p;
  const disposed: unknown[] = [];
  assert.equal(disposeUnowned([cache], lease.value, v => disposed.push(v)), false);
  const mine = { key: 'private', bytes: 1 };
  assert.equal(disposeUnowned([cache], mine, v => disposed.push(v)), true);
  assert.deepEqual(disposed, [mine]);
  assert.deepEqual(m.log.disposed, []);
  lease.release();
});

// ───────────────────────────── variants ─────────────────────────────

const wall: AssetDef = {
  id: 'asset.texture.stone-wall',
  kind: 'texture',
  title: 'Stone wall',
  licence: 'CC-BY-4.0',
  provenance: { credit: 'Example Studio', source: { url: 'https://example.com/stone-wall' } },
  colorSpace: 'srgb',
  variants: [
    { path: 'textures/stone/wall-512.webp', format: 'webp', width: 512 },
    { path: 'textures/stone/wall-2048.jpg', format: 'jpg', width: 2048 },
    { path: 'textures/stone/wall-2048.ktx2', format: 'ktx2', width: 2048 },
    { path: 'textures/stone/wall-4096.jpg', format: 'jpg', width: 4096 },
    { path: 'textures/stone/wall-1024.ktx2', format: 'ktx2', width: 1024, maxTier: 'low' },
  ],
};
const noKtx = (f: AssetFormat) => f !== 'ktx2';
const allFormats = () => true;

test('variant choice: smallest at least 2 texels per on-screen pixel; 4K reference keeps full detail', () => {
  const pick = (screenPx: number, extra: object = {}) =>
    chooseVariant(wall, { screenPx, tier: 'reference', supports: noKtx, ...extra }).path;
  assert.equal(pick(33), 'textures/stone/wall-512.webp', 'a 33 px object does not get a 4096 map');
  assert.equal(pick(256), 'textures/stone/wall-512.webp');
  assert.equal(pick(257), 'textures/stone/wall-2048.jpg');
  assert.equal(pick(1500), 'textures/stone/wall-4096.jpg');
  assert.equal(pick(3000), 'textures/stone/wall-4096.jpg', 'too large for every variant: the largest');
  assert.equal(pick(600, { pixelRatio: 2 }), 'textures/stone/wall-4096.jpg');
  assert.equal(pick(600, { supports: allFormats }), 'textures/stone/wall-2048.ktx2', 'KTX2 preferred at equal width');
  assert.equal(pick(1500, { maxWidth: 2048 }), 'textures/stone/wall-2048.jpg', 'the knob caps width');
  assert.equal(pick(300, { maxWidth: 256 }), 'textures/stone/wall-512.webp', 'a cap below every variant keeps the smallest');
});

test('variant choice: a maxTier port variant is used only on that tier or worse', () => {
  const q = { screenPx: 400, supports: allFormats };
  assert.equal(chooseVariant(wall, { ...q, tier: 'high' }).path, 'textures/stone/wall-2048.ktx2');
  assert.equal(chooseVariant(wall, { ...q, tier: 'low' }).path, 'textures/stone/wall-1024.ktx2');
  assert.throws(() => chooseVariant({ ...wall, variants: [wall.variants[4]] }, { ...q, tier: 'reference' }), /no variant/);
});

function assetLoader() {
  const pending: { path: string; resolve: (v: string) => void }[] = [];
  const log = { uploaded: [] as string[], discarded: [] as string[], disposed: [] as string[] };
  const loader: AssetLoader<string, Gpu> = {
    fetch: (_def, variant) => new Promise(resolve => pending.push({ path: variant.path, resolve })),
    upload: (decoded, _def, variant) => (log.uploaded.push(decoded), { key: variant.path, bytes: variant.width ?? 1 }),
    discard: d => log.discarded.push(d),
    dispose: r => log.disposed.push(r.key),
    bytes: r => r.bytes,
    supports: noKtx,
  };
  const arriveAll = async () => {
    while (pending.length) {
      const p = pending.shift()!;
      p.resolve(p.path);
    }
    await settle();
  };
  return { loader, log, pending, arriveAll };
}

test('asset leases: fourteen users of any size share resident uploads; a smaller need reuses a larger map', async () => {
  const f = assetLoader();
  const assets = new AssetLeases([wall], f.loader, { tier: 'reference', warmBytes: 1 << 20 });
  const owner = live();
  const big = assets.acquire(wall.id, { signal: owner.signal, screenPx: 1500 });
  await f.arriveAll();
  const held = await big;
  assert.equal(held.variant.path, 'textures/stone/wall-4096.jpg');
  const users = Array.from({ length: 14 }, (_, i) =>
    assets.acquire(wall.id, { signal: owner.signal, screenPx: i % 2 ? 33 : 900 }),
  );
  await f.arriveAll();
  const leases = await Promise.all(users);
  assert.ok(leases.every(l => l.value === held.value), 'every user shares the one resident 4096 map');
  assert.deepEqual(f.log.uploaded, ['textures/stone/wall-4096.jpg'], 'the map is uploaded once');
  assert.equal(assets.refs(wall.id, 'textures/stone/wall-4096.jpg'), 15);
  for (const l of leases) l.release();
  held.release();
  assert.equal(assets.owns(held.value), true, 'warm');
});

test('asset leases: with nothing resident a small disc loads the small variant; a tier change never downgrades a live lease', async () => {
  const f = assetLoader();
  const assets = new AssetLeases([wall], f.loader, { tier: 'reference', warmBytes: 0 });
  const owner = live();
  const p = assets.acquire(wall.id, { signal: owner.signal, screenPx: 1500 });
  await f.arriveAll();
  const lease = await p;
  assets.setTier('medium', { warmBytes: 0, maxWidth: 2048 });
  assert.equal(assets.choose(wall.id, { screenPx: 1500 }).path, 'textures/stone/wall-2048.jpg');
  assert.equal(lease.variant.path, 'textures/stone/wall-4096.jpg');
  assert.deepEqual(f.log.disposed, [], 'the live 4096 lease is untouched');
  lease.release();
  assert.deepEqual(f.log.disposed, ['textures/stone/wall-4096.jpg']);
  const small = assets.acquire(wall.id, { signal: owner.signal, screenPx: 33 });
  await f.arriveAll();
  assert.equal((await small).variant.path, 'textures/stone/wall-512.webp');
});

test('asset leases: abort during load never uploads, and unknown ids fail loudly', async () => {
  const f = assetLoader();
  const assets = new AssetLeases([wall], f.loader, { tier: 'reference', warmBytes: 1 << 20 });
  const owner = live();
  const p = assets.acquire(wall.id, { signal: owner.signal, screenPx: 100 });
  owner.abort();
  await assert.rejects(p, AbortError);
  await f.arriveAll();
  assert.deepEqual(f.log.uploaded, []);
  assert.deepEqual(f.log.discarded, ['textures/stone/wall-512.webp']);
  assert.equal(assets.stats.lateDrops, 1);
  await assert.rejects(assets.acquire('asset.texture.nope', { signal: live().signal }), /unknown asset id/);
  assert.throws(() => new AssetLeases([wall, wall], f.loader, { tier: 'reference', warmBytes: 0 }), /duplicate/);
});

test('zero-byte released resources are evicted at zero budget and by explicit eviction', async () => {
  for(const warmBytes of [0,64]){
    const {loader,log,arrive}=manualLoader(0),cache=new LeaseCache(loader,{warmBytes});
    const pending=cache.acquire('zero',new AbortController().signal);await arrive('zero');
    const lease=await pending;lease.release();
    if(warmBytes)assert.deepEqual(log.disposed,[]);
    cache.evictWarm();assert.deepEqual(log.disposed,['zero']);assert.equal(cache.info('zero'),undefined);
  }
});

test('explicit eviction drains all idle resources despite cleanup failure and restores warm budget', async () => {
  const disposed:string[]=[],loader:LeaseLoader<string,Gpu>={fetch:async key=>key,upload:key=>({key,bytes:1}),bytes:r=>r.bytes,discard(){},dispose:r=>{disposed.push(r.key);if(r.key==='a')throw Error('dispose failed');}};
  const cache=new LeaseCache(loader,{warmBytes:10});
  for(const key of ['a','b'])(await cache.acquire(key,new AbortController().signal)).release();
  assert.throws(()=>cache.evictWarm(),/cleanup failed/);assert.deepEqual(disposed,['a','b']);assert.equal(cache.residentBytes(),0);
  (await cache.acquire('c',new AbortController().signal)).release();assert.equal(cache.warmBytes(),1,'original positive budget restored');cache.evictWarm();
});

test('synchronous fetch failure is removed and same-key acquisition retries immediately', async () => {
  let calls = 0;
  const loader: LeaseLoader<string, Gpu> = { fetch(key) { if (++calls === 1) throw Error('sync failure'); return Promise.resolve(key); },
    upload: key => ({ key, bytes: 1 }), bytes: r => r.bytes, discard() {}, dispose() {} };
  const cache = new LeaseCache(loader, { warmBytes: 0 });
  await assert.rejects(cache.acquire('x', live().signal), /sync failure/);
  assert.equal(cache.info('x'), undefined);
  const lease = await cache.acquire('x', live().signal); assert.equal(calls, 2); lease.release();
});

test('initial fetch sees a subscribed pending entry and reentrant acquisition shares its valid promise', async () => {
  let cache!: LeaseCache<string, Gpu>, second: ReturnType<typeof cache.acquire> | undefined, calls = 0;
  const loader: LeaseLoader<string, Gpu> = { fetch(key) { calls++; assert.equal(cache.refs(key), 1); second = cache.acquire(key, live().signal); return Promise.resolve(key); },
    upload: key => ({ key, bytes: 1 }), bytes: r => r.bytes, discard() {}, dispose() {} };
  cache = new LeaseCache(loader, { warmBytes: 0 });
  const first = await cache.acquire('x', live().signal), other = await second!;
  assert.equal(first.value, other.value); assert.equal(calls, 1); assert.equal(cache.refs('x'), 2);
  first.release(); other.release();
});

test('abort inside immediate fetch detaches before abort callbacks reacquire the key', async () => {
  const owner = live(); let cache!: LeaseCache<string, Gpu>, replacement: ReturnType<typeof cache.acquire> | undefined, calls = 0;
  const disposed: string[] = [], discarded: string[] = [];
  const loader: LeaseLoader<string, Gpu> = { fetch(key, signal) {
    if (++calls === 1) { signal.addEventListener('abort', () => { replacement = cache.acquire(key, live().signal); }); owner.abort(); }
    return Promise.resolve(key);
  }, upload: key => ({ key, bytes: 1 }), bytes: r => r.bytes, discard: d => { discarded.push(d); }, dispose: r => { disposed.push(r.key); } };
  cache = new LeaseCache(loader, { warmBytes: 0 });
  await assert.rejects(cache.acquire('x', owner.signal), AbortError);
  const lease = await replacement!; await settle();
  assert.equal(calls, 2); assert.equal(cache.refs('x'), 1); assert.deepEqual(discarded, ['x']);
  assert.deepEqual(disposed, []); lease.release(); assert.deepEqual(disposed, ['x']);
});

for (const stage of ['upload', 'bytes'] as const) test(`abort inside ${stage} retires unpublished resource once and preserves same-key replacement`, async () => {
  const owner = live(); let cache!: LeaseCache<string, Gpu>, replacement: ReturnType<typeof cache.acquire> | undefined, generation = 0;
  const disposed: Gpu[] = []; let bytesCalls = 0;
  const replace = () => { owner.abort(); replacement = cache.acquire('x', live().signal); };
  const loader: LeaseLoader<string, Gpu> = { fetch: async key => key,
    upload(key) { const r = { key: key + ++generation, bytes: 1 }; if (stage === 'upload' && generation === 1) replace(); return r; },
    bytes(r) { bytesCalls++; if (stage === 'bytes' && r.key === 'x1') replace(); return 1; },
    discard() { assert.fail('upload owns decoded data'); }, dispose: r => { disposed.push(r); } };
  cache = new LeaseCache(loader, { warmBytes: 0 });
  await assert.rejects(cache.acquire('x', owner.signal), AbortError);
  const lease = await replacement!; await settle();
  assert.deepEqual(disposed.map(r => r.key), ['x1']); assert.equal(cache.owns(disposed[0]), false);
  assert.equal(cache.refs('x'), 1); assert.equal(lease.value.key, 'x2');
  assert.equal(bytesCalls, stage === 'upload' ? 1 : 2); lease.release();
});

for (const value of ['throw', NaN, Infinity, -1] as const) test(`failed byte accounting (${value}) disposes publication and allows retry`, async () => {
  let bad = true, disposals = 0;
  const loader: LeaseLoader<string, Gpu> = { fetch: async key => key, upload: key => ({ key, bytes: 1 }),
    bytes() { if (!bad) return 1; if (value === 'throw') throw Error('account failed'); return value; },
    discard() { assert.fail('decoded transferred'); }, dispose() { disposals++; } };
  const cache = new LeaseCache(loader, { warmBytes: 0 });
  await assert.rejects(cache.acquire('x', live().signal));
  assert.equal(cache.info('x'), undefined); assert.equal(cache.residentBytes(), 0); assert.equal(disposals, 1);
  bad = false; const lease = await cache.acquire('x', live().signal); lease.release(); assert.equal(disposals, 2);
});

test('upload failure owns decoded cleanup and cannot delete a reentrant replacement', async () => {
  const owner = live(); let cache!: LeaseCache<string, Gpu>, replacement: ReturnType<typeof cache.acquire> | undefined, first = true;
  const loader: LeaseLoader<string, Gpu> = { fetch: async key => key, upload(key) {
    if (first) { first = false; owner.abort(); replacement = cache.acquire(key, live().signal); throw Error('upload failure'); }
    return { key, bytes: 1 };
  }, bytes: r => r.bytes, discard() { assert.fail('upload owns decoded'); }, dispose() {} };
  cache = new LeaseCache(loader, { warmBytes: 0 });
  await assert.rejects(cache.acquire('x', owner.signal), AbortError);
  const lease = await replacement!; assert.equal(cache.refs('x'), 1); lease.release();
});

test('eviction rechecks live references after disposal callbacks and preserves new budget decisions', async () => {
  let cache!: LeaseCache<string, Gpu>, revived: ReturnType<typeof cache.acquire> | undefined;
  const disposed: string[] = [];
  const loader: LeaseLoader<string, Gpu> = { fetch: async key => key, upload: key => ({ key, bytes: 1 }), bytes: r => r.bytes, discard() {},
    dispose(r) { disposed.push(r.key); if (r.key === 'a') { revived = cache.acquire('b', live().signal); cache.setWarmBytes(100); } } };
  cache = new LeaseCache(loader, { warmBytes: 10 });
  const a = await cache.acquire('a', live().signal), b = await cache.acquire('b', live().signal); a.release(); b.release();
  cache.evictWarm(); const held = await revived!;
  assert.deepEqual(disposed, ['a']); assert.equal(cache.refs('b'), 1); assert.equal(cache.owns(held.value), true);
  held.release(); assert.deepEqual(disposed, ['a'], 'explicit new budget survives evictWarm');
  cache.setWarmBytes(0); assert.deepEqual(disposed, ['a', 'b']);
});

test('accounting and retirement failures retain both errors without leaving cache ownership', async () => {
  const accounting = Error('bytes failed'), cleanup = Error('dispose failed'); let resource!: Gpu;
  const cache = new LeaseCache<string, Gpu>({ fetch: async key => key, upload: key => (resource = { key, bytes: 1 }),
    bytes() { throw accounting; }, discard() {}, dispose() { throw cleanup; } }, { warmBytes: 1 });
  await assert.rejects(cache.acquire('x', live().signal), error => {
    assert.ok(error instanceof AggregateError); assert.deepEqual(error.errors, [accounting, cleanup]); return true;
  });
  assert.equal(cache.info('x'), undefined); assert.equal(cache.owns(resource), false); assert.equal(cache.stats.disposed, 1);
});

test('reentrant eviction includes newly released candidates and does not dispose them twice', async () => {
  let cache!: LeaseCache<string, Gpu>, a!: Awaited<ReturnType<typeof cache.acquire>>;
  const disposed: string[] = [];
  const loader: LeaseLoader<string, Gpu> = { fetch: async key => key, upload: key => ({ key, bytes: 1 }), bytes: r => r.bytes, discard() {},
    dispose(r) { disposed.push(r.key); if (r.key === 'b') { a.release(); cache.evictWarm(); } } };
  cache = new LeaseCache(loader, { warmBytes: 10 });
  a = await cache.acquire('a', live().signal); const b = await cache.acquire('b', live().signal);
  b.release(); cache.setWarmBytes(.5);
  assert.deepEqual(disposed, ['b', 'a']); assert.equal(cache.residentBytes(), 0);
});

test('publication does not run unrelated eviction callbacks or reject an otherwise valid lease', async () => {
  let fail = true;
  const cache = new LeaseCache<string, Gpu>({ fetch: async key => key, upload: key => ({ key, bytes: 1 }), bytes: r => r.bytes,
    discard() {}, dispose(r) { if (fail && r.key === 'old') throw Error('old disposal'); } }, { warmBytes: 1 });
  const old = await cache.acquire('old', live().signal); old.release();
  const fresh = await cache.acquire('fresh', live().signal);
  assert.equal(cache.refs('fresh'), 1); assert.equal(cache.owns(fresh.value), true);
  assert.throws(() => fresh.release(), /cleanup failed/);
  assert.equal(cache.refs('fresh'), 0); fail = false; cache.evictWarm(); assert.equal(cache.residentBytes(), 0);
});

test('abort before warm lease delivery settles with cancellation even when eviction cleanup fails', async () => {
  const failure = Error('dispose failed'); let disposals = 0;
  const cache = new LeaseCache<string, Gpu>({ fetch: async key => key, upload: key => ({ key, bytes: 1 }), bytes: r => r.bytes,
    discard() {}, dispose() { disposals++; throw failure; } }, { warmBytes: 1 });
  const first = await cache.acquire('x', live().signal); first.release();
  const owner = live(), pending = cache.acquire('x', owner.signal);
  cache.setWarmBytes(0); // The resource is currently live; eviction happens on cancellation.
  owner.abort();
  await assert.rejects(pending, error => {
    assert.ok(isAbortError(error)); assert.ok(error instanceof Error);
    assert.ok(error.cause instanceof AggregateError); assert.deepEqual(error.cause.errors, [failure]); return true;
  });
  assert.equal(disposals, 1); assert.equal(cache.info('x'), undefined); assert.equal(cache.owns(first.value), false);
  assert.equal(cache.warmBytes(), 0); assert.equal(cache.residentBytes(), 0);
});
