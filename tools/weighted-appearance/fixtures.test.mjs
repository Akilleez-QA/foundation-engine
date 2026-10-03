import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {Vector3} from 'three';
import {fixture, expectedVertices} from './fixtures.mjs';
for (const kind of ['amber', 'reversed'])
  test(`original ${kind} fixture deforms three distinct weight cases`, async () => {
    const bytes = fixture(kind);
    const loaded = await new GLTFLoader().parseAsync(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      '',
    );
    loaded.scene.getObjectByName('B').quaternion.setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2);
    loaded.scene.updateMatrixWorld(true);
    const mesh = loaded.scene.getObjectByName('surface');
    const expected = expectedVertices(Math.PI / 2);
    for (let i = 0; i < 3; i++) {
      const actual = mesh
        .applyBoneTransform(i, new Vector3().fromBufferAttribute(mesh.geometry.attributes.position, i))
        .toArray();
      for (let j = 0; j < 3; j++) assert.ok(Math.abs(actual[j] - expected[i][j]) < 1e-6);
    }
  });
