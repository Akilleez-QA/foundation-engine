import {test} from 'node:test';
import assert from 'node:assert/strict';
import {World} from '../core/ecs/world';
import {
  LIGHT_LIMITS,
  LOCAL_LIGHT_CAPS,
  POINT_LIGHT_DEFAULTS,
  PointLight,
  SPOT_LIGHT_DEFAULTS,
  SpotLight,
  lightSlotsFor,
  sceneLights,
} from './lights';
import {createLightSlots} from './light-slots';
import {defineScene, Transform} from './defs';
import {testScene} from './testing';

test('PointLight and SpotLight fill defaults and validate when written', () => {
  assert.deepEqual(PointLight().value, POINT_LIGHT_DEFAULTS);
  assert.deepEqual(PointLight({intensity: 6, distance: 8}).value, {...POINT_LIGHT_DEFAULTS, intensity: 6, distance: 8});
  const target: [number, number, number] = [1, 0, 2];
  const spot = SpotLight({angle: 0.5, penumbra: 0.4, target});
  target[0] = 9;
  assert.deepEqual(spot.value, {...SPOT_LIGHT_DEFAULTS, angle: 0.5, penumbra: 0.4, target: [1, 0, 2]});
  assert.equal(PointLight.id, 'point-light');
  assert.equal(SpotLight.id, 'spot-light');
});

test('invalid light data is refused, naming the field', () => {
  const bad: [() => unknown, RegExp][] = [
    [() => PointLight({color: 0x1000000}), /PointLight: color/],
    [() => PointLight({intensity: -1}), /PointLight: intensity/],
    [() => PointLight({intensity: LIGHT_LIMITS.intensity + 1}), /intensity/],
    [() => PointLight({distance: 51}), /PointLight: distance/],
    [() => PointLight({decay: NaN}), /decay/],
    [() => PointLight(JSON.parse('{"essential": 1}')), /essential/],
    [() => SpotLight({angle: 0}), /SpotLight: angle/],
    [() => SpotLight({angle: 2}), /angle/],
    [() => SpotLight({penumbra: 1.5}), /penumbra/],
    [() => SpotLight(JSON.parse('{"target": [1, 2]}')), /target/],
  ];
  for (const [make, message] of bad) assert.throws(make, message);
});

test('sceneLights bounds its slots; the knob caps each kind per visit', () => {
  assert.deepEqual(sceneLights().limits, {point: 4, spot: 0});
  assert.deepEqual(sceneLights({point: 16, spot: 4}).limits, {point: 16, spot: 4});
  assert.throws(() => sceneLights({point: 17}), /lights: point must be an integer in \[0, 16\]/);
  assert.throws(() => sceneLights({spot: 5}), /lights: spot/);
  assert.throws(() => sceneLights({point: 1.5}), /point/);
  assert.deepEqual(LOCAL_LIGHT_CAPS, {reference: 16, high: 8, medium: 4, low: 2});
  const lights = sceneLights({point: 8, spot: 2});
  assert.deepEqual(lightSlotsFor(lights, LOCAL_LIGHT_CAPS.reference), {point: 8, spot: 2});
  assert.deepEqual(lightSlotsFor(lights, LOCAL_LIGHT_CAPS.medium), {point: 4, spot: 2});
  assert.deepEqual(lightSlotsFor(lights, LOCAL_LIGHT_CAPS.low), {point: 2, spot: 2});
  assert.deepEqual(lightSlotsFor(undefined, 16), {point: 0, spot: 0});
  assert.throws(
    () => defineScene({id: 'bad', title: 'Bad', lights: JSON.parse('{"kind": "nope"}')}),
    /scene bad: lights must be sceneLights\(\.\.\.\)/,
  );
});

const lamp = (world: World, x: number, extra: Partial<Parameters<typeof PointLight>[0]> = {}) =>
  world.spawn(Transform({x}), PointLight({intensity: 5, ...extra}));

test('lights claim free slots, keep them, and release them on despawn; the slot count never changes', () => {
  const world = new World(),
    reports: string[] = [];
  const slots = createLightSlots({slots: {point: 2, spot: 0}, enabled: true, report: m => reports.push(m)});
  const a = lamp(world, 0),
    b = lamp(world, 1);
  slots.sync(world);
  assert.deepEqual([slots.point(world, 0)?.entity, slots.point(world, 1)?.entity], [a, b]);
  assert.deepEqual(slots.stats.admitted, {point: 2, spot: 0});
  world.despawn(a);
  slots.sync(world);
  assert.equal(slots.point(world, 0), null, 'the released slot goes dark');
  assert.equal(slots.point(world, 1)?.entity, b, 'a held slot never moves');
  const c = lamp(world, 2);
  slots.sync(world);
  assert.equal(slots.point(world, 0)?.entity, c, 'a new light takes the lowest free slot');
  assert.deepEqual(slots.stats.slots, {point: 2, spot: 0});
  assert.deepEqual(reports, []);
});

test('overflow is refused deterministically (essential first, then spawn order) and reported once per cause', () => {
  const world = new World(),
    reports: string[] = [];
  const slots = createLightSlots({slots: {point: 2, spot: 0}, enabled: true, report: m => reports.push(m)});
  const first = lamp(world, 0),
    second = lamp(world, 1),
    vital = lamp(world, 2, {essential: true});
  slots.sync(world);
  assert.deepEqual([slots.point(world, 0)?.entity, slots.point(world, 1)?.entity], [vital, first]);
  assert.equal(slots.stats.refused.full, 1);
  for (let i = 0; i < 5; i++) slots.sync(world);
  assert.equal(reports.length, 1, 'reported once, not every frame');
  assert.match(reports[0]!, /PointLight\(s\) not drawn: the scene's 2 point slot\(s\) are full/);
  world.despawn(first);
  slots.sync(world);
  assert.equal(slots.point(world, 1)?.entity, second, 'a refused light is admitted when a slot frees');
  assert.equal(slots.stats.refused.full, 0);
});

test('refusal counters count refused lights, not reports: 8 lights in 2 slots refuse 6, reported once', () => {
  const world = new World(),
    reports: string[] = [];
  const slots = createLightSlots({slots: {point: 2, spot: 0}, enabled: true, report: m => reports.push(m)});
  for (let i = 0; i < 8; i++) lamp(world, i);
  slots.sync(world);
  assert.equal(slots.stats.refused.full, 6);
  assert.deepEqual(slots.stats.admitted, {point: 2, spot: 0});
  for (let i = 0; i < 3; i++) slots.sync(world);
  assert.equal(slots.stats.refused.full, 6, 'a count of lights now, not a running total');
  assert.equal(reports.length, 1, 'still reported once per cause');
  assert.match(reports[0]!, /^6 PointLight\(s\) not drawn/);
  // Without sceneLights(): every light is refused and counted.
  const none = createLightSlots({slots: {point: 0, spot: 0}, enabled: false, report: m => reports.push(m)});
  none.sync(world);
  assert.equal(none.stats.refused['no-slots'], 8);
  assert.equal(reports.length, 2);
});

test('invalid run-time data darkens the slot and is reported once; fixing it lights it again', () => {
  const world = new World(),
    reports: string[] = [];
  const slots = createLightSlots({slots: {point: 1, spot: 0}, enabled: true, report: m => reports.push(m)});
  const e = lamp(world, 0);
  slots.sync(world);
  world.get(e, PointLight)!.intensity = -3;
  slots.sync(world);
  slots.sync(world);
  assert.equal(slots.point(world, 0), null);
  assert.equal(slots.stats.refused.invalid, 1);
  assert.equal(reports.length, 1);
  assert.match(reports[0]!, /PointLight: intensity/);
  world.get(e, PointLight)!.intensity = 3;
  slots.sync(world);
  assert.equal(slots.point(world, 0)?.data.intensity, 3);
});

test('a scene without sceneLights refuses its lights with one report', async () => {
  const scene = defineScene({id: 'dark', title: 'Dark', entities: [[Transform(), PointLight()]]});
  const t = await testScene(scene);
  t.run(0.1);
  assert.equal(t.lights.stats.slots.point, 0);
  assert.equal(t.lights.reports.length, 1);
  assert.match(t.lights.reports[0]!, /dark: a PointLight is not drawn: the scene has no light slots/);
  t.dispose();
});

test('testScene admits lights as a visit does, with the knob cap', async () => {
  const scene = defineScene({
    id: 'lamps',
    title: 'Lamps',
    lights: sceneLights({point: 4, spot: 1}),
    entities: [0, 1, 2].map(x => [Transform({x}), PointLight()]),
  });
  const reference = await testScene(scene);
  reference.run(0.05);
  assert.deepEqual(reference.lights.stats.admitted, {point: 3, spot: 0});
  assert.deepEqual(reference.lights.reports, []);
  reference.dispose();
  const low = await testScene(scene, {lightCap: LOCAL_LIGHT_CAPS.low});
  low.run(0.05);
  assert.deepEqual(low.lights.stats.slots, {point: 2, spot: 1});
  assert.deepEqual(low.lights.stats.admitted, {point: 2, spot: 0});
  assert.equal(low.lights.reports.length, 1);
  low.dispose();
});

test('a non-essential light refused only because the quality tier created fewer slots is info, once; essential is an error', () => {
  const world = new World(),
    reports: [string, string][] = [];
  const report = (m: string, level: string) => reports.push([level, m]);
  // The scene asked for 8; the tier (medium) creates 4: four non-essential lights wait, by design.
  const tiered = createLightSlots({slots: {point: 4, spot: 0}, requested: {point: 8, spot: 0}, enabled: true, report});
  const lamps = Array.from({length: 8}, (_, i) => lamp(world, i, {essential: i >= 6}));
  for (let i = 0; i < 3; i++) tiered.sync(world);
  assert.deepEqual(tiered.stats.refused.tier, 4);
  assert.equal(tiered.stats.refused.full, 0);
  assert.deepEqual(
    reports.map(([level]) => level),
    ['info'],
    'reported once, at info level',
  );
  assert.match(
    reports[0]![1],
    /^4 non-essential PointLight\(s\) not drawn at this quality tier: .* creates 4 of the scene's 8/,
  );
  const held = [0, 1, 2, 3].map(i => tiered.point(world, i)?.entity);
  assert.ok(held.includes(lamps[6]) && held.includes(lamps[7]), 'essential lights are admitted first');
  // An essential light the tier cannot hold is still an error.
  reports.length = 0;
  const lowWorld = new World();
  for (let i = 0; i < 8; i++) lamp(lowWorld, i, {essential: i < 4});
  const low = createLightSlots({slots: {point: 2, spot: 0}, requested: {point: 8, spot: 0}, enabled: true, report});
  low.sync(lowWorld);
  assert.equal(low.stats.refused.full, 2, 'two of the four essential lights have no slot');
  assert.equal(low.stats.refused.tier, 4);
  assert.deepEqual(
    reports.map(([level]) => level),
    ['info', 'error'],
  );
  assert.match(reports[1]![1], /2 PointLight\(s\) not drawn, 2 of them essential/);
});

test('lights beyond what the scene asked for are an error even when the tier also capped the slots', () => {
  const world = new World(),
    reports: [string, string][] = [];
  const slots = createLightSlots({
    slots: {point: 2, spot: 0},
    requested: {point: 4, spot: 0},
    enabled: true,
    report: (m, level) => reports.push([level, m]),
  });
  for (let i = 0; i < 6; i++) lamp(world, i);
  slots.sync(world);
  assert.equal(slots.stats.refused.tier, 2, 'the two the scene had room for');
  assert.equal(slots.stats.refused.full, 2, 'the two the scene never asked a slot for');
  assert.deepEqual(
    reports.map(([level]) => level),
    ['info', 'error'],
  );
});
