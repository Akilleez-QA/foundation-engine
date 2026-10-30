import test from 'node:test';
import assert from 'node:assert/strict';
import {defineScene, testScene, Name, Transform} from '../../author';
import {cameraSystem} from './index';

test('ownership revision snaps camera history even for a small target displacement', async () => {
  let revision = 0;
  const scene = await testScene(
    defineScene({
      id: 'camera-owner-reset',
      title: 'camera.reset',
      entities: [[Name({name: 'player'}), Transform()]],
      systems: [cameraSystem('follow', {smooth: 1, teleportDistance: 100, resetRevision: () => revision})],
    }),
  );
  scene.run(1 / 60);
  const tr = scene.world.get(scene.ctx.named('player')!, Transform)!;
  tr.x = 2;
  scene.run(1 / 60);
  assert.ok(scene.ctx.view.camera.target[0] > 0 && scene.ctx.view.camera.target[0] < 2);
  revision++;
  scene.run(1 / 60);
  assert.deepEqual(scene.ctx.view.camera.target, [2, 0.5, 0]);
  assert.deepEqual(scene.ctx.view.camera.position, [2, 5, -8]);
});

test('reset revision remains pending while the named target has no Transform', async () => {
  let revision = 0;
  const scene = await testScene(
    defineScene({
      id: 'camera-reset-target-loss',
      title: 'camera.reset',
      entities: [[Name({name: 'player'}), Transform()]],
      systems: [cameraSystem('follow', {smooth: 1, resetRevision: () => revision})],
    }),
  );
  scene.run(1 / 60);
  const entity = scene.ctx.named('player')!,
    before = structuredClone(scene.ctx.view.camera);
  scene.world.remove(entity, Transform);
  revision++;
  scene.run(2 / 60);
  assert.deepEqual(scene.ctx.view.camera, before);
  scene.world.add(entity, Transform({x: 2}));
  scene.run(1 / 60);
  assert.deepEqual(scene.ctx.view.camera.target, [2, 0.5, 0]);
  assert.deepEqual(scene.ctx.view.camera.position, [2, 5, -8]);
  scene.world.get(entity, Transform)!.x = 3;
  scene.run(1 / 60);
  assert.ok(scene.ctx.view.camera.target[0] > 2 && scene.ctx.view.camera.target[0] < 3);
});

for (const failure of ['throw', 'invalid'] as const) {
  test(`reset revision survives ${failure} clearance and is acknowledged only after successful retry`, async () => {
    let revision = 0,
      fail = false;
    const system = cameraSystem('follow', {
      smooth: 1,
      resetRevision: () => revision,
      obstruction: () => {
        if (fail) {
          if (failure === 'throw') throw Error('query unavailable');
          return NaN;
        }
        return null;
      },
    });
    const scene = await testScene(
      defineScene({
        id: `camera-reset-clearance-${failure}`,
        title: 'camera.reset',
        entities: [[Name({name: 'player'}), Transform()]],
      }),
    );
    // Invoke the actual system directly so a runner's caught diagnostic cannot
    // masquerade as successful publication or hide the expected exception.
    system.run(scene.ctx, 1 / 60);
    const before = structuredClone(scene.ctx.view.camera),
      tr = scene.world.get(scene.ctx.named('player')!, Transform)!;
    tr.x = 2;
    revision++;
    fail = true;
    assert.throws(() => system.run(scene.ctx, 1 / 60));
    assert.deepEqual(scene.ctx.view.camera, before);
    assert.throws(() => system.run(scene.ctx, 1 / 60));
    assert.deepEqual(scene.ctx.view.camera, before);
    fail = false;
    system.run(scene.ctx, 1 / 60);
    assert.deepEqual(scene.ctx.view.camera.target, [2, 0.5, 0]);
    assert.deepEqual(scene.ctx.view.camera.position, [2, 5, -8]);
    tr.x = 3;
    system.run(scene.ctx, 1 / 60);
    assert.ok(scene.ctx.view.camera.target[0] > 2 && scene.ctx.view.camera.target[0] < 3);
  });
}

test('failed clearance also preserves the last successful teleport-distance observation', async () => {
  let fail = false;
  const system = cameraSystem('follow', {
    smooth: 1,
    teleportDistance: 5,
    obstruction: () => {
      if (fail) throw Error('query unavailable');
      return null;
    },
  });
  const scene = await testScene(
    defineScene({
      id: 'camera-distance-clearance-retry',
      title: 'camera.reset',
      entities: [[Name({name: 'player'}), Transform()]],
    }),
  );
  system.run(scene.ctx, 1 / 60);
  scene.world.get(scene.ctx.named('player')!, Transform)!.x = 10;
  const before = structuredClone(scene.ctx.view.camera);
  fail = true;
  assert.throws(() => system.run(scene.ctx, 1 / 60));
  assert.deepEqual(scene.ctx.view.camera, before);
  fail = false;
  system.run(scene.ctx, 1 / 60);
  assert.deepEqual(scene.ctx.view.camera.target, [10, 0.5, 0]);
  assert.deepEqual(scene.ctx.view.camera.position, [10, 5, -8]);
});
