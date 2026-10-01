import test from 'node:test';
import assert from 'node:assert/strict';
import { Scene, PerspectiveCamera, type WebGLRenderer } from 'three';
import { observeQualityScene, type QualityScene } from './quality-view';

test('quality hook observes real instance render after success, ignores other passes, and restores on disposal', () => {
  const scene = new Scene(), other = new Scene(), camera = new PerspectiveCamera();
  let calls = 0, fail = false;
  const original = function(this: unknown) { assert.equal(this, renderer); if (fail) throw Error('GPU failure'); calls++; };
  const renderer = { render: original } as unknown as WebGLRenderer;
  const handle: QualityScene = { scene, renderer, camera: () => camera };
  const life = new AbortController(); observeQualityScene(handle, life.signal);
  renderer.render(other, camera); assert.equal(handle.renders, 0);
  renderer.render(scene, camera); assert.equal(handle.renders, 1); assert.equal(calls, 2);
  fail = true; assert.throws(() => renderer.render(scene, camera), /GPU failure/); assert.equal(handle.renders, 1);
  fail = false; handle.captureCamera = { position: [1, 2, 3], target: [0, 0, 0] };
  renderer.render(scene, camera); assert.deepEqual(camera.position.toArray(), [1, 2, 3]);
  life.abort(); assert.equal(renderer.render, original);
});
