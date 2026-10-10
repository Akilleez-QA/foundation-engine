import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {World} from '../core/ecs/world';
import {coreKnobs} from '../platform/render/quality';
import {Transform} from './defs';
import {LOCAL_LIGHT_CAPS, PointLight, SpotLight} from './lights';
import {createLightSlots} from './light-slots';
import {createSceneLightRig} from './scene-light-rig';

const count = (scene: T.Scene) => {
  let points = 0,
    spots = 0;
  scene.traverse(n => {
    if ((n as T.PointLight).isPointLight) points++;
    if ((n as T.SpotLight).isSpotLight) spots++;
  });
  return {points, spots};
};

test('the lights.local-max knob presets are the caps the runtime applies', () => {
  const knob = coreKnobs.find(k => k.id === 'lights.local-max');
  assert.ok(knob);
  assert.deepEqual(knob.presets, LOCAL_LIGHT_CAPS);
  assert.equal(knob.applies, 'reenter-scene');
  assert.equal(knob.wired, undefined, 'unwired until a template reads it, like effects.particles');
});

test('the rig is fixed for the visit: dark slots stay in the scene at intensity 0', () => {
  const scene = new T.Scene(),
    world = new World();
  const slots = createLightSlots({slots: {point: 3, spot: 1}, enabled: true, report: () => {}});
  const rig = createSceneLightRig(scene, {point: 3, spot: 1});
  assert.deepEqual(count(scene), {points: 3, spots: 1});
  const e = world.spawn(Transform({x: 2, y: 1, z: -1}), PointLight({color: 0xff8800, intensity: 6, distance: 8}));
  slots.sync(world);
  assert.equal(rig.apply(world, slots), true);
  const [lit, dark] = rig.lights.points;
  assert.deepEqual(lit!.position.toArray(), [2, 1, -1]);
  assert.deepEqual([lit!.intensity, lit!.distance, lit!.decay, lit!.color.getHex()], [6, 8, 2, 0xff8800]);
  assert.equal(dark!.intensity, 0);
  assert.equal(rig.apply(world, slots), false, 'nothing changed: nothing to draw');
  world.get(e, PointLight)!.visible = false;
  slots.sync(world);
  assert.equal(rig.apply(world, slots), true);
  assert.equal(lit!.intensity, 0, 'invisible: dark, but still in the scene');
  world.despawn(e);
  slots.sync(world);
  assert.equal(rig.apply(world, slots), true);
  assert.deepEqual(count(scene), {points: 3, spots: 1}, 'despawning changes no light count');
  rig.dispose();
  assert.deepEqual(count(scene), {points: 0, spots: 0});
});

test('a spot aims along its forward axis, or at its target', () => {
  const scene = new T.Scene(),
    world = new World();
  const slots = createLightSlots({slots: {point: 0, spot: 1}, enabled: true, report: () => {}});
  const rig = createSceneLightRig(scene, {point: 0, spot: 1});
  const e = world.spawn(Transform({y: 6, rx: -Math.PI / 2}), SpotLight({intensity: 20, angle: 0.5, penumbra: 0.4}));
  slots.sync(world);
  rig.apply(world, slots);
  const spot = rig.lights.spots[0]!;
  const aim = spot.target.position.clone().sub(spot.position);
  assert.ok(aim.y < -0.999, `aims down: ${aim.toArray()}`);
  assert.deepEqual([spot.angle, spot.penumbra], [0.5, 0.4]);
  assert.ok(scene.children.includes(spot.target), 'the target follows the scene graph');
  world.get(e, SpotLight)!.target = [3, 0, 0];
  slots.sync(world);
  assert.equal(rig.apply(world, slots), true);
  assert.deepEqual(spot.target.position.toArray(), [3, 0, 0]);
  rig.dispose();
});

test('lights on an interpolated entity follow its drawn pose', () => {
  const scene = new T.Scene(),
    world = new World();
  const slots = createLightSlots({slots: {point: 1, spot: 0}, enabled: true, report: () => {}});
  const rig = createSceneLightRig(scene, {point: 1, spot: 0});
  world.spawn(Transform({x: 4, y: 1, z: 0}), PointLight({intensity: 2}));
  slots.sync(world);
  assert.equal(
    rig.apply(world, slots, (_e, tr) => ({...tr, x: tr.x - 1})),
    true,
  );
  assert.deepEqual(rig.lights.points[0]!.position.toArray(), [3, 1, 0]);
});
