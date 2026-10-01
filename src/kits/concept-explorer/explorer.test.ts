import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineScene, Shape, testScene, Transform } from '../../author';
import { explorer, explorerSystem, Part, pickPart } from './index';

const scene = defineScene({ id: 'model', title: 'Model', entities: [
  [Transform(), Shape({ kind: 'sphere' }), Part({ id: 'core', label: 'Core', layer: 'inside', radius: 0.6 })],
  [Transform({ x: 3 }), Shape({ kind: 'sphere' }), Part({ id: 'moonlet', label: 'Small body', radius: 0.4 })],
], systems: [explorerSystem({ smooth: 0 })] });

test('concept explorer: the camera orbits the target; a tap picks the part under it; layers hide parts', async () => {
  const t = await testScene(scene);
  t.run(1 / 60);
  const cam = t.ctx.view.camera;
  assert.ok(Math.abs(Math.hypot(cam.position[0], cam.position[1], cam.position[2]) - 8) < 1e-6, 'orbit distance');
  assert.equal(pickPart(t.ctx, { x: 0, y: 0 }), 'core', 'the view centre looks at the core');
  explorer(t.ctx).layers.inside = false; t.run(1 / 60);
  assert.equal(pickPart(t.ctx, { x: 0, y: 0 }), null, 'a hidden layer cannot be picked');
  const yaw = explorer(t.ctx).orbit.yaw;
  t.hold('explorer-orbit', 1); t.run(1);
  assert.ok(explorer(t.ctx).orbit.yaw > yaw + 1);
});
