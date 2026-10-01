import test from 'node:test';
import assert from 'node:assert/strict';
import { defineScene, testScene, Name, Transform } from '../../author';
import { cameraSystem } from './index';

test('ownership revision snaps camera history even for a small target displacement', async () => {
  let revision = 0;
  const scene = await testScene(defineScene({ id: 'camera-owner-reset', title: 'camera.reset', entities: [[Name({ name: 'player' }), Transform()]], systems: [cameraSystem('follow', { smooth: 1, teleportDistance: 100, resetRevision: () => revision })] }));
  scene.run(1 / 60);
  const tr = scene.world.get(scene.ctx.named('player')!, Transform)!;
  tr.x = 2; scene.run(1 / 60);
  assert.ok(scene.ctx.view.camera.target[0] > 0 && scene.ctx.view.camera.target[0] < 2);
  revision++; scene.run(1 / 60);
  assert.deepEqual(scene.ctx.view.camera.target, [2, .5, 0]);
  assert.deepEqual(scene.ctx.view.camera.position, [2, 5, -8]);
});
