import test from 'node:test';
import assert from 'node:assert/strict';
import {createCellEdits} from '../procgen/cell-edits';
import {createOccupancy, type Occupancy} from './occupancy';
import {createFakeIdb} from '../../core/save/fake-idb';
import {openChunkStore} from '../../core/save/chunk-store';
import {createHandover, type SceneEntry} from '../../core/router/handover';

const snapshot = (values: Uint16Array, revision: number) =>
  createOccupancy({
    width: 5,
    height: 3,
    values: Uint8Array.from(values, v => Number(v !== 0)),
    revision,
    maxCells: 15,
    maxCellsPerQuery: 15,
    outside: 'blocked',
  });

test('excavation brush commits one cavity, failed persistence stays dirty, reopen restores exact queries', async () => {
  const baseline = {cellsX: 5, cellsY: 1, cellsZ: 3, values: new Uint16Array(15).fill(1)};
  const edits = createCellEdits(baseline, {maxBatch: 3, limits: {maxEdits: 3}});
  const before = snapshot(edits.materialize(), edits.revision);
  const brush = [1, 2, 3].map(x => ({x, y: 0, z: 1, value: 0}));
  assert.equal(edits.batch(0, brush), 'changed');
  const after = snapshot(edits.materialize(), edits.revision);
  assert.equal(before.rectangle(1, 1, 4, 2).status, 'hit');
  assert.equal(after.rectangle(1, 1, 4, 2).status, 'clear');
  assert.equal(after.point(2, 0).status, 'hit', 'roof remains above cavity');
  assert.equal(after.segment(1.5, 1.5, 3.5, 1.5).status, 'clear');
  assert.equal(edits.batch(1, [{x: 0, y: 0, z: 1, value: 0}]), 'full');
  const fake = createFakeIdb();
  const store = await openChunkStore({name: 'excavation', schema: 1, factory: fake.factory});
  fake.controls.quotaOnPut = () => true;
  assert.notEqual(
    (await store.write([{key: 'field', revision: edits.revision, data: edits.encode()}])).status,
    'saved',
  );
  assert.equal(edits.dirty, true);
  fake.controls.quotaOnPut = () => false;
  assert.equal((await store.write([{key: 'field', revision: edits.revision, data: edits.encode()}])).status, 'saved');
  edits.markSaved(edits.revision);
  store.close();
  const reopened = await openChunkStore({name: 'excavation', schema: 1, factory: fake.factory});
  const saved = await reopened.read('field');
  assert.equal(saved.status, 'found');
  if (saved.status !== 'found') throw Error('missing fixture');
  const restored = createCellEdits(baseline, {saved: saved.data, revision: saved.revision});
  assert.deepEqual(
    snapshot(restored.materialize(), restored.revision).segment(1.5, 1.5, 4.5, 1.5),
    after.segment(1.5, 1.5, 4.5, 1.5),
  );
  assert.equal(restored.dirty, false);
  reopened.close();
});

test('authored arena classifies materials explicitly, checks placement and nearest obstruction', () => {
  const materials = new Uint16Array([2, 2, 2, 2, 2, 2, 0, 3, 0, 2, 2, 2, 2, 2, 2]);
  // Creator declares material2 blocked and material3 traversable; no built-in material policy.
  const arena = createOccupancy({
    width: 5,
    height: 3,
    values: Uint8Array.from(materials, v => Number(v === 2)),
    maxCells: 15,
    maxCellsPerQuery: 15,
    revision: 0,
    outside: 'refuse',
  });
  assert.equal(arena.rectangle(1, 1, 4, 2).status, 'clear');
  assert.deepEqual(arena.segment(1.5, 1.5, 4.5, 1.5).cell, {x: 4, y: 1});
  assert.deepEqual(arena.segment(3.5, 1.5, 0.5, 1.5).cell, {x: 0, y: 1});
  const blocked = snapshot(new Uint16Array(15).fill(1), 1);
  const free: number[] = [];
  for (let i = 0; i < 15; i++) if (blocked.point(i % 5, Math.floor(i / 5)).status === 'clear') free.push(i);
  assert.deepEqual(free, [], 'finite scan reports no placement instead of rejection sampling');
});

test('existing scene handover refuses failed and late derived occupancy publication', async () => {
  const initial = snapshot(new Uint16Array(15), 0),
    newer = snapshot(new Uint16Array(15).fill(1), 2);
  let shown: Occupancy = initial,
    finish!: () => void;
  const h = createHandover({player: () => 'p', firstRender() {}});
  const entry = (id: string, value: Occupancy, ready?: Promise<void>): SceneEntry => ({
    id: `scene.${id}`,
    label: id,
    load: () => null,
    enter: () => ({
      ready,
      activate() {
        shown = value;
      },
      leave() {},
    }),
  });
  await h.go(entry('initial', initial));
  const failed = h.go(entry('failure', newer, Promise.reject(Error('derived preparation failed'))));
  assert.equal(await failed, 'failed');
  assert.equal(shown, initial);
  const old = h.go(
    entry(
      'old',
      snapshot(new Uint16Array(15).fill(1), 1),
      new Promise<void>(r => {
        finish = r;
      }),
    ),
  );
  assert.equal(await h.go(entry('new', newer)), 'activated');
  finish();
  assert.equal(await old, 'superseded');
  assert.equal(shown, newer);
  h.leave();
});
