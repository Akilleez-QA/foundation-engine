import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defineScene, Name, Transform, testScene, type SceneContext} from '../../author';
import {cameraSystem, supportOffsets, type SupportFraming} from './index';

async function scene(framing: SupportFraming, mode: 'follow' | 'orbit' = 'follow') {
  const s = defineScene({
    id: 'support',
    title: 'Support',
    entities: [[Name({name: 'player'}), Transform({x: 0, y: 0, z: 0})]],
    systems: [cameraSystem(mode, {smooth: 0, distance: 4, height: 3, ...framing})],
  });
  const t = await testScene(s);
  const player = () => t.world.get(t.ctx.named('player')!, Transform)!;
  return {t, player};
}

test('without a support query the camera follows the target height exactly as before', async () => {
  const {t, player} = await scene({});
  t.run(1 / 60);
  player().y = 1.5;
  t.run(1 / 60);
  assert.deepEqual(t.ctx.view.camera.position, [0, 4.5, -4]);
  assert.deepEqual(t.ctx.view.camera.target, [0, 2, 0]);
});

test('a jump over level support leaves the framing on the support height', async () => {
  const {t, player} = await scene({support: () => 0});
  t.run(1 / 60);
  const rest = {position: [...t.ctx.view.camera.position], target: [...t.ctx.view.camera.target]};
  for (const y of [0.4, 1.2, 1.9, 0.7]) {
    player().y = y;
    t.run(1 / 60);
    assert.deepEqual(t.ctx.view.camera.position, rest.position, `position at y=${y}`);
    assert.deepEqual(t.ctx.view.camera.target, rest.target, `target at y=${y}`);
  }
});

test('weights and the limit shape the offset; a long fall is followed beyond the limit', async () => {
  const {t, player} = await scene({support: () => 0, supportWeight: 1, supportTargetWeight: 0.5, supportLimit: 1});
  player().y = 0.8;
  t.run(1 / 60);
  // position: 0.8 + 3 - 0.8 = 3; target: 0.8 + 0.5 - 0.4
  assert.ok(Math.abs(t.ctx.view.camera.position[1] - 3) < 1e-12);
  assert.ok(Math.abs(t.ctx.view.camera.target[1] - 0.9) < 1e-12);
  player().y = 10;
  t.run(1 / 60);
  assert.ok(Math.abs(t.ctx.view.camera.position[1] - (10 + 3 - 1)) < 1e-12, 'clamped to the limit');
  assert.ok(Math.abs(t.ctx.view.camera.target[1] - (10 + 0.5 - 1)) < 1e-12);
  player().y = -10;
  t.run(1 / 60);
  assert.ok(Math.abs(t.ctx.view.camera.position[1] - (-10 + 3 + 1)) < 1e-12, 'below the support is clamped too');
});

test('null support follows the target itself; the query sees the current target position', async () => {
  const seen: number[][] = [];
  let ground: number | null = null;
  const {t, player} = await scene({
    support: (_ctx: SceneContext, p) => {
      seen.push([p.x, p.y, p.z]);
      return ground;
    },
  });
  player().y = 1;
  player().x = 2;
  t.run(1 / 60);
  assert.deepEqual(t.ctx.view.camera.target, [2, 1.5, 0]);
  assert.deepEqual(seen.at(-1), [2, 1, 0]);
  ground = 0.5;
  t.run(1 / 60);
  assert.deepEqual(t.ctx.view.camera.target, [2, 1, 0]);
});

test('orbit framing anchors too, and eased motion still converges to the anchored pose', async () => {
  const s = defineScene({
    id: 'orbit-support',
    title: 'Orbit',
    entities: [[Name({name: 'player'}), Transform({y: 1})]],
    systems: [cameraSystem('orbit', {smooth: 0.05, distance: 5, pitch: 0, support: () => 0})],
  });
  const t = await testScene(s);
  t.run(2);
  assert.deepEqual(t.ctx.view.camera.target, [0, 0, 0]);
  assert.deepEqual(t.ctx.view.camera.position, [0, 0, 5]);
});

test('invalid configuration is refused at construction and an invalid height fails the frame', async () => {
  for (const bad of [
    {supportWeight: -0.1},
    {supportWeight: 1.1},
    {supportTargetWeight: Number.NaN},
    {supportLimit: 0},
    {supportLimit: Infinity},
    {supportLimit: 2e6},
  ])
    assert.throws(() => cameraSystem('follow', {support: () => 0, ...bad}), RangeError, JSON.stringify(bad));
  assert.throws(() => supportOffsets({supportWeight: 2}), RangeError);
  assert.equal(supportOffsets({}), undefined);
  const offset = supportOffsets({support: () => 0})!;
  assert.throws(() => offset(Number.NaN, 0), /support height must be finite or null/);
  assert.throws(() => offset(Infinity, 0), /support height must be finite or null/);
  assert.equal(offset(null, 3), null);
  assert.deepEqual(offset(0, 5), {position: -2, target: -2});

  const {t, player} = await scene({support: () => Number.NaN});
  const before = [...t.ctx.view.camera.position];
  player().y = 1;
  assert.throws(() => t.run(1 / 60), /support height must be finite or null/);
  assert.deepEqual(t.ctx.view.camera.position, before, 'a failed query publishes no pose');
});
