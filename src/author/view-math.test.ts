import {test} from 'node:test';
import assert from 'node:assert/strict';
import {effectiveFov, pointerOnGround} from './view-math';

const view = {
  camera: {position: [0, 10, 10] as [number, number, number], target: [0, 0, 0] as [number, number, number], fov: 50},
  aspect: 1,
};

test('view math: the view centre lands on the camera target; right of centre lands at +x', () => {
  const at = (x: number, y: number) =>
    pointerOnGround({view: view as never, input: {pointer: {x, y, down: true, pressed: false}} as never});
  const c = at(0, 0)!;
  assert.ok(Math.abs(c.x) < 1e-9 && Math.abs(c.z) < 1e-9);
  assert.ok(at(0.5, 0)!.x > 1);
  assert.ok(at(0, -0.5)!.z > 1, 'lower on screen is nearer the camera');
  assert.equal(at(0, 3), null, 'above the horizon');
});

test('view math: minWidthFov widens the vertical view on a narrow screen only', () => {
  assert.equal(effectiveFov({camera: {...view.camera, minWidthFov: 40}, aspect: 2}), 50);
  assert.ok(effectiveFov({camera: {...view.camera, minWidthFov: 60}, aspect: 0.5}) > 90);
});

test('view math: projecting a point and casting a ray back agree', async () => {
  const {projectToView, viewRay} = await import('./view-math');
  const p = projectToView(view as never, [2, 0, 1])!;
  const {origin, dir} = viewRay(view as never, p);
  const k = -origin[1] / dir[1];
  assert.ok(Math.abs(origin[0] + dir[0] * k - 2) < 1e-9 && Math.abs(origin[2] + dir[2] * k - 1) < 1e-9);
  assert.equal(projectToView(view as never, [0, 20, 20]), null, 'behind the camera');
});
