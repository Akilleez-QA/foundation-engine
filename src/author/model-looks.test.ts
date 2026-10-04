import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {World} from '../core/ecs/world';
import {createModelLooks} from './model-looks';
import {createSceneSurfaces} from './scene-materials';
import {createSceneResources} from './scene-resources';
import {defineMaterial, Material} from './material';

/** A template like the model library's: shared geometry, materials and textures, instanced by cloning nodes. */
function template() {
  const map = new T.Texture();
  map.userData.shared = true;
  const body = new T.MeshStandardMaterial({color: 0x336699, roughness: 0.4, metalness: 0.7, map});
  body.userData.shared = true;
  const glass = new T.MeshStandardMaterial({color: 0xffffff, transparent: true, opacity: 0.5});
  glass.userData.shared = true;
  const scene = new T.Group(),
    geometry = new T.BoxGeometry();
  scene.add(new T.Mesh(geometry, body), new T.Mesh(geometry, [body, glass]));
  return {scene, map, body, glass, instance: () => scene.clone(true)};
}
const meshes = (root: T.Object3D) => root.children as T.Mesh[];
function setup() {
  const world = new World(),
    resources = createSceneResources(),
    errors: unknown[] = [];
  const surfaces = createSceneSurfaces({
    library: null,
    resources,
    signal: new AbortController().signal,
    anisotropy: 1,
    changed() {},
    report: e => errors.push(e),
  });
  const looks = createModelLooks({world, surfaces, resources, report: e => errors.push(e)});
  return {world, resources, errors, surfaces, looks};
}

test('a model without Material keeps its own shared materials', () => {
  const t = setup(),
    m = template(),
    e = t.world.spawn(),
    root = m.instance();
  t.looks.sync(e, root);
  assert.equal(meshes(root)[0]!.material, m.body);
  assert.equal(t.looks.sync(e, root), false, 'nothing to redraw');
  assert.equal(t.looks.stats.materials, 0);
});

test('fields left at their defaults keep the model value; the shared template is never changed', () => {
  const t = setup(),
    m = template(),
    e = t.world.spawn(),
    root = m.instance();
  t.world.add(e, defineMaterial({emissive: 0xff8800, emissiveIntensity: 3}));
  assert.equal(t.looks.sync(e, root), true);
  const glow = meshes(root)[0]!.material as T.MeshStandardMaterial;
  assert.notEqual(glow, m.body);
  assert.deepEqual(
    [glow.color.getHex(), glow.roughness, glow.metalness, glow.map, glow.emissive.getHex(), glow.emissiveIntensity],
    [0x336699, 0.4, 0.7, m.map, 0xff8800, 3],
  );
  assert.equal(glow.userData.shared, undefined, 'owned by the visit, not the library');
  assert.equal(m.body.emissive.getHex(), 0, 'the template material is untouched');
  const parts = meshes(root)[1]!.material as T.MeshStandardMaterial[];
  assert.equal(parts[0], glow, 'one override per source material and look');
  assert.equal(parts[1]!.opacity, 0.5, "the glass keeps its own opacity");
  assert.equal(t.looks.sync(e, root), false, 'unchanged data: nothing rebuilt');
});

test('instances showing the same look share overrides; the last user releases them, never the textures', () => {
  const t = setup(),
    m = template(),
    a = t.world.spawn(),
    b = t.world.spawn(),
    ra = m.instance(),
    rb = m.instance();
  for (const e of [a, b]) t.world.add(e, defineMaterial({shading: 'flat', side: 'double'}));
  t.looks.sync(a, ra);
  t.looks.sync(b, rb);
  const shared = meshes(ra)[0]!.material as T.MeshStandardMaterial;
  assert.equal(meshes(rb)[0]!.material, shared);
  assert.deepEqual([shared.flatShading, shared.side], [true, T.DoubleSide]);
  assert.equal(t.looks.stats.materials, 2, 'body and glass');
  let disposed = 0,
    mapDisposed = 0;
  shared.addEventListener('dispose', () => disposed++);
  m.map.addEventListener('dispose', () => mapDisposed++);
  t.looks.release(a);
  assert.equal(meshes(ra)[0]!.material, m.body, 'the released instance shows its own materials again');
  assert.equal(disposed, 0, 'still shown by b');
  t.looks.release(b);
  assert.equal(disposed, 1);
  assert.equal(mapDisposed, 0, "the model library's texture is borrowed");
  assert.equal(t.looks.stats.materials, 0);
  t.resources.dispose();
});

test('toon and matte redraw every part in that class, keeping colour, maps and transparency', () => {
  const t = setup(),
    m = template(),
    e = t.world.spawn(),
    root = m.instance();
  t.world.add(e, defineMaterial({shading: 'toon', toonSteps: 2}));
  t.looks.sync(e, root);
  const toon = meshes(root)[0]!.material as T.MeshToonMaterial;
  assert.equal(toon.type, 'MeshToonMaterial');
  assert.deepEqual([toon.color.getHex(), toon.map], [0x336699, m.map]);
  assert.equal((toon.gradientMap!.image as {width: number}).width, 2);
  const glass = (meshes(root)[1]!.material as T.Material[])[1]!;
  assert.deepEqual([glass.type, glass.transparent, glass.opacity], ['MeshToonMaterial', true, 0.5]);
  assert.equal(t.surfaces.stats.gradients, 1);
  t.world.get(e, Material)!.shading = 'matte';
  assert.equal(t.looks.sync(e, root), true);
  assert.equal((meshes(root)[0]!.material as T.Material).type, 'MeshLambertMaterial');
  assert.equal(t.surfaces.stats.gradients, 0, 'the toon gradient went with its last user');
  t.world.remove(e, Material);
  assert.equal(t.looks.sync(e, root), true);
  assert.equal(meshes(root)[0]!.material, m.body, 'removing the Material restores the model materials');
  assert.equal(t.looks.stats.materials, 0);
});

test('a texture on a model is reported once; invalid data is reported once and draws the model materials', () => {
  const t = setup(),
    m = template(),
    e = t.world.spawn(),
    root = m.instance();
  t.world.add(e, defineMaterial({texture: 'crate', emissive: 0x00ff00}));
  t.looks.sync(e, root);
  t.world.get(e, Material)!.emissive = 0x0000ff;
  t.looks.sync(e, root);
  assert.equal(t.errors.length, 1);
  assert.match(String(t.errors[0]), /keeps its own textures/);
  assert.equal((meshes(root)[0]!.material as T.MeshStandardMaterial).emissive.getHex(), 0x0000ff);
  t.world.get(e, Material)!.roughness = 9;
  t.looks.sync(e, root);
  t.looks.sync(e, root);
  assert.equal(t.errors.length, 2);
  assert.match(String(t.errors[1]), /roughness/);
  assert.equal(meshes(root)[0]!.material, m.body);
});
