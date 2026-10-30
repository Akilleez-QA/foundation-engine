import test from 'node:test';
import assert from 'node:assert/strict';
import {createSurface} from './surface';
import {createTerrainGenerationBuilder, prepareTerrainGeneration, createTerrainOwner} from './generation';
const surface = (revision: number) =>
  createSurface({
    id: 'world',
    revision,
    seed: 1,
    baseHeight: revision,
    originX: -4,
    originZ: -4,
    cellsX: 8,
    cellsZ: 8,
    spacing: 1,
  });
const layout = [
  {key: 'left', startX: 0, startZ: 0, cellsX: 4, cellsZ: 8, stride: 1 as const},
  {key: 'right', startX: 4, startZ: 0, cellsX: 4, cellsZ: 8, stride: 1 as const},
];
const make = (n: number) => prepareTerrainGeneration(surface(n), layout);
const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
test('generation builder bounds chunks and validates complete nonoverlapping coverage', () => {
  const builder = createTerrainGenerationBuilder(surface(1), layout);
  assert.equal(builder.step(1), 1);
  assert.equal(builder.result, undefined);
  assert.equal(builder.step(1), 1);
  assert.equal(builder.result!.epoch, 1);
  assert.ok(Object.isFrozen(builder.result!.chunks[0]!.chunk.mesh.positions));
  assert.throws(() => prepareTerrainGeneration(surface(1), [layout[0]!]));
  assert.throws(() => prepareTerrainGeneration(surface(1), [layout[0]!, {...layout[0]!, key: 'other'}]));
});
test('old generation survives pending/declined publication and one epoch invalidates after coherent swap', async () => {
  const first = make(1),
    second = make(2),
    released: number[] = [];
  const owner = createTerrainOwner(first, {maxBytes: first.bytes * 3, release: g => released.push(g.epoch)});
  let viewEpoch = 1,
    seen = 0;
  owner.subscribe(epoch => {
    assert.equal(viewEpoch, epoch);
    assert.equal(owner.current.surface.sample(0, 0)!.height, epoch);
    seen++;
  });
  assert.equal(
    owner.request(2, second.bytes, async () => second),
    'accepted',
  );
  assert.equal(owner.current.epoch, 1);
  assert.equal(
    owner.publish(() => false),
    false,
  );
  await settle();
  assert.equal(
    owner.publish(() => false),
    false,
  );
  assert.equal(owner.current.epoch, 1);
  assert.equal(
    owner.publish(next => {
      viewEpoch = next.epoch;
      return true;
    }),
    true,
  );
  assert.equal(seen, 1);
  assert.deepEqual(released, [1]);
  assert.equal(owner.stats().bytes, second.bytes);
  owner.close();
  owner.close();
  assert.deepEqual(released, [1, 2]);
});
test('supersession holds admission until late build settles, releases it, then permits retry', async () => {
  const first = make(1),
    second = make(2),
    third = make(3),
    released: number[] = [];
  const owner = createTerrainOwner(first, {maxBytes: first.bytes * 3, release: g => released.push(g.epoch)});
  let resolve!: (g: typeof second) => void;
  owner.request(
    2,
    second.bytes,
    () =>
      new Promise(r => {
        resolve = r;
      }),
  );
  await settle();
  assert.equal(
    owner.request(3, third.bytes, async () => third),
    'saturated',
  );
  resolve(second);
  await settle();
  assert.equal(
    owner.publish(() => true),
    false,
  );
  assert.deepEqual(released, [2]);
  assert.equal(
    owner.request(3, third.bytes, async () => third),
    'accepted',
  );
  await settle();
  owner.publish(() => true);
  assert.equal(owner.current.epoch, 3);
  owner.close();
  assert.deepEqual(released, [2, 1, 3]);
});
test('failed, wrong-revision and closed builds cannot publish or exceed admission', async () => {
  const first = make(1),
    owner = createTerrainOwner(first, {maxBytes: first.bytes * 2});
  assert.equal(
    owner.request(2, first.bytes + 1, async () => make(2)),
    'saturated',
  );
  assert.equal(
    owner.request(2, first.bytes, async () => make(3)),
    'accepted',
  );
  await settle();
  assert.equal(
    owner.publish(() => true),
    false,
  );
  assert.equal(owner.current.epoch, 1);
  owner.close();
  assert.equal(
    owner.request(3, first.bytes, async () => make(3)),
    'closed',
  );
});
test('throwing adapters keep old generation; listener/release errors cannot undo a published epoch', async () => {
  const first = make(1),
    second = make(2),
    owner = createTerrainOwner(first, {
      maxBytes: first.bytes * 3,
      release: () => {
        throw Error('release');
      },
    });
  owner.subscribe(() => {
    throw Error('listener');
  });
  owner.request(2, second.bytes, async () => second);
  await settle();
  assert.throws(() =>
    owner.publish(() => {
      throw Error('apply');
    }),
  );
  assert.equal(owner.current.epoch, 1);
  assert.equal(
    owner.publish(() => true),
    true,
  );
  assert.equal(owner.current.epoch, 2);
  assert.equal(owner.stats().listenerErrors, 1);
  assert.equal(owner.stats().ownerReleaseErrors, 1);
  owner.close();
  assert.equal(owner.stats().bytes, 0);
});

test('rejecting a candidate that aliases current preserves its live ownership until close', async () => {
  const first = make(1),
    releases: (typeof first)[] = [];
  const owner = createTerrainOwner(first, {maxBytes: first.bytes * 2, release: value => releases.push(value)});
  assert.equal(
    owner.request(2, first.bytes, async () => first),
    'accepted',
  );
  await settle();
  assert.equal(
    owner.publish(() => assert.fail('invalid candidate must not reach publication')),
    false,
  );
  assert.equal(owner.current, first);
  assert.deepEqual(releases, []);
  assert.equal(owner.stats().bytes, first.bytes);
  owner.close();
  owner.close();
  assert.deepEqual(releases, [first]);
  assert.equal(owner.stats().bytes, 0);
});

test('rejecting a distinct wrong-revision candidate still retires that candidate once', async () => {
  const first = make(1),
    invalid = make(3),
    releases: (typeof first)[] = [];
  const owner = createTerrainOwner(first, {maxBytes: first.bytes * 2, release: value => releases.push(value)});
  owner.request(2, invalid.bytes, async () => invalid);
  await settle();
  assert.equal(
    owner.publish(() => assert.fail('invalid candidate must not reach publication')),
    false,
  );
  assert.equal(owner.current, first);
  assert.deepEqual(releases, [invalid]);
  owner.close();
  owner.close();
  assert.deepEqual(releases, [invalid, first]);
});
