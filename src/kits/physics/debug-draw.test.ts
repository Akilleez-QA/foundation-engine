import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {World} from '../../core/ecs/world';
import {Transform} from '../../author';
import {openSceneExtension, type SceneExtensionContext} from '../../author/scene-extension';
import {Collider, loadPhysics, physicsDebugDraw, scenePhysics} from './index';

function visit(world: World) {
  const controller = new AbortController();
  const context: SceneExtensionContext = {
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(),
    renderer: {} as THREE.WebGLRenderer,
    canvas: {} as HTMLCanvasElement,
    backend: 'webgl2',
    ctx: {},
    world,
    kits: ['physics'],
    dev: true,
    signal: controller.signal,
    time: () => ({t: 0, calm: false}),
    mask: () => 1,
    invalidate: () => {},
    report: () => {},
  };
  return context;
}

test('debug draw extension: off unless listed, bounded line buffer, refreshed per tick, disposed with the visit', async () => {
  assert.equal((await loadPhysics()).status, 'ready');
  const physics = scenePhysics();
  assert.throws(() => physicsDebugDraw(physics, {maxVertices: 1}), RangeError);
  const world = new World();
  for (let i = 0; i < 6; i++) world.spawn(Transform({x: i * 3}), Collider({shape: 'ball', radius: 1}));
  let on = false;
  const context = visit(world);
  const session = openSceneExtension(physicsDebugDraw(physics, {maxVertices: 64, enabled: () => on}), context);
  physics.system.run({world} as never, 1 / 60);
  assert.equal(session.sync(0), false, 'nothing is created or drawn while disabled');
  assert.equal(context.scene.getObjectByName('kits.physics.debug'), undefined);
  on = true;
  assert.equal(session.sync(0), true);
  const lines = context.scene.getObjectByName('kits.physics.debug') as THREE.LineSegments;
  assert.ok(lines);
  const position = lines.geometry.getAttribute('position') as THREE.BufferAttribute;
  assert.equal(position.count, 64, 'capacity allocated once');
  assert.equal(lines.geometry.drawRange.count, 64, 'drawn up to the bound');
  const stats = session.stats!() as {drawn: number; total: number; truncatedFrames: number};
  assert.equal(stats.drawn, 64);
  assert.ok(stats.total > 64);
  assert.equal(stats.truncatedFrames, 1);
  assert.equal(session.sync(0), false, 'no refresh without a new physics tick');
  physics.system.run({world} as never, 1 / 60);
  assert.equal(session.sync(0), true);
  on = false;
  assert.equal(session.sync(0), true, 'hidden when disabled again');
  assert.equal(lines.visible, false);
  let disposed = 0;
  lines.geometry.addEventListener('dispose', () => disposed++);
  session.dispose();
  session.dispose();
  assert.equal(disposed, 1);
  assert.equal(context.scene.getObjectByName('kits.physics.debug'), undefined);
  physics.exit({world});
});
