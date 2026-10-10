/**
 * Composition with the existing persistence owners:
 * - the save store's own Web Storage port, shared with a live `SaveStore` of the same namespace (reset and usage);
 * - the chunk port over the IndexedDB-shaped test double (`fake-idb`), one transaction per key, with its quota fault
 *   injected at every put. The double is not a browser: real IndexedDB and real Web Storage are not exercised here.
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {openIndexedDbChunkPort, type ChunkPort} from '../../core/save/chunk-port';
import {createFakeIdb} from '../../core/save/fake-idb';
import type {SaveSection} from '../../core/save/section';
import {MemoryBackend} from '../../core/save/storage-port';
import {createSaveStore} from '../../core/save/store';
import {createSaveGenerations, type GenerationPort} from './index';

const settings: SaveSection<{volume: number}> = {
  id: 'device.settings-sample',
  scope: 'device',
  version: 1,
  initial: () => ({volume: 1}),
  parse: raw => raw as {volume: number},
};

test('runs on the save store port beside a live SaveStore: counted in usage, cleared by resetAll, sections untouched', async () => {
  const backend = new MemoryBackend(),
    local = backend.port(0, 'local'),
    session = new MemoryBackend().port(0, 'session');
  const store = createSaveStore({local, session, build: 'sample@1.0.0', sections: [settings]});
  store.section(settings).update(d => {
    d.volume = 0.5;
  });
  store.flush();
  const gens = createSaveGenerations({port: local, name: 'world'});
  await gens.load();
  assert.equal((await gens.commit({terrain: 't1', actors: 'a1'})).status, 'committed');
  assert.equal((await gens.commit({terrain: 't2', actors: 'a2'})).status, 'committed');
  // generation keys sit under the store's reset prefixes, so the store counts them and reset removes them
  assert.ok([...backend.data.keys()].filter(k => k.startsWith('game-gen|world|')).length >= 6);
  assert.ok(store.usage().chars > JSON.stringify(['t2', 'a2']).length);
  assert.equal(store.quarantine().length, 0);
  assert.equal(store.section(settings).get().volume, 0.5);
  const reset = store.resetAll();
  assert.deepEqual(reset.failed, []);
  assert.equal([...backend.data.keys()].filter(k => k.startsWith('game-gen|')).length, 0);
  gens.close();
  assert.equal((await createSaveGenerations({port: local, name: 'world'}).load()).status, 'empty');
});

/** Each operation is its own chunk-port transaction, so a multi-key commit is many independent commits. */
function chunkGenerationPort(port: ChunkPort): GenerationPort {
  return {
    get: key => port.update([key], current => ({result: (current.get(key)?.record as {text?: string})?.text ?? null})),
    set: key => {
      throw new Error(`unused ${key}`);
    },
    remove: key => port.update([key], () => ({result: undefined, plan: {remove: [key]}})),
    keys: async () => (await port.listMeta()).map(([k]) => k),
  };
}
const withSet = (port: ChunkPort): GenerationPort => ({
  ...chunkGenerationPort(port),
  set: (key, value) =>
    port.update([key], () => ({
      result: undefined,
      plan: {put: [{key, meta: {chars: value.length}, record: {text: value}}]},
    })),
});

const gen = (n: number) => ({alpha: `a${n}`, beta: `b${n}`.repeat(n), gamma: `g${n}`});

test('runs over the IndexedDB-shaped double through the chunk port; a quota fault at every put keeps a whole generation', async () => {
  // a clean commit to learn the number of puts (keys plus the record)
  const puts = Object.keys(gen(2)).length + 1;
  for (let failAt = 0; failAt <= puts; failAt++) {
    const fake = createFakeIdb();
    const port = await openIndexedDbChunkPort('generations', fake.factory);
    const owner = createSaveGenerations({port: withSet(port), name: 'world'});
    assert.equal((await owner.load()).status, 'empty');
    assert.equal((await owner.commit(gen(1))).status, 'committed');
    let seen = 0;
    fake.controls.quotaOnPut = store => store === 'records' && seen++ === failAt;
    const attempt = await owner.commit(gen(2));
    fake.controls.quotaOnPut = () => false;
    assert.equal(attempt.status, failAt < puts ? 'failed' : 'committed', `fail at put ${failAt}`);
    if (failAt < puts) assert.match(attempt.reason!, /quota/);
    port.close(); // the tab goes away
    const reopened = await openIndexedDbChunkPort('generations', fake.factory);
    const reader = createSaveGenerations({port: chunkGenerationPort(reopened), name: 'world'});
    const loaded = await reader.load();
    assert.deepEqual(loaded.snapshot!.entries, failAt < puts ? gen(1) : gen(2), `fail at put ${failAt}`);
    assert.equal(fake.controls.maxConcurrent, 1);
    reopened.close();
  }
});

test('over the IndexedDB-shaped double: a connection lost mid-commit and corrupted stored bytes both fall back', async () => {
  const fake = createFakeIdb();
  let port = await openIndexedDbChunkPort('generations', fake.factory);
  const owner = createSaveGenerations({port: withSet(port), name: 'world'});
  await owner.load();
  await owner.commit(gen(1));
  await owner.commit(gen(2));
  let n = 0;
  fake.controls.quotaOnPut = () => {
    if (++n === 2) fake.controls.versionChange(); // another tab upgrades: this connection closes mid-commit
    return false;
  };
  const lost = await owner.commit(gen(3));
  fake.controls.quotaOnPut = () => false;
  assert.equal(lost.status, 'failed');
  owner.close();
  port = await openIndexedDbChunkPort('generations', fake.factory);
  const writer = createSaveGenerations({port: withSet(port), name: 'world'});
  let loaded = await writer.load();
  assert.equal(loaded.status, 'recovered'); // slot a was torn by the lost commit
  assert.deepEqual(loaded.snapshot!.entries, gen(2));
  assert.equal((await writer.commit(gen(3))).snapshot!.slot, 'a');
  writer.close();
  port.close();

  // flip one character of a committed value inside the double's stored rows
  const damage = (key: string) => {
    const records = fake.controls.databases.get('fe-chunks:generations')!.get('records')!; // replaced on each commit
    const row = records.get(key) as {text: string};
    records.set(key, {text: row.text.slice(0, -1) + 'X'});
  };
  damage('game-gen|world|a|beta');
  port = await openIndexedDbChunkPort('generations', fake.factory);
  loaded = await createSaveGenerations({port: chunkGenerationPort(port), name: 'world'}).load();
  assert.equal(loaded.status, 'recovered');
  assert.deepEqual(loaded.snapshot!.entries, gen(2));
  port.close();
  // with the older copy damaged too, nothing valid remains: an explicit corrupt status, never an empty save
  damage('game-gen|world|b|gamma');
  port = await openIndexedDbChunkPort('generations', fake.factory);
  loaded = await createSaveGenerations({port: chunkGenerationPort(port), name: 'world'}).load();
  assert.equal(loaded.status, 'corrupt');
  assert.equal(loaded.snapshot, null);
  port.close();
});
