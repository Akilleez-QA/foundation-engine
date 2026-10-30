// Instrument actual Three allocations before the existing composed fixture boots.
import * as T from 'three';
import {Shape, Transform, Name, defineEntity} from '../../../src/author/index.ts';
const seen = new Map();
const disposed = new Map();
let frame = 0,
  active = [];
const originalDispose = T.BufferGeometry.prototype.dispose;
T.BufferGeometry.prototype.dispose = function () {
  disposed.set(this.uuid, (disposed.get(this.uuid) ?? 0) + 1);
  return originalDispose.call(this);
};
// WebGLRenderer.render is an instance property. Scene inherits this real draw hook
// from Object3D; WebGLRenderer calls it after rendering even an empty scene.
const originalAfterRender = T.Scene.prototype.onAfterRender;
T.Scene.prototype.onAfterRender = function (...args) {
  const meshes = [];
  this.traverse(node => {
    if (node.geometry?.type !== 'BoxGeometry') return;
    const geometry = node.geometry;
    seen.set(geometry.uuid, geometry.parameters.width);
    meshes.push({name: node.name, id: geometry.uuid, width: geometry.parameters.width});
  });
  const result = originalAfterRender.apply(this, args);
  active = meshes;
  frame++;
  return result;
};
const {sceneContext} = await import('./hud-entry.mjs');
await window.hudBoot;
while (!sceneContext()) await new Promise(requestAnimationFrame);
const subject = () => sceneContext().named('subject');
window.primitiveCheck = {
  snapshot: () => ({
    frame,
    active,
    seen: [...seen].map(([id, width]) => ({id, width, disposals: disposed.get(id) ?? 0})),
  }),
  resize: width => {
    const ctx = sceneContext();
    ctx.world.get(subject(), Shape).size = [width, 1, 1];
    ctx.world.touch();
  },
  share: () =>
    sceneContext().spawn(
      defineEntity({
        id: 'shared',
        components: [Name({name: 'shared'}), Transform({x: 2}), Shape({kind: 'box', size: [1, 1, 1]})],
      }),
    ),
  removeSubject: () => sceneContext().world.remove(subject(), Shape),
  removeShared: () => {
    const ctx = sceneContext();
    ctx.world.remove(ctx.named('shared'), Shape);
  },
};
