import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createVisibility, type VisibilitySource} from './index';

const make = () => createVisibility({cellCount: 8, maxSources: 3, maxCellsPerSource: 4, maxDrain: 2});
type Ledger = ReturnType<typeof make>;
function add(v: Ledger) {
  const result = v.addSource();
  if (result.status !== 'added') throw Error(result.status);
  return result.source;
}
function begin(v: Ledger, source: VisibilitySource) {
  const result = v.begin(source);
  if (result.status !== 'prepared') throw Error(result.status);
  return result.ticket;
}
function put(v: Ledger, source: VisibilitySource, cells: number[]) {
  assert.equal(v.replace(begin(v, source), cells), 'replaced');
}
function state(v: Ledger) {
  return Array.from({length: v.limits.cellCount}, (_, i) => v.cell(i));
}

test('overlapping source removal conserves coverage and separately retains exploration', () => {
  const v = make(),
    a = add(v),
    b = add(v);
  put(v, a, [0, 1]);
  put(v, b, [1, 2]);
  v.removeSource(a);
  assert.deepEqual(v.cell(0), {cell: 0, visible: false, explored: true});
  assert.equal(v.cell(1)?.visible, true);
  v.removeSource(b);
  assert.equal(v.cell(1)?.visible, false);
  v.resetExploration();
  assert.ok(state(v).every(cell => !cell?.visible && !cell?.explored));
});

test('new calculations revoke older results; rejection preserves the new ticket and accepted cells', () => {
  const v = make(),
    a = add(v);
  put(v, a, [0]);
  const old = begin(v, a),
    next = begin(v, a),
    before = state(v);
  assert.equal(v.replace(old, [1]), 'stale');
  assert.throws(() => v.replace(next, [2, 3, 8]));
  assert.deepEqual(state(v), before);
  assert.equal(v.replace(next, [1, 2, 3, 4, 5]), 'saturated');
  assert.throws(() => v.replace(next, [2, 2]));
  assert.equal(v.replace({...next}, [2]), 'stale');
  assert.equal(v.replace(next, [2]), 'replaced');
  assert.equal(v.replace(next, [3]), 'stale');
  assert.equal(v.cell(0)?.visible, false);
});

test('cancel, remove, independent observers and disposal retire exact authority', () => {
  const v = make(),
    other = make(),
    a = add(v),
    ticket = begin(v, a);
  assert.equal(other.replace(ticket, [0]), 'stale');
  assert.equal(v.cancel(ticket), 'cancelled');
  assert.equal(v.replace(ticket, [0]), 'stale');
  const later = begin(v, a);
  v.removeSource(a);
  const replacement = add(v);
  assert.notEqual(replacement.generation, a.generation);
  assert.equal(v.replace(later, [0]), 'stale');
  assert.equal(v.begin(a).status, 'stale');
  put(v, replacement, [0]);
  assert.equal(other.cell(0)?.visible, false);
  v.dispose();
  v.dispose();
  assert.deepEqual(v.stats, {sources: 0, calculations: 0, pending: 0, closed: true});
  assert.equal(v.cell(0), undefined);
  assert.equal(v.addSource().status, 'closed');
  assert.equal(v.resetExploration(), 'closed');
  assert.deepEqual(v.drain(), []);
});

test('dirty drain is bounded, coalesced current state and safe across wraparound', () => {
  const v = make(),
    a = add(v);
  put(v, a, [0, 1, 2, 3]);
  assert.equal(v.stats.pending, 4);
  assert.deepEqual(
    v.drain().map(c => c.cell),
    [0, 1],
  );
  put(v, a, [4, 5, 6, 7]);
  assert.equal(v.stats.pending, 8);
  assert.equal(v.drain(1)[0]?.visible, false);
  put(v, a, [2, 4, 5]);
  const seen = [];
  while (v.stats.pending) seen.push(...v.drain());
  assert.equal(new Set(seen.map(c => c.cell)).size, seen.length);
  for (const cell of seen) assert.deepEqual(cell, v.cell(cell.cell));
  assert.deepEqual(v.drain(), []);
  put(v, a, [5, 4, 2]);
  assert.equal(v.stats.pending, 0, 'permuting identical coverage is not a state change');
  assert.throws(() => v.drain(3));
});

test('bounded admission captures data without calling array iterators or accessors', () => {
  const options = {cellCount: 8, maxSources: 1, maxCellsPerSource: 4, maxDrain: 2};
  const v = createVisibility(options),
    a = add(v);
  options.maxSources = 100;
  assert.equal(v.addSource().status, 'saturated');
  const cells = [0, 1];
  Object.defineProperty(cells, Symbol.iterator, {
    value: () => {
      throw Error('iterator');
    },
  });
  put(v, a, cells);
  cells[0] = 7;
  assert.equal(v.cell(0)?.visible, true);
  const ticket = begin(v, a),
    bad = [2];
  Object.defineProperty(bad, '0', {
    get: () => {
      throw Error('executed');
    },
  });
  assert.throws(() => v.replace(ticket, bad), /invalid cell data/);
  assert.throws(() => v.replace(ticket, Array(2)), /invalid cell data/);
  assert.equal(v.replace(ticket, [2]), 'replaced');
  for (const bad of [NaN, Infinity, -1, 0, 1.5, 2 ** 30])
    assert.throws(() => createVisibility({...options, cellCount: bad}));
  assert.throws(() => createVisibility({cellCount: 1 << 20, maxSources: 4096, maxCellsPerSource: 4096, maxDrain: 1}));
});

test('reset exploration preserves currently visible cells without losing their removal history', () => {
  const v = make(),
    a = add(v);
  put(v, a, [0, 1]);
  put(v, a, [1]);
  v.resetExploration();
  assert.equal(v.cell(0)?.explored, false);
  assert.equal(v.cell(1)?.explored, true);
  put(v, a, []);
  assert.equal(v.cell(1)?.explored, true);
});

test('600 bounded commands agree with independent set-union/history and consumer mirror', () => {
  const v = make(),
    handles = [add(v), add(v), add(v)];
  const sets = [new Set<number>(), new Set<number>(), new Set<number>()],
    history = new Set<number>();
  const mirror = state(v);
  for (let n = 0; n < 600; n++) {
    const source = n % 3;
    const cells = [...new Set([n % 8, (n * 3 + 1) % 8, (n * 5 + 2) % 8])];
    if (n % 7 === 0) cells.length = 0;
    sets[source] = new Set(cells);
    put(v, handles[source]!, cells);
    cells.forEach(c => history.add(c));
    const union = new Set(sets.flatMap(s => [...s]));
    if (n % 11 === 0) {
      v.resetExploration();
      history.clear();
      union.forEach(c => history.add(c));
    }
    for (let cell = 0; cell < 8; cell++)
      assert.deepEqual(v.cell(cell), {cell, visible: union.has(cell), explored: history.has(cell)});
    for (const changed of v.drain()) mirror[changed.cell] = changed;
    if (n % 13 === 0) {
      while (v.stats.pending) for (const changed of v.drain()) mirror[changed.cell] = changed;
      assert.deepEqual(mirror, state(v));
    }
    assert.ok(v.stats.pending <= 8);
  }
});
