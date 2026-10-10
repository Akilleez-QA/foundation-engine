import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Quaternion, Vector3} from 'three';
import {createLookAt, type JointPose, type LookAtJoint} from './index';
import {blendPoseLayers} from './pose-layers';

const chain: LookAtJoint[] = [
  {joint: 'neck', share: 0.4, yaw: [-0.5, 0.5], pitch: [-0.3, 0.3]},
  {joint: 'head', share: 1, yaw: [-0.8, 0.8], pitch: [-0.5, 0.5]},
];
const close = (a: number, b: number, tol = 1e-9, msg = '') => assert.ok(Math.abs(a - b) < tol, `${msg} ${a} vs ${b}`);
const dir = (yaw: number, pitch: number) => ({
  x: Math.sin(yaw) * Math.cos(pitch),
  y: Math.sin(pitch),
  z: Math.cos(yaw) * Math.cos(pitch),
});

test('snapping look-at reaches the target direction and splits it over the chain by share and limits', () => {
  const look = createLookAt({joints: chain, smoothing: 0, maxSpeed: 100});
  const s = look.update(1, dir(0.6, 0.2));
  assert.equal(s.engaged, true);
  close(s.yaw, 0.6);
  close(s.pitch, 0.2);
  close(s.joints[0]!.yaw, 0.24, 1e-9, 'neck takes 40%');
  close(s.joints[1]!.yaw, 0.36, 1e-9, 'head takes the rest');
  // The composed rotation turns the forward axis onto the requested direction.
  const q = new Quaternion(...s.joints[0]!.rotation).multiply(new Quaternion(...s.joints[1]!.rotation));
  const f = new Vector3(0, 0, 1).applyQuaternion(q);
  const want = dir(0.6, 0.2);
  close(f.x, want.x, 1e-9);
  close(f.y, want.y, 1e-9);
  close(f.z, want.z, 1e-9);
});

test('limits clamp the total and overflow flows to the next joint', () => {
  const look = createLookAt({joints: chain, smoothing: 0, maxSpeed: 100});
  assert.deepEqual(look.limits.yaw, [-1.3, 1.3]);
  const s = look.update(1, dir(1.5, -1));
  close(s.yaw, 1.3);
  close(s.pitch, -0.8);
  close(s.joints[0]!.yaw, 0.5, 1e-9, 'neck share 0.52 clamps to its limit 0.5');
  close(s.joints[1]!.yaw, 0.8);
});

test('targets behind or absent relax to rest; smoothing and the speed cap bound each step', () => {
  const look = createLookAt({joints: chain, smoothing: 0.2, maxSpeed: 1, ignoreBeyond: 1.5});
  let s = look.update(0.1, dir(0.8, 0));
  assert.ok(s.yaw > 0 && s.yaw <= 0.1 + 1e-12, `capped at 1 rad/s: ${s.yaw}`);
  for (let i = 0; i < 100; i++) s = look.update(0.1, dir(0.8, 0));
  close(s.yaw, 0.8, 1e-6);
  s = look.update(0.1, {x: 0, y: 0, z: -1});
  assert.equal(s.engaged, false, 'behind the front cone');
  assert.ok(s.yaw < 0.8);
  for (let i = 0; i < 100; i++) s = look.update(0.1, null);
  close(s.yaw, 0, 1e-6);
  assert.equal(look.update(0.1, {x: 0, y: 0, z: 0}).engaged, false, 'zero-length direction');
  s = look.update(0.1, dir(0.5, 0));
  close(look.reset().yaw, 0);
});

test('parent frames conjugate the delta; apply composes onto a base pose and other layers', () => {
  const turned = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2).toArray() as [
    number,
    number,
    number,
    number,
  ];
  const look = createLookAt({
    joints: [{joint: 'head', share: 1, yaw: [-1, 1], pitch: [-1, 1], parentFrame: turned}],
    smoothing: 0,
    maxSpeed: 100,
  });
  const s = look.update(1, dir(0.4, 0));
  // In a parent rolled 90° about Z, a root yaw about Y becomes a local rotation about X.
  const axisLocal = new Vector3(0, 1, 0).applyQuaternion(new Quaternion(...turned).invert());
  const expected = new Quaternion().setFromAxisAngle(axisLocal, 0.4);
  assert.ok(new Quaternion(...s.joints[0]!.rotation).angleTo(expected) < 1e-9);
  const base: JointPose[] = [
    {joint: 'spine', position: [0, 1, 0], rotation: [0, 0, 0, 1]},
    {joint: 'head', position: [0, 2, 0], rotation: [0, 0, 0, 1]},
  ];
  const posed = look.apply(blendPoseLayers(base, []), s);
  assert.deepEqual(posed[0], base[0]);
  assert.ok(new Quaternion(...posed[1]!.rotation).angleTo(expected) < 1e-9);
  assert.throws(() => look.apply([base[0]!], s), /lacks chain joint head/);
});

test('configuration and inputs are validated', () => {
  const bad: Parameters<typeof createLookAt>[0][] = [
    {joints: []},
    {joints: Array.from({length: 9}, (_, i) => ({joint: `j${i}`, share: 1, yaw: [-0.1, 0.1], pitch: [-0.1, 0.1]}))},
    {joints: [chain[0]!, chain[0]!]},
    {joints: [{...chain[0]!, share: 0}]},
    {joints: [{...chain[0]!, yaw: [0.1, 0.5]}]},
    {joints: [{...chain[0]!, pitch: [-2, 0.5]}]},
    {joints: [{...chain[0]!, parentFrame: [0, 0, 0, 0]}]},
    {joints: chain, smoothing: -1},
    {joints: chain, maxSpeed: 0},
    {joints: chain, ignoreBeyond: 4},
  ];
  for (const options of bad) assert.throws(() => createLookAt(options), RangeError);
  const look = createLookAt({joints: chain});
  assert.throws(() => look.update(Number.NaN, null), RangeError);
  assert.throws(() => look.update(0.1, {x: Infinity, y: 0, z: 1}), RangeError);
});
