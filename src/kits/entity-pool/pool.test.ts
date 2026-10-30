import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createEntityPool, createPoolResult, type EntityPoolLimits, type PoolClass} from './index';

const ids = (out: {evicted: Float64Array; count: number}) => Array.from(out.evicted.subarray(0, out.count));

test('validation refuses malformed limits, ids, classes and results before any change', () => {
  const ok: EntityPoolLimits = {maxMembers: 4, classes: {a: {priority: 1}}};
  assert.throws(() => createEntityPool({...ok, maxMembers: 0}), RangeError);
  assert.throws(() => createEntityPool({...ok, maxMembers: 1.5}), RangeError);
  assert.throws(() => createEntityPool({...ok, classes: {}}), RangeError);
  assert.throws(() => createEntityPool({...ok, classes: {a: {priority: -1}}}), RangeError);
  assert.throws(() => createEntityPool({...ok, classes: {a: {priority: 1, cost: 0}}}), RangeError);
  assert.throws(() => createEntityPool({...ok, classes: {a: {priority: 1, max: 5}}}), RangeError);
  assert.throws(() => createEntityPool({...ok, classes: {a: {priority: 1, order: 'random' as never}}}), RangeError);
  assert.throws(() => createEntityPool({...ok, classes: {a: {priority: 1, evictable: 1 as never}}}), TypeError);
  assert.throws(() => createEntityPool({...ok, maxEvictionsPerAdmit: 5}), RangeError);
  assert.throws(() => createEntityPool({...ok, maxCost: 0}), RangeError);
  const pool = createEntityPool(ok);
  const out = createPoolResult(ok);
  assert.throws(() => pool.admit(-1, 'a', out), RangeError);
  assert.throws(() => pool.admit(2 ** 53, 'a', out), RangeError);
  assert.throws(() => pool.admit(1, 'zzz', out), RangeError);
  assert.throws(() => pool.admit(1, 'a', {...out, evicted: new Float64Array(0)}), RangeError);
  assert.throws(() => pool.setScore(1, NaN), RangeError);
  assert.throws(() => pool.sweep(() => true, -1), RangeError);
  assert.equal(pool.size, 0);
});

test('expendable classes are evicted first, in deterministic order, and the result names each eviction', () => {
  const limits: EntityPoolLimits = {
    maxMembers: 6,
    classes: {
      spark: {priority: 0, evictable: true}, // oldest first
      debris: {priority: 1, evictable: true, order: 'newest'},
      enemy: {priority: 5},
    },
  };
  const pool = createEntityPool(limits),
    out = createPoolResult(limits);
  for (const id of [1, 2, 3]) assert.equal(pool.admit(id, 'spark', out), 'admitted');
  for (const id of [4, 5, 6]) assert.equal(pool.admit(id, 'debris', out), 'admitted');
  // Full. An enemy evicts sparks (lowest priority) oldest first.
  assert.equal(pool.admit(10, 'enemy', out), 'admitted');
  assert.deepEqual(ids(out), [1]);
  assert.deepEqual(out.evictedClass.slice(0, 1), ['spark']);
  pool.admit(11, 'enemy', out);
  pool.admit(12, 'enemy', out);
  assert.deepEqual(ids(out), [3]);
  // Sparks exhausted: debris goes next, newest first.
  pool.admit(13, 'enemy', out);
  assert.deepEqual(ids(out), [6]);
  // A spark cannot evict anything (no lower class) and the pool is full.
  assert.equal(pool.admit(20, 'spark', out), 'refused');
  assert.equal(out.reason, 'capacity');
  assert.equal(out.count, 0);
  // Debris can evict sparks, but there are none left, and debris does not replace its own.
  assert.equal(pool.admit(21, 'debris', out), 'refused');
  pool.admit(14, 'enemy', out);
  pool.admit(15, 'enemy', out);
  assert.deepEqual(ids(out), [4]);
  // Only enemies left: an enemy is not evictable, and the enemy class is at its (default) max.
  assert.equal(pool.admit(16, 'enemy', out), 'refused');
  assert.equal(out.reason, 'class-full');
  const s = pool.stats();
  assert.equal(s.members, 6);
  assert.deepEqual({...s.classes.spark}, {live: 0, pinned: 0, admitted: 3, evicted: 3, refused: 1, released: 0});
  assert.equal(s.classes.enemy!.refused, 1);
});

test('pins protect members; score order evicts the lowest score; replaceOwn recycles a full class', () => {
  const limits: EntityPoolLimits = {
    maxMembers: 8,
    classes: {
      crowd: {priority: 0, evictable: true, order: 'score'},
      shot: {priority: 3, max: 2, replaceOwn: true},
      boss: {priority: 9},
    },
  };
  const pool = createEntityPool(limits),
    out = createPoolResult(limits);
  for (let id = 1; id <= 6; id++) pool.admit(id, 'crowd', out);
  // Score = distance to the camera, negated so the farthest (lowest score) goes first.
  [5, 1, 9, 3, 7, 2].forEach((d, i) => pool.setScore(i + 1, -d));
  pool.pin(3, true); // farthest, but held
  pool.admit(100, 'shot', out);
  pool.admit(101, 'shot', out);
  assert.equal(pool.size, 8);
  pool.admit(200, 'boss', out);
  assert.deepEqual(ids(out), [5], 'the farthest unpinned crowd member (distance 7)');
  // The shot class is at max 2: a third shot replaces its own oldest, even though crowd members are lower.
  assert.equal(pool.admit(102, 'shot', out), 'admitted');
  assert.deepEqual(ids(out), [100]);
  assert.deepEqual(out.evictedClass.slice(0, 1), ['shot']);
  pool.pin(3, false);
  pool.admit(201, 'boss', out);
  assert.deepEqual(ids(out), [3], 'unpinned, it is the farthest again');
  // Without replaceOwn a full class is refused.
  const strict = createEntityPool({maxMembers: 4, classes: {a: {priority: 1, max: 1}}});
  const o2 = createPoolResult({maxMembers: 4});
  strict.admit(1, 'a', o2);
  assert.equal(strict.admit(2, 'a', o2), 'refused');
  assert.equal(o2.reason, 'class-full');
});

test('cost caps evict as many expendable members as the cost needs, atomically, within the eviction limit', () => {
  const limits: EntityPoolLimits = {
    maxMembers: 100,
    maxCost: 10,
    maxEvictionsPerAdmit: 3,
    classes: {
      small: {priority: 0, evictable: true, cost: 1},
      big: {priority: 5, cost: 4},
      huge: {priority: 6, cost: 8},
    },
  };
  const pool = createEntityPool(limits),
    out = createPoolResult(limits);
  for (let id = 1; id <= 10; id++) pool.admit(id, 'small', out);
  assert.equal(pool.cost, 10);
  assert.equal(pool.check('big', out), 'refused', 'four evictions exceed the per-admit limit of three');
  assert.equal(out.reason, 'eviction-limit');
  assert.equal(pool.admit(50, 'big', out), 'refused');
  assert.equal(out.reason, 'eviction-limit');
  assert.equal(pool.size, 10, 'a refused admission changes nothing');
  pool.release(1);
  assert.equal(pool.admit(50, 'big', out), 'admitted');
  assert.deepEqual(ids(out), [2, 3, 4]);
  assert.equal(pool.cost, 10);
  // A huge needs 8: only 6 small remain evictable -> capacity refusal, nothing evicted.
  assert.equal(pool.admit(60, 'huge', out), 'refused');
  assert.equal(pool.size, 7);
});

test('duplicates, release, sweep and dispose', () => {
  const limits: EntityPoolLimits = {maxMembers: 5, classes: {a: {priority: 0, evictable: true}}};
  const pool = createEntityPool(limits),
    out = createPoolResult(limits);
  for (let id = 1; id <= 5; id++) pool.admit(id, 'a', out);
  assert.equal(pool.admit(3, 'a', out), 'duplicate');
  assert.equal(pool.release(3), true);
  assert.equal(pool.release(3), false);
  assert.equal(pool.classOf(4), 'a');
  const dead = new Set([1, 5]);
  assert.equal(
    pool.sweep(id => !dead.has(id), 2),
    1,
    'two checks reach slots 0 and 1 (ids 1 and 2)',
  );
  assert.equal(
    pool.sweep(id => !dead.has(id), 10),
    1,
  );
  assert.equal(pool.size, 2);
  assert.equal(pool.stats().classes.a!.released, 3);
  pool.dispose();
  pool.dispose();
  assert.equal(pool.admit(9, 'a', out), 'closed');
  assert.equal(pool.size, 0);
  assert.equal(pool.has(2), false);
  assert.equal(pool.release(2), false);
  assert.equal(pool.stats().closed, true);
});

test('review: a cheap class is not emptied when a later class must give a member anyway', () => {
  const limits: EntityPoolLimits = {
    maxMembers: 100,
    maxCost: 150,
    classes: {
      spark: {priority: 0, evictable: true},
      debris: {priority: 1, evictable: true, cost: 100},
      boss: {priority: 9, cost: 100},
    },
  };
  const pool = createEntityPool(limits),
    out = createPoolResult(limits);
  for (let id = 1; id <= 50; id++) pool.admit(id, 'spark', out);
  pool.admit(99, 'debris', out);
  assert.equal(pool.admit(200, 'boss', out), 'admitted', 'one eviction fits the default limit of 16');
  assert.deepEqual(ids(out), [99]);
  assert.equal(pool.stats().classes.spark!.live, 50);
  // A mix: 30 sparks + 1 debris give 130; a 60-cost request needs 40 -> one debris; then sparks return.
  const p2 = createEntityPool({...limits, classes: {...limits.classes, mid: {priority: 5, cost: 60}}});
  for (let id = 1; id <= 30; id++) p2.admit(id, 'spark', out);
  p2.admit(99, 'debris', out);
  p2.admit(300, 'mid', out);
  assert.deepEqual(ids(out), [99]);
});

test('review: sweep tolerates re-entrant callbacks and bounds its work', () => {
  const limits: EntityPoolLimits = {maxMembers: 4, classes: {a: {priority: 0, evictable: true}}};
  const out = createPoolResult(limits);
  const p = createEntityPool(limits);
  p.admit(1, 'a', out);
  p.admit(2, 'a', out);
  assert.equal(
    p.sweep(id => (id === 1 ? (p.release(1), false) : true), 1),
    0,
    'already released by the callback',
  );
  assert.equal(p.size, 1);
  assert.equal(p.has(2), true);
  assert.equal(p.stats().classes.a!.released, 1);
  assert.equal(p.stats().classes.a!.pinned, 0);
  const q = createEntityPool(limits);
  q.admit(1, 'a', out);
  assert.equal(
    q.sweep(id => (q.release(id), q.admit(9, 'a', out), false), 1),
    0,
  );
  assert.equal(q.has(9), true, 'a member admitted during the callback survives');
  const same = createEntityPool(limits);
  same.admit(5, 'a', out);
  same.sweep(id => (same.release(id), same.admit(id, 'a', out), false), 1);
  assert.equal(same.has(5), true, 'a release and re-admission of the same id inside the callback is kept');
  const r = createEntityPool(limits);
  r.admit(1, 'a', out);
  r.admit(2, 'a', out);
  const seen: number[] = [];
  r.sweep(id => (seen.push(id), r.dispose(), true), 10);
  assert.deepEqual(seen, [1], 'dispose inside the callback stops the sweep');
  const big = createEntityPool({maxMembers: 1 << 16, classes: {a: {priority: 0}}});
  big.admit(7, 'a', createPoolResult({maxMembers: 1 << 16}));
  let calls = 0;
  big.sweep(() => (calls++, true), 2000);
  assert.equal(calls, 1, 'each member is checked at most once per sweep');
  assert.throws(() => createEntityPool({maxMembers: 4, maxCost: 3, classes: {a: {priority: 0, cost: 4}}}), RangeError);
  assert.throws(
    () => createEntityPool({maxMembers: 4, classes: JSON.parse('{"__proto__": {"priority": 0}}')}),
    RangeError,
  );
});

// ---- Independent model: one victim at a time over plain arrays. ----

interface MMember {
  id: number;
  cls: string;
  seq: number;
  score: number;
  pinned: boolean;
}

function modelAdmit(
  members: MMember[],
  defs: Record<string, PoolClass>,
  names: string[],
  limits: {maxMembers: number; maxCost: number; maxEvict: number},
  id: number,
  cls: string,
  seq: number,
): {status: string; reason: string; evicted: number[]} {
  if (members.some(m => m.id === id)) return {status: 'duplicate', reason: 'none', evicted: []};
  const c = defs[cls]!;
  const costOf = (n: string) => defs[n]!.cost ?? 1;
  const cand = members.slice();
  const evicted: number[] = [];
  const firstOf = (n: string) => {
    const pool = cand.filter(m => m.cls === n && !m.pinned);
    const ord = defs[n]!.order ?? 'oldest';
    pool.sort((a, b) =>
      ord === 'score' && a.score !== b.score ? a.score - b.score : ord === 'newest' ? b.seq - a.seq : a.seq - b.seq,
    );
    return pool[0];
  };
  const victimsOrder = names
    .filter(n => defs[n]!.evictable && defs[n]!.priority < c.priority)
    .sort((a, b) => defs[a]!.priority - defs[b]!.priority || names.indexOf(a) - names.indexOf(b));
  if (c.replaceOwn) victimsOrder.push(cls);
  const removed: MMember[] = [];
  const remove = (m: MMember) => {
    cand.splice(cand.indexOf(m), 1);
    removed.push(m);
  };
  const fits = () =>
    cand.filter(m => m.cls === cls).length + 1 <= (c.max ?? limits.maxMembers) &&
    cand.length + 1 <= limits.maxMembers &&
    cand.reduce((s, m) => s + costOf(m.cls), 0) + costOf(cls) <= limits.maxCost;
  for (;;) {
    const classCount = cand.filter(m => m.cls === cls).length;
    if (classCount + 1 > (c.max ?? limits.maxMembers)) {
      const v = c.replaceOwn ? firstOf(cls) : undefined;
      if (!v) return {status: 'refused', reason: 'class-full', evicted: []};
      remove(v);
      continue;
    }
    const cost = cand.reduce((s, m) => s + costOf(m.cls), 0);
    if (cand.length + 1 <= limits.maxMembers && cost + costOf(cls) <= limits.maxCost) break;
    let v: MMember | undefined;
    for (const n of victimsOrder) if ((v = firstOf(n))) break;
    if (!v) return {status: 'refused', reason: 'capacity', evicted: []};
    remove(v);
  }
  // Give back, latest evicted first, every victim whose return still leaves room.
  for (let i = removed.length - 1; i >= 0; i--) {
    cand.push(removed[i]!);
    if (fits()) removed.splice(i, 1);
    else cand.pop();
  }
  evicted.push(...removed.map(m => m.id));
  if (evicted.length > limits.maxEvict) return {status: 'refused', reason: 'eviction-limit', evicted: []};
  members.length = 0;
  members.push(...cand, {id, cls, seq, score: 0, pinned: false});
  return {status: 'admitted', reason: 'none', evicted};
}

test('a 6,000-operation randomized run matches an independent one-victim-at-a-time model with give-back', () => {
  let state = 0x9e3779b9;
  const rnd = () => (state = (Math.imul(state ^ (state >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0) / 2 ** 32;
  const seen = {admitted: 0, evicted: 0, refused: new Set<string>()};
  for (let trial = 0; trial < 6; trial++) {
    const defs: Record<string, PoolClass> = {
      fx: {priority: 0, evictable: true, cost: 1, order: 'oldest'},
      prop: {priority: 2, evictable: true, cost: 2, order: 'score', max: 6},
      critter: {priority: 2, evictable: true, cost: 1, order: 'newest', replaceOwn: true, max: 5},
      npc: {priority: 4, cost: 3, max: 4, replaceOwn: trial % 2 === 0, evictable: trial % 3 === 0},
      hero: {priority: 9, cost: 2},
    };
    const names = Object.keys(defs);
    const maxMembers = 10 + trial,
      maxCost = 16 + trial * 2,
      maxEvict = 2 + (trial % 3);
    const limits: EntityPoolLimits = {maxMembers, maxCost, maxEvictionsPerAdmit: maxEvict, classes: defs};
    const pool = createEntityPool(limits),
      out = createPoolResult(limits);
    const model: MMember[] = [];
    let seq = 0;
    for (let step = 0; step < 1000; step++) {
      const r = rnd();
      const id = Math.floor(rnd() * 40);
      if (r < 0.55) {
        const cls = names[Math.floor(rnd() * names.length)]!;
        const want = modelAdmit(model, defs, names, {maxMembers, maxCost, maxEvict}, id, cls, seq);
        const got = pool.admit(id, cls, out);
        if (got === 'admitted') (seq++, (seen.admitted++, (seen.evicted += out.count)));
        if (got === 'refused') seen.refused.add(out.reason);
        assert.equal(got, want.status, `trial ${trial} step ${step} status`);
        assert.equal(out.reason, want.reason, `trial ${trial} step ${step} reason`);
        assert.deepEqual(ids(out), want.evicted, `trial ${trial} step ${step} evicted`);
        if (r < 0.1) {
          // check() agrees with the admission outcome on a fresh id.
          const probe = modelAdmit(model.slice(), defs, names, {maxMembers, maxCost, maxEvict}, 1000, cls, seq);
          pool.check(cls, out);
          assert.equal(out.status, probe.status);
          assert.equal(out.count, probe.evicted.length);
        }
      } else if (r < 0.7) {
        const m = model.find(x => x.id === id);
        assert.equal(pool.release(id), !!m);
        if (m) model.splice(model.indexOf(m), 1);
      } else if (r < 0.85) {
        const m = model.find(x => x.id === id);
        const score = Math.floor(rnd() * 5) - 2;
        assert.equal(pool.setScore(id, score), !!m);
        if (m) m.score = score;
      } else {
        const m = model.find(x => x.id === id);
        const p = rnd() < 0.5;
        assert.equal(pool.pin(id, p), !!m);
        if (m) m.pinned = p;
      }
      assert.equal(pool.size, model.length);
      assert.equal(
        pool.cost,
        model.reduce((s, m) => s + (defs[m.cls]!.cost ?? 1), 0),
      );
      for (const m of model) assert.equal(pool.classOf(m.id), m.cls);
    }
  }
  assert.ok(seen.admitted > 600 && seen.evicted > 300, `coverage: ${seen.admitted} admitted, ${seen.evicted} evicted`);
  assert.deepEqual([...seen.refused].sort(), ['capacity', 'class-full', 'eviction-limit']);
});
