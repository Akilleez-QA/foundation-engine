import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {visibleModelBounds, modelFitDistance} from './visible-model-bounds';

test('hidden groups do not change the remaining visible frame', () => {
  const root = new T.Group(),
    cabin = new T.Mesh(new T.BoxGeometry(2, 3, 4)),
    stage = new T.Group();
  const tank = new T.Mesh(new T.BoxGeometry(4, 20, 4));
  tank.position.y = -15;
  stage.add(tank);
  root.add(cabin, stage);
  root.position.set(10, 4, -2);
  root.rotation.z = 0.7;
  const full = visibleModelBounds(root);
  stage.visible = false;
  const visible = visibleModelBounds(root);
  const cabinBox = new T.Box3().setFromObject(cabin);
  assert.ok(full.getSize(new T.Vector3()).length() > visible.getSize(new T.Vector3()).length() * 2);
  assert.deepEqual(visible.min.toArray(), cabinBox.min.toArray());
  assert.deepEqual(visible.max.toArray(), cabinBox.max.toArray());
});
test('visible bounds account for instanced placements and a hidden whole model', () => {
  const root = new T.Group(),
    mesh = new T.InstancedMesh(new T.BoxGeometry(2, 2, 2), new T.MeshBasicMaterial(), 2);
  mesh.setMatrixAt(0, new T.Matrix4().makeTranslation(-5, 0, 0));
  mesh.setMatrixAt(1, new T.Matrix4().makeTranslation(5, 0, 0));
  root.add(mesh);
  const b = visibleModelBounds(root);
  assert.equal(b.min.x, -6);
  assert.equal(b.max.x, 6);
  root.visible = false;
  assert.ok(visibleModelBounds(root).isEmpty());
});
test('sphere fit contains a rotated box in portrait and landscape views', () => {
  const box = new T.Box3(new T.Vector3(-3, -2, -1), new T.Vector3(3, 2, 1)),
    sphere = box.getBoundingSphere(new T.Sphere());
  for (const aspect of [0.45, 0.8, 1.5, 2.5])
    for (const direction of [new T.Vector3(5, 2.5, 13), new T.Vector3(-1, 2, 1)]) {
      const camera = new T.PerspectiveCamera(42, aspect, 0.1, 6000);
      camera.position.copy(direction.normalize().multiplyScalar(modelFitDistance(sphere.radius, 42, aspect)));
      camera.lookAt(sphere.center);
      camera.updateMatrixWorld();
      for (const x of [-3, 3])
        for (const y of [-2, 2])
          for (const z of [-1, 1]) {
            const p = new T.Vector3(x, y, z).project(camera);
            assert.ok(Math.abs(p.x) < 1 && Math.abs(p.y) < 1 && p.z < 1 && p.z > -1);
          }
    }
});

test('a multi-part model frames only its remaining visible part after the others are hidden', async () => {
  const {disposeOwnedTree} = await import('./dispose-owned-tree');
  for (const tilt of [0, -Math.PI / 2, 0.9]) {
    const group = new T.Group(),
      core = new T.Group(),
      parts = [0, 1, 2].map(i => {
        const g = new T.Group();
        const m = new T.Mesh(new T.CylinderGeometry(1.5 - i * 0.3, 1.5 - i * 0.3, 6, 8));
        m.position.y = -6 * (i + 1);
        g.add(m);
        group.add(g);
        return g;
      });
    const head = new T.Mesh(new T.SphereGeometry(1.2, 8, 6));
    core.add(head);
    group.add(core);
    group.rotation.z = tilt;
    parts.forEach(p => (p.visible = false));
    const bounds = visibleModelBounds(group),
      payload = visibleModelBounds(core);
    assert.deepEqual(bounds.min.toArray(), payload.min.toArray());
    assert.deepEqual(bounds.max.toArray(), payload.max.toArray());
    const sphere = bounds.getBoundingSphere(new T.Sphere());
    assert.ok(sphere.radius > 0 && Number.isFinite(sphere.radius));
    for (const aspect of [0.45, 2]) {
      const camera = new T.PerspectiveCamera(42, aspect, 0.1, 6000);
      camera.position
        .copy(sphere.center)
        .add(new T.Vector3(5, 2.5, 13).normalize().multiplyScalar(modelFitDistance(sphere.radius, 42, aspect)));
      camera.lookAt(sphere.center);
      camera.updateMatrixWorld();
      for (const x of [bounds.min.x, bounds.max.x])
        for (const y of [bounds.min.y, bounds.max.y])
          for (const z of [bounds.min.z, bounds.max.z]) {
            const p = new T.Vector3(x, y, z).project(camera);
            assert.ok(Math.abs(p.x) < 1 && Math.abs(p.y) < 1);
          }
    }
    disposeOwnedTree(group);
  }
});
