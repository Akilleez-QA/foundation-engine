/** Test-build scene handles. Features publish their real render inputs; production never retains a scene here. */
import {TEST_API} from '../../core/env';
import type {Camera, Scene, WebGLRenderer} from 'three';
export interface QualityScene {
  scene: Scene;
  renderer: WebGLRenderer;
  camera(): Camera;
  prerequisites?: Promise<unknown>;
  renders?: number;
  captureCamera?: {position: [number, number, number]; target: [number, number, number]};
  pose?(): unknown;
}
const scenes = new Map<string, QualityScene>();
export function registerQualityScene(view: string, scene: QualityScene, signal: AbortSignal): void {
  if (!TEST_API) return;
  observeQualityScene(scene, signal);
  scenes.set(view, scene);
  signal.addEventListener(
    'abort',
    () => {
      if (scenes.get(view) === scene) scenes.delete(view);
    },
    {once: true},
  );
}
export function qualityScene(view: string): QualityScene | undefined {
  return scenes.get(view);
}

/** Three installs render on the instance, not its prototype. Observe exactly the feature's final scene pass. */
export function observeQualityScene(handle: QualityScene, signal: AbortSignal): void {
  const renderer = handle.renderer,
    original = renderer.render;
  handle.renders = 0;
  const render: typeof renderer.render = function (this: WebGLRenderer, scene, camera) {
    if (scene === handle.scene && handle.captureCamera) {
      camera.position.set(...handle.captureCamera.position);
      camera.lookAt(...handle.captureCamera.target);
      camera.updateMatrixWorld();
    }
    original.call(this, scene, camera);
    if (scene === handle.scene) handle.renders = (handle.renders ?? 0) + 1;
  };
  renderer.render = render;
  signal.addEventListener(
    'abort',
    () => {
      if (renderer.render === render) renderer.render = original;
    },
    {once: true},
  );
}
