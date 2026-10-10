/**
 * Fault injection: a wrapper port that dies after N mutating operations (a crash: nothing after it runs), throws on
 * a chosen write, or answers asynchronously; plus byte flips and dropped keys applied to the stored bytes. After every
 * fault a fresh owner over the same backend must load exactly the previous or the new generation, never a mix.
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {MemoryBackend, type StoragePort} from '../../core/save/storage-port';
import {createSaveGenerations, type GenerationPort, type LoadResult} from './index';

class FaultPort implements GenerationPort {
  /** Mutations (set/remove) that succeeded. */
  mutations = 0;
  /** The mutation index at which the process "dies": that write and everything after it never happens. */
  crashAt = Infinity;
  crashed = false;
  failSet: (key: string) => boolean = () => false;
  constructor(
    readonly inner: StoragePort,
    readonly async = false,
  ) {}
  private gate<T>(fn: () => T): T | Promise<T> {
    if (this.crashed) throw new Error('process gone');
    return this.async ? Promise.resolve().then(fn) : fn();
  }
  private mutate(fn: () => void): void | Promise<void> {
    return this.gate(() => {
      if (this.crashed) throw new Error('process gone');
      if (this.mutations === this.crashAt) {
        this.crashed = true;
        throw new Error('crash');
      }
      fn();
      this.mutations++;
    });
  }
  get(key: string) {
    return this.gate(() => this.inner.get(key));
  }
  set(key: string, value: string) {
    return this.mutate(() => {
      if (this.failSet(key)) throw new Error('QuotaExceededError');
      this.inner.set(key, value);
    });
  }
  remove(key: string) {
    return this.mutate(() => this.inner.remove(key));
  }
  keys() {
    return this.gate(() => this.inner.keys());
  }
}

const gen = (n: number, keys: number) => {
  const out: Record<string, string> = {};
  for (let k = 0; k < keys; k++) out[`part-${k}`] = `{"gen":${n},"part":${k},"pad":"${'x'.repeat(k * 7)}"}`;
  return out;
};
const fresh = (backend: MemoryBackend, tab: number) => createSaveGenerations({port: backend.port(tab), name: 'run'});
const reload = (backend: MemoryBackend, tab: number): Promise<LoadResult> => fresh(backend, tab).load();

/** Commits `history` cleanly, then attempts `next` with a crash at mutation `crashAt` (counted within that commit). */
async function crashCommit(
  history: Record<string, string>[],
  next: Record<string, string>,
  crashAt: number,
  async: boolean,
) {
  const backend = new MemoryBackend(),
    port = new FaultPort(backend.port(0), async);
  const owner = createSaveGenerations({port, name: 'run'});
  await owner.load();
  for (const h of history) assert.equal((await owner.commit(h)).status, 'committed');
  port.crashAt = port.mutations + crashAt;
  const attempt = await owner.commit(next);
  return {backend, attempt, base: port.mutations};
}

for (const async of [false, true]) {
  test(`crash at every write index of a multi-key commit loads exactly the old or the new generation (${async ? 'async' : 'sync'} port)`, async () => {
    let cases = 0;
    for (const keys of [1, 3, 6]) {
      for (const historyLength of [0, 1, 2, 3]) {
        const history = Array.from({length: historyLength}, (_, i) => gen(i + 1, i % 2 ? keys : keys + 1));
        const next = gen(historyLength + 1, keys);
        // a clean run tells how many mutations the commit makes (remove record, keys, record, sweep)
        const clean = await crashCommit(history, next, Infinity, async);
        assert.equal(clean.attempt.status, 'committed');
        const total = clean.attempt.writes,
          recordIndex = 1 + keys; // remove-record, then `keys` sets, then the record
        for (let crashAt = 0; crashAt <= total; crashAt++) {
          const {backend, attempt} = await crashCommit(history, next, crashAt, async);
          const loaded = await reload(backend, 1);
          const committed = crashAt > recordIndex;
          assert.equal(attempt.status, committed ? 'committed' : 'failed');
          if (committed) {
            assert.deepEqual(loaded.snapshot?.entries, next, `keys ${keys} history ${historyLength} crash ${crashAt}`);
            assert.equal(loaded.snapshot!.generation, historyLength + 1);
          } else if (historyLength === 0) {
            assert.equal(loaded.status, 'empty', `first commit torn at ${crashAt} reads as no save`);
          } else {
            assert.deepEqual(
              loaded.snapshot?.entries,
              history.at(-1),
              `keys ${keys} history ${historyLength} crash ${crashAt}`,
            );
            assert.equal(loaded.snapshot!.generation, historyLength);
            // untouched or still-absent target: loaded; a target with its record gone and keys left behind: recovered
            const untouched = crashAt === 0 || (historyLength === 1 && crashAt === 1);
            assert.equal(loaded.status, untouched ? 'loaded' : 'recovered', `crash ${crashAt}`);
          }
          // recovery: the next commit from a fresh owner lands and is the newest generation
          const after = fresh(backend, 2);
          await after.load();
          const final = gen(99, keys);
          assert.equal((await after.commit(final)).status, 'committed');
          assert.deepEqual((await reload(backend, 3)).snapshot?.entries, final);
          cases++;
        }
      }
    }
    assert.ok(cases > 60, `${cases} crash points`);
  });
}

test('a throwing write (quota, blocked storage) fails the commit and keeps the previous generation', async () => {
  for (let failing = 0; failing < 4; failing++) {
    const backend = new MemoryBackend(),
      port = new FaultPort(backend.port(0));
    const owner = createSaveGenerations({port, name: 'run'});
    await owner.load();
    await owner.commit(gen(1, 3));
    let sets = 0;
    port.failSet = () => sets++ === failing;
    const r = await owner.commit(gen(2, 3));
    assert.equal(r.status, 'failed');
    assert.match(r.reason!, /Quota/);
    assert.equal(r.snapshot!.generation, 1);
    assert.deepEqual((await reload(backend, 1)).snapshot!.entries, gen(1, 3));
    // the owner keeps working once storage recovers
    port.failSet = () => false;
    assert.equal((await owner.commit(gen(2, 3))).status, 'committed');
  }
  // the save store's own quota model: a generation that does not fit is refused by the port, old one intact
  const backend = new MemoryBackend(),
    owner = fresh(backend, 0);
  await owner.load();
  await owner.commit({big: 'y'.repeat(100)});
  backend.quotaChars = backend.used() + 50;
  assert.equal((await owner.commit({big: 'z'.repeat(100)})).status, 'failed');
  assert.deepEqual((await reload(backend, 1)).snapshot!.entries, {big: 'y'.repeat(100)});
});

test('reads that throw report unavailable, never empty', async () => {
  const backend = new MemoryBackend(),
    owner = fresh(backend, 0);
  await owner.load();
  await owner.commit(gen(1, 2));
  backend.failGet = () => true;
  const loaded = await reload(backend, 1);
  assert.equal(loaded.status, 'unavailable');
  assert.equal((await owner.commit(gen(2, 2))).status, 'unavailable');
});

/** Two clean generations: 1 in slot a, 2 in slot b. */
async function twoGenerations() {
  const backend = new MemoryBackend(),
    owner = fresh(backend, 0);
  await owner.load();
  await owner.commit(gen(1, 3));
  await owner.commit(gen(2, 3));
  owner.close();
  return backend;
}
const flip = (backend: MemoryBackend, key: string, at: number) => {
  const v = backend.data.get(key)!,
    i = ((at % v.length) + v.length) % v.length;
  backend.data.set(key, v.slice(0, i) + String.fromCharCode(v.charCodeAt(i) ^ 1) + v.slice(i + 1));
};

test('a flipped byte anywhere in the newest generation falls back to the older one, atomically', async () => {
  let cases = 0;
  const keys = ['game-gen|run|b#commit', 'game-gen|run|b|part-0', 'game-gen|run|b|part-1', 'game-gen|run|b|part-2'];
  for (const key of keys) {
    const length = (await twoGenerations()).data.get(key)!.length;
    for (let at = 0; at < length; at++) {
      const backend = await twoGenerations();
      flip(backend, key, at);
      const loaded = await reload(backend, 1);
      assert.equal(loaded.status, 'recovered', `${key} @${at}`);
      assert.deepEqual(loaded.snapshot!.entries, gen(1, 3));
      assert.equal(loaded.slots.find(s => s.slot === 'b')!.state, 'invalid');
      cases++;
    }
  }
  assert.ok(cases > 200);
});

test('a dropped key, a stale key from another generation or a record copied to the other slot invalidates that slot', async () => {
  const dropped = await twoGenerations();
  dropped.data.delete('game-gen|run|b|part-1');
  let loaded = await reload(dropped, 1);
  assert.equal(loaded.status, 'recovered');
  assert.match(loaded.slots.find(s => s.slot === 'b')!.reason!, /missing/);
  assert.deepEqual(loaded.snapshot!.entries, gen(1, 3));

  const stale = await twoGenerations(); // slot b's key replaced by slot a's (older generation) bytes
  stale.data.set('game-gen|run|b|part-1', stale.data.get('game-gen|run|a|part-1')!);
  loaded = await reload(stale, 1);
  assert.equal(loaded.status, 'recovered');
  assert.match(loaded.slots.find(s => s.slot === 'b')!.reason!, /another generation/);

  const copied = await twoGenerations(); // slot a's record copied over slot b's: names the wrong slot
  copied.data.set('game-gen|run|b#commit', copied.data.get('game-gen|run|a#commit')!);
  loaded = await reload(copied, 1);
  assert.match(loaded.slots.find(s => s.slot === 'b')!.reason!, /another save or slot/);
  assert.equal(loaded.snapshot!.generation, 1);
});

test('the older slot being damaged still loads the newest generation; both damaged is corrupt, not empty', async () => {
  const older = await twoGenerations();
  flip(older, 'game-gen|run|a|part-0', 3);
  let loaded = await reload(older, 1);
  assert.equal(loaded.status, 'loaded'); // the older slot is not read when the newest verifies
  assert.equal(loaded.snapshot!.generation, 2);

  const both = await twoGenerations();
  flip(both, 'game-gen|run|a|part-0', 3);
  flip(both, 'game-gen|run|b|part-2', 5);
  loaded = await reload(both, 1);
  assert.equal(loaded.status, 'corrupt');
  assert.equal(loaded.snapshot, null);
  assert.deepEqual(
    loaded.slots.map(s => s.state),
    ['invalid', 'invalid'],
  );
  // after a corrupt load, a commit is allowed, takes a counter above every readable record, and keeps a damaged slot
  const owner = fresh(both, 2);
  await owner.load();
  const next = await owner.commit(gen(3, 3));
  assert.equal(next.snapshot!.generation, 3);
  assert.equal((await reload(both, 3)).snapshot!.generation, 3);

  const records = await twoGenerations(); // records unreadable in both slots
  records.data.set('game-gen|run|a#commit', 'garbage');
  records.data.set('game-gen|run|b#commit', '{}');
  assert.equal((await reload(records, 1)).status, 'corrupt');
});

test('a reader racing a writer in another tab retries and reports contended when the record keeps changing', async () => {
  const backend = await twoGenerations();
  const inner = backend.port(5);
  let reads = 0;
  const port: GenerationPort = {
    // every second read of slot b's record (the re-read after verifying) sees it gone: a writer is rewriting it
    get: k => (k === 'game-gen|run|b#commit' && ++reads % 2 === 0 ? null : inner.get(k)),
    set: (k, v) => inner.set(k, v),
    remove: k => inner.remove(k),
  };
  const owner = createSaveGenerations({port, name: 'run', maxLoadAttempts: 3});
  const loaded = await owner.load();
  assert.equal(loaded.status, 'contended');
  assert.equal(reads, 6);
  assert.equal((await owner.commit(gen(9, 1))).status, 'not-loaded'); // a contended load adopts nothing
});

test('randomised fault sequence: every reload is exactly the last committed or the attempted generation', async () => {
  let seed = 0x5eed;
  const rand = (n: number) => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return seed % n;
  };
  const backend = new MemoryBackend();
  const byGeneration = new Map<number, Record<string, string>>();
  let committed = 0,
    failures = 0,
    tab = 0;
  for (let round = 0; round < 400; round++) {
    const port = new FaultPort(backend.port(tab++), rand(2) === 1);
    const owner = createSaveGenerations({port, name: 'run'});
    const loaded = await owner.load();
    if (committed === 0) assert.ok(loaded.status === 'empty', `round ${round}: ${loaded.status}`);
    else {
      assert.equal(loaded.snapshot!.generation, committed, `round ${round}`);
      assert.deepEqual(loaded.snapshot!.entries, byGeneration.get(committed));
    }
    const keys = 1 + rand(6),
      next = gen(round + 1000, keys);
    for (const k of Object.keys(next)) if (rand(3) === 0) delete next[k];
    const fault = rand(4);
    if (fault === 0) port.crashAt = rand(keys + 4);
    else if (fault === 1) port.failSet = () => rand(5) === 0;
    const r = await owner.commit(next);
    if (r.status === 'committed') {
      committed = r.snapshot!.generation;
      byGeneration.set(committed, next);
    } else {
      assert.equal(r.status, 'failed');
      failures++;
    }
    owner.close();
    // occasionally damage the older slot only: the newest must still win
    if (committed > 1 && rand(5) === 0) {
      const stale = r.status === 'committed' && r.snapshot!.slot === 'a' ? 'b' : 'a';
      const victim = [...backend.data.keys()].filter(k => k.startsWith(`game-gen|run|${stale}`) && !k.includes('#'));
      const head = (await reload(backend, 999)).snapshot!;
      if (victim.length && head.slot !== stale) flip(backend, victim[rand(victim.length)]!, rand(40));
    }
  }
  assert.ok(committed > 100 && failures > 50, `${committed} generations committed, ${failures} failed`);
});

/** An asynchronous port with seeded delays (a number of microtask turns) that logs every mutation in order. */
function racingPort(inner: StoragePort, log: [string, string | null][], delay: () => number): GenerationPort {
  const wait = async () => {
    for (let i = delay(); i > 0; i--) await Promise.resolve();
  };
  return {
    async get(k) {
      await wait();
      return inner.get(k);
    },
    async set(k, v) {
      await wait();
      inner.set(k, v);
      log.push([k, v]);
    },
    async remove(k) {
      await wait();
      inner.remove(k);
      log.push([k, null]);
    },
    async keys() {
      await wait();
      return inner.keys();
    },
  };
}

test('review repro: two owners on different port objects racing one commit each never both stay authoritative', async () => {
  const backend = new MemoryBackend(),
    log: [string, string | null][] = [];
  let tick = 0;
  const a = createSaveGenerations({port: racingPort(backend.port(1), log, () => tick++ % 3), name: 'run'});
  const b = createSaveGenerations({port: racingPort(backend.port(2), log, () => tick++ % 2), name: 'run'});
  await a.load();
  await b.load();
  const [ra, rb] = await Promise.all([a.commit({k: 'from-a', j: 'a'}), b.commit({k: 'from-b', j: 'b'})]);
  const statuses = [ra.status, rb.status].sort();
  assert.ok(statuses.filter(s => s === 'committed').length <= 1, statuses.join());
  const final = await reload(backend, 9);
  const winner = [ra, rb].find(r => r.status === 'committed');
  if (winner) assert.deepEqual(final.snapshot!.entries, winner.snapshot!.entries);
  else assert.notEqual(final.status, 'loaded'); // nobody confirmed: nothing new may be adopted silently
  for (const r of [ra, rb]) assert.ok(['committed', 'lost', 'conflict'].includes(r.status), r.status);
});

test('review fuzz: racing async writers — every committed result was the head at some moment after its record', async () => {
  let seed = 0xfeed;
  const rand = (n: number) => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return (seed >>> 8) % n;
  };
  const backend = new MemoryBackend();
  let committedTotal = 0,
    lostTotal = 0;
  for (let round = 0; round < 120; round++) {
    const log: [string, string | null][] = [],
      start = new Map(backend.data);
    const owners = Array.from({length: 2 + rand(3)}, (_, i) =>
      createSaveGenerations({port: racingPort(backend.port(100 + i), log, () => rand(4)), name: 'run'}),
    );
    for (const o of owners) await o.load();
    const prior = owners[0]!.current();
    const results = await Promise.all(
      owners.map((o, i) => {
        const entries: Record<string, string> = {};
        for (let k = 0; k <= rand(3); k++) entries[`k${k}`] = `r${round}-o${i}-k${k}`;
        return o.commit(entries);
      }),
    );
    for (const o of owners) o.close();
    // replay the round's mutations; a load of each intermediate state shows which generation was the head then
    const state = new MemoryBackend();
    for (const [k, v] of start) state.data.set(k, v);
    const heads: (string | null)[] = [];
    for (const [k, v] of log) {
      if (v === null) state.data.delete(k);
      else state.data.set(k, v);
      const snap = (await createSaveGenerations({port: state.port(), name: 'run'}).load()).snapshot;
      heads.push(snap ? JSON.stringify(snap) : null);
    }
    for (const r of results) {
      assert.ok(['committed', 'lost', 'conflict', 'unconfirmed'].includes(r.status), r.status);
      if (r.status === 'committed') {
        committedTotal++;
        assert.ok(heads.includes(JSON.stringify(r.snapshot)), `round ${round}: committed but never the head`);
      }
      if (r.status === 'lost') lostTotal++;
    }
    // whatever a fresh load returns now was reported committed by someone, or is the generation before the round
    const final = (await reload(backend, 999)).snapshot;
    const claimed = results.filter(r => r.status === 'committed').map(r => JSON.stringify(r.snapshot));
    assert.ok(
      claimed.includes(JSON.stringify(final)) || JSON.stringify(final) === JSON.stringify(prior),
      `round ${round}: final head was never reported committed`,
    );
  }
  assert.ok(committedTotal > 40 && lostTotal > 0, `${committedTotal} committed, ${lostTotal} lost`);
});

/** A port over `inner` whose chosen operations wait for `release()` (another writer runs meanwhile). */
function heldPort(inner: StoragePort, holdGet: (key: string, n: number) => boolean, holdSet: (key: string) => boolean) {
  let release!: () => void;
  const gate = new Promise<void>(r => (release = r));
  const gets = new Map<string, number>();
  let reached!: () => void;
  const waiting = new Promise<void>(r => (reached = r));
  const port: GenerationPort = {
    async get(k) {
      const n = (gets.get(k) ?? 0) + 1;
      gets.set(k, n);
      if (holdGet(k, n)) {
        reached();
        await gate;
      }
      return inner.get(k);
    },
    async set(k, v) {
      if (holdSet(k)) {
        reached();
        await gate;
      }
      inner.set(k, v);
    },
    remove: k => inner.remove(k),
    keys: () => inner.keys(),
  };
  return {port, release: () => release(), waiting};
}

test('re-review repro: a racing record landing after a confirmed commit invalidates it; load falls back and the owner sees conflict', async () => {
  const backend = new MemoryBackend();
  const seed = fresh(backend, 0);
  await seed.load();
  await seed.commit({k: 'gen1'}); // slot a
  seed.close();
  // W: holds its record write (after its narrowing check passed: slot b had no record yet)
  const w = heldPort(
    backend.port(1),
    () => false,
    k => k === 'game-gen|run|b#commit',
  );
  const writerW = createSaveGenerations({port: w.port, name: 'run'});
  const writerX = fresh(backend, 2);
  await writerW.load();
  await writerX.load();
  const pendingW = writerW.commit({k: 'from-w'});
  await w.waiting;
  const rx = await writerX.commit({k: 'from-x'}); // same target slot b, completes and confirms
  assert.equal(rx.status, 'committed');
  assert.deepEqual(rx.snapshot!.entries, {k: 'from-x'});
  w.release();
  const rw = await pendingW; // W's record lands over X's keys: slot b invalid
  assert.equal(rw.status, 'lost');
  const loaded = await reload(backend, 9);
  assert.equal(loaded.status, 'recovered');
  assert.deepEqual(loaded.snapshot!.entries, {k: 'gen1'}); // the generation before both
  assert.equal(loaded.slots.find(s => s.slot === 'b')!.state, 'invalid');
  assert.equal((await writerX.commit({k: 'again'})).status, 'conflict'); // X learns on its next commit
});

test('re-review: the narrowing check makes a writer stand down when a valid generation already landed in its slot', async () => {
  const backend = new MemoryBackend();
  const seed = fresh(backend, 0);
  await seed.load();
  await seed.commit({k: 'gen1'});
  seed.close();
  // W: holds its second read of slot b's record, which is the check just before its record write
  const w = heldPort(
    backend.port(1),
    (k, n) => k === 'game-gen|run|b#commit' && n === 3, // 1: load, 2: commit's scan, 3: the check
    () => false,
  );
  const writerW = createSaveGenerations({port: w.port, name: 'run'});
  const writerX = fresh(backend, 2);
  await writerW.load();
  await writerX.load();
  const pendingW = writerW.commit({k: 'from-w'});
  await w.waiting;
  // W has written its key; X rewrites it, writes its record and confirms
  assert.equal((await writerX.commit({k: 'from-x'})).status, 'committed');
  w.release();
  const rw = await pendingW;
  assert.equal(rw.status, 'lost');
  assert.match(rw.reason!, /valid generation into this slot first/);
  const loaded = await reload(backend, 9);
  assert.equal(loaded.status, 'loaded');
  assert.deepEqual(loaded.snapshot!.entries, {k: 'from-x'}); // X's confirmed generation survives
});
