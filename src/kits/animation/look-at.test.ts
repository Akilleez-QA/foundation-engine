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
    {joints: chain, ignoreBeyond: 2},
  ];
  for (const options of bad) assert.throws(() => createLookAt(options), RangeError);
  const look = createLookAt({joints: chain});
  assert.throws(() => look.update(Number.NaN, null), RangeError);
  assert.throws(() => look.update(0.1, {x: Infinity, y: 0, z: 1}), RangeError);
});

test('the joint parts always add up to the clamped aim (no residual lost), across random chains', () => {
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let run = 0; run < 500; run++) {
    const n = 1 + Math.floor(rnd() * 4);
    const joints = Array.from({length: n}, (_, i) => ({
      joint: `j${i}`,
      share: 0.05 + rnd() * 0.95,
      yaw: [-rnd() * 1.5, rnd() * 1.5] as [number, number],
      pitch: [-rnd() * 1.5, rnd() * 1.5] as [number, number],
    }));
    const look = createLookAt({joints, smoothing: 0, maxSpeed: 100});
    const s = look.update(1, dir((rnd() - 0.5) * 3, (rnd() - 0.5) * 1.4));
    const sumYaw = s.joints.reduce((a, j) => a + j.yaw, 0),
      sumPitch = s.joints.reduce((a, j) => a + j.pitch, 0);
    close(sumYaw, s.yaw, 1e-9, `run ${run} yaw`);
    close(sumPitch, s.pitch, 1e-9, `run ${run} pitch`);
    s.joints.forEach((j, i) => {
      assert.ok(j.yaw >= joints[i]!.yaw[0] - 1e-12 && j.yaw <= joints[i]!.yaw[1] + 1e-12);
    });
  }
  const look = createLookAt({
    joints: [
      {joint: 'neck', share: 0.1, yaw: [-0.5, 0.5], pitch: [-0.5, 0.5]},
      {joint: 'head', share: 1, yaw: [-0.5, 0.5], pitch: [-0.5, 0.5]},
    ],
    smoothing: 0,
    maxSpeed: 100,
  });
  const s = look.update(1, dir(1, 0));
  assert.deepEqual(
    s.joints.map(j => j.yaw),
    [0.5, 0.5],
    'the neck takes back what the head could not',
  );
});

test('targets behind or straight above do not flip yaw between its limits', () => {
  const look = createLookAt({
    joints: [{joint: 'head', share: 1, yaw: [-1.2, 1.2], pitch: [-1.2, 1.2]}],
    smoothing: 0,
    maxSpeed: 100,
  });
  assert.equal(look.update(1, {x: 1e-6, y: 1, z: -0.3}).engaged, false, 'behind is outside the default cone');
  const up = look.update(1, {x: 1e-6, y: 1, z: 1e-6});
  assert.ok(Math.abs(up.yaw) < 1e-3, `yaw fades near vertical: ${up.yaw}`);
  const left = look.update(1, {x: -1e-6, y: 1, z: 1e-6});
  assert.ok(Math.abs(left.yaw - up.yaw) < 2e-3);
});

test('hierarchical parent frames from the rest pose make the posed end joint aim exactly', () => {
  const restLocal = [
    new Quaternion().setFromAxisAngle(new Vector3(1, 0.3, 0).normalize(), 0.4),
    new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -0.7),
    new Quaternion().setFromAxisAngle(new Vector3(0.2, 1, 0.1).normalize(), 0.3),
  ];
  // Parent frame of joint i relative to the root = product of the rest rotations above it.
  const frames: Quaternion[] = [];
  let acc = new Quaternion();
  for (const r of restLocal) {
    frames.push(acc.clone());
    acc = acc.clone().multiply(r);
  }
  const restWorld = acc;
  const look = createLookAt({
    joints: restLocal.map((_, i) => ({
      joint: `j${i}`,
      share: 0.5,
      yaw: [-0.6, 0.6] as [number, number],
      pitch: [-0.4, 0.4] as [number, number],
      parentFrame: frames[i]!.toArray() as [number, number, number, number],
    })),
    smoothing: 0,
    maxSpeed: 100,
  });
  const s = look.update(1, dir(0.9, 0.5));
  const posed = look.apply(
    restLocal.map((q, i) => ({
      joint: `j${i}`,
      position: [0, 0, 0],
      rotation: q.toArray() as [number, number, number, number],
    })),
    s,
  );
  const world = posed.reduce((w, p) => w.multiply(new Quaternion(...p.rotation)), new Quaternion());
  const aim = new Quaternion()
    .setFromAxisAngle(new Vector3(0, 1, 0), s.yaw)
    .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -s.pitch));
  assert.ok(world.angleTo(aim.multiply(restWorld)) < 1e-6);
});

test('limits are read once, apply refuses foreign states, duplicates and invalid rotations', () => {
  let reads = 0;
  const yaw = [0, 0.5] as unknown as [number, number];
  Object.defineProperty(yaw, 0, {get: () => (reads++ === 0 ? -0.5 : -3)});
  const look = createLookAt({joints: [{joint: 'head', share: 1, yaw, pitch: [-0.2, 0.2]}]});
  assert.deepEqual(look.limits.yaw, [-0.5, 0.5]);
  const s = look.update(0.1, dir(0.2, 0));
  const forged = {...s};
  assert.throws(
    () => look.apply([{joint: 'head', position: [0, 0, 0], rotation: [0, 0, 0, 1]}], forged),
    /state returned/,
  );
  assert.throws(
    () =>
      look.apply(
        [
          {joint: 'head', position: [0, 0, 0], rotation: [0, 0, 0, 1]},
          {joint: 'head', position: [0, 0, 0], rotation: [0, 0, 0, 1]},
        ],
        s,
      ),
    /repeats/,
  );
  assert.throws(() => look.apply([{joint: 'head', position: [0, 0, 0], rotation: [0, 0, 0, 0]}], s), /invalid/);
});
