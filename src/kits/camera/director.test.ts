import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defineScene, Name, testScene, Transform, type Vec3} from '../../author';
import {
  cameraDirectorSystem,
  closeUpPose,
  createCameraTransition,
  createCameraVolumes,
  createLetterbox,
  railPose,
  shotPose,
  stringPose,
  type CameraPose,
} from './index';

const close = (a: number, b: number, tol = 1e-9, msg = '') => assert.ok(Math.abs(a - b) < tol, `${msg} ${a} vs ${b}`);
const pose = (position: Vec3, target: Vec3, fov = 50): CameraPose => ({position, target, fov});

test('the ladder prefers overrides, then the lowest-priority containing volume, then the fallback, with stickiness', () => {
  const v = createCameraVolumes({
    fallback: 'free',
    stickiness: 0.5,
    volumes: [
      {id: 'hall', shape: {kind: 'box', center: [0, 0, 0], half: [5, 3, 5]}, priority: 10, setting: 'hall'},
      {
        id: 'alcove',
        shape: {kind: 'cylinder', base: [4, -1, 0], radius: 2, height: 4},
        priority: 1,
        setting: 'tight',
      },
      {
        id: 'turned',
        shape: {kind: 'box', center: [20, 0, 0], half: [1, 1, 4], yaw: Math.PI / 2},
        priority: 5,
        setting: 'side',
      },
    ],
  });
  assert.equal(v.resolve([0, 0, 0]).setting, 'hall');
  assert.equal(v.resolve([4, 0, 0]).setting, 'tight', 'lower priority wins');
  assert.equal(v.resolve([6.3, 0, 0]).setting, 'tight', 'still inside the alcove grown by stickiness');
  assert.equal(v.resolve([7, 0, 0]).setting, 'free');
  assert.equal(v.resolve([23, 0, 0.5]).setting, 'side', 'a yawed box is tested in its own frame');
  assert.equal(v.resolve([20, 0, 3]).setting, 'free');
  assert.deepEqual(v.resolve([0, 0, 0], [{id: 'scripted', setting: 'shot'}]), {
    setting: 'shot',
    source: 'scripted',
    kind: 'override',
  });
  assert.throws(
    () =>
      createCameraVolumes({
        fallback: 'f',
        volumes: [{id: 'a', shape: {kind: 'box', center: [0, 0, 0], half: [0, 1, 1]}, priority: 1, setting: 's'}],
      }),
    RangeError,
  );
});

test('string rig keeps the eye in the world inside its distance band and blends height by distance', () => {
  const rig = {min: 2, max: 6, height: [1, 3] as const, look: [0.5, 1] as const};
  const first = stringPose(rig, [0, 0, 0], null, 0);
  assert.deepEqual(
    first.position.map(v => v + 0),
    [0, 3, -6],
  );
  const dragged = stringPose(rig, [0, 0, 10], first.position);
  close(dragged.position[2], 4, 1e-9, 'pulled to the max distance behind the subject');
  const near = stringPose(rig, [0, 0, -5], first.position);
  close(Math.hypot(near.position[0], near.position[2] + 5), 2, 1e-9, 'pushed out to the min distance');
  close(near.position[1], 1);
  close(near.target[1], 0.5);
});

test('rail, close-up and shot poses', () => {
  const rail = railPose(
    {
      points: [
        [0, 0, 0],
        [10, 0, 0],
        [10, 0, 10],
      ],
      height: 2,
      look: 1,
    },
    [12, 5, 4],
  );
  assert.deepEqual(rail.position, [10, 2, 4]);
  assert.deepEqual(rail.target, [12, 6, 4]);
  const c = closeUpPose({center: [1, 2, 3], radius: 1}, 0, 0, 60, 1);
  close(c.position[2] - 3, 2, 1e-9, 'distance fits the sphere: r / sin(fov/2)');
  const a = pose([0, 0, 10], [0, 0, 0]),
    b = pose([10, 0, 0], [0, 0, 0], 30);
  const mid = shotPose(a, b, 5, 10, 'orbit');
  close(Math.hypot(...mid.position), 10, 1e-9, 'orbit keeps the distance instead of cutting through');
  close(mid.fov, 40);
  assert.deepEqual(shotPose(a, b, 10, 10).position, [10, 0, 0]);
  assert.deepEqual(shotPose(a, b, 0, 0).position, [10, 0, 0]);
});

test('transition length follows the pose change and lands exactly on a moving goal', () => {
  const t = createCameraTransition({k: 4, minTicks: 3, maxTicks: 50});
  const ticks = t.begin(pose([0, 0, 0], [0, 0, 1]), pose([16, 0, 0], [16, 0, 1]));
  assert.equal(ticks, Math.ceil(4 * Math.sqrt(32)));
  let goal: CameraPose = pose([16, 0, 0], [16, 0, 1]);
  let last: CameraPose = goal;
  const steps: number[] = [];
  for (let i = 0; i < ticks; i++) {
    goal = pose([16 + i * 0.1, 0, 0], [16 + i * 0.1, 0, 1]);
    const before = t.pose!.position[0];
    last = t.step(goal);
    steps.push(last.position[0] - before);
  }
  assert.deepEqual(last, goal, 'arrives exactly on the live goal');
  assert.ok(steps[0]! > steps.at(-2)!, 'decelerates');
  assert.equal(t.begin(pose([0, 0, 0], [0, 0, 1]), pose([0, 0, 0.001], [0, 0, 1])), 0, 'tiny changes cut');
});

test('carry moves the in-progress pose with a turning support', () => {
  const t = createCameraTransition();
  t.begin(pose([0, 0, 5], [0, 0, 0]), pose([10, 0, 5], [10, 0, 0]));
  t.carry([1, 0, 0], Math.PI / 2, [0, 0, 0]);
  const p = t.pose!;
  close(p.position[0], 5 + 1);
  close(p.position[2], 0);
  assert.throws(() => t.carry([Number.NaN, 0, 0]), RangeError);
});

test('letterbox eases at its rate and reports changes', () => {
  const l = createLetterbox(2);
  l.set(1);
  assert.deepEqual(l.step(0.25), {amount: 0.5, changed: true});
  assert.deepEqual(l.step(1), {amount: 1, changed: true});
  assert.deepEqual(l.step(1), {amount: 1, changed: false});
  assert.throws(() => l.set(2), RangeError);
});

test('the director system switches settings by volume, blends between rigs and returns from a scripted shot', async () => {
  let scripted = false;
  const volumes = createCameraVolumes({
    fallback: 'follow',
    volumes: [{id: 'room', shape: {kind: 'box', center: [20, 0, 0], half: [5, 5, 5]}, priority: 1, setting: 'fixed'}],
  });
  const scene = defineScene({
    id: 'director',
    title: 'Director',
    entities: [[Name({name: 'player'}), Transform({})]],
    systems: [
      cameraDirectorSystem({
        volumes,
        overrides: () => (scripted ? [{id: 'cut', setting: 'shot'}] : []),
        transition: {k: 2, minTicks: 4, maxTicks: 30},
        settings: {
          follow: (_ctx, s) => pose([s[0], s[1] + 3, s[2] - 6], [s[0], s[1], s[2]]),
          fixed: () => pose([20, 10, 10], [20, 0, 0], 40),
          shot: (_ctx, s) => closeUpPose({center: s, radius: 1}, 1, 0.2),
        },
      }),
    ],
  });
  const t = await testScene(scene);
  const player = () => t.world.get(t.ctx.named('player')!, Transform)!;
  t.run(1 / 60);
  assert.deepEqual(t.ctx.view.camera.position, [0, 3, -6]);
  player().x = 20;
  t.run(1 / 60);
  assert.notDeepEqual(t.ctx.view.camera.position, [20, 10, 10], 'blends instead of cutting');
  t.run(1);
  assert.deepEqual(t.ctx.view.camera.position, [20, 10, 10]);
  assert.equal(t.ctx.view.camera.fov, 40);
  const still = t.ctx.view.camera.position;
  t.run(0.5);
  assert.equal(t.ctx.view.camera.position, still, 'no rewrite while nothing moves');
  scripted = true;
  t.run(1);
  scripted = false;
  player().x = 30;
  t.run(1);
  assert.deepEqual(t.ctx.view.camera.position, [30, 3, -6], 'back on the live gameplay pose after the shot');
});

test('review fixes: per-world stickiness, carry pivot before the move, validation and frozen poses', async () => {
  const v = createCameraVolumes({
    fallback: 'f',
    stickiness: 1,
    volumes: [
      {id: 'a', shape: {kind: 'box', center: [0, 0, 0], half: [2, 2, 2]}, priority: 5, setting: 'a'},
      {id: 'b', shape: {kind: 'box', center: [4, 0, 0], half: [1.5, 2, 2]}, priority: 5, setting: 'b'},
    ],
  });
  const w1 = {},
    w2 = {};
  assert.equal(v.resolve([0, 0, 0], [], w1).setting, 'a');
  assert.equal(v.resolve([2.7, 0, 0], [], w2).setting, 'b', 'another world does not inherit stickiness');
  assert.equal(v.resolve([2.7, 0, 0], [], w1).setting, 'a', 'the same world keeps its sticky volume');
  assert.throws(() => v.resolve([0, 0, 0], [{id: 'x', setting: ''}]), RangeError);
  const t = createCameraTransition();
  t.begin(pose([0, 0, -5], [0, 0, 0]), pose([10, 0, 0], [0, 0, 0]));
  // Subject moved from the origin to x=1 while its support turned a quarter: the camera keeps its offset, rotated.
  t.carry([1, 0, 0], Math.PI / 2, [0, 0, 0]);
  const p = t.pose!;
  close(p.position[0], 1 - 5, 1e-9);
  close(p.position[2], 0, 1e-9);
  assert.ok(Object.isFrozen(p.position));
  assert.throws(() => stringPose({min: 2, max: 6, height: [1, 3]}, [0, 0, 0], [0, 0, 0], Number.NaN), RangeError);
  assert.throws(
    () => shotPose(pose([0, 0, 1], [0, 0, 0]), pose([1, 0, 0], [0, 0, 0]), 1, 2, 'curvy' as never),
    RangeError,
  );
  assert.deepEqual(
    shotPose(pose([0, 0, 10], [0, 0, 0]), pose([10, 0, 0], [0, 0, 0]), 10, 10, 'orbit').position,
    [10, 0, 0],
  );
  assert.throws(
    () => cameraDirectorSystem({volumes: v, settings: {a: () => pose([0, 0, 1], [0, 0, 0])}}),
    /no rig for setting/,
  );
});
