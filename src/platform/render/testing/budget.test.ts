import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {expectBuildBudget, measureBuild} from './budget';
test('counts hidden ancestry, instances, groups, ranges and double-sided passes', () => {
  const root = new T.Group(),
    opaque = new T.MeshBasicMaterial(),
    glass = new T.MeshBasicMaterial({transparent: true, side: T.DoubleSide});
  const hidden = new T.Group();
  hidden.visible = false;
  hidden.add(new T.Mesh(new T.BoxGeometry(), opaque));
  root.add(hidden);
  const instances = new T.InstancedMesh(new T.BoxGeometry(), opaque, 4);
  instances.castShadow = true;
  root.add(instances);
  const grouped = new T.Mesh(new T.BoxGeometry(), [opaque, glass]);
  grouped.geometry.clearGroups();
  grouped.geometry.addGroup(0, 6, 0);
  grouped.geometry.addGroup(6, 6, 1);
  grouped.geometry.setDrawRange(3, 9);
  root.add(grouped);
  assert.deepEqual(measureBuild(root), {
    meshes: 3,
    draws: 4,
    casters: 1,
    triangles: 53,
    materials: 2,
    textures: 0,
    texturePixels: 0,
  });
});
test('a new unbatched prop fails its budget and still cleans up', () => {
  let disposed = false;
  const root = new T.Group(),
    m = new T.MeshBasicMaterial();
  root.add(new T.Mesh(new T.BoxGeometry(), m), new T.Mesh(new T.BoxGeometry(), m));
  assert.throws(
    () =>
      expectBuildBudget(
        () => root,
        {draws: 1},
        {
          dispose: () => {
            disposed = true;
          },
        },
      ),
    /draws: 2 exceeds 1/,
  );
  assert.equal(disposed, true);
});
