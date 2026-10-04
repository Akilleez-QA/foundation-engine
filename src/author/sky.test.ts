import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {defineEnvironment, type EnvironmentState} from './environment';
import {bindEnvironment} from './scene-environment';
import {skyGradientAt, type Sky} from './sky';
import {skyPixels, skyStars, skyTextureKey, SKY_TEXTURE} from './sky-pixels';
import {createSkyLayer} from './scene-sky';

const dusk: Sky = {kind: 'gradient', top: 0x1040a0, horizon: 0xf0a060, bottom: 0x202020};
const base = (extra: Partial<EnvironmentState> = {}): EnvironmentState =>
  defineEnvironment({
    background: 0x101820,
    ambient: {sky: 0xffffff, ground: 0x445566, intensity: 1},
    directional: {color: 0xffffff, intensity: 1, position: [4, 9, 6]},
    haze: null,
    points: [],
    pointSize: 2,
    ...extra,
  });

test('the gradient runs bottom, horizon, top; the exponent shapes it', () => {
  assert.deepEqual(skyGradientAt(dusk, 0), [0xf0, 0xa0, 0x60]);
  assert.deepEqual(skyGradientAt(dusk, Math.PI / 2), [0x10, 0x40, 0xa0]);
  assert.deepEqual(skyGradientAt(dusk, -Math.PI / 2), [0x20, 0x20, 0x20]);
  const half = skyGradientAt(dusk, Math.PI / 4),
    wide = skyGradientAt({...dusk, exponent: 0.5}, Math.PI / 4);
  assert.ok(Math.abs(half[2] - (0x60 + 0xa0) / 2) < 1e-9, 'linear at exponent 1');
  assert.ok(wide[2] > half[2], 'below 1 leaves the horizon sooner');
});

test('sky pixels are deterministic, one column without a disc, 256 with one', () => {
  const plain = skyPixels(dusk);
  assert.deepEqual([plain.width, plain.height], [SKY_TEXTURE.width, SKY_TEXTURE.height]);
  assert.deepEqual(skyPixels(dusk).data, plain.data, 'same input, same bytes');
  const top = (plain.height - 1) * 4,
    want = [0x10, 0x40, 0xa0];
  for (let c = 0; c < 3; c++) assert.ok(Math.abs(plain.data[top + c]! - want[c]!) <= 2, `top row channel ${c}`);
  const lit = skyPixels({...dusk, discs: [{direction: [0, 1, -1], size: 4, color: 0xffffff, glow: 0.4}]});
  assert.equal(lit.width, SKY_TEXTURE.discWidth);
  assert.equal(lit.data.length, SKY_TEXTURE.discWidth * SKY_TEXTURE.height * 4);
  // The brightest texel is the disc, at 45° elevation.
  let best = 0,
    at = 0;
  for (let i = 0; i < lit.data.length; i += 4) {
    const v = lit.data[i]! + lit.data[i + 1]! + lit.data[i + 2]!;
    if (v > best) [best, at] = [v, i / 4];
  }
  const row = Math.floor(at / lit.width),
    elevation = ((row + 0.5) / lit.height - 0.5) * 180;
  assert.ok(Math.abs(elevation - 45) <= 3, `disc at ${elevation}° (within its 2° radius plus a row)`);
  assert.ok(best > 3 * 240);
});

test('the texture key ignores stars; stars are deterministic per seed and fade to the horizon', () => {
  assert.equal(skyTextureKey(dusk), skyTextureKey({...dusk, stars: {count: 10, seed: 3}}));
  assert.notEqual(skyTextureKey(dusk), skyTextureKey({...dusk, top: 0}));
  const a = skyStars({count: 50, seed: 7}),
    b = skyStars({count: 50, seed: 7}),
    c = skyStars({count: 50, seed: 8});
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.equal(a.length, 50);
  assert.ok(
    a.every(s => s.direction[1] > 0),
    'upper hemisphere',
  );
});

test('invalid sky and haze are refused, naming the field', () => {
  const bad: [Partial<EnvironmentState>, RegExp][] = [
    [{sky: {...dusk, top: 0x1000000}}, /sky\.top/],
    [{sky: {...dusk, exponent: 0}}, /sky\.exponent/],
    [{sky: {...dusk, discs: [{direction: [0, 0, 0]}]}}, /sky\.discs\[0\]\.direction/],
    [{sky: {...dusk, discs: [{direction: [0, 1, 0]}, {direction: [0, 1, 0], size: 30}]}}, /sky\.discs\[1\]\.size/],
    [
      {sky: {...dusk, discs: Array.from({length: 5}, () => ({direction: [0, 1, 0] as [number, number, number]}))}},
      /sky\.discs must be a list of at most 4/,
    ],
    [{sky: {...dusk, stars: {count: 5000, seed: 1}}}, /sky\.stars\.count/],
    [{sky: JSON.parse('{"kind": "procedural", "top": 0, "horizon": 0, "bottom": 0}')}, /sky\.kind/],
    [{haze: {kind: 'exp2', color: 0, density: 0}}, /haze/],
    [{haze: {kind: 'exp2', color: 0, density: 2}}, /haze/],
    [{haze: {kind: 'exp2', color: 'sky', density: 0.03}}, /haze\.color 'sky' needs a sky/],
    [{haze: {color: 'sky', near: 1, far: 10}}, /haze\.color 'sky' needs a sky/],
    [{sky: dusk, cube: {faces: ['a', 'a', 'a', 'a', 'a', 'a'], screenPx: 512}}, /sky and cube/],
  ];
  for (const [extra, message] of bad) assert.throws(() => base(extra), message, JSON.stringify(extra));
});

const fogOf = (scene: T.Scene) => scene.fog;
const skyMesh = (scene: T.Scene) => scene.children.find(c => c instanceof T.Mesh) as T.Mesh | undefined;

test('a sky is one unlit, fogless mesh around the camera; it regenerates only when the sky changes', () => {
  const scene = new T.Scene(),
    camera = new T.PerspectiveCamera();
  const env = bindEnvironment(scene, undefined, () => createSkyLayer(scene));
  const withSky = base({
    sky: {...dusk, stars: {count: 20, seed: 1}},
    haze: {kind: 'exp2', color: 'sky', density: 0.03},
  });
  assert.equal(env.sync(withSky, camera), true);
  const mesh = skyMesh(scene)!;
  assert.ok(mesh, 'a sky mesh');
  const material = mesh.material as T.MeshBasicMaterial;
  assert.ok(material instanceof T.MeshBasicMaterial);
  assert.deepEqual(
    [material.fog, material.depthWrite, material.side, material.toneMapped],
    [false, false, T.BackSide, false],
  );
  const texture = material.map!;
  assert.ok(texture instanceof T.DataTexture);
  // Stars are their own additive points, so a faint star never darkens a bright sky.
  const stars = scene.getObjectByName('environment-stars') as T.Points<T.BufferGeometry, T.PointsMaterial>;
  assert.equal(stars.geometry.getAttribute('position').count, 20);
  assert.equal(stars.material.blending, T.AdditiveBlending);
  // exp2 haze in the horizon colour.
  const fog = fogOf(scene) as T.FogExp2;
  assert.ok(fog instanceof T.FogExp2);
  assert.equal(fog.color.getHex(), new T.Color(0xf0a060).getHex());
  assert.equal(fog.density, 0.03);
  // The camera moves: the sky follows, nothing regenerates.
  camera.position.set(5, 2, -3);
  assert.equal(env.sync(withSky, camera), false);
  assert.deepEqual(mesh.position.toArray(), [5, 2, -3]);
  // A change that is not the sky keeps the texture.
  let disposed = 0;
  texture.addEventListener('dispose', () => disposed++);
  env.sync({...withSky, ambient: {...withSky.ambient, intensity: 0.5}}, camera);
  assert.equal(material.map, texture);
  // A sky change regenerates it once and disposes the old one.
  env.sync({...withSky, sky: {...withSky.sky!, top: 0}}, camera);
  assert.notEqual(material.map, texture);
  assert.equal(disposed, 1);
  // Without a sky, no mesh; dispose releases everything.
  env.sync(base(), camera);
  assert.equal(skyMesh(scene)?.visible ?? false, false);
  env.dispose();
  assert.equal(scene.children.length, 0);
});

test('an environment without sky or exp2 haze builds exactly what it did before', () => {
  const scene = new T.Scene(),
    env = bindEnvironment(scene);
  env.sync(base({haze: {color: 0x334455, near: 5, far: 30}}), new T.PerspectiveCamera());
  assert.ok(scene.fog instanceof T.Fog);
  assert.equal(skyMesh(scene), undefined, 'no sky mesh is created');
  assert.deepEqual(
    scene.children.map(c => c.type),
    ['HemisphereLight', 'DirectionalLight', 'Points'],
  );
  env.dispose();
});

test('a sky waits for its lazy layer: nothing is drawn, the runtime is told, and a refresh applies it', () => {
  const scene = new T.Scene(),
    camera = new T.PerspectiveCamera();
  let loaded = false;
  const env = bindEnvironment(scene, undefined, () => (loaded ? createSkyLayer(scene) : null));
  const e = base({sky: dusk});
  env.sync(e, camera);
  assert.equal(env.wantsSky(), true);
  assert.equal(skyMesh(scene), undefined);
  loaded = true;
  env.refresh();
  assert.equal(env.sync(e, camera), true, 'the same environment is applied again');
  assert.equal(env.wantsSky(), false);
  assert.ok(skyMesh(scene));
  env.dispose();
  assert.equal(scene.children.length, 0);
});
