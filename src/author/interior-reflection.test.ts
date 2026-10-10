import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {defineEnvironment, type EnvironmentState} from './environment';
import {
  INTERIOR_REFLECTION_LIMITS,
  interiorReflectionKey,
  interiorReflectionPixels,
  validateInteriorReflection,
  type InteriorReflection,
} from './interior-reflection';
import {leaseInteriorReflection} from './scene-interior-reflection';
import {bindSceneCubes, type CubeLoader, type InteriorLoader} from './scene-cubes';
import type {TextureLibrary} from '../platform/assets/textures';

const interior = (over: Partial<InteriorReflection> = {}): InteriorReflection => ({
  kind: 'interior',
  size: [20, 8, 20],
  eyeHeight: 2,
  wall: {color: 0x101010, intensity: 1},
  floor: {color: 0x080808},
  ceiling: {color: 0x000000, intensity: 0},
  lights: [{position: [0, 6, -8], radius: 1, color: 0xffcc88, intensity: 8}],
  ...over,
});
const base: EnvironmentState = {
  background: 0,
  ambient: {sky: 0x222222, ground: 0x111111, intensity: 0.5},
  directional: {color: 0xffffff, intensity: 1, position: [1, 2, 3]},
  haze: null,
  points: [],
  pointSize: 2,
};
const flush = () => new Promise(resolve => setImmediate(resolve));
async function until(ready: () => boolean) {
  const deadline = performance.now() + 2000;
  while (!ready()) {
    if (performance.now() > deadline) assert.fail('interior reflection did not reach expected state');
    await flush();
  }
}

test('interior reflection: valid data passes defineEnvironment and is copied', () => {
  const input = interior();
  const e = defineEnvironment({...base, reflection: input});
  assert.deepEqual(e.reflection, input);
  assert.notEqual(e.reflection, input);
  // Defaults: size, eye height, intensity and lights are all optional.
  defineEnvironment({
    ...base,
    reflection: {kind: 'interior', wall: {color: 1}, floor: {color: 2}, ceiling: {color: 3}},
  });
});

test('interior reflection: bounds, finite numbers and colours are refused naming the field', () => {
  const bad: [Partial<InteriorReflection> | Record<string, unknown>, RegExp][] = [
    [{kind: 'hall'}, /kind must be 'interior'/],
    [{size: [0.5, 8, 20]}, /size must be in \[1, 200\]/],
    [{size: [20, Infinity, 20]}, /size must be/],
    [{size: [20, 8]}, /size must be \[width/],
    [{eyeHeight: 8}, /eyeHeight must be inside/],
    [{eyeHeight: NaN}, /eyeHeight must be inside/],
    [{wall: {color: 0x1000000}}, /wall\.color must be a 24-bit/],
    [{floor: {color: 1.5}}, /floor\.color must be a 24-bit/],
    [{ceiling: {color: 0, intensity: -1}}, /ceiling\.intensity must be in \[0, 16\]/],
    [{ceiling: {color: 0, intensity: NaN}}, /ceiling\.intensity/],
    [{wall: undefined}, /wall must be/],
    [
      {
        lights: Array.from({length: INTERIOR_REFLECTION_LIMITS.lights + 1}, () => ({
          position: [0, 6, 0] as [number, number, number],
          radius: 1,
          intensity: 1,
        })),
      },
      /lights must be a list of at most 8/,
    ],
    [{lights: [{position: [0, 9, 0], radius: 1, intensity: 1}]}, /lights\[0\]\.position must be inside the interior/],
    [{lights: [{position: [11, 4, 0], radius: 1, intensity: 1}]}, /position must be inside the interior/],
    [{lights: [{position: [0, 4, NaN], radius: 1, intensity: 1}]}, /position must be \[x, y, z\]/],
    [{lights: [{position: [0, 6, 0], radius: 0, intensity: 1}]}, /radius must be in \(0, 10\]/],
    [{lights: [{position: [0, 6, 0], radius: 11, intensity: 1}]}, /radius must be in/],
    [{lights: [{position: [0, 2.5, 0], radius: 1, intensity: 1}]}, /must not contain the probe/],
    [{lights: [{position: [0, 6, 0], radius: 1, intensity: 1001}]}, /intensity must be in \[0, 1000\]/],
    [{lights: [{position: [0, 6, 0], radius: 1, intensity: Infinity}]}, /intensity must be in/],
    [{lights: [{position: [0, 6, 0], radius: 1, intensity: 1, color: -1}]}, /lights\[0\]\.color/],
  ];
  for (const [over, why] of bad) {
    const r = {...interior(), ...over} as InteriorReflection;
    assert.throws(() => validateInteriorReflection(r), why, JSON.stringify(over));
    assert.throws(() => defineEnvironment({...base, reflection: r}), why);
  }
});

test('interior reflection: existing cube reflections are unaffected by validation', () => {
  const cube = {faces: ['a', 'b', 'c', 'd', 'e', 'f'] as const, screenPx: 512};
  assert.deepEqual(defineEnvironment({...base, reflection: cube}).reflection, cube);
  assert.equal(defineEnvironment(base).reflection, undefined);
});

test('interior reflection: pixels are deterministic, linear and show surfaces and lights where they are', () => {
  const r = interior();
  const a = interiorReflectionPixels(r),
    b = interiorReflectionPixels(structuredClone(r));
  assert.equal(a.width, INTERIOR_REFLECTION_LIMITS.width);
  assert.equal(a.height, INTERIOR_REFLECTION_LIMITS.height);
  assert.deepEqual(a.data, b.data);
  const at = (u: number, v: number) => {
    const i = Math.floor(u * a.width),
      j = Math.floor(v * a.height);
    return [...a.data.subarray((j * a.width + i) * 4, (j * a.width + i) * 4 + 4)];
  };
  const lin = (c: number) => Math.pow((c / 255 + 0.055) / 1.055, 2.4);
  // Straight down is the floor, straight up the (black) ceiling, the horizon a wall.
  assert.ok(Math.abs(at(0.5, 0.001)[0]! - 8 / 255 / 12.92) < 1e-6);
  assert.equal(at(0.5, 0.999)[0], 0);
  assert.ok(Math.abs(at(0.1, 0.5)[0]! - lin(0x10)) < 1e-6);
  // The light at -z, 4 m above the probe and 8 m away: u = atan2(-1, 0) / 2π + 0.5 = 0.25.
  const elevation = Math.atan2(4, 8);
  const lamp = at(0.25, elevation / Math.PI + 0.5);
  assert.ok(Math.abs(lamp[0]! - 8) < 1e-6);
  assert.ok(Math.abs(lamp[1]! - lin(0xcc) * 8) < 1e-6);
  assert.equal(lamp[3], 1);
  assert.ok(a.data.every(Number.isFinite));
});

test('interior reflection: key ignores field order and defaults, and changes with the look', () => {
  const r = interior();
  const reordered = {
    lights: r.lights,
    ceiling: r.ceiling,
    floor: {intensity: 1, color: 0x080808},
    wall: r.wall,
    eyeHeight: 2,
    kind: 'interior',
  } as InteriorReflection;
  assert.equal(interiorReflectionKey({...reordered, size: [20, 8, 20]}), interiorReflectionKey(r));
  assert.notEqual(interiorReflectionKey(interior({wall: {color: 0x101011}})), interiorReflectionKey(r));
});

test('interior reflection: the texture is half-float equirectangular, linear, and released once', () => {
  const lease = leaseInteriorReflection(interior());
  const t = lease.value as T.DataTexture;
  assert.equal(t.mapping, T.EquirectangularReflectionMapping);
  assert.equal(t.type, T.HalfFloatType);
  assert.equal(t.colorSpace, T.LinearSRGBColorSpace);
  assert.equal(t.image.width * t.image.height * 4 * 2, 1024 * 1024);
  let disposed = 0;
  t.addEventListener('dispose', () => disposed++);
  lease.release();
  lease.release();
  assert.equal(disposed, 1);
});

test('interior reflection: same data builds once per visit, a change replaces and disposes, exit disposes', async () => {
  const built: T.Texture[] = [];
  let disposed = 0;
  const interiorLoader: InteriorLoader = async () => ({
    leaseInteriorReflection: (r: InteriorReflection) => {
      const lease = leaseInteriorReflection(r);
      lease.value.addEventListener('dispose', () => disposed++);
      built.push(lease.value);
      return lease;
    },
  });
  const cubeLoader: CubeLoader = async () => assert.fail('an interior reflection loads no cube');
  const scene = new T.Scene(),
    life = new AbortController(),
    errors: unknown[] = [];
  let invalidations = 0;
  const owner = bindSceneCubes(
    scene,
    {} as TextureLibrary,
    life.signal,
    () => invalidations++,
    e => errors.push(e),
    cubeLoader,
    interiorLoader,
  );
  owner.sync(undefined, interior());
  await until(() => scene.environment !== null);
  const first = scene.environment;
  assert.equal(built.length, 1);
  assert.equal(invalidations, 1);
  // Equal data in a fresh object (as each published environment is) does not rebuild.
  for (let i = 0; i < 5; i++) owner.sync(undefined, structuredClone(interior()));
  await flush();
  assert.equal(built.length, 1);
  assert.equal(scene.environment, first);
  assert.equal(scene.background, null);
  // A changed look builds one replacement and disposes the old texture once it is in place.
  owner.sync(undefined, interior({wall: {color: 0x202020}}));
  await until(() => scene.environment !== first);
  assert.equal(built.length, 2);
  assert.equal(disposed, 1);
  // Clearing the reflection restores the scene's own environment and disposes.
  owner.sync(undefined, undefined);
  assert.equal(scene.environment, null);
  assert.equal(disposed, 2);
  owner.sync(undefined, interior());
  await until(() => scene.environment !== null);
  life.abort();
  assert.equal(scene.environment, null);
  assert.equal(disposed, 3);
  assert.deepEqual(errors, []);
});

test('interior reflection: malformed run-time data is reported and the previous reflection stays', async () => {
  const scene = new T.Scene(),
    life = new AbortController(),
    errors: unknown[] = [];
  const owner = bindSceneCubes(
    scene,
    {} as TextureLibrary,
    life.signal,
    () => {},
    e => errors.push(e),
  );
  owner.sync(undefined, interior());
  await until(() => scene.environment !== null);
  const kept = scene.environment;
  owner.sync(undefined, interior({size: [20, 8, -1]}));
  await until(() => errors.length > 0);
  assert.match(String(errors[0]), /size must be in/);
  assert.equal(scene.environment, kept);
  owner.dispose();
  assert.equal(scene.environment, null);
});
