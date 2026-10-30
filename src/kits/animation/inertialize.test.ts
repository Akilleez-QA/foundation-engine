import test from 'node:test';
import assert from 'node:assert/strict';
import {createInertializer, MAX_INERTIAL_BLEND, type JointPose} from './index';
import {must} from '../../testing/must';
const joints = ['hip', 'arm'];
/** Rotation about +Y by `angle` radians. */
const yaw = (angle: number) => [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)] as const;
const pose = (hipX: number, armAngle: number): JointPose[] => [
  {joint: 'hip', position: [hipX, 1, 0], rotation: [0, 0, 0, 1]},
  {joint: 'arm', position: [0, 0, 0], rotation: yaw(armAngle)},
];
const copy = (p: readonly JointPose[]): JointPose[] =>
  p.map(({joint, position: [x, y, z], rotation: [qx, qy, qz, qw]}) => ({
    joint,
    position: [x, y, z],
    rotation: [qx, qy, qz, qw],
  }));
/** Rotation angle about +Y of a unit quaternion with only y and w components. */
const angleOf = (q: readonly number[]) => 2 * Math.atan2(must(q[1]), must(q[3]));
const near = (a: number, b: number, tolerance: number, what: string) =>
  assert.ok(Math.abs(a - b) <= tolerance, `${what}: ${a} vs ${b}`);

test('inertial switch keeps position and velocity continuous, then reaches the target', () => {
  // Outgoing: hip moving +2/s, arm turning +3 rad/s. Incoming: hip still at x = 1, arm at rest at 0.5 rad.
  const dt = 1 / 60,
    from = pose(0, 0),
    fromPrevious = pose(-2 * dt, -3 * dt),
    to = pose(1, 0.5);
  const blend = createInertializer(joints);
  blend.switchTo({from, fromPrevious, to, toPrevious: to, dt, blendTime: 0.4});
  const at = (t: number) => copy(blend.sample(to, t));
  const start = at(0);
  near(must(start[0]).position[0], 0, 1e-12, 'position at switch');
  near(angleOf(must(start[1]).rotation), 0, 1e-12, 'rotation at switch');
  const h = 1e-5,
    later = at(h);
  near((must(later[0]).position[0] - must(start[0]).position[0]) / h, 2, 1e-3, 'velocity at switch');
  near((angleOf(must(later[1]).rotation) - angleOf(must(start[1]).rotation)) / h, 3, 1e-3, 'angular velocity');
  const end = at(0.4);
  assert.deepEqual(must(end[0]).position, [1, 1, 0]);
  near(angleOf(must(end[1]).rotation), 0.5, 1e-12, 'rotation at end');
  // The offset arrives with zero velocity: samples straddling the end agree to second order.
  near((must(at(0.4)[0]).position[0] - must(at(0.4 - h)[0]).position[0]) / h, 0, 1e-3, 'velocity at end');
  assert.equal(blend.blending(0.39), true);
  assert.equal(blend.blending(0.4), false);
});

test('rotation offsets take the shortest hemisphere for sign-flipped quaternions', () => {
  const blend = createInertializer(['arm']);
  const target = yaw(0.2),
    [x, y, z, w] = yaw(-0.2),
    from: JointPose[] = [{joint: 'arm', position: [0, 0, 0], rotation: [-x, -y, -z, -w]}];
  blend.switchTo({from, to: [{joint: 'arm', position: [0, 0, 0], rotation: target}], blendTime: 1});
  let previous = -0.2;
  for (let step = 1; step <= 20; step++) {
    const t = step / 20;
    const q = must(blend.sample([{joint: 'arm', position: [0, 0, 0], rotation: target}], t)[0]).rotation;
    const angle = angleOf(q[3] < 0 ? q.map(v => -v) : q);
    // Monotone through 0.4 radians, never the 2π - 0.4 way round.
    assert.ok(angle >= previous - 1e-12 && angle <= 0.2 + 1e-12, `angle ${angle} at ${t}`);
    previous = angle;
  }
  near(previous, 0.2, 1e-9, 'converged');
});

test('a re-switch mid-blend starts from the current output and replaces the old offset', () => {
  const dt = 0.01,
    blend = createInertializer(joints),
    a = pose(0, 0),
    b = pose(4, 1);
  blend.switchTo({from: a, to: b, blendTime: 0.5});
  const previousOutput = copy(blend.sample(b, 0.2 - dt)),
    output = blend.sample(b, 0.2),
    shown = copy(output),
    c = pose(-3, -1);
  // Passing the live output buffer as `from` is allowed.
  blend.switchTo({from: output, fromPrevious: previousOutput, to: c, dt, blendTime: 0.3});
  const after = blend.sample(c, 0);
  near(must(after[0]).position[0], must(shown[0]).position[0], 1e-12, 'no jump on re-switch');
  near(angleOf(must(after[1]).rotation), angleOf(must(shown[1]).rotation), 1e-12, 'no rotation jump');
  const velocityBefore = (must(shown[0]).position[0] - must(previousOutput[0]).position[0]) / dt;
  const h = 1e-6,
    velocityAfter = (must(blend.sample(c, h)[0]).position[0] - must(shown[0]).position[0]) / h;
  near(velocityAfter, velocityBefore, 1e-3, 'velocity carried through re-switch');
  assert.deepEqual(must(blend.sample(c, 0.3)[0]).position, [-3, 1, 0]);
  blend.reset();
  assert.equal(blend.blending(0), false);
  assert.deepEqual(must(blend.sample(c, 0)[0]).position, [-3, 1, 0]);
});

test('zero blend time switches immediately and samples reuse one output buffer', () => {
  const blend = createInertializer(joints),
    to = pose(5, 0.3);
  blend.switchTo({from: pose(0, 0), to, blendTime: 0});
  const first = blend.sample(to, 0);
  assert.deepEqual(must(first[0]).position, [5, 1, 0]);
  near(angleOf(must(first[1]).rotation), 0.3, 1e-12, 'immediate rotation');
  assert.equal(blend.sample(to, 1), first);
  assert.equal(blend.blending(0), false);
});

test('bounds and invalid input are refused without changing the blend in progress', () => {
  assert.throws(() => createInertializer([]), /joint list/);
  assert.throws(() => createInertializer(['a', 'a']), /joint list/);
  assert.throws(() => createInertializer(Array.from({length: 129}, (_, i) => `j${i}`)), /joint list/);
  assert.equal(createInertializer(Array.from({length: 128}, (_, i) => `j${i}`)).joints.length, 128);
  const blend = createInertializer(joints),
    to = pose(1, 0);
  blend.switchTo({from: pose(0, 0), to, blendTime: 1});
  const refused: [object, RegExp][] = [
    [{from: pose(0, 0), to, blendTime: -0.1}, /blend time/],
    [{from: pose(0, 0), to, blendTime: MAX_INERTIAL_BLEND + 0.1}, /blend time/],
    [{from: pose(0, 0), to, blendTime: Number.NaN}, /blend time/],
    [{from: pose(Number.NaN, 0), to, blendTime: 0.2}, /from position/],
    [{from: pose(0, 0), to: [...to].reverse(), blendTime: 0.2}, /every joint in order/],
    [{from: pose(0, 0), to: to.slice(1), blendTime: 0.2}, /every joint in order/],
    [{from: pose(0, 0), fromPrevious: pose(0, 0), to, blendTime: 0.2}, /dt/],
    [{from: pose(0, 0), fromPrevious: pose(0, 0), to, dt: 2, blendTime: 0.2}, /dt/],
    [
      {from: [pose(0, 0)[0], {joint: 'arm', position: [0, 0, 0], rotation: [0, 0, 0, 0]}], to, blendTime: 0.2},
      /from rotation/,
    ],
  ];
  for (const [input, message] of refused)
    assert.throws(() => blend.switchTo(input as Parameters<typeof blend.switchTo>[0]), message);
  // The original one-second blend from x = 0 is intact.
  near(must(blend.sample(to, 0)[0]).position[0], 0, 1e-12, 'state unchanged');
  assert.equal(blend.blending(0.9), true);
  assert.throws(() => blend.sample(to, -1), /elapsed/);
  assert.throws(() => blend.sample(pose(Number.POSITIVE_INFINITY, 0), 0), /target position/);
});

test('inertial samples are deterministic for identical inputs', () => {
  const run = () => {
    const blend = createInertializer(joints);
    blend.switchTo({from: pose(0.3, 2), fromPrevious: pose(0.2, 1.9), to: pose(1, -2), dt: 0.02, blendTime: 0.35});
    return [0, 0.1, 0.2, 0.3].map(t => copy(blend.sample(pose(1, -2), t)));
  };
  assert.deepEqual(run(), run());
});
