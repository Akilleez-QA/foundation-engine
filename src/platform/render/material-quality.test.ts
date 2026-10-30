import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {finishMaterialTextures, installMaterialQuality} from './material-quality';
test('late maps receive filtering without changing color interpretation or repeatedly uploading', () => {
  const m = new T.MeshStandardMaterial();
  const t = new T.Texture();
  t.colorSpace = T.NoColorSpace;
  m.normalMap = t;
  finishMaterialTextures(m, 8);
  const version = t.version;
  assert.equal(t.anisotropy, 8);
  assert.equal(t.colorSpace, T.NoColorSpace);
  finishMaterialTextures(m, 8);
  assert.equal(t.version, version);
  m.dispose();
  t.dispose();
});
test('late loader attachment is handled at draw time and existing hooks restored', () => {
  const scene = new T.Scene(),
    m = new T.MeshStandardMaterial(),
    mesh = new T.Mesh(new T.BoxGeometry(), m);
  let calls = 0;
  const original = () => {
    calls++;
  };
  mesh.onBeforeRender = original;
  scene.add(mesh);
  const quality = installMaterialQuality(scene, 4);
  quality.refresh();
  const texture = new T.Texture();
  texture.colorSpace = T.SRGBColorSpace;
  m.map = texture;
  mesh.onBeforeRender({} as T.WebGLRenderer, scene, new T.Camera(), mesh.geometry, m, new T.Group());
  assert.equal(texture.anisotropy, 4);
  assert.equal(texture.colorSpace, T.SRGBColorSpace);
  assert.equal(calls, 1);
  quality.dispose();
  assert.equal(mesh.onBeforeRender, original);
  mesh.geometry.dispose();
  m.dispose();
  texture.dispose();
});
test('a refresh after a partial rebuild forgets (and unwraps) meshes that left the tree', () => {
  const scene = new T.Scene(),
    quality = installMaterialQuality(scene, 4),
    make = () => {
      const mesh = new T.Mesh(new T.BoxGeometry(), new T.MeshStandardMaterial());
      scene.add(mesh);
      return mesh;
    };
  const old = make();
  quality.refresh();
  assert.notEqual(old.onBeforeRender, T.Object3D.prototype.onBeforeRender);
  scene.remove(old);
  const rebuilt = make();
  quality.refresh();
  assert.equal(old.onBeforeRender, T.Object3D.prototype.onBeforeRender, 'the discarded mesh is unwrapped and released');
  assert.notEqual(rebuilt.onBeforeRender, T.Object3D.prototype.onBeforeRender);
  scene.add(old);
  quality.refresh();
  const wrapped = old.onBeforeRender;
  quality.refresh();
  assert.equal(old.onBeforeRender, wrapped, 'a returning mesh is wrapped once');
  quality.dispose();
  assert.equal(old.onBeforeRender, T.Object3D.prototype.onBeforeRender);
});
