import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {World} from '../core/ecs/world';
import {coreKnobs} from '../platform/render/quality';
import {defineScene, Transform} from './defs';
import {defineEnvironment} from './environment';
import {PointLight, sceneLights, SpotLight} from './lights';
import {createLightSlots, shadowedSlotsFor} from './light-slots';
import {createSceneLightRig, createSunShadow} from './scene-light-rig';
import {bindEnvironment} from './scene-environment';
import {localShadowMapSize, SHADOWED_LIGHT_CAPS, Shadow, sceneShadows, shadowFlags} from './shadow-casting';
import {testScene} from './testing';

test('sceneShadows and Shadow validate; flags follow the override, then the scene default', () => {
  assert.deepEqual(sceneShadows().defaults, {cast: 'all-shapes', receive: 'all'});
  assert.throws(
    () => sceneShadows(JSON.parse('{"cast": "everything"}')),
    /shadows: cast must be 'all-shapes' or 'none'/,
  );
  assert.throws(() => sceneShadows(JSON.parse('{"receive": "some"}')), /shadows: receive/);
  assert.throws(() => Shadow(JSON.parse('{"cast": 1}')), /Shadow: cast and receive must be booleans/);
  assert.deepEqual(Shadow({cast: false}).value, {cast: false, receive: true});
  const all = sceneShadows(),
    none = sceneShadows({cast: 'none', receive: 'none'});
  assert.deepEqual(
    shadowFlags(undefined, {cast: true, receive: true}),
    {cast: false, receive: false},
    'no scene shadows',
  );
  assert.deepEqual(shadowFlags(all, undefined), {cast: true, receive: true});
  assert.deepEqual(shadowFlags(none, undefined), {cast: false, receive: false});
  assert.deepEqual(shadowFlags(all, {cast: false, receive: true}), {cast: false, receive: true});
  assert.deepEqual(shadowFlags(none, {cast: true, receive: false}), {cast: true, receive: false});
  assert.throws(
    () => defineScene({id: 'bad', title: 'Bad', shadows: JSON.parse('{"kind": "x"}')}),
    /scene bad: shadows must be sceneShadows/,
  );
});

test('the lights.shadowed-max knob is the tier bound: reference 4, high 2, medium 1, low 0', () => {
  const knob = coreKnobs.find(k => k.id === 'lights.shadowed-max');
  assert.ok(knob);
  assert.deepEqual(knob.presets, SHADOWED_LIGHT_CAPS);
  assert.equal(knob.applies, 'reenter-scene');
  assert.deepEqual(localShadowMapSize(4), {point: 512, spot: 1024});
  assert.deepEqual(localShadowMapSize(2), {point: 512, spot: 512});
});

test('the sun shadow is validated with the environment', () => {
  const base = {
    background: 0,
    ambient: {sky: 0xffffff, ground: 0, intensity: 1},
    haze: null,
    points: [],
    pointSize: 1,
  };
  const sun = (shadow: unknown) =>
    defineEnvironment({
      ...base,
      directional: {color: 0xffffff, intensity: 1, position: [1, 2, 3], shadow: JSON.parse(JSON.stringify(shadow))},
    });
  assert.deepEqual(sun({extent: 14}).directional.shadow, {extent: 14});
  assert.throws(() => sun({extent: 0}), /directional\.shadow\.extent must be in \(0, 200\]/);
  assert.throws(() => sun({extent: 201}), /extent/);
  assert.throws(() => sun({extent: 10, softness: 'blurry'}), /softness must be 'hard' or 'soft'/);
});

test('shadowed slots are chosen once: essential first, then entity order, bounded by the cap and the slots', () => {
  const world = new World();
  const a = world.spawn(Transform(), PointLight({shadow: true}));
  world.spawn(Transform(), PointLight());
  const vital = world.spawn(Transform(), SpotLight({shadow: true, essential: true}));
  world.spawn(Transform(), PointLight({shadow: true}));
  assert.deepEqual(shadowedSlotsFor(world, {point: 8, spot: 2}, 4), {point: 2, spot: 1});
  assert.deepEqual(shadowedSlotsFor(world, {point: 8, spot: 2}, 2), {point: 1, spot: 1}, 'the essential spot first');
  assert.deepEqual(shadowedSlotsFor(world, {point: 8, spot: 2}, 0), {point: 0, spot: 0}, 'low: none');
  assert.deepEqual(shadowedSlotsFor(world, {point: 1, spot: 0}, 4), {point: 1, spot: 0}, 'never more than the slots');
  assert.ok(a < vital);
});

test('a shadow light takes a shadowed slot; others never do; a late one shines without a shadow, reported once', () => {
  const world = new World(),
    reports: string[] = [];
  const plain = world.spawn(Transform(), PointLight());
  const caster = world.spawn(Transform(), PointLight({shadow: true}));
  const slots = createLightSlots({
    slots: {point: 3, spot: 0},
    enabled: true,
    shadowed: shadowedSlotsFor(world, {point: 3, spot: 0}, 1),
    shadows: true,
    report: m => reports.push(m),
  });
  slots.sync(world);
  assert.deepEqual(slots.stats.shadowed, {point: 1, spot: 0});
  assert.equal(slots.point(world, 0)?.entity, caster, 'slot 0 casts shadows');
  assert.equal(slots.point(world, 1)?.entity, plain);
  const late = world.spawn(Transform(), PointLight({shadow: true}));
  slots.sync(world);
  slots.sync(world);
  assert.equal(slots.point(world, 2)?.entity, late, 'drawn, in a plain slot');
  assert.equal(slots.stats.refused.shadow, 1);
  assert.equal(reports.length, 1);
  assert.match(
    reports[0]!,
    /a PointLight casts no shadow: no shadowed point slot is free \(the scene's own shadow lights hold 1/,
  );
  world.despawn(caster);
  world.spawn(Transform(), PointLight());
  slots.sync(world);
  assert.equal(slots.point(world, 0), null, 'a light without shadow never takes the shadowed slot');
  assert.equal(slots.stats.refused.full, 1);
});

test('without sceneShadows a shadow request draws the light and is reported once', async () => {
  const scene = defineScene({
    id: 'flat',
    title: 'Flat',
    lights: sceneLights({point: 2}),
    entities: [[Transform(), PointLight({shadow: true})]],
  });
  const t = await testScene(scene);
  t.run(0.1);
  assert.deepEqual(t.lights.stats.admitted, {point: 1, spot: 0});
  assert.deepEqual(t.lights.stats.shadowed, {point: 0, spot: 0});
  assert.equal(t.lights.reports.length, 1);
  assert.match(t.lights.reports[0]!, /flat: a PointLight casts no shadow: the scene has no shadows/);
  t.dispose();
  const shaded = defineScene({...scene, id: 'shaded', shadows: sceneShadows()});
  const low = await testScene(shaded, {shadowCap: SHADOWED_LIGHT_CAPS.low});
  low.run(0.05);
  assert.deepEqual(low.lights.stats.shadowed, {point: 0, spot: 0}, 'low: no local shadows');
  low.dispose();
  const reference = await testScene(shaded);
  reference.run(0.05);
  assert.deepEqual(reference.lights.stats.shadowed, {point: 1, spot: 0});
  assert.deepEqual(reference.lights.reports, []);
  reference.dispose();
});

/** What the shadow scheduler touches on a renderer, without a GL context (node has none). */
const fakeRenderer = (): T.WebGLRenderer =>
  Object.assign(Object.create(T.WebGLRenderer.prototype), {
    shadowMap: {enabled: true, type: T.PCFShadowMap, render() {}},
    dispose() {},
  });

test('only the shadowed slots cast; the rest of the rig is unchanged', () => {
  const scene = new T.Scene();
  const rig = createSceneLightRig(
    scene,
    {point: 3, spot: 1},
    {shadowed: {point: 1, spot: 1}, mapSize: {point: 512, spot: 1024}, renderer: fakeRenderer()},
  );
  assert.deepEqual(
    rig.lights.points.map(l => l.castShadow),
    [true, false, false],
  );
  assert.equal(rig.lights.spots[0]!.castShadow, true);
  assert.equal(rig.lights.points[0]!.shadow.mapSize.x, 512);
  assert.equal(rig.lights.spots[0]!.shadow.mapSize.x, 1024);
  rig.dispose();
});

test('the sun shadow covers the extent around the origin, keeps the direction and turns off cleanly', () => {
  const scene = new T.Scene();
  const sun = createSunShadow(fakeRenderer(), 2048);
  const env = bindEnvironment(scene, sun.apply);
  const e = defineEnvironment({
    background: 0,
    ambient: {sky: 0xffffff, ground: 0, intensity: 1},
    directional: {color: 0xffffff, intensity: 1, position: [-6, 12, -4], shadow: {extent: 14, softness: 'soft'}},
    haze: null,
    points: [],
    pointSize: 1,
  });
  assert.equal(env.sync(e, new T.PerspectiveCamera()), true);
  const light = scene.children.find(c => c instanceof T.DirectionalLight) as T.DirectionalLight;
  assert.equal(light.castShadow, true);
  const cam = light.shadow.camera;
  assert.deepEqual([cam.left, cam.right, cam.top, cam.bottom, cam.far], [-14, 14, 14, -14, 56]);
  assert.ok(Math.abs(light.position.length() - 28) < 1e-9, 'two extents from the origin');
  const authored = new T.Vector3(-6, 12, -4).normalize();
  assert.ok(light.position.clone().normalize().distanceTo(authored) < 1e-9, 'same direction');
  assert.equal(light.shadow.radius, 3);
  // An unrelated change keeps the shadow placement.
  assert.equal(env.sync({...e, ambient: {...e.ambient, intensity: 0.5}}, new T.PerspectiveCamera()), true);
  assert.ok(Math.abs(light.position.length() - 28) < 1e-9);
  // Without a shadow the sun is back to its authored position and casts nothing.
  const plain = {
    ...e,
    directional: {color: 0xffffff, intensity: 1, position: [-6, 12, -4] as [number, number, number]},
  };
  env.sync(plain, new T.PerspectiveCamera());
  assert.equal(light.castShadow, false);
  assert.deepEqual(light.position.toArray(), [-6, 12, -4]);
  env.dispose();
  sun.dispose();
});

test('a scene without sceneShadows leaves the sun exactly as before', () => {
  const scene = new T.Scene();
  const env = bindEnvironment(scene);
  env.sync(
    defineEnvironment({
      background: 0,
      ambient: {sky: 0xffffff, ground: 0, intensity: 1},
      directional: {color: 0xffffff, intensity: 1, position: [1, 2, 3], shadow: {extent: 10}},
      haze: null,
      points: [],
      pointSize: 1,
    }),
    new T.PerspectiveCamera(),
  );
  const light = scene.children.find(c => c instanceof T.DirectionalLight) as T.DirectionalLight;
  assert.equal(light.castShadow, false);
  assert.deepEqual(light.position.toArray(), [1, 2, 3]);
  env.dispose();
});
