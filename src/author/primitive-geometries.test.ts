import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { createPrimitiveGeometries } from './primitive-geometries';
import { createSceneResources } from './scene-resources';
import { disposeOwnedTree } from '../platform/render/dispose-owned-tree';

function track(geometry: T.BufferGeometry | T.Material) {
  let disposals = 0;
  geometry.addEventListener('dispose', () => { disposals++; });
  return () => disposals;
}

test('repeated primitive resizing retains only the currently used geometry', () => {
  const resources = createSceneResources();
  const geometries = createPrimitiveGeometries(resources);
  let lease = geometries.acquire('box', [1, 1, 1]);
  const material = new T.MeshBasicMaterial();
  const mesh = new T.Mesh(lease.geometry, material);
  const counts = [track(lease.geometry)];
  for (let size = 2; size <= 100; size++) {
    const next = geometries.acquire('box', [size, 1, 1]);
    counts.push(track(next.geometry));
    const previous = lease;
    mesh.geometry = next.geometry;
    lease = next;
    previous.release();
    assert.equal(counts.filter(count => count() === 0).length, 1);
    assert.equal(counts.at(-1)!(), 0);
    assert.equal(mesh.geometry, lease.geometry);
  }
  lease.release();
  geometries.dispose();
  resources.dispose();
  assert.ok(counts.every(count => count() === 1));
  material.dispose();
});

test('identical live primitives share geometry until the last mesh releases it', () => {
  const resources = createSceneResources();
  const geometries = createPrimitiveGeometries(resources);
  const first = geometries.acquire('sphere', [2, 2, 2]);
  const second = geometries.acquire('sphere', [2, 2, 2]);
  const count = track(first.geometry);
  assert.equal(first.geometry, second.geometry);
  first.release(); first.release();
  assert.equal(count(), 0);
  const third = geometries.acquire('sphere', [2, 2, 2]);
  assert.equal(third.geometry, second.geometry);
  second.release();
  assert.equal(count(), 0);
  third.release();
  assert.equal(count(), 1);
  const recreated = geometries.acquire('sphere', [2, 2, 2]);
  assert.notEqual(recreated.geometry, first.geometry);
  const recreatedCount = track(recreated.geometry);
  recreated.release(); geometries.dispose(); resources.dispose();
  assert.equal(count(), 1);
  assert.equal(recreatedCount(), 1);
});

test('scene exit disposes shared and distinct primitive geometry exactly once', () => {
  const resources = createSceneResources();
  const geometries = createPrimitiveGeometries(resources);
  const scene = new T.Scene();
  const leases = [geometries.acquire('plane', [2, 1, 3]),
    geometries.acquire('plane', [2, 1, 3]), geometries.acquire('cone', [1, 2, 1])];
  const counts = [track(leases[0].geometry), track(leases[2].geometry)];
  const material = resources.own(new T.MeshLambertMaterial());
  const materialCount = track(material);
  const meshes = leases.map(lease => new T.Mesh(lease.geometry, material));
  scene.add(...meshes);
  scene.remove(...meshes); // Runtime detaches owned representations before tree cleanup.
  geometries.dispose(); resources.dispose(); disposeOwnedTree(scene);
  for (const lease of leases) lease.release();
  geometries.dispose(); resources.dispose();
  assert.deepEqual(counts.map(count => count()), [1, 1]);
  assert.equal(materialCount(), 1);
  assert.throws(() => geometries.acquire('box', [1, 1, 1]), /already disposed/);
});

test('throwing last-release listener cannot poison a replacement with the same key', () => {
  const resources = createSceneResources();
  const geometries = createPrimitiveGeometries(resources);
  const old = geometries.acquire('box', [1, 1, 1]);
  let replacement: ReturnType<typeof geometries.acquire> | undefined;
  old.geometry.addEventListener('dispose', () => {
    replacement = geometries.acquire('box', [1, 1, 1]);
    throw Error('listener failed');
  });
  assert.throws(() => old.release(), /listener failed/);
  const retained = geometries.acquire('box', [1, 1, 1]);
  assert.equal(retained.geometry, replacement!.geometry);
  assert.notEqual(retained.geometry, old.geometry);
  const count = track(retained.geometry);
  old.release(); replacement!.release();
  assert.equal(count(), 0);
  retained.release(); geometries.dispose(); resources.dispose();
  assert.equal(count(), 1);
});

test('failed geometry disposal drains siblings and remaining scene resources', () => {
  const resources = createSceneResources();
  const geometries = createPrimitiveGeometries(resources);
  const first = geometries.acquire('box', [1, 1, 1]);
  const second = geometries.acquire('box', [2, 1, 1]);
  first.geometry.addEventListener('dispose', () => { throw Error('failed'); });
  const count = track(second.geometry);
  let otherDisposed = 0;
  resources.own({ dispose() { otherDisposed++; } });
  assert.throws(() => {
    try { geometries.dispose(); } finally { resources.dispose(); }
  }, AggregateError);
  first.release(); second.release(); geometries.dispose(); resources.dispose();
  assert.equal(count(), 1);
  assert.equal(otherDisposed, 1);
});
