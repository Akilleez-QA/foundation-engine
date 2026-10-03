import test from 'node:test';
import assert from 'node:assert/strict';
import {createSurface} from './surface';
import {createTerrainOwner, prepareTerrainGeneration} from './generation';
import {inspectTerrain} from './inspect';

const layout = [
  {key: 'left-side', startX: 0, startZ: 0, cellsX: 4, cellsZ: 8, stride: 1 as const},
  {key: 'right-side', startX: 4, startZ: 0, cellsX: 4, cellsZ: 8, stride: 1 as const},
];
const make = (revision: number) =>
  prepareTerrainGeneration(
    createSurface({
      id: 'diagnostic-surface',
      revision,
      seed: 1,
      baseHeight: revision,
      originX: 0,
      originZ: 0,
      cellsX: 8,
      cellsZ: 8,
      spacing: 1,
    }),
    layout,
  );
const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

test('inspection pages prepared geometry separately from detached consumer display metadata', () => {
  const first = make(1),
    owner = createTerrainOwner(first, {maxBytes: first.bytes * 3});
  try {
    const display = {epoch: 1, tiles: [{index: 0, stride: 2 as const, vertices: 12, triangles: 10}]};
    const result = inspectTerrain(owner, {
      expectedEpoch: 1,
      limit: 1,
      maxLabelLength: 4,
      displayed: display,
      sample: {x: 1, z: 1},
    });
    assert.equal(result.status, 'ready');
    if (result.status !== 'ready') throw Error('expected ready');
    assert.equal(result.total, 2);
    assert.equal(result.nextOffset, 1);
    assert.equal(result.tiles.length, 1);
    assert.equal(result.tiles[0]!.key, 'left');
    assert.equal(result.tiles[0]!.keyTruncated, true);
    assert.equal(result.surface.idTruncated, true);
    assert.equal(result.tiles[0]!.prepared.stride, 1);
    assert.equal(result.tiles[0]!.displayed!.stride, 2);
    assert.equal(result.contact!.sample!.height, 1);
    result.tiles[0]!.bounds.min.x = 999;
    result.tiles[0]!.displayed!.vertices = 999;
    assert.equal(first.chunks[0]!.chunk.bounds.min.x, 0);
    assert.equal(display.tiles[0]!.vertices, 12);
    assert.equal(inspectTerrain(owner, {expectedEpoch: 1, offset: 1, limit: 1}).status, 'ready');
    const empty = inspectTerrain(owner, {expectedEpoch: 1, offset: 2});
    assert.equal(empty.status, 'ready');
    if (empty.status === 'ready') assert.deepEqual(empty.tiles, []);
    assert.equal(owner.stats().requests, 0, 'inspection admits no work');
  } finally {
    owner.close();
  }
});

test('inspection tracks pending/current publication and rejects stale view epochs', async () => {
  const first = make(1),
    second = make(2);
  const owner = createTerrainOwner(first, {maxBytes: first.bytes + second.bytes});
  let resolve!: (value: typeof second) => void;
  assert.equal(
    owner.request(
      2,
      second.bytes,
      () =>
        new Promise(r => {
          resolve = r;
        }),
    ),
    'accepted',
  );
  await settle();
  const pending = inspectTerrain(owner, {expectedEpoch: 1, sample: {x: 1, z: 1}});
  assert.equal(pending.status, 'ready');
  assert.equal(pending.state.epoch, 1);
  assert.equal(pending.state.desiredEpoch, 2);
  assert.equal(pending.state.requests, 1);
  resolve(second);
  await settle();
  assert.equal(
    owner.publish(() => true),
    true,
  );
  assert.equal(inspectTerrain(owner, {expectedEpoch: 1}).status, 'stale');
  assert.equal(inspectTerrain(owner, {expectedEpoch: 2, displayed: {epoch: 1, tiles: []}}).status, 'stale-display');
  const current = inspectTerrain(owner, {expectedEpoch: 2, sample: {x: 1, z: 1}});
  assert.equal(current.status, 'ready');
  if (current.status === 'ready') assert.equal(current.contact!.sample!.height, 2);
  owner.close();
  const closed = inspectTerrain(owner, {expectedEpoch: 2});
  assert.equal(closed.status, 'closed');
  assert.equal(closed.state.bytes, 0);
  assert.equal(closed.state.requests, 0);
});

test('inspection validates finite page/point and displayed bounds without enumerating oversized arrays', () => {
  const first = make(1),
    owner = createTerrainOwner(first, {maxBytes: first.bytes});
  try {
    for (const limit of [0, -1, 65, Infinity, 1.5])
      assert.throws(() => inspectTerrain(owner, {expectedEpoch: 1, limit}), RangeError);
    assert.throws(() => inspectTerrain(owner, {expectedEpoch: 1, offset: 3}), RangeError);
    assert.throws(() => inspectTerrain(owner, {expectedEpoch: NaN}), RangeError);
    assert.throws(() => inspectTerrain(owner, {expectedEpoch: 1, sample: {x: Infinity, z: 0}}), RangeError);
    const valid = {index: 0, stride: 1 as const, vertices: 1, triangles: 0};
    for (const tiles of [
      [valid, valid],
      [{...valid, index: 2}],
      [{...valid, vertices: -1}],
      [{...valid, triangles: 1.5}],
      Array(2),
    ]) {
      assert.throws(() => inspectTerrain(owner, {expectedEpoch: 1, displayed: {epoch: 1, tiles}}), RangeError);
    }
    const oversized = Array(65);
    Object.defineProperty(oversized, 0, {
      get() {
        throw Error('must reject length before rows');
      },
    });
    assert.throws(() => inspectTerrain(owner, {expectedEpoch: 1, displayed: {epoch: 1, tiles: oversized}}), RangeError);
  } finally {
    owner.close();
  }
});

test('closed inspection reports still-retiring work until cancelled execution settles', async () => {
  const first = make(1),
    second = make(2);
  const released: number[] = [];
  const owner = createTerrainOwner(first, {
    maxBytes: first.bytes + second.bytes,
    release: value => {
      released.push(value.epoch);
    },
  });
  let resolve!: (value: typeof second) => void;
  owner.request(
    2,
    second.bytes,
    () =>
      new Promise(r => {
        resolve = r;
      }),
  );
  await settle();
  owner.close();
  const retiring = inspectTerrain(owner, {expectedEpoch: 1});
  assert.equal(retiring.status, 'closed');
  assert.equal(retiring.state.requests, 1);
  assert.equal(retiring.state.bytes, second.bytes);
  resolve(second);
  await settle();
  const settled = inspectTerrain(owner, {expectedEpoch: 1});
  assert.equal(settled.state.requests, 0);
  assert.equal(settled.state.bytes, 0);
  assert.deepEqual(released, [1, 2]);
});
