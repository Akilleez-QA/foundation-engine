import test from 'node:test';
import assert from 'node:assert/strict';
import {PerspectiveCamera, OrthographicCamera, Vector3} from 'three';
import {dragTouchCamera, touchMetrics} from './touch-camera';
for (const perspective of [false, true])
  test(`touch pan preserves attitude and camera distance (${perspective ? 'perspective' : 'map'})`, () => {
    const camera = perspective
      ? new PerspectiveCamera(45, 4 / 3, 0.1, 100)
      : new OrthographicCamera(-4, 4, 3, -3, 0.1, 100);
    const target = new Vector3();
    camera.position.set(0, -6, 8);
    camera.lookAt(target);
    const quaternion = camera.quaternion.clone(),
      offset = camera.position.clone().sub(target),
      right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    dragTouchCamera(camera, target, 100, 0, 800, 600, 'pan');
    assert.ok(target.dot(right) < 0);
    assert.ok(camera.position.clone().sub(target).distanceTo(offset) < 1e-12);
    assert.ok(camera.quaternion.angleTo(quaternion) < 1e-7);
  });
test('touch rotation follows screen axes even after crossing a pole', () => {
  const camera = new PerspectiveCamera();
  const target = new Vector3();
  camera.position.set(0, 0, 5);
  camera.lookAt(target);
  for (let i = 0; i < 100; i++) {
    const vertical = i % 2 === 0,
      before = camera.position.clone(),
      right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion),
      up = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    dragTouchCamera(camera, target, vertical ? 0 : 4, vertical ? 4 : 0, 800, 600, 'rotate');
    const delta = camera.position.clone().sub(before).normalize();
    assert.ok(Math.abs(delta.dot(vertical ? up : right)) > 0.99);
    assert.ok(Math.abs(camera.position.length() - 5) < 1e-10);
  }
});
test('pinch metrics use both fingers and survive returning to one finger', () => {
  assert.deepEqual(
    touchMetrics([
      {x: 10, y: 20},
      {x: 110, y: 20},
    ]),
    {x: 60, y: 20, distance: 100},
  );
  assert.deepEqual(touchMetrics([{x: 110, y: 20}]), {x: 110, y: 20, distance: 0});
});
