import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {bakeStaticMeshes} from './index';
import {staticBakeMaterial} from './material';

test('world-space shader certification restores static baking without admitting unknown or replaced hooks', () => {
  for (const replacement of ['none', 'compile', 'key', 'uncertified'] as const) {
    const material = new T.MeshStandardMaterial();
    material.onBeforeCompile = () => {};
    material.customProgramCacheKey = () => 'world-clip';
    if (replacement !== 'uncertified') staticBakeMaterial(material);
    if (replacement === 'compile') material.onBeforeCompile = () => {};
    if (replacement === 'key') material.customProgramCacheKey = () => 'changed';
    const root = new T.Group();
    root.add(new T.Mesh(new T.BoxGeometry(), material), new T.Mesh(new T.BoxGeometry(), material));
    assert.equal(bakeStaticMeshes(root), replacement === 'none' ? 2 : 0);
    assert.equal(root.children.length, replacement === 'none' ? 1 : 2);
  }
});

test('scene bake keeps the original scope-matrix evaluation order byte for byte', () => {
  const ancestor = new T.Group(),
    scope = new T.Group();
  ancestor.add(scope);
  ancestor.position.set(6.8500000000000005, 2.2, 34.3);
  ancestor.rotation.y = 0.71;
  ancestor.scale.setScalar(0.37);
  // Like a model built inside a posed but not yet presented parent, the ancestor matrixWorld
  // is still identity. The original bake updates the scope, not its ancestors.
  scope.position.set(0, 1.044139397744973, 1.1079999999999994);
  const material = new T.MeshStandardMaterial();
  for (let i = 0; i < 2; i++) {
    const part = new T.Mesh(new T.SphereGeometry(0.13, 8, 6), material);
    part.position.set(0.1 + i, 0.37, -0.29);
    part.rotation.set(0.3, 0.7, 0.2);
    scope.add(part);
  }
  scope.updateMatrixWorld(true);
  const inverse = scope.matrixWorld.clone().invert();
  const expected = scope.children.map(o => {
    const m = o as T.Mesh;
    return m.geometry.clone().applyMatrix4(inverse.clone().multiply(m.matrixWorld));
  });
  bakeStaticMeshes(scope);
  const baked = scope.children[0] as T.Mesh;
  for (const name of ['position', 'normal', 'uv'])
    assert.deepEqual(
      Array.from(baked.geometry.getAttribute(name).array),
      expected.flatMap(g => Array.from(g.getAttribute(name).array)),
      name,
    );
  assert.deepEqual(
    ancestor.matrixWorld.elements,
    new T.Matrix4().elements,
    'construction does not force parent world-matrix propagation',
  );
});
