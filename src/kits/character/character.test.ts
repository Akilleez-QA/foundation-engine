import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineScene, Name, testScene, Transform } from '../../author';
import { Character, characterSystem, Solid, Walls } from './index';

const scene = defineScene({
  id: 'walls', title: 'Walls', view: { camera: { position: [0, 8, 8], target: [0, 0, 0] } },
  entities: [[Name({ name: 'player' }), Transform(), Character({ speed: 4 })], [Walls({ minX: -3, maxX: 3, minZ: -3, maxZ: 3 })], [Transform({ x: -2 }), Solid({ halfX: 0.5, halfZ: 3 })]],
  systems: [characterSystem()],
});
const pos = (t: Awaited<ReturnType<typeof testScene>>) => t.world.get(t.ctx.named('player')!, Transform)!;

test('character: up moves away from the camera; the walls stop it', async () => {
  const t = await testScene(scene);
  t.hold('character-z', -1); t.run(0.5);
  assert.ok(pos(t).z < -1.5, `moved to ${pos(t).z}`);
  t.run(3);
  assert.ok(Math.abs(pos(t).z - (-3 + 0.35)) < 0.05, 'stops at the wall less its radius');
  assert.ok(Math.abs(pos(t).ry - Math.PI) < 0.01, 'faces where it went');
});

test('character: a solid blocks, and releasing the input stops within a short coast', async () => {
  const t = await testScene(scene);
  t.hold('character-x', -1); t.run(2);
  assert.ok(Math.abs(pos(t).x - (-1.5 + 0.35)) < 0.05, `blocked by the solid at ${pos(t).x}`);
  t.release('character-x'); t.hold('character-x', 1); t.run(0.2); t.release('character-x');
  const x = pos(t).x; t.run(1);
  assert.ok(pos(t).x - x < 0.3);
});
