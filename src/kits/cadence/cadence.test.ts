import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mulberry32} from '../../core/rng';
import {createCadence, createCadenceResult, type CadenceLimits, type CadenceTakeResult} from './index';

const limits: CadenceLimits = {maxMembers: 8, maxDuePerTake: 8, maxPeriod: 100};
function setup(o: Partial<CadenceLimits> = {}) {
  const l = {...limits, ...o};
  return {cad: createCadence(l), out: createCadenceResult(l)};
}
const ids = (r: CadenceTakeResult) => [...r.ids.subarray(0, r.count)];
const col = (b: Float64Array, r: CadenceTakeResult) => [...b.subarray(0, r.count)];

test('limits and inputs are validated before any change', () => {
  assert.throws(() => createCadence({...limits, maxMembers: 0}), RangeError);
  assert.throws(() => createCadence({...limits, maxDuePerTake: 9}), RangeError);
  assert.throws(() => createCadence({...limits, maxPeriod: 2 ** 31}), RangeError);
  assert.throws(() => createCadence({...limits, x: 1} as CadenceLimits), /unknown limit 'x'/);
  assert.throws(() => createCadenceResult({maxDuePerTake: 0}), RangeError);
  const {cad, out} = setup();
  assert.throws(() => cad.add(-1, 2), TypeError);
  assert.throws(() => cad.add(1, 0), RangeError);
  assert.throws(() => cad.add(1, 101), RangeError);
  assert.throws(() => cad.add(1, 4, 4), RangeError);
  assert.throws(() => cad.take(1.5, out), RangeError);
  assert.throws(() => cad.take(1, createCadenceResult({maxDuePerTake: 2})), TypeError);
  assert.throws(() => cad.take(1, Object.freeze({...out})), TypeError);
  assert.equal(cad.stats.members, 0);
  cad.take(5, out);
  assert.throws(() => cad.take(4, out), /before the previous tick/);
});

test('members run at their own period, spread by id, on a stable phase grid', () => {
  const {cad, out} = setup();
  cad.add(0, 4); // offset 0 -> first due 4
  cad.add(1, 4); // first due 1
  cad.add(2, 2); // offset 0 -> first due 2
  const seen: number[][] = [];
  for (let t = 1; t <= 8; t++) seen.push(ids(cad.take(t, out)));
  assert.deepEqual(seen, [[1], [2], [], [0, 2], [1], [2], [], [0, 2]]);
  assert.equal(out.status, 'complete');
});

test('explicit phase; elapsed and lateness; skipped occurrences are not replayed', () => {
  const {cad, out} = setup();
  cad.add(9, 10, 3);
  assert.deepEqual(ids(cad.take(2, out)), []);
  cad.take(3, out);
  assert.deepEqual(ids(out), [9]);
  assert.deepEqual(col(out.elapsed, out), [3]);
  assert.deepEqual(col(out.late, out), [0]);
  // Next due 13; skip ahead to 37: one serve, late 24, next due on the grid (43), never a burst.
  cad.take(37, out);
  assert.deepEqual(ids(out), [9]);
  assert.deepEqual(col(out.elapsed, out), [34]);
  assert.deepEqual(col(out.late, out), [24]);
  assert.deepEqual(ids(cad.take(42, out)), []);
  assert.deepEqual(ids(cad.take(43, out)), [9]);
});

test('the per-take budget defers the least overdue members, which stay due', () => {
  const {cad, out} = setup({maxDuePerTake: 2});
  for (let id = 0; id < 5; id++) cad.add(id, 10, id % 3); // phases 0(->10),1,2,0(->10),1
  cad.take(10, out);
  assert.deepEqual(ids(out), [1, 4], 'earliest due first, ties by id');
  assert.equal(out.status, 'deferred');
  cad.take(10, out);
  assert.deepEqual(ids(out), [2, 0]);
  cad.take(10, out);
  assert.deepEqual(ids(out), [3]);
  assert.equal(out.status, 'complete');
  assert.deepEqual(col(out.late, out), [0]);
  // Members keep their own phase grids: 1 and 4 (phase 1) are next due at 11, 2 (phase 2) at 12, 0 and 3 at 20.
  assert.deepEqual(ids(cad.take(11, out)), [1, 4]);
  assert.deepEqual(ids(cad.take(12, out)), [2]);
  assert.deepEqual(ids(cad.take(19, out)), []);
});

test('setPeriod, remove, saturation and disposal', () => {
  const {cad, out} = setup({maxMembers: 2, maxDuePerTake: 2});
  assert.equal(cad.add(5, 10, 9), 'added');
  assert.equal(cad.add(5, 10), 'duplicate');
  assert.equal(cad.add(6, 3), 'added');
  assert.equal(cad.add(7, 3), 'saturated');
  cad.take(4, out);
  assert.deepEqual(ids(out), [6]);
  assert.equal(cad.setPeriod(5, 2), 'set', 'tick 1 (after last 0, odd) has passed: the next odd tick after 4');
  assert.deepEqual(ids(cad.take(4, out)), []);
  cad.take(5, out);
  assert.deepEqual(ids(out), [5]);
  assert.deepEqual(col(out.late, out), [0]);
  assert.equal(cad.setPeriod(8, 2), 'absent');
  assert.equal(cad.remove(6), 'removed');
  assert.equal(cad.remove(6), 'absent');
  assert.equal(cad.has(6), false);
  assert.equal(cad.add(7, 3), 'added', 'the freed slot is reused');
  cad.dispose();
  cad.dispose();
  assert.equal(cad.take(9, out).status, 'closed');
  assert.equal(out.count, 0);
  assert.equal(cad.add(1, 2), 'closed');
  assert.equal(cad.has(5), false);
});

test('snapshot and restore continue the exact schedule; malformed snapshots change nothing', () => {
  const a = setup(),
    b = setup();
  a.cad.add(3, 7);
  a.cad.add(4, 5, 2);
  a.cad.take(6, a.out);
  const json = JSON.stringify(a.cad.snapshot());
  assert.equal(b.cad.restore(JSON.parse(json)), 'restored');
  for (let t = 7; t < 40; t++) {
    a.cad.take(t, a.out);
    b.cad.take(t, b.out);
    assert.deepEqual(ids(b.out), ids(a.out));
    assert.deepEqual(col(b.out.elapsed, b.out), col(a.out.elapsed, a.out));
  }
  const c = setup();
  c.cad.add(1, 2);
  for (const bad of [
    {now: -1, members: []},
    {now: 5, members: [{id: 1, period: 2, due: 6, last: 6, phase: 0}]},
    {now: 5, members: [{id: 1, period: 2, due: 3, last: 4, phase: 0}]},
    {now: 5, members: [{id: 1, period: 101, due: 6, last: 4, phase: 0}]},
    {
      now: 5,
      members: [
        {id: 1, period: 2, due: 6, last: 4},
        {id: 1, period: 2, due: 6, last: 4},
      ],
    },
    {now: 5, members: Array.from({length: 9}, (_, id) => ({id, period: 2, due: 6, last: 4, phase: 0}))},
    {now: 5, members: [{id: 1, period: 2, due: 1e15, last: 0, phase: 0}]},
  ])
    assert.throws(() => c.cad.restore(bad as never));
  assert.equal(c.cad.has(1), true, 'refused restores keep the old state');
});

/** Independent reference: scan every member at every tick. */
test('a 4,000-step randomised run matches a brute-force scan model', () => {
  const l: CadenceLimits = {maxMembers: 24, maxDuePerTake: 5, maxPeriod: 17};
  const cad = createCadence(l),
    out = createCadenceResult(l);
  type M = {period: number; key: number; due: number; last: number};
  // Spec by enumeration: the first tick after t congruent to key mod period.
  const grid = (t: number, period: number, key: number) => {
    let u = t + 1;
    while (u % period !== key % period) u++;
    return u;
  };
  const ref = new Map<number, M>();
  let now = 0;
  const rand = mulberry32(42);
  for (let step = 0; step < 4000; step++) {
    const op = rand(),
      id = Math.floor(rand() * 40);
    if (op < 0.2) {
      const period = 1 + Math.floor(rand() * l.maxPeriod);
      const phase = rand() < 0.5 ? Math.floor(rand() * period) : undefined;
      const r = cad.add(id, period, phase);
      if (r === 'added') {
        const key = phase ?? id;
        ref.set(id, {period, key, due: grid(now, period, key), last: now});
      } else assert.equal(r, ref.has(id) ? 'duplicate' : 'saturated');
    } else if (op < 0.3) {
      assert.equal(cad.remove(id), ref.delete(id) ? 'removed' : 'absent');
    } else if (op < 0.38) {
      const period = 1 + Math.floor(rand() * l.maxPeriod);
      const m = ref.get(id);
      assert.equal(cad.setPeriod(id, period), m ? 'set' : 'absent');
      if (m && m.period !== period) {
        m.period = period;
        if (m.due > now) {
          const next = grid(m.last, period, m.key);
          m.due = next > now ? next : grid(now, period, m.key);
        }
      }
    } else {
      now += rand() < 0.05 ? 20 + Math.floor(rand() * 60) : Math.floor(rand() * 4);
      cad.take(now, out);
      const due = [...ref.entries()].filter(([, m]) => m.due <= now).sort((x, y) => x[1].due - y[1].due || x[0] - y[0]);
      const served = due.slice(0, l.maxDuePerTake);
      assert.deepEqual(
        ids(out),
        served.map(([i]) => i),
        `step ${step}`,
      );
      assert.deepEqual(
        col(out.elapsed, out),
        served.map(([, m]) => now - m.last),
      );
      assert.deepEqual(
        col(out.late, out),
        served.map(([, m]) => now - m.due),
      );
      assert.equal(out.status, due.length > served.length ? 'deferred' : 'complete');
      for (const [, m] of served) {
        m.last = now;
        m.due = grid(now, m.period, m.key);
      }
      if (step % 500 === 0) {
        // Mid-run snapshot round trip through JSON must be invisible.
        const copy = createCadence(l);
        copy.restore(JSON.parse(JSON.stringify(cad.snapshot())));
        assert.deepEqual(copy.snapshot(), cad.snapshot());
      }
    }
  }
});

test('period changes keep the phase spread; the same period is a no-op; aliasing is refused', () => {
  const {cad, out} = setup();
  for (let id = 0; id < 8; id++) cad.add(id, 8);
  for (let id = 0; id < 8; id++) cad.setPeriod(id, 8);
  const counts: number[] = [];
  for (let t = 1; t <= 16; t++) counts.push(cad.take(t, out).count);
  assert.deepEqual(counts, Array(16).fill(1), 'one member per tick, unchanged');
  for (let id = 0; id < 8; id++) cad.setPeriod(id, 4); // a whole population changes band at once
  const after: number[] = [];
  for (let t = 17; t <= 24; t++) after.push(cad.take(t, out).count);
  assert.deepEqual(after, Array(8).fill(2), 'still spread: two per tick at period 4');
  const aliased = {...out, late: out.ids};
  assert.throws(() => cad.take(25, aliased), /must not share memory/);
  assert.throws(() => cad.take(Number.MAX_SAFE_INTEGER, out), RangeError);
});
