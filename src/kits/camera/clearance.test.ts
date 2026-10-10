import {test} from 'node:test';
import assert from 'node:assert/strict';
import {clearCamera} from './clearance';
import {cameraSystem} from './index';
import {defineScene, Name, Transform, testScene} from '../../author';

test('camera footprint clamps to nearest obstruction after padding', () => {
  const pose = {position: [0, 0, 10] as [number, number, number], target: [0, 0, 0] as [number, number, number]};
  let queries = 0;
  const result = clearCamera(
    pose,
    from => {
      queries++;
      return from[0] > 0 ? 2 : 7;
    },
    0.5,
    0.2,
  );
  assert.equal(queries, 5);
  assert.equal(result.position[2], 1.8);
  assert.deepEqual(pose.position, [0, 0, 10]);
  assert.deepEqual(
    clearCamera(pose, () => null),
    pose,
  );
});

test('camera handles vertical, coincident and obstructed-at-target poses', () => {
  assert.deepEqual(
    clearCamera({position: [1, 2, 3], target: [1, 2, 3]}, () => {
      throw Error('no segment');
    }),
    {position: [1, 2, 3], target: [1, 2, 3]},
  );
  // Intentional contract change: an obstruction at the target no longer collapses the camera onto it;
  // the default floor keeps it 0.05 along the requested direction.
  assert.deepEqual(clearCamera({position: [0, 10, 0], target: [0, 0, 0]}, () => 0).position, [0, 0.05, 0]);
  for (const n of [-1, NaN, Infinity, 11])
    assert.throws(() => clearCamera({position: [0, 10, 0], target: [0, 0, 0]}, () => n));
});

test('camera clears smoothed pose and resets discontinuous target history per world', async () => {
  const system = cameraSystem('follow', {smooth: 1, teleportDistance: 5, obstruction: () => null});
  const scene = defineScene({
    id: 'test',
    title: 'Test',
    entities: [[Name({name: 'player'}), Transform()]],
    systems: [system],
  });
  const a = await testScene(scene),
    b = await testScene(scene);
  a.run(1 / 60);
  const tr = a.world.get(a.ctx.named('player')!, Transform)!;
  tr.x = 100;
  a.run(1 / 60);
  assert.equal(a.ctx.view.camera.target[0], 100);
  b.run(1 / 60);
  assert.equal(b.ctx.view.camera.target[0], 0);
});
test('losing a tracked entity holds the last view instead of following an invented origin', async () => {
  const scene = defineScene({
    id: 'lost',
    title: 'Lost',
    entities: [[Name({name: 'player'}), Transform({x: 20})]],
    systems: [cameraSystem('follow', {smooth: 0})],
  });
  const test = await testScene(scene);
  test.run(1 / 60);
  const target = [...test.ctx.view.camera.target];
  test.world.despawn(test.ctx.named('player')!);
  test.run(1 / 60);
  assert.deepEqual(test.ctx.view.camera.target, target);
});

test('clearance keeps a minimum distance so the view never collapses onto its target', () => {
  const pose = {position: [0, 2, 6] as [number, number, number], target: [0, 1, 0] as [number, number, number]};
  const near = clearCamera(pose, () => 0.05, 0.15, 0.1);
  const gap = Math.hypot(...near.position.map((v, i) => v - pose.target[i]!));
  assert.ok(gap > 0, 'a pose at its own target has no defined view direction');
  assert.ok(Math.abs(gap - 0.05) < 1e-9, 'the default floor is 0.05 along the requested direction');
  const away = near.position.map((v, i) => v - pose.target[i]!);
  const requested = pose.position.map((v, i) => v - pose.target[i]!);
  const cos = away.reduce((s, v, i) => s + v * requested[i]!, 0) / (gap * Math.hypot(...requested));
  assert.ok(Math.abs(cos - 1) < 1e-12, 'the floor keeps the requested direction');
  // A creator-chosen floor, e.g. outside a character's head; obstruction beyond the floor still wins.
  assert.ok(
    Math.abs(
      Math.hypot(...clearCamera(pose, () => 0.3, 0.15, 0.1, 0.8).position.map((v, i) => v - pose.target[i]!)) - 0.8,
    ) < 1e-9,
  );
  assert.ok(
    Math.abs(
      Math.hypot(...clearCamera(pose, () => 3, 0.15, 0.1, 0.8).position.map((v, i) => v - pose.target[i]!)) - 2.9,
    ) < 1e-9,
  );
  // The floor never pushes the camera farther than the requested pose.
  const close = {position: [0, 1, 0.5] as [number, number, number], target: [0, 1, 0] as [number, number, number]};
  assert.deepEqual(clearCamera(close, () => 0, 0.15, 0.1, 0.8).position, [0, 1, 0.5]);
  for (const bad of [-1, NaN, Infinity]) assert.throws(() => clearCamera(pose, () => null, 0.15, 0.1, bad), RangeError);
});

test('camera system publishes a floored pose when geometry touches the target', async () => {
  const scene = defineScene({
    id: 'floor',
    title: 'Floor',
    entities: [[Name({name: 'player'}), Transform()]],
    systems: [cameraSystem('follow', {smooth: 0, obstruction: () => 0, clearanceMinDistance: 0.4})],
  });
  const t = await testScene(scene);
  t.run(1 / 60);
  const {position, target} = t.ctx.view.camera;
  assert.ok(Math.abs(Math.hypot(...position.map((v, i) => v - target[i]!)) - 0.4) < 1e-9);
});
