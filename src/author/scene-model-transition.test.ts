import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {World} from '../core/ecs/world';
import {Transform} from './defs';
import {Model, validateModel, MAX_MODEL_TRANSITION, type ModelData} from './model';
import {createSceneModels} from './scene-model';
import {createModelLibrary} from '../platform/assets/models';
import {MAX_TRANSITION_NODES} from './scene-model-transition';

async function waitFor(ready: () => boolean) {
  const deadline = Date.now() + 2000;
  while (!ready()) {
    assert.ok(Date.now() < deadline, 'model readiness deadline exceeded');
    await new Promise(r => setTimeout(r, 1));
  }
}
const close = (actual: number, expected: number, message?: string, tolerance = 1e-6) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${message ?? ''} expected ${expected}, got ${actual}`);
/** Keyframe values are stored in single precision, so a rotation angle near zero is only good to ~1e-4 radians. */
const angle = (actual: number, expected: number, message?: string) => close(actual, expected, message, 1e-3);
const smooth = (t: number) => t * t * (3 - 2 * t);

/** hand: 'rise' moves y 0→2 over 1 s, 'side' holds x=4; tail: only 'rise' turns it about y; 'side' never drives it. */
function fixture(model: Partial<ModelData> = {}, extraBones = 0) {
  const world = new World(),
    scene = new T.Scene(),
    life = new AbortController(),
    errors: unknown[] = [];
  const source = new T.Group(),
    hand = new T.Bone(),
    tail = new T.Bone();
  hand.name = 'hand';
  tail.name = 'tail';
  source.add(hand, tail);
  const extra: T.KeyframeTrack[] = [];
  for (let i = 0; i < extraBones; i++) {
    const b = new T.Bone();
    b.name = `b${i}`;
    source.add(b);
    extra.push(new T.VectorKeyframeTrack(`b${i}.position`, [0, 1], [0, 0, 0, 0, 1, 0]));
  }
  const quarter = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), Math.PI / 2).toArray();
  const clips = [
    new T.AnimationClip('rise', 1, [
      new T.VectorKeyframeTrack('hand.position', [0, 1], [0, 0, 0, 0, 2, 0]),
      new T.QuaternionKeyframeTrack('tail.quaternion', [0, 1], [...quarter, ...quarter]),
      ...extra,
    ]),
    new T.AnimationClip('side', 1, [new T.VectorKeyframeTrack('hand.position', [0, 1], [4, 0, 0, 4, 0, 0])]),
  ];
  const library = createModelLibrary({
    def: id => ({
      id,
      kind: 'model',
      title: id,
      licence: 'original',
      provenance: {},
      variants: [{path: id + '.glb', format: 'glb'}],
    }),
    fetchBytes: async () => new ArrayBuffer(16),
    parse: async () => ({scene: source.clone(true), animations: clips}),
  });
  const owner = createSceneModels({
    world,
    scene,
    library,
    signal: life.signal,
    invalidate() {},
    report: error => errors.push(error),
  });
  const e = world.spawn(Transform({}), Model({asset: 'model', clip: 'rise', loop: false, ...model}));
  const node = (name: string) => {
    let found: T.Object3D | undefined;
    scene.traverse(n => {
      if (n.name === name) found = n;
    });
    return found!;
  };
  return {world, scene, life, errors, owner, e, node, model: () => world.get(e, Model)!};
}
async function ready(f: ReturnType<typeof fixture>) {
  f.owner.sync();
  await waitFor(() => f.owner.socket(f.e, 'hand') !== null);
  f.owner.sync(0);
}

test('the default transition of zero keeps the existing hard cut', async () => {
  const f = fixture();
  await ready(f);
  f.owner.sync(0.5);
  close(f.node('hand').position.y, 1);
  f.model().clip = 'side';
  f.owner.sync(0);
  close(f.node('hand').position.x, 4);
  close(f.node('hand').position.y, 0);
  assert.deepEqual(f.errors, []);
  f.life.abort();
});

test('a transition starts from the displayed pose and eases into the new clip over its duration', async () => {
  const f = fixture({transition: 0.5});
  await ready(f);
  // The first clip after loading never blends in from the bind pose.
  f.owner.sync(0.5);
  close(f.node('hand').position.y, 1);
  f.model().clip = 'side';
  assert.equal(f.owner.sync(0), true);
  // Nothing jumps on the switching frame.
  close(f.node('hand').position.x, 0);
  close(f.node('hand').position.y, 1);
  f.owner.sync(0.25);
  const k = smooth(0.5);
  close(f.node('hand').position.x, 4 * k);
  close(f.node('hand').position.y, 1 - k);
  f.owner.sync(0.25);
  close(f.node('hand').position.x, 4);
  close(f.node('hand').position.y, 0);
  assert.deepEqual(f.errors, []);
  f.life.abort();
});

test('a node only the outgoing clip drove eases back to its original pose and is not left part-way', async () => {
  const f = fixture({transition: 1});
  await ready(f);
  f.owner.sync(0.5);
  const quarter = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), Math.PI / 2);
  angle(f.node('tail').quaternion.angleTo(quarter), 0, 'tail at clip pose');
  f.model().clip = 'side';
  f.owner.sync(0);
  f.owner.sync(0.5);
  angle(f.node('tail').quaternion.angleTo(new T.Quaternion()), (Math.PI / 2) * (1 - smooth(0.5)), 'tail mid-way');
  // A switch before completion restarts from the displayed, part-blended pose.
  const before = f.node('hand').position.clone(),
    tailBefore = f.node('tail').quaternion.clone();
  f.model().clip = '';
  f.owner.sync(0);
  close(f.node('hand').position.distanceTo(before), 0, 'hand continuity');
  angle(f.node('tail').quaternion.angleTo(tailBefore), 0, 'tail continuity');
  f.owner.sync(1);
  // Bind pose: every animated node returns to its original values.
  close(f.node('hand').position.length(), 0);
  angle(f.node('tail').quaternion.angleTo(new T.Quaternion()), 0);
  f.owner.sync(0.5);
  angle(f.node('tail').quaternion.angleTo(new T.Quaternion()), 0, 'no stale blend after completion');
  f.life.abort();
});

test('a revision restart of the same clip blends instead of snapping back to its first frame', async () => {
  const f = fixture({transition: 0.5});
  await ready(f);
  f.owner.sync(1);
  close(f.node('hand').position.y, 2);
  f.model().revision++;
  f.owner.sync(0);
  close(f.node('hand').position.y, 2);
  f.owner.sync(0.25);
  // The restarted clip has advanced 0.25 s (y = 0.5) and the blend is half-way in time.
  close(f.node('hand').position.y, 2 + (0.5 - 2) * smooth(0.5));
  f.owner.sync(0.25);
  close(f.node('hand').position.y, 1);
  f.life.abort();
});

test('paused playback holds a transition without reporting redraws, and resumes it', async () => {
  const f = fixture({transition: 0.5});
  await ready(f);
  f.owner.sync(0.5);
  f.model().clip = 'side';
  f.owner.sync(0.25);
  const held = f.node('hand').position.clone();
  f.model().playing = false;
  f.owner.sync(0);
  assert.equal(f.owner.sync(0.25), false);
  close(f.node('hand').position.distanceTo(held), 0);
  f.model().playing = true;
  assert.equal(f.owner.sync(0.25), true);
  close(f.node('hand').position.x, 4);
  f.life.abort();
});

test('pose overrides apply after the blend and removing them restores the blended pose', async () => {
  const f = fixture({transition: 1});
  await ready(f);
  f.owner.sync(0.5);
  f.model().clip = 'side';
  f.owner.sync(0);
  f.model().pose = [{node: 'hand', position: [9, 9, 9]}];
  f.owner.sync(0.5);
  close(f.node('hand').position.x, 9);
  f.model().pose = [];
  f.owner.sync(0);
  close(f.node('hand').position.x, 4 * smooth(0.5));
  close(f.node('hand').position.y, 1 - smooth(0.5));
  f.owner.sync(0.5);
  close(f.node('hand').position.x, 4);
  f.life.abort();
});

test('an unknown clip still cuts and reports; invalid transitions are refused before playback changes', async () => {
  const f = fixture({transition: 0.5});
  await ready(f);
  f.owner.sync(0.5);
  f.model().clip = 'missing';
  f.owner.sync(0);
  assert.match(String(f.errors[0]), /unknown or ambiguous clip missing/);
  close(f.node('hand').position.y, 0);
  for (const transition of [-0.1, MAX_MODEL_TRANSITION + 0.01, Number.NaN, Infinity])
    assert.throws(() => validateModel({...f.model(), transition}), /model: invalid definition/);
  validateModel({...f.model(), transition: MAX_MODEL_TRANSITION});
  const {transition: _omitted, ...withoutTransition} = f.model();
  validateModel(withoutTransition as ModelData);
  f.model().transition = 5;
  assert.throws(() => f.owner.sync(0), /model: invalid definition/);
  f.life.abort();
});

test('a rig over the transition node budget cuts, reports once and keeps playing', async () => {
  const f = fixture({transition: 0.5}, MAX_TRANSITION_NODES);
  await ready(f);
  f.owner.sync(0.5);
  f.model().clip = 'side';
  f.owner.sync(0);
  close(f.node('hand').position.x, 4);
  f.model().clip = 'rise';
  f.owner.sync(0);
  assert.equal(f.errors.length, 1);
  assert.match(String(f.errors[0]), /animated nodes; clip changes cut/);
  f.life.abort();
  assert.equal(f.scene.children.length, 0);
});
