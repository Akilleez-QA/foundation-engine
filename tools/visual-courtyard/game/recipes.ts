// The examples of docs/recipes/use-three-directly.md that the courtyard scenes do not run, kept here so `npm run
// typecheck` compiles them against the engine's three.js on every change, three upgrades included (a helper file: no
// default export, never drawn). The lantern (lantern.ts), bloom and shadows (look.ts) are the recipe's other examples.
import {defineScene, defineSystem, type SceneContext} from '@engine';
import {sceneThree, useThree, hasThree, type ThreeHandle} from '@kits/three';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';

/** A glTF model with its first animation playing, through an AnimationMixer. */
export function loadAnimated(three: ThreeHandle, url: string) {
  let mixer: THREE.AnimationMixer | null = null;
  new GLTFLoader().load(url, gltf => {
    if (three.signal.aborted) return; // the visit ended while it loaded: the engine disposed the scene already
    three.root.add(gltf.scene); // under root: disposed with the visit
    mixer = new THREE.AnimationMixer(gltf.scene);
    const clip = gltf.animations[0];
    if (clip) mixer.clipAction(clip).play();
    three.requestRender(); // changed outside a hook: ask for a frame
  });
  three.onFrame(({dt}) => mixer?.update(dt)); // animating: frames keep running
}

/** A debug scene you can orbit with the mouse (OrbitControls owns the pointer, so keep it to debug scenes). */
export const debugScene = defineScene({
  id: 'debug-orbit',
  title: 'Debug orbit',
  extensions: [
    sceneThree({
      setup(three) {
        const controls = three.own(new OrbitControls(three.camera, three.canvas));
        controls.target.set(0, 1, 0);
        controls.addEventListener('change', () => three.requestRender());
        // The engine places the camera from ctx.view.camera only when that changes; OrbitControls moves it after.
        three.onBeforeRender(() => controls.update());
      },
    }),
  ],
  view: {camera: {position: [6, 4, 6], target: [0, 1, 0]}},
});

/** A custom ShaderMaterial (WebGL2 only): a pulsing glow driven by time in a frame hook. */
export function pulsingOrb(three: ThreeHandle) {
  const material = new THREE.ShaderMaterial({
    uniforms: {time: {value: 0}, color: {value: new THREE.Color(0x66ccff)}},
    vertexShader: /* glsl */ `void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float time;
      uniform vec3 color;
      void main() { gl_FragColor = vec4(color * (0.6 + 0.4 * sin(time * 3.0)), 1.0); }`,
  });
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.5, 32, 16), material);
  orb.position.set(0, 1.5, 0);
  three.root.add(orb);
  three.onFrame(({t, calm}) => {
    material.uniforms.time!.value = calm ? 0 : t; // Calm: no decorative motion
  });
}

/** Point-light shadows: the scene opts in with sceneThree({ shadows: true }); a light and its casters opt in here. */
export function shadowedLamp(three: ThreeHandle) {
  const lamp = new THREE.PointLight(0xffc070, 8, 10, 2);
  lamp.position.set(0, 2.5, 0);
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(512, 512);
  three.root.add(lamp);
  three.onBeforeRender(() =>
    three.scene.traverse(o => {
      if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = true;
    }),
  );
}

/** A system may use the handle too (never in headless testScene: check hasThree first). */
export const spinRoot = defineSystem({
  id: 'spin-root',
  phase: 'frame',
  run(ctx: SceneContext) {
    if (!hasThree(ctx)) return;
    const three = useThree(ctx);
    three.root.rotation.y += 0.01;
    three.requestRender();
  },
});
