import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {World} from '../core/ecs/world';
import {Mesh, type MeshData} from './mesh';
import {createSceneResources} from './scene-resources';
import {indexedGeometry, replaceIndexedGeometry, releaseIndexed, type IndexedSlot} from './indexed-geometry';

function data(revision = 0): MeshData {
  return Mesh({positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2], revision}).value;
}
function fixture() {
  const resources = createSceneResources();
  const world = new World(),
    entity = world.spawn();
  const initial = data();
  const geometry = indexedGeometry(initial, resources);
  const material = resources.own(new T.MeshLambertMaterial());
  const slot: IndexedSlot = {mesh: new T.Mesh(geometry, material), ...initial, sig: ''};
  const scene = new T.Scene();
  scene.add(slot.mesh);
  const slots = new Map([[entity, slot]]);
  let changes = 0,
    closed = false;
  const changed = () => {
    changes++;
  };
  const current = () => !closed && slots.get(entity) === slot;
  const close = () => {
    closed = true;
    releaseIndexed(entity, slots, scene, resources);
    resources.dispose();
  };
  return {resources, entity, slot, scene, slots, geometry, material, changed, current, close, changes: () => changes};
}

test('throwing old disposal observes fully published replacement and does not retain old geometry', () => {
  const f = fixture();
  const next = data(1);
  next.colors = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  let oldDisposals = 0,
    newDisposals = 0;
  f.geometry.addEventListener('dispose', () => {
    oldDisposals++;
    assert.notEqual(f.slot.mesh.geometry, f.geometry);
    assert.equal(f.slot.revision, 1);
    assert.equal(f.slot.colors, next.colors);
    assert.equal(f.slot.mesh.material.vertexColors, true);
    assert.equal(f.changes(), 1);
    f.slot.mesh.geometry.addEventListener('dispose', () => {
      newDisposals++;
    });
    throw Error('old cleanup failed');
  });
  assert.throws(() => replaceIndexedGeometry(f.slot, next, f.resources, f.current, f.changed), /old cleanup failed/);
  f.resources.release(f.geometry);
  assert.equal(oldDisposals, 1);
  f.close();
  assert.equal(newDisposals, 1);
});

test('nested replacement wins and retires the superseded allocation exactly once', () => {
  const f = fixture();
  let intermediateDisposals = 0,
    finalDisposals = 0;
  f.geometry.addEventListener('dispose', () => {
    f.slot.mesh.geometry.addEventListener('dispose', () => {
      intermediateDisposals++;
    });
    assert.equal(replaceIndexedGeometry(f.slot, data(2), f.resources, f.current, f.changed), true);
    f.slot.mesh.geometry.addEventListener('dispose', () => {
      finalDisposals++;
    });
  });
  assert.equal(replaceIndexedGeometry(f.slot, data(1), f.resources, f.current, f.changed), false);
  assert.equal(f.slot.revision, 2);
  assert.equal(intermediateDisposals, 1);
  f.close();
  assert.equal(intermediateDisposals, 1);
  assert.equal(finalDisposals, 1);
});

test('teardown inside old disposal prevents continuation and drains published replacement', () => {
  const f = fixture();
  let replacementDisposals = 0;
  f.geometry.addEventListener('dispose', () => {
    f.slot.mesh.geometry.addEventListener('dispose', () => {
      replacementDisposals++;
    });
    f.close();
  });
  assert.equal(replaceIndexedGeometry(f.slot, data(1), f.resources, f.current, f.changed), false);
  assert.equal(f.slots.size, 0);
  assert.equal(f.scene.children.length, 0);
  assert.equal(replacementDisposals, 1);
  f.resources.dispose();
  assert.equal(replacementDisposals, 1);
});

test('invalid replacement preserves the installed geometry, metadata and ownership', () => {
  const f = fixture();
  let disposed = 0;
  f.geometry.addEventListener('dispose', () => {
    disposed++;
  });
  const invalid = data(1);
  invalid.indices = [0, 1, 9];
  assert.throws(() => replaceIndexedGeometry(f.slot, invalid, f.resources, f.current, f.changed), /mesh:/);
  assert.equal(f.slot.mesh.geometry, f.geometry);
  assert.equal(f.slot.revision, 0);
  assert.equal(f.changes(), 0);
  assert.equal(disposed, 0);
  f.close();
  assert.equal(disposed, 1);
});

test('retirement removes identity before callbacks and cannot remove a replacement slot', () => {
  const f = fixture();
  const next = data(1);
  const replacement: IndexedSlot = {
    mesh: new T.Mesh(indexedGeometry(next, f.resources), f.resources.own(new T.MeshLambertMaterial())),
    ...next,
    sig: '',
  };
  let oldGeometry = 0,
    oldMaterial = 0,
    nextGeometry = 0;
  f.geometry.addEventListener('dispose', () => {
    oldGeometry++;
  });
  f.material.addEventListener('dispose', () => {
    oldMaterial++;
  });
  replacement.mesh.geometry.addEventListener('dispose', () => {
    nextGeometry++;
  });
  f.slot.mesh.addEventListener('removed', () => {
    assert.equal(f.slots.has(f.entity), false);
    releaseIndexed(f.entity, f.slots, f.scene, f.resources);
    f.slots.set(f.entity, replacement);
    f.scene.add(replacement.mesh);
    throw Error('removed callback failed');
  });
  assert.throws(() => releaseIndexed(f.entity, f.slots, f.scene, f.resources), AggregateError);
  assert.equal(f.slots.get(f.entity), replacement);
  assert.deepEqual([oldGeometry, oldMaterial, nextGeometry], [1, 1, 0]);
  releaseIndexed(f.entity, f.slots, f.scene, f.resources);
  f.resources.dispose();
  assert.deepEqual([oldGeometry, oldMaterial, nextGeometry], [1, 1, 1]);
});
