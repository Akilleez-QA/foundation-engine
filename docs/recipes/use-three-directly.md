# Use three.js directly

The engine draws with three.js. Most looks are plain data on `@engine` (environment, materials, particles, models):
prefer those when they can say what you want, because then quality tiers, render backends and three.js upgrades stay
the engine's problem. When they cannot (point lights, shadows, bloom, a custom shader, a loader or controls), opt the
game into **`@kits/three`** and use three.js itself.

**Full power, you own compatibility across three upgrades.** Code written against three.js is `@unstable`: when the
engine moves to a newer three.js, your code may need changes. The kit's contract is in its
[README](../../src/kits/three/README.md).

Every example below compiles in the courtyard fixture (`tools/visual-courtyard/game`: `look.ts`, `lantern.ts`,
`recipes.ts`), and the lantern, shadow and bloom ones run in its browser check (`npm run test:three-kit-browser`).

## 1. Opt in

```ts
// game/game.ts
import {defineGame} from '@engine';
import {three} from '@kits/three';
export default defineGame({id: 'my-game', title: 'My game', version: '0.1.0', firstScene: 'courtyard', kits: [three()]});
```

Now this game's files may import `three`, `three/addons/*` and `three/examples/jsm/*` (`npm run lint:layers` refuses
them in any game that does not list `three()`). `npm run check` prints each file that does, so the author always sees
where the escape hatch is in use. Every import gets the engine's single copy of three.js.

A scene asks for a handle by listing `sceneThree()`:

```ts
import {defineScene} from '@engine';
import {sceneThree} from '@kits/three';

export default defineScene({
  id: 'courtyard',
  title: 'Courtyard',
  extensions: [sceneThree({shadows: 'pcf-soft', setup: three => { /* build, hook, override */ }})],
  // entities, systems, view as usual
});
```

`setup(three)` runs once per visit before the first frame is prepared, so what it builds is compiled with the scene.
Elsewhere (`enter`, `exit`, a system), get the same handle with `useThree(ctx)`; `hasThree(ctx)` is false in headless
`testScene`, which has no renderer.

## 2. Bloom with an EffectComposer

```ts
import {type ThreeHandle} from '@kits/three';
import * as THREE from 'three';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';

export function bloom(three: ThreeHandle) {
  const {renderer, scene, camera} = three;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; // this visit's renderer: the scene's choice
  renderer.toneMappingExposure = 0.9;
  const composer = three.own(new EffectComposer(renderer)); // disposed when the visit ends
  const pass = three.own(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.65, 0.5, 0.9));
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(pass);
  composer.addPass(three.own(new OutputPass())); // tone mapping and sRGB
  three.onResize(({width, height, pixelRatio}) => {
    composer.setPixelRatio(pixelRatio);
    composer.setSize(width, height);
  });
  three.setRenderOverride(() => composer.render()); // the composer draws every frame the engine draws
}
```

The override runs only on frames the engine draws (render on change). It must leave the render target at `null`
(an `OutputPass` or any `renderToScreen` pass does). Its passes count in the scene's `draws` budget.

## 3. A lantern with a real light: `customObject`

```ts
import {customObject, ThreeObject, sceneThree, THREE} from '@kits/three';
import {defineScene, Transform} from '@engine';

export const lantern = customObject({
  id: 'lantern',
  limits: {triangles: 2_000, textures: 0},
  create({own}) {
    const group = new THREE.Group();
    const glass = new THREE.Mesh(
      own(new THREE.BoxGeometry(0.42, 0.5, 0.42)),
      own(new THREE.MeshStandardMaterial({color: 0xffd28a, emissive: 0xffb04a, emissiveIntensity: 6})),
    );
    glass.position.y = 2.45;
    const light = new THREE.PointLight(0xffa850, 7, 9, 1.7);
    light.position.y = 2.3;
    group.add(glass, light);
    return group;
  },
});

export default defineScene({
  id: 'lamps',
  title: 'Lamps',
  extensions: [sceneThree({objects: [lantern], max: 8})],
  entities: [[Transform({x: 3, z: -3}), ThreeObject({use: 'lantern'})]],
});
```

One object per entity, placed by its `Transform`, disposed when the entity goes. An `update(object, frame)` that
returns true redraws; it gets no world, so it cannot change game state.

## 4. Point-light shadows

```ts
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
```

The scene opts in with `sceneThree({shadows: true})`. The engine's shadow scheduler still redraws the maps only when a
caster or light changes, so a still scene pays nothing after the first frame. A point light's shadow is six maps:
keep it to one or two lights, and build lights in `setup` (a light added later recompiles every lit material once).

## 5. A glTF model with its animation

```ts
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

export function loadAnimated(three: ThreeHandle, url: string) {
  let mixer: THREE.AnimationMixer | null = null;
  new GLTFLoader().load(url, gltf => {
    if (three.signal.aborted) return; // the visit ended while it loaded
    three.root.add(gltf.scene);
    mixer = new THREE.AnimationMixer(gltf.scene);
    const clip = gltf.animations[0];
    if (clip) mixer.clipAction(clip).play();
    three.requestRender(); // changed outside a hook
  });
  three.onFrame(({dt}) => mixer?.update(dt)); // animating: frames keep running
}
```

For models the engine already handles (`Model`, [load a model](load-a-model.md)), prefer that: it shares and releases
model files through the asset library and residency budgets.

## 6. OrbitControls in a debug scene

```ts
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';

export const debugScene = defineScene({
  id: 'debug-orbit',
  title: 'Debug orbit',
  extensions: [
    sceneThree({
      setup(three) {
        const controls = three.own(new OrbitControls(three.camera, three.canvas));
        controls.target.set(0, 1, 0);
        controls.addEventListener('change', () => three.requestRender());
        three.onBeforeRender(() => controls.update());
      },
    }),
  ],
  view: {camera: {position: [6, 4, 6], target: [0, 1, 0]}},
});
```

OrbitControls reads the pointer directly, around the engine's input actions: keep it to debug and inspection scenes.

## 7. A custom ShaderMaterial

```ts
export function pulsingOrb(three: ThreeHandle) {
  const material = new THREE.ShaderMaterial({
    uniforms: {time: {value: 0}, color: {value: new THREE.Color(0x66ccff)}},
    vertexShader: `void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
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
```

GLSL runs on the WebGL2 backend only; a future WebGPU backend will not draw it.

## Rules that still hold

- **Dispose.** Everything under `three.root`, everything `own()`ed, and the rest of the scene are disposed when the
  visit ends. Something you detach and keep is yours: `own()` it or dispose it. Dev builds report a resource that left
  the scene undisposed.
- **Ask for frames.** A still scene draws nothing. `onFrame` keeps frames running; after any other change (a load, a
  timer, an event) call `three.requestRender()`.
- **Leave the engine's renderer state alone.** Tone mapping, output colour space and shadow settings are yours for the
  visit. The render target, the drawing-buffer size and the pixel ratio are the engine's: they are restored after your
  hooks run, and dev builds report it. Resize composers in `onResize`.
- **Budgets are honest.** `play:snap` and the gate measure draws, triangles, textures and heap from the real renderer,
  whatever made them. Over budget: recover first (fewer lights and passes, smaller maps), as the
  [fix-budget skill](../../.claude/skills/fix-budget/SKILL.md) says.
- **Replays.** Replays and determinism checks compare game state, not the three.js scene. Visuals the kit drives are not
  part of a replay unless the game keeps them in state.
- **Game state stays in systems.** Read the world in a hook if you need to; change game state in systems, so a replay
  of the same inputs gives the same game.
