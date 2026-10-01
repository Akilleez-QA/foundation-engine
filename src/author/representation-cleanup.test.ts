import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { createSceneResources } from './scene-resources';
import { createPrimitiveGeometries } from './primitive-geometries';
import { retireRepresentations } from './representation-cleanup';

for (const event of ['removed', 'childremoved'] as const) {
  test(`${event} callback failure cannot skip primitive release or material cleanup`, () => {
    const resources = createSceneResources(), primitives = createPrimitiveGeometries(resources);
    const lease = primitives.acquire('box', [1, 1, 1]);
    const material = resources.own(new T.MeshLambertMaterial());
    const scene = new T.Scene(), mesh = new T.Mesh(lease.geometry, material);
    scene.add(mesh);
    let geometries = 0, materials = 0;
    lease.geometry.addEventListener('dispose', () => { geometries++; });
    material.addEventListener('dispose', () => { materials++; });
    const fail = () => { throw Error('detach failure'); };
    if (event === 'removed') mesh.addEventListener(event, fail); else scene.addEventListener(event, fail);
    assert.throws(() => retireRepresentations(scene, [mesh], [() => lease.release(), () => resources.release(material)]), AggregateError);
    assert.equal(scene.children.length, 0);
    assert.deepEqual([geometries, materials], [1, 1]);
    primitives.dispose(); resources.dispose();
    assert.deepEqual([geometries, materials], [1, 1]);
  });
}

test('visit cleanup drains all detach and resource callbacks while preserving every failure', () => {
  const resources = createSceneResources(), primitives = createPrimitiveGeometries(resources);
  const first = new T.Mesh(primitives.acquire('box', [1, 1, 1]).geometry, resources.own(new T.MeshLambertMaterial()));
  const second = new T.Mesh(resources.own(new T.BufferGeometry()), resources.own(new T.MeshLambertMaterial()));
  const scene = new T.Scene(); scene.add(first, second);
  const counts = [0, 0, 0, 0];
  [first.geometry, first.material, second.geometry, second.material].forEach((r, i) => r.addEventListener('dispose', () => { counts[i]++; }));
  first.addEventListener('removed', () => { throw Error('detach first'); });
  second.addEventListener('removed', () => { throw Error('detach second'); });
  first.geometry.addEventListener('dispose', () => { throw Error('geometry failed'); });
  assert.throws(() => retireRepresentations(scene, [first, second], [() => primitives.dispose(), () => resources.dispose()]), (error: unknown) => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.errors.length, 3);
    return true;
  });
  assert.equal(scene.children.length, 0);
  assert.deepEqual(counts, [1, 1, 1, 1]);
  primitives.dispose(); resources.dispose();
  assert.deepEqual(counts, [1, 1, 1, 1]);
});
