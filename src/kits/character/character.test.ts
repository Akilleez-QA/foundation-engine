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

test('character: math option — deterministic arithmetic stays within the kit tolerance of Math and repeats exactly; unknown modes are refused', async () => {
  const solidScene = (math?: 'platform' | 'deterministic') => defineScene({
    id: 'turning', title: 'Turning', view: { camera: { position: [3, 8, 6], target: [0, 0, 0] } },
    entities: [[Name({ name: 'player' }), Transform(), Character({ speed: 4 })], [Walls({ minX: -4, maxX: 4, minZ: -4, maxZ: 4 })], [Transform({ x: 2, z: -1, ry: 0.6 }), Solid({ halfX: 0.6, halfZ: 0.4 })], [Transform({ x: -2, z: 1 }), Solid({ r: 0.7 })]],
    systems: [characterSystem({ math })],
  });
  const drive = async (math?: 'platform' | 'deterministic') => {
    const t = await testScene(solidScene(math));
    const path: number[] = [];
    for (const [x, z] of [[1, -1], [0, 1], [-1, 0], [1, 1], [0, -1]] as const) {
      t.hold('character-x', x); t.hold('character-z', z); t.run(0.7);
      const p = pos(t); path.push(p.x, p.z, p.ry);
    }
    return path;
  };
  const platform = await drive(), deterministic = await drive('deterministic'), again = await drive('deterministic');
  assert.deepEqual(deterministic, again, 'deterministic runs repeat exactly');
  assert.deepEqual(await drive('platform'), platform, "'platform' is the default");
  for (let i = 0; i < platform.length; i++) assert.ok(Math.abs(platform[i]! - deterministic[i]!) < 1e-9, `sample ${i}: ${platform[i]} vs ${deterministic[i]}`);
  assert.throws(() => characterSystem({ math: 'fixed' as never }), RangeError);
});
