/**
 * Seeded randomized comparison of World's optional change ticks, observers and cached queries with a brute-force
 * reference model that keeps its own sequence numbers, event log and iteration rules.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {component, World, type ComponentType, type Entity} from './world';
import {added, changed, type ChangeCursor, type ChangeFilter} from './world-tracking';

type Value = {n: number};
const A = component('a', {n: 0});
const B = component('b', {n: 0});
const C = component('c', {n: 0});
const TYPES: readonly ComponentType<Value>[] = [A, B, C];

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Held {
  value: Value;
  addedAt: number;
  changedAt: number;
}

/** The reference: plain maps, its own change sequence, its own expected event log. */
class Model {
  readonly alive = new Map<Entity, Map<string, Held>>();
  /** Component type ids in the order the world first created their stores (despawn reports removals in it). */
  readonly storeOrder: string[] = [];
  next = 1;
  seq = 0;
  version = 0;
  readonly events: string[] = [];
  constructor(readonly observers: readonly {tag: string; key: string}[]) {}

  private event(key: string, e: Entity): void {
    for (const o of this.observers) if (o.key === key) this.events.push(`${o.tag}:${e}`);
  }
  spawn(values: [ComponentType<Value>, Value][]): Entity {
    const e = this.next++;
    this.alive.set(e, new Map());
    for (const [type, value] of values) this.add(e, type, value);
    this.version++;
    return e;
  }
  add(e: Entity, type: ComponentType<Value>, value: Value): void {
    const held = this.alive.get(e)!;
    if (!this.storeOrder.includes(type.id)) this.storeOrder.push(type.id);
    const prior = held.get(type.id);
    const tick = ++this.seq;
    held.set(type.id, {value, addedAt: prior ? prior.addedAt : tick, changedAt: tick});
    this.version++;
    this.event(`${prior ? 'change' : 'add'}:${type.id}`, e);
  }
  remove(e: Entity, type: ComponentType<Value>): void {
    if (this.alive.get(e)?.delete(type.id)) {
      this.version++;
      this.event(`remove:${type.id}`, e);
    }
  }
  markChanged(e: Entity, type: ComponentType<Value>): boolean {
    const h = this.alive.get(e)?.get(type.id);
    if (!h) return false;
    h.changedAt = ++this.seq;
    this.version++;
    this.event(`change:${type.id}`, e);
    return true;
  }
  despawn(e: Entity): void {
    const held = this.alive.get(e);
    if (!held) return;
    this.alive.delete(e);
    for (const id of this.storeOrder) if (held.has(id)) this.event(`remove:${id}`, e);
    this.version++;
    this.event('despawn', e);
  }
  matches(e: Entity, types: readonly ComponentType<Value>[]): boolean {
    const held = this.alive.get(e);
    return !!held && types.every(t => held.has(t.id));
  }
  passes(e: Entity, filters: readonly ChangeFilter[], since: number, overflowed: boolean): boolean {
    const held = this.alive.get(e);
    return filters.every(f => {
      const h = held?.get(f.type.id);
      if (!h) return false;
      return overflowed || (f.kind === 'added' ? h.addedAt : h.changedAt) > since;
    });
  }
  row(e: Entity, types: readonly ComponentType<Value>[]): unknown[] {
    return [e, ...types.map(t => this.alive.get(e)!.get(t.id)!.value)];
  }
  matching(types: readonly ComponentType<Value>[]): Entity[] {
    return [...this.alive.keys()].filter(e => this.matches(e, types)).sort((a, b) => a - b);
  }
}

function runModel(seed: number, operations: number, maxTick?: number): {rebases: number; overflowed: number} {
  const random = rng(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(random() * xs.length)]!;
  const w = new World();
  if (maxTick !== undefined) w.configureTracking({maxTick, maxQueued: 1_000_000, maxDeliveriesPerFlush: 1_000_000});
  else w.configureTracking({maxQueued: 1_000_000, maxDeliveriesPerFlush: 1_000_000});
  w.trackChanges(A, B, C);

  // Observers: two on remove:a check registration order within one event.
  const log: string[] = [];
  const specs: {tag: string; key: string}[] = [];
  const observe = (tag: string, on: 'add' | 'remove' | 'change' | 'despawn', type?: ComponentType<Value>) => {
    specs.push({tag, key: type ? `${on}:${type.id}` : on});
    return w.observe(
      type ? {on, type, run: ev => log.push(`${tag}:${ev.entity}`)} : {on, run: ev => log.push(`${tag}:${ev.entity}`)},
    );
  };
  for (const t of TYPES) for (const on of ['add', 'remove', 'change'] as const) observe(`${on}-${t.id}`, on, t);
  observe('remove-a-second', 'remove', A);
  observe('despawn', 'despawn');
  const m = new Model(specs);

  const cursors: {c: ChangeCursor; seq: number; rate: number}[] = [0.5, 0.2, 0.02].map(rate => ({
    c: w.changeCursor(),
    seq: 0,
    rate,
  }));
  const shapes: ComponentType<Value>[][] = [[A], [B], [A, B], [B, C], [A, B, C], [C, A]];
  const cached = shapes.map(types => ({types, q: w.cachedQuery(...types)}));
  const filterSets: ChangeFilter[][] = [[added(A)], [changed(B)], [added(A), changed(C)], [changed(A), changed(B)], []];
  const half = Math.floor((maxTick ?? Number.MAX_SAFE_INTEGER - 1) / 2);
  let overflowedSeen = 0;

  const someEntity = (): Entity => 1 + Math.floor(random() * (m.next + 1)); // includes dead and unborn ids
  const mutate = (): void => {
    const r = random();
    if (r < 0.2) {
      const values = TYPES.filter(() => random() < 0.5).map(
        t => [t, {n: Math.floor(random() * 100)}] as [ComponentType<Value>, Value],
      );
      const e = w.spawn(...values.map(([t, v]) => ({type: t, value: v})));
      assert.equal(e, m.spawn(values));
    } else if (r < 0.35) {
      const e = someEntity();
      w.despawn(e);
      m.despawn(e);
    } else if (r < 0.6) {
      const e = someEntity(),
        t = pick(TYPES),
        v = {n: Math.floor(random() * 100)};
      if (m.alive.has(e)) {
        w.add(e, {type: t, value: v});
        m.add(e, t, v);
      } else assert.throws(() => w.add(e, {type: t, value: v}), /does not exist/);
    } else if (r < 0.75) {
      const e = someEntity(),
        t = pick(TYPES);
      w.remove(e, t);
      m.remove(e, t);
    } else {
      const e = someEntity(),
        t = pick(TYPES);
      assert.equal(w.markChanged(e, t), m.markChanged(e, t));
    }
  };

  const checkCursor = (k: {c: ChangeCursor; seq: number}) => {
    if (k.c.overflowed) {
      overflowedSeen++;
      assert.ok(m.seq - k.seq > half, 'a cursor only overflows after more than half the tick range of changes');
    }
  };

  /** Iterate a world iterator in lockstep with the reference rules, mutating between rows. */
  const lockstep = (
    rows: Iterator<unknown[]>,
    types: readonly ComponentType<Value>[],
    filter: (e: Entity) => boolean,
  ): void => {
    const candidates = m.matching(types); // filters are checked when each entity is reached
    let visited = 0;
    let i = 0;
    for (;;) {
      // Reference: the next candidate that still matches (and passes the filter) when reached.
      let want: unknown[] | undefined;
      while (i < candidates.length) {
        const e = candidates[i++]!;
        if (m.matches(e, types) && filter(e)) {
          want = m.row(e, types);
          break;
        }
      }
      const got = rows.next();
      if (got.done) {
        assert.equal(want, undefined, 'the world iterator ended early');
        break;
      }
      assert.ok(want, `the world yielded entity ${String(got.value[0])} the reference skips`);
      assert.equal(got.value.length, want.length);
      got.value.forEach((v, j) => assert.equal(v, want![j]));
      if (random() < 0.5) mutate();
      if (random() < 0.5) mutate();
      if (++visited === 48) {
        rows.return?.(undefined); // a bounded pass (stopping early must also be safe)
        break;
      }
    }
  };

  for (let op = 0; op < operations; op++) {
    const r = random();
    if (r < 0.6) mutate();
    else if (r < 0.7) {
      for (const k of cursors)
        if (random() < k.rate) {
          checkCursor(k);
          k.c.advance();
          k.seq = m.seq;
        }
    } else if (r < 0.78) {
      const k = pick(cursors);
      checkCursor(k);
      const filters = pick(filterSets),
        types = pick(shapes);
      const want = m
        .matching(types)
        .filter(e => m.passes(e, filters, k.seq, k.c.overflowed))
        .map(e => m.row(e, types));
      const got = [...w.queryFiltered(k.c, filters, ...types)];
      assert.deepEqual(
        got.map(r => r[0]),
        want.map(r => r[0]),
      );
      got.forEach((row, j) => row.forEach((v, x) => assert.equal(v, want[j]![x])));
    } else if (r < 0.8) {
      // A cursor created now from the start sees every present tracked component, rebases or not.
      const fresh = w.changeCursor({fromStart: true});
      for (const types of shapes) {
        const filters = [added(types[0]!), changed(types[types.length - 1]!)];
        assert.deepEqual(
          [...w.queryFiltered(fresh, filters, ...types)].map(row => row[0]),
          m.matching(types),
        );
      }
      fresh.dispose();
    } else if (r < 0.84) {
      // Mutating while iterating: uncached, cached and filtered queries.
      const kind = Math.floor(random() * 3),
        types = pick(shapes);
      if (kind === 0) lockstep(w.query(...types)[Symbol.iterator](), types, () => true);
      else if (kind === 1) {
        const {q, types: cachedTypes} = pick(cached);
        lockstep(q[Symbol.iterator](), cachedTypes, () => true);
      } else {
        const k = pick(cursors),
          filters = pick(filterSets);
        checkCursor(k);
        const since = k.seq; // the cursor is not advanced mid-iteration; a rebase may overflow it (read live)
        lockstep(w.queryFiltered(k.c, filters, ...types), types, e => m.passes(e, filters, since, k.c.overflowed));
      }
    } else if (r < 0.92) {
      for (const {q, types} of cached) {
        const want = m.matching(types);
        assert.deepEqual(
          [...q].map(row => row[0]),
          want,
        );
        assert.equal(q.size, want.length);
      }
    } else {
      const report = w.flushObservers();
      assert.equal(report.dropped, 0);
      assert.equal(report.deferred, 0);
      assert.deepEqual(log.splice(0), m.events.splice(0));
    }
    assert.equal(w.version, m.version);
    assert.equal(w.count, m.alive.size);
  }
  w.flushObservers();
  assert.deepEqual(log, m.events);
  const stats = w.trackingStats();
  return {rebases: stats.rebases, overflowed: overflowedSeen};
}

test('model: change filters, observers and cached queries agree with a brute-force reference (seeded)', () => {
  for (const seed of [1, 2, 3, 0xbeef]) runModel(seed, 4000);
});

test('model: tick rebases keep filters exact for cursors in range and conservative for overflowed ones', () => {
  let rebases = 0,
    overflowed = 0;
  for (const seed of [11, 12, 13]) {
    const r = runModel(seed, 4000, 64);
    rebases += r.rebases;
    overflowed += r.overflowed;
  }
  assert.ok(rebases > 10, `rebases exercised (${rebases})`);
  assert.ok(overflowed > 0, `an overflowed cursor was exercised (${overflowed})`);
});

test('model: a world that never uses tracking matches the reference queries and version', () => {
  const random = rng(77);
  const w = new World();
  const m = new Model([]);
  for (let op = 0; op < 4000; op++) {
    const r = random(),
      e = 1 + Math.floor(random() * (m.next + 1)),
      t = TYPES[Math.floor(random() * 3)]!;
    if (r < 0.3) {
      const values = TYPES.filter(() => random() < 0.5).map(x => [x, {n: op}] as [ComponentType<Value>, Value]);
      w.spawn(...values.map(([x, v]) => ({type: x, value: v})));
      m.spawn(values);
    } else if (r < 0.45) {
      w.despawn(e);
      m.despawn(e);
    } else if (r < 0.7) {
      if (m.alive.has(e)) {
        const v = {n: op};
        w.add(e, {type: t, value: v});
        m.add(e, t, v);
      }
    } else if (r < 0.9) {
      w.remove(e, t);
      m.remove(e, t);
    } else {
      w.touch();
      m.version++;
    }
    assert.equal(w.version, m.version);
    if (op % 50 === 0)
      for (const types of [[A], [A, B], [B, C]])
        assert.deepEqual(
          [...w.query(...types)].map(row => row[0]),
          m.matching(types),
        );
  }
  assert.deepEqual(w.trackingStats(), {
    changeTick: 0,
    rebases: 0,
    cursorsOverflowed: 0,
    cursors: 0,
    observers: 0,
    queued: 0,
    delivered: 0,
    dropped: 0,
    observerErrors: 0,
    cachedQueries: 0,
  });
});
