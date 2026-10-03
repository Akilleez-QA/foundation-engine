import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveSeed } from '../../core/rng';
import { createFakeIdb } from '../../core/save/fake-idb';
import { openChunkStore } from '../../core/save/chunk-store';
import { cellularGridJob } from './cellular';
import { baselineChecksum, createCellEdits, decodeCellEdits } from './cell-edits';
import { GRID_MAX_CELLS } from './grid-job';
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
  assert.equal(a.encode().length, 24 + (1 + 2) + (3 + 2));
  const decoded = decodeCellEdits(a.encode(), baseline, {}, baselineChecksum(baseline.values));
  assert.deepEqual([...decoded], [[5, 9], [89999, 65535]]);
  // edits are bound to the baseline they were made against
  const moved = { ...baseline, values: baseline.values.slice() }; moved.values[5] = 9;
  assert.throws(() => createCellEdits(moved, { saved: a.encode() }), /baseline mismatch/);
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
  const dims = { cellsX: 8, cellsY: 1, cellsZ: 8 };
  const cases: [string, Uint8Array, typeof dims?][] = [
    ['magic', mutate(b => { b[0] = 0; return b; })],
    ['format', mutate(b => { b[3] = 2; return b; })],
    ['grid dimensions', bytes, { cellsX: 4, cellsY: 1, cellsZ: 16 }],
    ['count', mutate(b => { b[20] = 3; return b; })],
    ['truncated', bytes.subarray(0, bytes.length - 1)],
    ['trailing', new Uint8Array([...bytes, 0])],
    ['zero delta', mutate(b => { b[27] = 0; return b; })],
    ['range', mutate(b => { b[27] = 100; return b; })],
    ['overlong varint', (() => { const b = [...bytes]; b.splice(24, 1, 0x82, 0x00); return new Uint8Array(b); })()],
    ['six-byte varint', (() => { const b = [...bytes]; b.splice(24, 1, 0x82, 0x80, 0x80, 0x80, 0x80, 0x00); return new Uint8Array(b); })()],
    ['header', bytes.subarray(0, 5)],
  ];
  for (const [why, b, d] of cases) assert.throws(() => decodeCellEdits(b, d ?? dims), Error, why);
  assert.throws(() => decodeCellEdits(bytes, dims, { maxValue: 5 }), /value out of range/);
  assert.throws(() => decodeCellEdits(bytes, dims, { maxEdits: 1 }), /too many/);
  assert.throws(() => createCellEdits({ cellsX: 8, cellsY: 1, cellsZ: 8, values: new Uint16Array(64) }, { saved: cases[0]![1] }));
});

test('GEN-02 the largest grid encodes an edit at its last index (five-byte varint) and round-trips', () => {
  const values = new Uint16Array(GRID_MAX_CELLS);
  const edits = createCellEdits({ cellsX: 2048, cellsY: 1, cellsZ: 2048, values });
  assert.equal(edits.set(2047, 0, 2047, 7), 'changed');
  const encoded = edits.encode();
  assert.equal(encoded.length, 24 + 4 + 2, 'a 22-bit index delta needs four varint bytes');
  const loaded = createCellEdits({ cellsX: 2048, cellsY: 1, cellsZ: 2048, values }, { saved: encoded, revision: 1 });
  assert.equal(loaded.get(2047, 0, 2047), 7);
  // five-byte varints (index deltas ≥ 2^28) decode without allocating such a grid
  const cells = 2 ** 29, delta = 2 ** 28 + 1, header = new DataView(new ArrayBuffer(24));
  [0x46, 0x43, 0x45, 0x01].forEach((b, i) => header.setUint8(i, b));
  header.setUint32(4, 2 ** 15, true); header.setUint32(8, 2 ** 7, true); header.setUint32(12, 2 ** 7, true); header.setUint32(20, 1, true);
  const varint: number[] = []; for (let d = delta; ; d = Math.floor(d / 128)) { if (d < 128) { varint.push(d); break; } varint.push((d & 0x7f) | 0x80); }
  assert.equal(varint.length, 5);
  const crafted = new Uint8Array([...new Uint8Array(header.buffer), ...varint, 9, 0]);
  assert.deepEqual([...decodeCellEdits(crafted, { cellsX: 2 ** 15, cellsY: 2 ** 7, cellsZ: 2 ** 7 })], [[delta - 1, 9]]);
  assert.equal(2 ** 15 * 2 ** 7 * 2 ** 7, cells);
});

test('GEN-02 edits made against one seed are refused over content from another seed', async () => {
  const base = cellularGridJob.generateNow(recipeAt(7, 0, 0)), other = cellularGridJob.generateNow(recipeAt(8, 0, 0));
  const edits = createCellEdits(base); edits.set(1, 0, 1, 1 - base.get(1, 0, 1));
  assert.throws(() => createCellEdits(other, { saved: edits.encode(), revision: 1 }), /baseline mismatch/);
  assert.equal(createCellEdits(cellularGridJob.generateNow(recipeAt(7, 0, 0)), { saved: edits.encode(), revision: 1 }).size, 1);
});

test('GEN-02 edits are bound to grid dimensions: uniform content of another shape is refused', () => {
  // reviewed case: an edit at (7,0,0) on an all-zero 8x4x1 grid must not land at (3,1,0) on a 4x8x1 grid
  const wide = { cellsX: 8, cellsY: 4, cellsZ: 1, values: new Uint16Array(32) }, tall = { cellsX: 4, cellsY: 8, cellsZ: 1, values: new Uint16Array(32) };
  const edits = createCellEdits(wide); edits.set(7, 0, 0, 5);
  assert.equal(baselineChecksum(wide.values), baselineChecksum(tall.values), 'the values alone collide');
  assert.throws(() => createCellEdits(tall, { saved: edits.encode() }), /grid dimensions mismatch/);
  for (const shape of [{ cellsX: 8, cellsY: 1, cellsZ: 4 }, { cellsX: 2, cellsY: 4, cellsZ: 4 }, { cellsX: 32, cellsY: 1, cellsZ: 1 }])
    assert.throws(() => createCellEdits({ ...shape, values: new Uint16Array(32) }, { saved: edits.encode() }), /grid dimensions mismatch/);
  assert.equal(createCellEdits({ ...wide, values: new Uint16Array(32) }, { saved: edits.encode() }).get(7, 0, 0), 5, 'identical shape and content still load');
});

test('GEN-02 acknowledging a pending save retains edits made after submission', async () => {
  const fake = createFakeIdb();
  const store = await openChunkStore({ name: 'pending-edit', schema: 1, factory: fake.factory });
  const baseline = { cellsX: 2, cellsY: 1, cellsZ: 1, values: new Uint16Array(2) };
  const edits = createCellEdits(baseline);
  try {
    edits.set(0, 0, 0, 1);
    const submittedRevision = edits.revision;
    const pending = store.write([{ key: 'region', revision: submittedRevision, data: edits.encode() }]);
    edits.set(1, 0, 0, 2);
    assert.equal((await pending).status, 'saved');
    edits.markSaved(submittedRevision);
    assert.equal(edits.dirty, true);
    const first = await store.read('region');
    assert.equal(first.status, 'found');
    if (first.status !== 'found') return;
    const persisted = createCellEdits(baseline, { saved: first.data, revision: first.revision });
    assert.equal(persisted.get(0, 0, 0), 1);
    assert.equal(persisted.get(1, 0, 0), 0);
    const nextRevision = edits.revision;
    assert.equal((await store.write([{ key: 'region', revision: nextRevision, data: edits.encode() }])).status, 'saved');
    edits.markSaved(nextRevision);
    assert.equal(edits.dirty, false);
    const final = await store.read('region');
    assert.equal(final.status, 'found');
    if (final.status === 'found') assert.equal(createCellEdits(baseline, { saved: final.data, revision: final.revision }).get(1, 0, 0), 2);
  } finally { store.close(); }
});
