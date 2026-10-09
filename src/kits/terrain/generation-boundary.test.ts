import test from 'node:test';
import assert from 'node:assert/strict';
import {createSurface} from './surface';
import {
  createTerrainGenerationBuilder,
  createTerrainOwner,
  prepareTerrainGeneration,
  type TerrainGeneration,
} from './generation';

const layout = [
  {key: 'left', startX: 0, startZ: 0, cellsX: 2, cellsZ: 4, stride: 1 as const},
  {key: 'right', startX: 2, startZ: 0, cellsX: 2, cellsZ: 4, stride: 1 as const},
];
const surface = (revision: number) =>
  createSurface({
    id: 'boundary-world',
    revision,
    seed: 1,
    baseHeight: revision,
    originX: 0,
    originZ: 0,
    cellsX: 4,
    cellsZ: 4,
    spacing: 1,
  });
const make = (revision: number) => prepareTerrainGeneration(surface(revision), layout);
const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

test('a ready generation superseded before publication retires without replacing any live view', async () => {
  const initial = make(1),
    ready = make(2),
    replacement = make(3);
  const releases: TerrainGeneration[] = [];
  const notifications: number[] = [];
  const views = {contact: initial, render: initial, navigation: initial};
  const owner = createTerrainOwner(initial, {
    maxBytes: initial.bytes + replacement.bytes,
    release: value => releases.push(value),
  });
  owner.subscribe(epoch => {
    assert.equal(views.contact.epoch, epoch);
    assert.equal(views.render.epoch, epoch);
    assert.equal(views.navigation.epoch, epoch);
    assert.equal(releases.includes(initial), false, 'the previous generation remains owned through notification');
    notifications.push(epoch);
  });
  try {
    assert.equal(
      owner.request(2, ready.bytes, async () => ready),
      'accepted',
    );
    await settle();
    assert.equal(owner.stats().ready, 1);
    assert.equal(owner.stats().bytes, initial.bytes + ready.bytes);
    let complete!: (value: TerrainGeneration) => void;
    assert.equal(
      owner.request(
        3,
        replacement.bytes,
        () =>
          new Promise(resolve => {
            complete = resolve;
          }),
      ),
      'accepted',
    );
    await settle();
    assert.deepEqual(releases, [ready], 'ready superseded work retires before the replacement finishes');
    assert.equal(owner.stats().bytes, initial.bytes + replacement.bytes);
    assert.equal(
      owner.publish(() => assert.fail('unfinished replacement cannot reach a view')),
      false,
    );
    assert.deepEqual(views, {contact: initial, render: initial, navigation: initial});
    assert.deepEqual(notifications, []);

    complete(replacement);
    await settle();
    assert.equal(
      owner.publish((next, previous) => {
        assert.equal(previous, initial);
        assert.equal(next, replacement);
        views.contact = views.render = views.navigation = next;
        return true;
      }),
      true,
    );
    assert.equal(owner.current, replacement);
    assert.deepEqual(notifications, [3]);
    assert.deepEqual(releases, [ready, initial]);
    assert.equal(owner.stats().bytes, replacement.bytes);
    assert.equal(
      owner.publish(() => assert.fail('a generation publishes only once')),
      false,
    );
  } finally {
    owner.close();
    owner.close();
  }
  assert.deepEqual(releases, [ready, initial, replacement]);
  assert.equal(owner.stats().bytes, 0);
});

for (const boundary of ['cancel', 'close'] as const) {
  test(`a ${boundary} boundary keeps a late partial-build completion out of the live world and retires it once`, async () => {
    const initial = make(1);
    const builder = createTerrainGenerationBuilder(surface(2), layout);
    const releases: TerrainGeneration[] = [];
    const owner = createTerrainOwner(initial, {maxBytes: initial.bytes * 2, release: value => releases.push(value)});
    let signal!: AbortSignal;
    let complete!: (value: TerrainGeneration) => void;
    assert.equal(
      owner.request(2, initial.bytes, async abort => {
        signal = abort;
        assert.equal(builder.step(1), 1);
        assert.equal(builder.result, undefined);
        // Deliberately finish after abort: the owner must quarantine even an uncooperative adapter.
        return new Promise(resolve => {
          complete = resolve;
        });
      }),
      'accepted',
    );
    await settle();
    assert.equal(signal.aborted, false);
    assert.equal(owner.stats().bytes, initial.bytes * 2);
    owner[boundary]();
    owner[boundary]();
    assert.equal(signal.aborted, true);
    assert.equal(owner.current, initial);
    assert.equal(owner.stats().requests, 1, 'running work retains admission until it settles');
    assert.equal(owner.stats().bytes, boundary === 'close' ? initial.bytes : initial.bytes * 2);
    assert.deepEqual(releases, boundary === 'close' ? [initial] : []);
    assert.equal(
      owner.publish(() => assert.fail('cancelled work cannot publish')),
      false,
    );

    assert.equal(builder.step(1), 1);
    const late = builder.result!;
    complete(late);
    await settle();
    assert.equal(
      owner.publish(() => assert.fail('late completion cannot publish')),
      false,
    );
    assert.equal(owner.current, initial);
    assert.equal(owner.stats().requests, 0);
    assert.equal(owner.stats().bytes, boundary === 'close' ? 0 : initial.bytes);
    assert.deepEqual(releases, boundary === 'close' ? [initial, late] : [late]);
    owner.close();
    owner.close();
    assert.equal(releases.filter(value => value === initial).length, 1);
    assert.equal(releases.filter(value => value === late).length, 1);
    assert.equal(owner.stats().bytes, 0);
  });
}
