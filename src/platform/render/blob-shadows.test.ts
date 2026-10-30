import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {BLOB_LIFT, createBlobShadowLayer, type BlobInstance} from './blob-shadows';

const blob = (x: number, alpha = 0.5): BlobInstance => ({x, y: 0, z: 0, yaw: 0, width: 1, depth: 1, alpha});

test('the layer is one instanced mesh at a fixed capacity; writes clamp to it and upload only on change', () => {
  assert.throws(() => createBlobShadowLayer(new T.Scene(), {capacity: 0, distance: null}), /capacity/);
  const scene = new T.Scene();
  const layer = createBlobShadowLayer(scene, {capacity: 2, distance: 30});
  assert.equal(scene.children.length, 1);
  assert.equal(layer.mesh.instanceMatrix.count, 2);
  assert.equal((layer.mesh.material as T.ShaderMaterial).uniforms.fadeFar!.value, 30);
  assert.equal((layer.mesh.material as T.ShaderMaterial).fog, true, 'scene fog fades blobs');
  assert.equal(layer.write([]), false, 'empty stays empty');
  assert.equal(layer.write([blob(1), blob(2), blob(3)]), true);
  assert.equal(layer.mesh.count, 2, 'never more than capacity');
  assert.equal(layer.write([blob(1), blob(2), blob(3)]), false);
  assert.equal(layer.uploads, 1);
  const at = new T.Matrix4();
  layer.mesh.getMatrixAt(0, at);
  assert.ok(Math.abs(at.elements[13]! - BLOB_LIFT) < 1e-7, 'lifted off the surface');
  assert.equal(layer.write([blob(1, 0.25), blob(2)]), true, 'an alpha change uploads');
  assert.equal(layer.write([blob(1, 0.25)]), true, 'a shorter list lowers the count');
  assert.equal(layer.mesh.count, 1);
  assert.equal(layer.uploads, 3);
  layer.dispose();
  assert.equal(scene.children.length, 0);
  assert.equal(layer.write([blob(4)]), false, 'inert after dispose');
});
