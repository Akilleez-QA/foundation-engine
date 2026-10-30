import test from 'node:test';
import assert from 'node:assert/strict';
import {LeaseCache, type LeaseLoader, type LeaseResidency, type ResidencyPressure} from './lease-cache';
import {must} from '../../testing/must';

/** RES-01 adversarial cases for the residency policy of the existing lease cache. */

interface Gpu {
  readonly key: string;
  readonly bytes: number;
}

/** Fetches resolve immediately unless `hold` names the key; every upload, park and dispose is recorded. */
function loader(bytes: (key: string) => number = () => 64) {
  const log = {
    fetched: [] as string[],
    uploaded: [] as string[],
    parked: [] as string[],
    disposed: [] as string[],
    discarded: [] as string[],
  };
  const held = new Map<string, () => void>();
  const hold = new Set<string>();
  const l: LeaseLoader<string, Gpu> = {
    fetch(key) {
      log.fetched.push(key);
      if (!hold.has(key)) return Promise.resolve(key);
      return new Promise(resolve => held.set(key, () => resolve(key)));
    },
    upload: (decoded, key) => {
      log.uploaded.push(decoded);
      return {key, bytes: bytes(key)};
    },
    discard: decoded => {
      log.discarded.push(decoded);
    },
    dispose: r => {
      log.disposed.push(r.key);
    },
    park: r => {
      log.parked.push(r.key);
    },
    bytes: r => r.bytes,
  };
  return {
    loader: l,
    log,
    hold,
    release: (key: string) => {
      held.get(key)!();
      held.delete(key);
    },
  };
}

const settle = () => new Promise<void>(r => setTimeout(r, 0));
const owner = () => new AbortController();

function cache(warmBytes: number, residency?: LeaseResidency, bytes?: (key: string) => number) {
  const m = loader(bytes);
  const reports: ResidencyPressure[] = [];
  const c = new LeaseCache(m.loader, {
    warmBytes,
    residency: residency && {onPressure: r => reports.push(r), ...residency},
  });
  return {c, m, reports};
}

const use = async (c: LeaseCache<string, Gpu>, key: string) => {
  const lease = await c.acquire(key, owner().signal);
  lease.release();
};

test('RES-01: the measured gap: without a policy a released key loads again; a pin keeps it', async () => {
  const off = cache(0);
  await use(off.c, 'hero');
  await use(off.c, 'hero');
  assert.equal(off.c.stats.loads, 2, 'released at once: the second use fetches and uploads again');
  assert.equal(off.m.log.parked.length, 0, 'nothing retained, nothing parked');

  const on = cache(0, {pinned: key => key === 'hero'});
  await use(on.c, 'hero');
  await use(on.c, 'hero');
  assert.equal(on.c.stats.loads, 1);
  assert.equal(on.c.stats.hits, 1);
  assert.deepEqual(on.m.log.uploaded, ['hero']);
  assert.equal(on.c.pinnedBytes(), 64);
});

test('RES-01: resident bytes exactly at the ceiling evict nothing; one byte over evicts the least recent', async () => {
  const {c, m, reports} = cache(1024, {residentBytes: 128});
  await use(c, 'a');
  await use(c, 'b');
  assert.equal(c.residentBytes(), 128);
  assert.equal(c.stats.evictions, 0);
  assert.equal(reports.length, 0);
  await use(c, 'c');
  assert.deepEqual(m.log.disposed, ['a'], 'the least recently used retained entry goes first');
  assert.equal(c.residentBytes(), 128);
  assert.equal(c.stats.evictions, 1);
  assert.equal(c.stats.pressure, 0);
  await use(c, 'a');
  assert.equal(c.stats.reloads, 1, 'a load of an evicted key is a re-preparation');
});

test('RES-01: everything pinned over the ceiling degrades explicitly: kept, reported once, never evicted', async () => {
  const {c, m, reports} = cache(0, {residentBytes: 100, pinned: () => true});
  for (const key of ['a', 'b', 'c']) await use(c, key);
  assert.equal(c.residentBytes(), 192);
  assert.deepEqual(m.log.disposed, []);
  assert.equal(c.stats.pressure, 1);
  assert.equal(reports.length, 1);
  // The first breach is the publication of b while a is pinned: the report splits live and pinned bytes.
  assert.deepEqual(reports[0], {residentBytes: 128, limitBytes: 100, liveBytes: 64, pinnedBytes: 64, warmBytes: 0});
  assert.equal(c.pinnedBytes(), 192);
  // Staying over budget across more traffic never re-reports, reloads or evicts.
  for (let i = 0; i < 20; i++) await use(c, must(['a', 'b', 'c'][i % 3]));
  assert.equal(reports.length, 1);
  assert.equal(c.stats.loads, 3);
  assert.equal(c.stats.evictions, 0);
  // Unpinning lets the budget apply; the cache falls under and a later breach reports again.
  c.setResidency(0, {residentBytes: 100, pinned: key => key === 'a', onPressure: r => reports.push(r)});
  assert.deepEqual(m.log.disposed.sort(), ['b', 'c']);
  assert.equal(c.residentBytes(), 64);
  const x = await c.acquire('x', owner().signal),
    y = await c.acquire('y', owner().signal);
  assert.equal(reports.length, 2, 'a new transition over the ceiling reports again');
  assert.deepEqual(
    [must(reports[1]).liveBytes, must(reports[1]).pinnedBytes],
    [64, 64],
    'reported at the first breach (x), not again for y',
  );
  x.release();
  y.release();
  assert.equal(c.residentBytes(), 64);
});

test('RES-01: live leases are never evicted for the ceiling; their release relieves the pressure', async () => {
  const {c, m, reports} = cache(0, {residentBytes: 64});
  const a = await c.acquire('a', owner().signal);
  const b = await c.acquire('b', owner().signal);
  assert.equal(reports.length, 1);
  assert.deepEqual(m.log.disposed, []);
  assert.equal(b.value.key, 'b', 'the second live lease is usable');
  b.release();
  assert.deepEqual(m.log.disposed, ['b']);
  const again = await c.acquire('b', owner().signal);
  assert.equal(reports.length, 2, 'falling under reset the edge; going over again reports');
  again.release();
  a.release();
});

test('RES-01: a budget change during preparation leaves the pending load alone; abandoned loads are discarded', async () => {
  const {c, m} = cache(1024, {});
  await use(c, 'warm');
  m.hold.add('slow');
  const requester = owner();
  const pending = c.acquire('slow', requester.signal);
  c.setResidency(0, {residentBytes: 0});
  assert.deepEqual(m.log.disposed, ['warm'], 'only the retained entry is evicted');
  assert.equal(c.info('slow')?.state, 'pending');
  m.release('slow');
  const lease = await pending;
  assert.equal(lease.value.key, 'slow', 'publication completes as a live lease');
  assert.equal(c.stats.pressure, 1, 'and reports the ceiling it now exceeds');
  lease.release();
  assert.deepEqual(m.log.disposed, ['warm', 'slow']);

  m.hold.add('gone');
  const leaving = owner();
  const abandoned = c.acquire('gone', leaving.signal);
  leaving.abort();
  await assert.rejects(abandoned, {name: 'AbortError'});
  c.setResidency(1024, {});
  m.release('gone');
  await settle();
  assert.deepEqual(m.log.discarded, ['gone'], 'late data never reaches upload');
  assert.equal(c.residentBytes(), 0);
});

test('RES-01: a publication evicts retained entries to make space, never the entry being published', async () => {
  const {c, m} = cache(1024, {residentBytes: 128});
  await use(c, 'a');
  await use(c, 'b');
  const live = await c.acquire('c', owner().signal);
  assert.deepEqual(m.log.disposed, ['a']);
  assert.equal(c.info('c')?.refs, 1);
  live.release();
});

test('RES-01: retained entries are parked once per retention; evicted ones are disposed, never parked', async () => {
  const {c, m} = cache(64, {pinned: key => key === 'pin'});
  await use(c, 'pin');
  await use(c, 'a');
  await use(c, 'b');
  assert.deepEqual(m.log.parked, ['pin', 'a', 'b']);
  assert.deepEqual(m.log.disposed, ['a'], 'a was retained, parked, then evicted by b');
  await use(c, 'pin');
  assert.deepEqual(m.log.parked, ['pin', 'a', 'b', 'pin'], 'a re-retained entry is parked again; no upload');
  assert.deepEqual(m.log.uploaded, ['pin', 'a', 'b']);
  // With no space at all an entry is disposed directly, without a park first.
  const tight = cache(0);
  await use(tight.c, 'x');
  assert.deepEqual(tight.m.log.parked, []);
  assert.deepEqual(tight.m.log.disposed, ['x']);
});

test('RES-01: scene exit releases every lease; only budgeted and pinned entries stay, and teardown retires them', async () => {
  const {c, m} = cache(64, {residentBytes: 1024, pinned: key => key === 'pin'});
  const scene = owner();
  const keys = ['pin', 'a', 'b', 'c'];
  await Promise.all(keys.map(k => c.acquire(k, scene.signal)));
  assert.equal(c.residentBytes(), 256);
  scene.abort();
  for (const k of keys) assert.equal(c.refs(k), 0, `${k} released by the scene signal`);
  assert.equal(c.residentBytes(), 128, 'the pin and one warm entry fit the warm budget');
  assert.equal(c.pinnedBytes(), 64);
  assert.equal(m.log.disposed.length, 2);
  c.evictWarm();
  assert.equal(c.residentBytes(), 0);
  assert.equal(c.pinnedBytes(), 0);
  assert.deepEqual(m.log.disposed.length, 4, 'every resource disposed exactly once');
  assert.equal(new Set(m.log.disposed).size, 4);
});

test('RES-01: alternating access does not thrash when the working set fits, and pinned keys never reload', async () => {
  const fits = cache(0, {residentBytes: 128, pinned: () => true});
  for (let i = 0; i < 40; i++) await use(fits.c, i % 2 ? 'a' : 'b');
  assert.equal(fits.c.stats.loads, 2);
  assert.equal(fits.c.stats.evictions, 0);

  const warm = cache(128, {residentBytes: 128});
  for (let i = 0; i < 40; i++) await use(warm.c, i % 2 ? 'a' : 'b');
  assert.equal(warm.c.stats.loads, 2);
  assert.equal(warm.c.stats.evictions, 0);

  // A working set larger than the budget pays LRU reloads, bounded: at most one eviction per load, none of a pin.
  const small = cache(64, {residentBytes: 128, pinned: key => key === 'p'});
  for (let i = 0; i < 30; i++) await use(small.c, must(['p', 'a', 'b'][i % 3]));
  assert.ok(small.c.stats.evictions <= small.c.stats.loads);
  assert.equal(small.m.log.uploaded.filter(k => k === 'p').length, 1);
  assert.equal(small.c.stats.pressure, 0);
});

test('RES-01: invalid policies are rejected before they apply', () => {
  const {c} = cache(0);
  assert.throws(() => c.setResidency(-1), RangeError);
  assert.throws(() => c.setResidency(0, {residentBytes: 1.5}), RangeError);
  assert.throws(() => new LeaseCache(loader().loader, {warmBytes: 0, residency: {residentBytes: -1}}), RangeError);
});

test('RES-01: eviction failures caused by a publication are reported, not thrown into the unrelated load', async () => {
  const m = loader();
  m.loader.dispose = r => {
    if (r.key === 'a') throw Error('driver');
  };
  const errors: unknown[] = [];
  const c = new LeaseCache(m.loader, {
    warmBytes: 1024,
    residency: {residentBytes: 64, onCleanupError: e => errors.push(e)},
  });
  await use(c, 'a');
  const b = await c.acquire('b', owner().signal);
  assert.equal(b.value.key, 'b');
  assert.equal(c.stats.cleanupFailures, 1);
  assert.equal(errors.length, 1);
  assert.equal(c.info('a'), undefined, 'the failed entry is still retired from accounting');
  b.release();
});

test('RES-01: a throwing cleanup reporter cannot unwind a publication or its accounting', async () => {
  const m = loader();
  m.loader.dispose = r => {
    if (r.key === 'a') throw Error('driver');
  };
  const c = new LeaseCache(m.loader, {
    warmBytes: 1024,
    residency: {
      residentBytes: 64,
      onCleanupError: () => {
        throw Error('reporter');
      },
    },
  });
  await use(c, 'a');
  const b = await c.acquire('b', owner().signal);
  assert.equal(b.value.key, 'b');
  assert.equal(c.stats.cleanupFailures, 1);
  assert.equal(c.residentBytes(), 64, 'only the live entry is counted');
  b.release();
  assert.deepEqual(c.info('b'), {state: 'ready', refs: 0, bytes: 64}, 'retained within the budget');
  assert.equal(c.residentBytes(), 64);
  c.evictWarm();
  assert.equal(c.residentBytes(), 0, 'accounting matches the entries');
});

test('RES-01: makeSpace evicts unpinned retained entries LRU for an owner admission, never live or pinned ones', async () => {
  const {c, m} = cache(1024, {pinned: key => key === 'pin'});
  await use(c, 'pin');
  await use(c, 'a');
  await use(c, 'b');
  const live = await c.acquire('live', owner().signal);
  c.makeSpace(() => c.residentBytes() > 192);
  assert.deepEqual(m.log.disposed, ['a'], 'one retained entry, least recent first');
  c.makeSpace(() => true);
  assert.deepEqual(m.log.disposed, ['a', 'b'], 'an unsatisfiable need stops when nothing evictable remains');
  assert.equal(c.refs('live'), 1);
  assert.equal(c.pinnedBytes(), 64);
  live.release();
});
