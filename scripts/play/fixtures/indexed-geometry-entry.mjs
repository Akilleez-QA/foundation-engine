// Actual author runtime composition; instrumentation stays in the diagnostic.
import * as T from 'three';
import {Mesh} from '../../../src/author/mesh.ts';
const seen = new Map(),
  disposed = new Map();
let subjectMesh,
  frame = 0,
  failures = 0,
  appDisposed = false,
  lateDraws = 0;
const remember = geometry => {
  if (geometry) seen.set(geometry.uuid, geometry);
};
const originalDispose = T.BufferGeometry.prototype.dispose;
T.BufferGeometry.prototype.dispose = function () {
  disposed.set(this.uuid, (disposed.get(this.uuid) ?? 0) + 1);
  return originalDispose.call(this);
};
const originalBeforeRender = T.Scene.prototype.onBeforeRender;
T.Scene.prototype.onBeforeRender = function (...args) {
  if (appDisposed) lateDraws++;
  return originalBeforeRender.apply(this, args);
};
const originalAfterRender = T.Scene.prototype.onAfterRender;
T.Scene.prototype.onAfterRender = function (...args) {
  this.traverse(node => {
    if (node.name === 'subject' && node.geometry?.type === 'BufferGeometry') {
      subjectMesh = node;
      remember(node.geometry);
    }
  });
  frame++;
  return originalAfterRender.apply(this, args);
};
const {sceneContext} = await import('./hud-entry.mjs');
await window.hudBoot;
while (!sceneContext()) await new Promise(requestAnimationFrame);
const ctx = sceneContext(),
  entity = ctx.named('subject');
ctx.world.add(entity, Mesh({positions: [-1, 0, 0, 1, 0, 0, 0, 2, 0], indices: [0, 1, 2]}));
window.indexedCheck = {
  snapshot() {
    remember(subjectMesh?.geometry);
    return {
      frame,
      failures,
      appDisposed,
      lateDraws,
      active: subjectMesh?.geometry.uuid,
      seen: [...seen.keys()].map(id => ({id, disposals: disposed.get(id) ?? 0})),
    };
  },
  revise(revision) {
    const data = ctx.world.get(entity, Mesh);
    data.positions = [-1, 0, 0, 1, 0, 0, 0, 2 + revision / 10, 0];
    data.revision = revision;
    ctx.world.touch();
  },
  disposeAppOnOldDisposal() {
    subjectMesh.geometry.addEventListener('dispose', () => {
      appDisposed = true;
      window.hudCheck.dispose();
    });
  },
  failOldDisposal() {
    subjectMesh.geometry.addEventListener('dispose', () => {
      failures++;
      throw Error('indexed diagnostic disposal failure');
    });
  },
};
