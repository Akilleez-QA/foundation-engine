import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeIdb } from './fake-idb';
import { MemoryChunkDatabase, memoryChunkPort, openIndexedDbChunkPort } from './chunk-port';
import { createChunkStore, crc32, openChunkStore, ChunkStoreError, type ChunkStore } from './chunk-store';

const bytes = (...v: number[]) => new Uint8Array(v);
const fill = (n: number, v = 1) => new Uint8Array(n).fill(v);
async function idbStore(name = 'world', options: Parameters<typeof createChunkStore>[1] = { schema: 1 }) {
  const fake = createFakeIdb();
  const open = (o = options) => openChunkStore({ ...o, name, factory: fake.factory });
  return { fake, store: await open(), open };
}
const record = (fake: ReturnType<typeof createFakeIdb>, key: string) => fake.controls.databases.get('world')!.get('records')!.get(key) as { data: Uint8Array; key: string; crc: number };

test('GEN-02 crc32 matches the IEEE reference vector', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
});

test('GEN-02 IndexedDB records round-trip, persist across reopen and are returned as copies', async () => {
  const { fake, store, open } = await idbStore();
  assert.equal(store.stats().durability, 'durable');
  const data = bytes(1, 2, 3);
  assert.deepEqual(await store.write([{ key: 'r:0,0', revision: 1, data }]), { status: 'saved', evicted: [] });
  data[0] = 99; // the store copied at call time
  const read = await store.read('r:0,0');
  assert.equal(read.status, 'found');
  if (read.status === 'found') { assert.deepEqual([...read.data], [1, 2, 3]); assert.equal(read.revision, 1); assert.equal(read.schema, 1); read.data[0] = 7; }
  assert.deepEqual(await store.read('r:9,9'), { status: 'missing' });
  store.close();
  const again = await open();
  assert.deepEqual(again.stats().records, 1); assert.equal(again.stats().bytes, 3);
  const reread = await again.read('r:0,0');
  assert.ok(reread.status === 'found' && reread.data[0] === 1, 'returned data was a copy');
  assert.ok(fake.controls.commits >= 1);
  again.close();
});

test('GEN-02 a multi-record write is atomic: a quota failure on any record commits nothing', async () => {
  const { fake, store } = await idbStore();
  await store.write([{ key: 'a', revision: 1, data: bytes(1) }]);
  fake.controls.quotaOnPut = (s, k) => s === 'records' && k === 'b';
  assert.deepEqual(await store.write([{ key: 'a', revision: 2, data: bytes(2, 2) }, { key: 'b', revision: 1, data: bytes(3) }]), { status: 'quota' });
  const a = await store.read('a');
  assert.ok(a.status === 'found' && a.revision === 1 && a.data.length === 1, 'the first record was not half-written');
  assert.deepEqual(await store.read('b'), { status: 'missing' });
  assert.equal(store.stats().records, 1); assert.equal(store.stats().bytes, 1);
  fake.controls.quotaOnPut = () => false;
  assert.equal((await store.write([{ key: 'a', revision: 2, data: bytes(2, 2) }, { key: 'b', revision: 1, data: bytes(3) }])).status, 'saved');
  assert.equal(store.stats().bytes, 3);
  store.close();
});

test('GEN-02 revisions are compared inside the transaction, so a second tab cannot overwrite newer data', async () => {
  const fake = createFakeIdb();
  const tabA = await openChunkStore({ name: 'world', schema: 1, factory: fake.factory });
  const tabB = await openChunkStore({ name: 'world', schema: 1, factory: fake.factory });
  assert.equal((await tabA.write([{ key: 'k', revision: 1, data: bytes(1) }])).status, 'saved');
  assert.equal((await tabB.write([{ key: 'k', revision: 2, data: bytes(2) }])).status, 'saved');
  assert.deepEqual(await tabA.write([{ key: 'k', revision: 2, data: bytes(3) }]), { status: 'stale', key: 'k' });
  assert.deepEqual(await tabA.write([{ key: 'k', revision: 1, data: bytes(3) }]), { status: 'stale', key: 'k' });
  const r = await tabA.read('k'); assert.ok(r.status === 'found' && r.data[0] === 2);
  // a stale record in a batch refuses the whole batch
  assert.deepEqual(await tabA.write([{ key: 'new', revision: 1, data: bytes(1) }, { key: 'k', revision: 2, data: bytes(9) }]), { status: 'stale', key: 'k' });
  assert.deepEqual(await tabA.read('new'), { status: 'missing' });
  tabA.close(); tabB.close();
});

test('GEN-02 unreadable records are quarantined; their bytes are copied aside before any overwrite', async () => {
  const corruptions: [string, (fake: ReturnType<typeof createFakeIdb>) => void][] = [
    ['checksum', f => { record(f, 'k').data[1] ^= 0xff; }],
    ['length', f => { const r = record(f, 'k'); r.data = r.data.subarray(0, 2).slice(); }],
    ['record envelope', f => { record(f, 'k').key = 'other'; }],
    ['record envelope', f => { f.controls.databases.get('world')!.get('records')!.delete('k'); }],
    ['meta envelope', f => { f.controls.databases.get('world')!.get('meta')!.set('k', 'garbage'); }],
    ['length', f => { (record(f, 'k') as { data: unknown }).data = [1, 2, 3]; }],
  ];
  for (const [why, corrupt] of corruptions) {
    const { fake, store, open } = await idbStore('world', { schema: 1, limits: { maxQuarantine: 1 } });
    await store.write([{ key: 'k', revision: 1, data: bytes(1, 2, 3) }]);
    corrupt(fake);
    assert.deepEqual(await store.read('k'), { status: 'quarantined' }, why);
    assert.deepEqual(await store.write([{ key: 'k', revision: 1, data: bytes(4) }]), { status: 'saved', evicted: [] }, `${why}: a write may replace it once the copy is kept`);
    const rows = await store.quarantine();
    assert.ok(Array.isArray(rows) && rows.length === 1 && rows[0]!.key === 'k' && rows[0]!.reason === why, why);
    assert.equal(store.stats().quarantined, 1);
    // quarantine full: the next unreadable record is left untouched and writes over it are refused
    await store.write([{ key: 'k2', revision: 1, data: bytes(5) }]);
    record(fake, 'k2').data[0] ^= 1;
    const before = structuredClone(record(fake, 'k2'));
    assert.deepEqual(await store.write([{ key: 'k2', revision: 5, data: bytes(6) }]), { status: 'quarantine-full', key: 'k2' });
    assert.deepEqual(await store.remove('k2'), { status: 'quarantine-full' });
    assert.deepEqual(record(fake, 'k2'), before, 'unread bytes are never destroyed');
    assert.deepEqual(await store.clearQuarantine(), { status: 'cleared' });
    assert.deepEqual(await store.remove('k2'), { status: 'removed' });
    assert.equal(store.stats().quarantined, 1, 'the removed unreadable record was copied aside');
    store.close();
    const reopened = await open(); assert.equal(reopened.stats().quarantined, 1); reopened.close();
  }
});

test('GEN-02 creator schema: older records are returned for migration, newer ones are read-only', async () => {
  const db = new MemoryChunkDatabase();
  const v1 = await createChunkStore(memoryChunkPort(db), { schema: 1 });
  await v1.write([{ key: 'k', revision: 1, data: bytes(1) }]);
  const v2 = await createChunkStore(memoryChunkPort(db), { schema: 2 });
  const old = await v2.read('k'); assert.ok(old.status === 'found' && old.schema === 1);
  assert.equal((await v2.write([{ key: 'k', revision: 2, data: bytes(2) }])).status, 'saved');
  assert.deepEqual(await v1.read('k'), { status: 'newer', schema: 2, revision: 2 });
  assert.deepEqual(await v1.write([{ key: 'k', revision: 3, data: bytes(3) }]), { status: 'newer', key: 'k' });
  const kept = await v2.read('k'); assert.ok(kept.status === 'found' && kept.revision === 2);
});

test('GEN-02 limits refuse before storage work; without an evictable policy nothing is discarded', async () => {
  const db = new MemoryChunkDatabase();
  const store = await createChunkStore(memoryChunkPort(db), { schema: 0, limits: { maxKeyLength: 8, maxRecordBytes: 16, maxRecords: 3, maxTotalBytes: 40, maxBatch: 2 } });
  for (const bad of [
    () => store.write([{ key: 'x'.repeat(9), revision: 1, data: bytes(1) }]), () => store.write([{ key: '', revision: 1, data: bytes(1) }]),
    () => store.write([{ key: 'a', revision: 1, data: fill(17) }]), () => store.write([{ key: 'a', revision: -1, data: bytes(1) }]),
    () => store.write([{ key: 'a', revision: 1.5, data: bytes(1) }]), () => store.write([{ key: 'a', revision: 1, data: [1] as never }]),
    () => store.write([]), () => store.write([{ key: 'a', revision: 1, data: bytes(1) }, { key: 'a', revision: 2, data: bytes(1) }]),
    () => store.write([1, 2, 3].map(i => ({ key: `k${i}`, revision: 1, data: bytes(1) }))), () => store.read(5 as never),
  ]) await assert.rejects(bad(), ChunkStoreError);
  assert.equal(db.commits, 0, 'no storage work for refused input');
  for (const k of ['a', 'b']) await store.write([{ key: k, revision: 1, data: fill(16) }]);
  assert.deepEqual(await store.write([{ key: 'c', revision: 1, data: fill(16) }]), { status: 'full' }, 'total bytes');
  await store.write([{ key: 'c', revision: 1, data: fill(4) }]);
  assert.deepEqual(await store.write([{ key: 'd', revision: 1, data: fill(1) }]), { status: 'full' }, 'record count');
  assert.equal((await store.write([{ key: 'a', revision: 2, data: fill(8) }])).status, 'saved', 'replacing a record frees its old bytes');
  assert.deepEqual(store.stats().records, 3); assert.equal(store.stats().bytes, 28);
  await assert.rejects(createChunkStore(memoryChunkPort(), { schema: -1 }), ChunkStoreError);
  await assert.rejects(createChunkStore(memoryChunkPort(), { schema: 1, limits: { maxPending: 0 } }), ChunkStoreError);
});

test('GEN-02 eviction releases only creator-marked records, least recently used first', async () => {
  const store = await createChunkStore(memoryChunkPort(), { schema: 1, limits: { maxRecords: 3 }, evictable: k => k.startsWith('cache:') });
  await store.write([{ key: 'cache:1', revision: 1, data: bytes(1) }]);
  await store.write([{ key: 'cache:2', revision: 1, data: bytes(1) }]);
  await store.write([{ key: 'edit:1', revision: 1, data: bytes(1) }]);
  await store.read('cache:1'); // now cache:2 is least recently used
  assert.deepEqual(await store.write([{ key: 'edit:2', revision: 1, data: bytes(1) }]), { status: 'saved', evicted: ['cache:2'] });
  assert.deepEqual(await store.read('cache:2'), { status: 'missing' });
  assert.deepEqual(await store.write([{ key: 'edit:3', revision: 1, data: bytes(1) }]), { status: 'saved', evicted: ['cache:1'] });
  assert.deepEqual(await store.write([{ key: 'edit:4', revision: 1, data: bytes(1) }]), { status: 'full' }, 'edits are never evicted');
  for (const k of ['edit:1', 'edit:2', 'edit:3']) assert.equal((await store.read(k)).status, 'found');
});

test('GEN-02 pending operations are bounded and close resolves queued work as closed', async () => {
  const store: ChunkStore = await createChunkStore(memoryChunkPort(), { schema: 1, limits: { maxPending: 2 } });
  const first = store.write([{ key: 'a', revision: 1, data: bytes(1) }]), second = store.read('a');
  assert.deepEqual(await store.read('a'), { status: 'busy' });
  assert.equal(store.stats().pending, 2);
  assert.equal((await first).status, 'saved'); assert.equal((await second).status, 'found');
  assert.equal(store.stats().pending, 0);
  // a port whose transaction waits for a gate, so "already in a transaction" is observable
  const inner = memoryChunkPort(); let entered!: () => void, release!: () => void;
  const inside = new Promise<void>(r => { entered = r; }), gate = new Promise<void>(r => { release = r; });
  const gated: typeof inner = { ...inner, async update(keys, decide) { entered(); await gate; return inner.update(keys, decide); } };
  const slow = await createChunkStore(gated, { schema: 1 });
  const running = slow.write([{ key: 'b', revision: 1, data: bytes(1) }]), queued = slow.read('b');
  await inside;
  slow.close(); slow.close(); store.close();
  release();
  assert.equal((await running).status, 'saved', 'work already started completes');
  assert.deepEqual(await queued, { status: 'closed' });
  assert.deepEqual(await store.read('a'), { status: 'closed' });
  assert.equal(slow.stats().pending, 0); assert.equal(store.stats().pending, 0);
});

test('GEN-02 unavailable IndexedDB falls back to a session store; a version change makes the durable one unavailable', async () => {
  for (const factory of [undefined, null]) {
    const store = await openChunkStore({ name: 'w', schema: 1, factory: factory as never });
    if (factory === undefined && (globalThis as { indexedDB?: unknown }).indexedDB) continue;
    assert.equal(store.stats().durability, 'session');
    assert.equal((await store.write([{ key: 'a', revision: 1, data: bytes(1) }])).status, 'saved');
  }
  const fake = createFakeIdb(); fake.controls.failOpen = true;
  const fallback = await openChunkStore({ name: 'w', schema: 1, factory: fake.factory });
  assert.equal(fallback.stats().durability, 'session');
  await assert.rejects(openIndexedDbChunkPort('w', undefined), /unavailable/);
  const { fake: f2, store } = await idbStore();
  await store.write([{ key: 'a', revision: 1, data: bytes(1) }]);
  f2.controls.versionChange();
  assert.deepEqual(await store.read('a'), { status: 'unavailable' });
  assert.deepEqual(await store.write([{ key: 'a', revision: 2, data: bytes(2) }]), { status: 'unavailable' });
  await assert.rejects(openChunkStore({ name: '', schema: 1, factory: null }), ChunkStoreError);
});
