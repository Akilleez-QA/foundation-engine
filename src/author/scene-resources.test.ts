import test from 'node:test';
import assert from 'node:assert/strict';
import { must } from '../testing/must';
import * as T from 'three';
import { createSceneResources } from './scene-resources';
import { disposeOwnedTree } from '../platform/render/dispose-owned-tree';

test('shared primitives, replaced indexed geometry and materials dispose exactly once', () => {
  const owner = createSceneResources(), scene = new T.Scene();
  const shared = owner.own(new T.BoxGeometry()), indexed = owner.own(new T.BufferGeometry());
  const materials = [owner.own(new T.MeshLambertMaterial()), owner.own(new T.MeshLambertMaterial())];
  const resources = [shared, indexed, ...materials]; const counts = resources.map(() => 0);
  resources.forEach((r, i) => r.addEventListener('dispose', () => { counts[i] = must(counts[i]) + 1; }));
  owner.own(shared);
  const meshes = [new T.Mesh(shared, materials[0]), new T.Mesh(shared, materials[1]), new T.Mesh(indexed, materials[0])];
  scene.add(...meshes); owner.release(indexed); owner.release(indexed);
  scene.remove(...meshes); owner.dispose(); disposeOwnedTree(scene); owner.dispose();
  assert.deepEqual(counts, [1, 1, 1, 1]); assert.throws(() => owner.own(shared), /already disposed/);
});
test('one failed disposer does not leak the rest or retry disposed resources', () => {
  const owner = createSceneResources(); let n = 0;
  owner.own({ dispose() { throw Error('failed'); } }); owner.own({ dispose() { n++; } });
  assert.throws(() => owner.dispose(), AggregateError); owner.dispose(); assert.equal(n, 1);
});
test('late ownership disposes rejected allocation and never double disposes it', () => {
  const owner = createSceneResources(); let n = 0; const r = { dispose() { n++; } }; owner.dispose();
  assert.throws(() => owner.own(r)); assert.throws(() => owner.own(r)); assert.equal(n, 1);
});
