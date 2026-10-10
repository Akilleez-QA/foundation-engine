import assert from 'node:assert/strict';
import {test} from 'node:test';
import {crc32} from '../../core/save/chunk-store';
import {MemoryBackend} from '../../core/save/storage-port';
import {createSaveGenerations, type GenerationPort} from './index';

/** Writes a slot exactly as a commit would (namespace 'game', save 'run'), bypassing the owner's input checks. */
function forge(backend: MemoryBackend, slot: 'a' | 'b', generation: number, entries: Record<string, string>) {
  const enc = new TextEncoder(),
    sum = (t: string) => crc32(enc.encode(t)),
    keys: [string, number, number][] = [];
  for (const k of Object.keys(entries).sort()) {
    const value = `${generation}|${entries[k]}`;
    backend.data.set(`game-gen|run|${slot}|${k}`, value);
    keys.push([k, value.length, sum(value)]);
  }
  const body = JSON.stringify({f: 1, ns: 'game', n: 'run', s: slot, g: generation, k: keys});
  backend.data.set(`game-gen|run|${slot}#commit`, `${sum(body).toString(16).padStart(8, '0')}|${body}`);
}

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
  forge(backend, 'a', Number.MAX_SAFE_INTEGER, {a: '1'});
  const h = open(backend.port(1));
  assert.equal((await h.load()).snapshot!.generation, Number.MAX_SAFE_INTEGER);
  assert.equal((await h.commit({a: '2'})).status, 'exhausted');
});

test('review: each entry value is read once; a getter cannot change what is validated or written', async () => {
  const backend = new MemoryBackend(),
    g = open(backend.port(), {maxKeyChars: 8});
  await g.load();
  let reads = 0;
  const entries = {
    get a() {
      return reads++ === 0 ? 'ok' : 'x'.repeat(1000);
    },
  };
  const r = await g.commit(entries);
  assert.equal(reads, 1);
  assert.equal(r.status, 'committed');
  assert.deepEqual(r.snapshot!.entries, {a: 'ok'});
  assert.equal(backend.data.get('game-gen|run|a|a'), '1|ok');
});

test('review: lone surrogates are refused at commit and a stored ill-formed value invalidates its slot', async () => {
  const backend = new MemoryBackend(),
    g = open(backend.port());
  await g.load();
  await assert.rejects(g.commit({a: 'x\uD800y'}), /lone surrogate/);
  await assert.rejects(g.commit({a: '\uDC00'}), /lone surrogate/);
  assert.equal((await g.commit({a: 'pair \uD83D\uDE00 ok'})).status, 'committed');
  g.close();
  // a lone surrogate encodes to U+FFFD in UTF-8, so its checksum matches; the slot is still refused
  forge(backend, 'b', 2, {a: 'x\uD800'});
  const loaded = await open(backend.port(1)).load();
  assert.equal(loaded.status, 'recovered');
  assert.match(loaded.slots.find(s => s.slot === 'b')!.reason!, /well-formed/);
  assert.deepEqual(loaded.snapshot!.entries, {a: 'pair \uD83D\uDE00 ok'});
});

test('review: a record from another namespace is refused', async () => {
  const backend = new MemoryBackend();
  forge(backend, 'a', 1, {a: '1'});
  const other = createSaveGenerations({port: backend.port(), namespace: 'game', name: 'run'});
  assert.equal((await other.load()).status, 'loaded');
  other.close();
  // the same bytes moved under another namespace's prefix are not that namespace's save
  for (const [k, v] of [...backend.data]) backend.data.set(k.replace(/^game-/, 'demo-'), v);
  const moved = createSaveGenerations({port: backend.port(1), namespace: 'demo', name: 'run'});
  const loaded = await moved.load();
  assert.equal(loaded.status, 'corrupt');
  assert.match(loaded.slots[0]!.reason!, /another save/);
});

test('review: close mid-commit keeps the writer claim until the commit settles', async () => {
  const backend = new MemoryBackend(),
    sync = backend.port();
  let release!: () => void;
  let hold = false;
  const gate = new Promise<void>(r => (release = r));
  const port: GenerationPort = {
    get: k => sync.get(k),
    remove: k => sync.remove(k),
    async set(k, v) {
      if (hold) await gate;
      sync.set(k, v);
    },
  };
  const first = open(port);
  await first.load();
  await first.commit({a: '1', b: '1'});
  hold = true;
  const pending = first.commit({a: '2', b: '2'});
  await Promise.resolve();
  first.close();
  assert.throws(() => open(port), /already has a writer/); // still in flight
  release();
  assert.equal((await pending).status, 'closed');
  const successor = open(port); // claim released once the commit settled
  assert.deepEqual((await successor.load()).snapshot!.entries, {a: '1', b: '1'});
});

test('review: closing after the record skips the sweep; the sweep never removes keys of a newer generation', async () => {
  const backend = new MemoryBackend(),
    sync = backend.port();
  let owner!: ReturnType<typeof open>;
  let closeOnRecord = false;
  const port: GenerationPort = {
    get: k => sync.get(k),
    remove: k => sync.remove(k),
    set(k, v) {
      sync.set(k, v);
      if (closeOnRecord && k.endsWith('#commit')) owner.close();
    },
    keys: () => sync.keys(),
  };
  owner = open(port);
  await owner.load();
  await owner.commit({x: '1', y: '1'}); // slot a
  await owner.commit({x: '2'}); // slot b
  closeOnRecord = true;
  const r = await owner.commit({x: '3'}); // slot a: y is stale but the owner was closed after its record
  assert.equal(r.status, 'committed');
  assert.equal(r.leftovers, 1);
  assert.equal(backend.data.has('game-gen|run|a|y'), true);

  const next = open(backend.port(1));
  await next.load();
  await next.commit({x: '4'}); // slot b
  // a key carrying a newer generation than the commit about to overwrite slot a (another writer's)
  backend.data.set('game-gen|run|a|z', '99|other');
  const swept = await next.commit({x: '5'}); // slot a, generation 5: removes y (gen 1), keeps z (gen 99)
  assert.equal(swept.status, 'committed');
  assert.equal(backend.data.has('game-gen|run|a|y'), false);
  assert.equal(backend.data.get('game-gen|run|a|z'), '99|other');
  assert.equal(swept.leftovers, 1);
});
