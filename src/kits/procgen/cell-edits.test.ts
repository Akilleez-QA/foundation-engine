import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveSeed } from '../../core/rng';
import { createFakeIdb } from '../../core/save/fake-idb';
import { openChunkStore } from '../../core/save/chunk-store';
import { cellularGridJob } from './cellular';
import { createCellEdits, decodeCellEdits } from './cell-edits';
import type { GridRecipe } from './grid-job';

const recipeAt = (root: number, cx: number, cz: number): GridRecipe => ({ formatVersion: 1, generatorVersion: 1, id: `region:${cx},${cz}`, revision: 1, seed: deriveSeed(root, 'region', cx, cz), cellsX: 32, cellsY: 2, cellsZ: 32, parameters: '[0.45,4,5,4]' });

test('GEN-02 edits over a regenerated grid survive store, reopen and regeneration exactly', async () => {
  const fake = createFakeIdb();
  const store = await openChunkStore({ name: 'world', schema: 1, factory: fake.factory });
  const baseline = cellularGridJob.generateNow(recipeAt(7, 3, -2));
  const edits = createCellEdits(baseline);
  const expected = baseline.values.slice();
  const changes: [number, number, number, number][] = [[0, 0, 0, 1 - baseline.get(0, 0, 0)], [31, 1, 31, 1 - baseline.get(31, 1, 31)], [5, 1, 9, 1 - baseline.get(5, 1, 9)]];
  for (const [x, y, z, v] of changes) { assert.equal(edits.set(x, y, z, v), 'changed'); expected[(y * 32 + z) * 32 + x] = v; }
  assert.equal(edits.set(5, 1, 9, 1 - baseline.get(5, 1, 9)), 'unchanged');
  assert.equal(edits.size, 3); assert.equal(edits.revision, 3); assert.equal(edits.dirty, true);
  assert.equal((await store.write([{ key: 'region:3,-2', revision: edits.revision, data: edits.encode() }])).status, 'saved');
  edits.markSaved(3); assert.equal(edits.dirty, false);
  store.close();
  // a later session: regenerate the baseline from the same root, load the stored delta
  const reopened = await openChunkStore({ name: 'world', schema: 1, factory: fake.factory });
  const stored = await reopened.read('region:3,-2');
  assert.equal(stored.status, 'found');
  if (stored.status !== 'found') return;
  const again = createCellEdits(cellularGridJob.generateNow(recipeAt(7, 3, -2)), { saved: stored.data, revision: stored.revision });
  assert.deepEqual([...again.materialize()], [...expected]);
  assert.equal(again.revision, 3); assert.equal(again.dirty, false);
  // unedited neighbours need no record at all
  assert.deepEqual(await reopened.read('region:4,-2'), { status: 'missing' });
  reopened.close();
});

test('GEN-02 edits back to the baseline disappear and the encoding is canonical and compact', () => {
  const baseline = { cellsX: 300, cellsY: 1, cellsZ: 300, values: new Uint16Array(90000) };
  const a = createCellEdits(baseline), b = createCellEdits(baseline);
  a.set(5, 0, 0, 9); a.set(299, 0, 299, 65535); a.set(7, 0, 0, 3); a.set(7, 0, 0, 0);
  b.set(299, 0, 299, 65535); b.set(5, 0, 0, 9);
  assert.equal(a.size, 2);
  assert.deepEqual([...a.encode()], [...b.encode()], 'insertion order does not change the bytes');
  assert.equal(a.encode().length, 12 + (1 + 2) + (3 + 2));
  const decoded = decodeCellEdits(a.encode(), 90000);
  assert.deepEqual([...decoded], [[5, 9], [89999, 65535]]);
  // stored edits equal to a (changed) baseline are dropped on load
  const moved = { ...baseline, values: baseline.values.slice() }; moved.values[5] = 9;
  assert.equal(createCellEdits(moved, { saved: a.encode() }).size, 1);
});

test('GEN-02 the edit bound refuses new cells without losing existing edits', () => {
  const edits = createCellEdits({ cellsX: 4, cellsY: 1, cellsZ: 4, values: new Uint16Array(16) }, { limits: { maxEdits: 2, maxValue: 3 } });
  assert.equal(edits.set(0, 0, 0, 1), 'changed'); assert.equal(edits.set(1, 0, 0, 1), 'changed');
  assert.equal(edits.set(2, 0, 0, 1), 'full'); assert.equal(edits.revision, 2);
  assert.equal(edits.set(1, 0, 0, 2), 'changed', 'existing cells can still change');
  assert.equal(edits.set(1, 0, 0, 0), 'changed'); assert.equal(edits.set(2, 0, 0, 1), 'changed', 'reverting frees a slot');
  assert.throws(() => edits.set(0, 0, 0, 4), /out of range/);
  assert.throws(() => edits.set(4, 0, 0, 1), /outside grid/);
  assert.throws(() => createCellEdits({ cellsX: 2, cellsY: 1, cellsZ: 2, values: new Uint16Array(3) }), /invalid baseline/);
});

test('GEN-02 malformed or mismatched edit encodings are refused, never partially applied', () => {
  const good = createCellEdits({ cellsX: 8, cellsY: 1, cellsZ: 8, values: new Uint16Array(64) });
  good.set(1, 0, 0, 5); good.set(3, 0, 2, 6);
  const bytes = good.encode();
  const mutate = (fn: (b: Uint8Array) => Uint8Array) => fn(bytes.slice());
  const cases: [string, Uint8Array, number?][] = [
    ['magic', mutate(b => { b[0] = 0; return b; })],
    ['format', mutate(b => { b[3] = 2; return b; })],
    ['grid size', bytes, 65],
    ['count', mutate(b => { b[8] = 3; return b; })],
    ['truncated', bytes.subarray(0, bytes.length - 1)],
    ['trailing', new Uint8Array([...bytes, 0])],
    ['zero delta', mutate(b => { b[15] = 0; return b; })],
    ['range', mutate(b => { b[15] = 100; return b; })],
    ['header', bytes.subarray(0, 5)],
  ];
  for (const [why, b, cells] of cases) assert.throws(() => decodeCellEdits(b, cells ?? 64), Error, why);
  assert.throws(() => decodeCellEdits(bytes, 64, { maxValue: 5 }), /value out of range/);
  assert.throws(() => decodeCellEdits(bytes, 64, { maxEdits: 1 }), /too many/);
  assert.throws(() => createCellEdits({ cellsX: 8, cellsY: 1, cellsZ: 8, values: new Uint16Array(64) }, { saved: cases[0]![1] }));
});
