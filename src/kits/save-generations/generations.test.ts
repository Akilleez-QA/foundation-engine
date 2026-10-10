import assert from 'node:assert/strict';
import {test} from 'node:test';
import {MemoryBackend} from '../../core/save/storage-port';
import {createSaveGenerations, type GenerationPort} from './index';

const open = (port: GenerationPort, extra: Partial<Parameters<typeof createSaveGenerations>[0]> = {}) =>
  createSaveGenerations({port, name: 'run', ...extra});

test('limits and inputs are validated once, with documented defaults', () => {
  const port = new MemoryBackend().port();
  const g = open(port);
  assert.deepEqual(g.limits, {maxKeys: 16, maxKeyChars: 262_144, maxTotalChars: 1_048_576, maxLoadAttempts: 3});
  assert.equal(g.prefix, 'game-gen|run|');
  assert.ok(Object.isFrozen(g.limits));
  g.close();
  const other = new MemoryBackend().port();
  assert.throws(() => open(other, {name: 'Bad Name'}), RangeError);
  assert.throws(() => open(other, {namespace: 'NO'}), RangeError);
  assert.throws(() => open(other, {maxKeys: 0}), RangeError);
  assert.throws(() => open(other, {maxKeys: 257}), RangeError);
  assert.throws(() => open(other, {maxKeyChars: 2_000_001}), RangeError);
  assert.throws(() => open(other, {maxTotalChars: 1.5}), RangeError);
  assert.throws(() => open(other, {maxLoadAttempts: 9}), RangeError);
  assert.throws(() => createSaveGenerations({port: {} as GenerationPort, name: 'run'}), RangeError);
});

test('one writer per save and port: a second owner is refused until the first closes', () => {
  const backend = new MemoryBackend(),
    port = backend.port();
  const first = open(port);
  assert.throws(() => open(port), /already has a writer/);
  const otherName = open(port, {name: 'other'}); // another save on the same port is fine
  const otherTab = open(backend.port(1)); // another tab has its own port object (see the conflict test)
  first.close();
  first.close();
  open(port).close();
  otherName.close();
  otherTab.close();
});

test('commit before load is refused; first load of nothing is empty', async () => {
  const g = open(new MemoryBackend().port());
  assert.equal((await g.commit({x: '1'})).status, 'not-loaded');
  const loaded = await g.load();
  assert.equal(loaded.status, 'empty');
  assert.equal(loaded.snapshot, null);
  assert.deepEqual(
    loaded.slots.map(s => s.state),
    ['absent', 'absent'],
  );
});

test('commits alternate slots, counters rise and load returns the newest generation exactly', async () => {
  const backend = new MemoryBackend(),
    g = open(backend.port());
  await g.load();
  const c1 = await g.commit({world: 'w1', party: 'p1'});
  assert.equal(c1.status, 'committed');
  assert.deepEqual(c1.snapshot, {generation: 1, slot: 'a', entries: {party: 'p1', world: 'w1'}});
  assert.ok(Object.isFrozen(c1) && Object.isFrozen(c1.snapshot) && Object.isFrozen(c1.snapshot!.entries));
  const c2 = await g.commit({world: 'w2', party: 'p2', extra: 'e2'});
  assert.equal(c2.snapshot!.slot, 'b');
  assert.equal(c2.snapshot!.generation, 2);
  const c3 = await g.commit({world: 'w3'});
  assert.equal(c3.snapshot!.slot, 'a');
  // the old generation's `party` key in slot a was swept after the commit record landed
  assert.equal(backend.data.has('game-gen|run|a|party'), false);
  assert.equal(c3.leftovers, 0);
  g.close();
  const again = open(backend.port(1));
  const loaded = await again.load();
  assert.equal(loaded.status, 'loaded');
  assert.deepEqual(loaded.snapshot, {generation: 3, slot: 'a', entries: {world: 'w3'}});
  assert.deepEqual(
    loaded.slots.map(s => [s.slot, s.state, s.generation]),
    [
      ['a', 'verified', 3],
      ['b', 'unchecked', 2],
    ],
  );
  assert.deepEqual(again.current(), loaded.snapshot);
});

test('an empty generation is a valid generation, not an absent save', async () => {
  const backend = new MemoryBackend(),
    g = open(backend.port());
  await g.load();
  await g.commit({a: '1'});
  assert.equal((await g.commit({})).status, 'committed');
  const loaded = await open(backend.port(1)).load();
  assert.equal(loaded.status, 'loaded');
  assert.deepEqual(loaded.snapshot, {generation: 2, slot: 'b', entries: {}});
});

test('bounds: too many keys or characters is refused before any write; malformed entries throw', async () => {
  const backend = new MemoryBackend(),
    g = open(backend.port(), {maxKeys: 2, maxKeyChars: 4, maxTotalChars: 6});
  await g.load();
  const before = backend.writes;
  assert.equal((await g.commit({a: '1', b: '2', c: '3'})).status, 'too-large');
  assert.equal((await g.commit({a: '12345'})).status, 'too-large');
  assert.equal((await g.commit({a: '1234', b: '123'})).status, 'too-large');
  assert.equal(backend.writes, before);
  assert.equal((await g.commit({a: '1234', b: '12'})).status, 'committed');
  await assert.rejects(g.commit({'Bad Key': 'x'}), RangeError);
  await assert.rejects(g.commit(JSON.parse('{"a": 1}')), RangeError); // untyped data from outside
  await assert.rejects(g.commit(JSON.parse('null')), RangeError);
});

test('a second commit while one is in flight is refused as busy; readers see one coherent snapshot', async () => {
  const backend = new MemoryBackend(),
    sync = backend.port();
  let release!: () => void;
  const gate = new Promise<void>(r => (release = r));
  let hold = false;
  const port: GenerationPort = {
    get: k => sync.get(k),
    remove: k => sync.remove(k),
    async set(k, v) {
      if (hold) await gate;
      sync.set(k, v);
    },
    keys: () => sync.keys(),
  };
  const g = open(port);
  await g.load();
  await g.commit({a: 'one', b: 'one'});
  hold = true;
  const pending = g.commit({a: 'two', b: 'two'});
  await Promise.resolve();
  assert.equal(g.busy(), true);
  assert.equal((await g.commit({a: 'x'})).status, 'busy');
  assert.equal((await g.load()).status, 'busy');
  assert.deepEqual(g.current()!.entries, {a: 'one', b: 'one'});
  release();
  assert.equal((await pending).status, 'committed');
  assert.deepEqual(g.current()!.entries, {a: 'two', b: 'two'});
  assert.equal(g.busy(), false);
});

test('cancellation before the commit record leaves the previous generation authoritative', async () => {
  const backend = new MemoryBackend(),
    inner = backend.port();
  const signal = {aborted: false};
  let sets = 0;
  const port: GenerationPort = {
    get: k => inner.get(k),
    remove: k => inner.remove(k),
    set(k, v) {
      inner.set(k, v);
      if (++sets === 4) signal.aborted = true; // the first commit made 3 sets; abort after the next data key
    },
    keys: () => inner.keys(),
  };
  const g = open(port);
  await g.load();
  await g.commit({a: 'old', b: 'old'});
  const r = await g.commit({a: 'new', b: 'new'}, {signal});
  assert.equal(r.status, 'cancelled');
  assert.equal(r.snapshot!.generation, 1);
  const loaded = await open(backend.port(1)).load();
  assert.equal(loaded.status, 'recovered');
  assert.deepEqual(loaded.snapshot!.entries, {a: 'old', b: 'old'});
  assert.equal(loaded.slots.find(s => s.slot === 'b')!.state, 'torn');
  // an already-aborted signal writes nothing
  const writes = backend.writes;
  assert.equal((await g.commit({a: 'n'}, {signal})).status, 'cancelled');
  assert.equal(backend.writes, writes);
  signal.aborted = false;
  assert.equal((await g.commit({a: 'next'}, {signal})).snapshot!.slot, 'b');
});

test('closing an owner mid-commit stops it before its next write', async () => {
  const backend = new MemoryBackend(),
    inner = backend.port();
  let g!: ReturnType<typeof open>;
  let sets = 0;
  const port: GenerationPort = {
    get: k => inner.get(k),
    remove: k => inner.remove(k),
    set(k, v) {
      inner.set(k, v);
      if (++sets === 3) g.close();
    },
  };
  g = open(port);
  await g.load();
  await g.commit({a: '1'});
  assert.equal((await g.commit({a: '2', b: '2'})).status, 'closed');
  assert.equal((await g.load()).status, 'closed');
  assert.deepEqual((await open(backend.port(1)).load()).snapshot!.entries, {a: '1'});
});

test('another writer (a second tab) makes a stale owner refuse with conflict until it loads again', async () => {
  const backend = new MemoryBackend();
  const tab1 = open(backend.port(1)),
    tab2 = open(backend.port(2));
  await tab1.load();
  await tab2.load();
  assert.equal((await tab1.commit({k: 'from-1'})).status, 'committed');
  const stale = await tab2.commit({k: 'from-2'});
  assert.equal(stale.status, 'conflict');
  assert.equal(stale.writes, 0);
  const reloaded = await tab2.load();
  assert.deepEqual(reloaded.snapshot!.entries, {k: 'from-1'});
  assert.equal((await tab2.commit({k: 'from-2'})).snapshot!.generation, 2);
});

test('generation counter ceiling is refused, not wrapped', async () => {
  const backend = new MemoryBackend(),
    g = open(backend.port());
  await g.load();
  await g.commit({a: '1'});
  // forge a valid record at the ceiling by rewriting the slot as a commit would
  const {crc32} = await import('../../core/save/chunk-store');
  const enc = new TextEncoder(),
    top = Number.MAX_SAFE_INTEGER,
    value = `${top}|1`;
  backend.data.set('game-gen|run|a|a', value);
  const body = JSON.stringify({f: 1, n: 'run', s: 'a', g: top, k: [['a', value.length, crc32(enc.encode(value))]]});
  backend.data.set('game-gen|run|a#commit', `${crc32(enc.encode(body)).toString(16).padStart(8, '0')}|${body}`);
  const h = open(backend.port(1));
  assert.equal((await h.load()).snapshot!.generation, top);
  assert.equal((await h.commit({a: '2'})).status, 'exhausted');
});
