import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defineScene, Name, testScene, Transform} from '../../author';
import {cameraPose, cameraSystem, type CameraMode} from './index';

const t0 = {x: 1, y: 0, z: 2, heading: 0};

test('camera: every mode gives a finite pose that looks at or along the target', () => {
  for (const mode of ['follow', 'orbit', 'first-person', 'top-down', 'side-scroll', 'fixed'] as CameraMode[]) {
    const p = cameraPose(mode, t0);
    assert.ok([...p.position, ...p.target].every(Number.isFinite), mode);
    assert.notDeepEqual(p.position, p.target, mode);
  }
  assert.deepEqual(
    cameraPose('follow', t0, {distance: 4, height: 3}),
    {position: [1, 3, -2], target: [1, 0.5, 2]},
    'behind: heading 0 faces +z',
  );
  assert.deepEqual(cameraPose('top-down', t0).target, [1, 0, 2]);
  assert.deepEqual(cameraPose('fixed', t0, {position: [0, 5, 5], lookAt: [0, 0, 0]}), {
    position: [0, 5, 5],
    target: [0, 0, 0],
  });
});

test('camera: the system eases to the pose and then stops changing the view', async () => {
  const scene = defineScene({
    id: 'cam',
    title: 'Cam',
    entities: [[Name({name: 'player'}), Transform({x: 3})]],
    systems: [cameraSystem('top-down', {smooth: 0.05})],
  });
  const t = await testScene(scene);
  t.run(1);
  assert.deepEqual(t.ctx.view.camera.target, [3, 0, 0]);
  const before = t.ctx.view.camera.position;
  t.run(0.5);
  assert.equal(t.ctx.view.camera.position, before, 'at rest the camera object is not replaced (no redraws)');
});
