// The fixture's look through @kits/three (a helper file): ACES tone mapping, an EffectComposer with UnrealBloomPass
// drawing every frame (a render override), a moonlight shadow and shadows on the scene's own meshes.
import {THREE, type ThreeHandle} from '@kits/three';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';

/** Bloom through an EffectComposer that draws the scene's frames. The composer is owned: disposed with the visit. */
export function bloom(three: ThreeHandle, o: {strength: number; radius: number; threshold: number}) {
  const {renderer, scene, camera} = three;
  // The renderer is this visit's own (the pool leases a fresh one per visit): tone mapping is the scene's choice.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  const composer = three.own(new EffectComposer(renderer));
  const pass = new UnrealBloomPass(new THREE.Vector2(256, 256), o.strength, o.radius, o.threshold);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(pass);
  composer.addPass(three.own(new OutputPass()));
  three.own(pass);
  three.onResize(({width, height, pixelRatio}) => {
    composer.setPixelRatio(pixelRatio);
    composer.setSize(width, height);
  });
  three.setRenderOverride(() => composer.render());
  return composer;
}

/** Moonlight shadows and shadows on the scene's own meshes (they appear as entities are drawn). */
export function shadows(three: ThreeHandle) {
  const {scene} = three;
  const done = new WeakSet<object>();
  three.onBeforeRender(() => {
    scene.traverse(o => {
      if (done.has(o)) return;
      done.add(o);
      if (o instanceof THREE.DirectionalLight) {
        o.castShadow = true;
        o.shadow.mapSize.set(2048, 2048);
        o.shadow.bias = -0.0008;
        Object.assign(o.shadow.camera, {left: -14, right: 14, top: 14, bottom: -14, near: 0.5, far: 40});
        o.shadow.camera.updateProjectionMatrix();
      } else if (o instanceof THREE.Mesh && !(o instanceof THREE.InstancedMesh)) {
        const material = o.material as THREE.Material;
        if (material.transparent) return;
        o.castShadow = o.name !== 'floor';
        o.receiveShadow = true;
      }
    });
  });
}
