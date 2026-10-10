import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defineScene, Name, testScene, Transform, type Vec3} from '../../author';
import {cameraDirectorSystem, createCameraVolumes, createEasedBounds, createLookAhead, createAreaCamera} from './index';

const close = (a: number, b: number, tol = 1e-9, msg = '') => assert.ok(Math.abs(a - b) < tol, `${msg} ${a} vs ${b}`);

test('look-ahead leads in the direction of travel; the world focus moves at most subject speed plus catchUp', () => {
  const look = createLookAhead({lead: 0.5, maxLead: 3, catchUp: 2});
  let x = 0,
    prev = 0,
    fastest = 0;
  let focus: Vec3 = [0, 0, 0];
  for (let i = 0; i < 240; i++) {
    x += 10 / 60;
    focus = look.step(1 / 60, [x, 0, 0], [10, 0, 0]);
    if (i > 0) fastest = Math.max(fastest, (focus[0] - prev) * 60);
    prev = focus[0];
  }
  assert.ok(fastest <= 12 + 1e-6, `world focus speed ${fastest}`);
  close(focus[0] - x, 3, 1e-9, 'lead clamps to maxLead');
  // Reverse while moving: the focus swings back at no more than 10 + 2 per second.
  const before = focus[0];
  x -= 10 / 60;
  const turned = look.step(1 / 60, [x, 0, 0], [-10, 0, 0]);
  assert.ok(before - turned[0] <= 12 / 60 + 1e-9);
  // Stopped: the lead decays at catchUp only.
  const stopped = look.step(0.1, [x, 0, 0], [0, 0, 0]);
  assert.ok(stopped[0] - x <= turned[0] - x);
  look.reset();
  assert.deepEqual(look.offset, [0, 0]);
  assert.ok(createLookAhead());
  assert.throws(() => createLookAhead({lead: 0}), RangeError);
  assert.throws(() => look.step(Number.NaN, [0, 0, 0], [0, 0, 0]), RangeError);
});

test('area camera holds an area pose and pans to the next area over panTicks', () => {
  const areas = createAreaCamera({
    panTicks: 4,
    areas: [
      {id: 'a', area: [0, 0, 10, 10], pose: {position: [5, 10, 5], target: [5, 0, 5], fov: 50}},
      {id: 'b', area: [10, 0, 20, 10], pose: {position: [15, 10, 5], target: [15, 0, 5], fov: 40}},
    ],
  });
  assert.deepEqual(areas.step([2, 0, 2]), {pose: areas.pose, area: 'a', panning: false});
  assert.deepEqual(areas.pose.position, [5, 10, 5]);
  const first = areas.step([12, 0, 2]);
  assert.equal(first.area, 'b');
  assert.equal(first.panning, true);
  assert.ok(first.pose.position[0] > 5 && first.pose.position[0] < 15);
  let last = first;
  for (let i = 0; i < 3; i++) last = areas.step([12, 0, 2]);
  assert.equal(last.panning, false);
  assert.deepEqual(last.pose.position, [15, 10, 5]);
  assert.equal(last.pose.fov, 40);
  assert.equal(areas.step([50, 0, 50]).area, 'b', 'outside every room keeps the last');
  assert.throws(
    () =>
      createAreaCamera({
        areas: [{id: 'x', area: [1, 0, 0, 1], pose: {position: [0, 0, 0], target: [0, 0, 1], fov: 50}}],
      }),
    RangeError,
  );
});

test('eased bounds move each edge at a rate, faster when asked, and clamp points', () => {
  const b = createEasedBounds([0, 0, 0, 10, 10, 10], {rate: 2, fastRate: 8});
  b.set([0, 0, 0, 4, 10, 10]);
  assert.equal(b.step(1), true);
  assert.deepEqual(b.bounds, [0, 0, 0, 8, 10, 10]);
  b.step(1, true);
  assert.deepEqual(b.bounds, [0, 0, 0, 4, 10, 10]);
  assert.equal(b.step(1), false);
  assert.deepEqual(b.clamp([7, -1, 5]), [4, 0, 5]);
  b.set([20, 0, 0, 30, 10, 10]);
  for (let i = 0; i < 20; i++) {
    b.step(0.37);
    const [minX, , , maxX] = b.bounds;
    assert.ok(minX! <= maxX!, 'edges move toward ordered targets at one rate, so they never cross');
  }
  b.set([20, 0, 0, 30, 10, 10], true);
  assert.deepEqual(b.bounds, [20, 0, 0, 30, 10, 10]);
  assert.throws(() => b.set([1, 0, 0, 0, 1, 1]), RangeError);
});

test('the rigs compose as director settings', async () => {
  const look = createLookAhead({lead: 0.5, maxLead: 3, catchUp: 4});
  const bounds = createEasedBounds([-100, 0, -100, 100, 50, 100]);
  let last: Vec3 = [0, 0, 0];
  const scene = defineScene({
    id: 'rigs',
    title: 'Rigs',
    entities: [[Name({name: 'player'}), Transform({})]],
    systems: [
      cameraDirectorSystem({
        volumes: createCameraVolumes({fallback: 'side', volumes: []}),
        settings: {
          side: (_ctx, s) => {
            const velocity: Vec3 = [(s[0] - last[0]) * 60, 0, (s[2] - last[2]) * 60];
            last = s;
            const focus = bounds.clamp(look.step(1 / 60, s, velocity));
            return {position: [focus[0], focus[1] + 2, focus[2] + 12], target: focus, fov: 50};
          },
        },
      }),
    ],
  });
  const t = await testScene(scene);
  const player = () => t.world.get(t.ctx.named('player')!, Transform)!;
  for (let i = 0; i < 60; i++) {
    player().x += 0.1;
    t.run(1 / 60);
  }
  assert.ok(t.ctx.view.camera.target[0] > player().x, 'the camera leads the player');
});
