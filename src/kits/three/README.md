# `@kits/three`: full three.js, opt-in

**Full power, and you own compatibility across three.js upgrades.** This kit hands a game the whole of three.js: the
engine's own copy (r186), its scene, camera, renderer and canvas, per-frame hooks and a render override. Code written
against it is `@unstable`: a three.js upgrade of the engine may break it, and fixing it is the game's job. The kit is
outside the public compatibility promise ([public compatibility](../../../docs/guides/public-compatibility.md)).

Prefer the engine's own data (`@engine`: environment, materials, particles, models) when it can say what you want: it
keeps quality tiers, render backends and upgrades the engine's problem. Use this kit for everything it cannot say yet:
point and spot lights, shadows, bloom and other post-processing, custom shaders, loaders and controls. Recipes with
real examples: [use three.js directly](../../../docs/recipes/use-three-directly.md).

## Opt in

```ts
// game/game.ts: the game opts in. lint:layers then allows `three` imports in this game's files only.
import {three} from '@kits/three';
export default defineGame({ /* … */ kits: [three()] });

// game/courtyard.ts: a scene asks for a handle.
import {sceneThree, useThree} from '@kits/three';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
export default defineScene({
  id: 'courtyard',
  extensions: [sceneThree({ shadows: 'pcf-soft', setup(three) { /* build objects, hooks, an override */ } })],
  // …
});
```

- **Imports.** A game that lists `three()` may import anything from `three`, `three/addons/*` and
  `three/examples/jsm/*`, in its own files. Every import of `three` resolves to the engine's single copy (the Vite `three` alias; the fixture
  checks it), so `instanceof` works across engine, addons and game. A game that does not list
  the kit may not import either (`npm run lint:layers`: `three-needs-kit`, `kit-not-listed`). `three/webgpu` and
  `three/tsl` stay banned for every game (ADR 0078). Engine code never gets this allowance.
- **Visibility.** `npm run check` prints one line per game file that uses the kit.
- **Runtime.** A scene with `sceneThree()` in a game that does not list `three()` reports why and gets no handle.

## The handle: `useThree(ctx)`

Available from the scene's `setup` (before program preparation) through `enter()`, systems and `exit()`, until the
visit ends. `hasThree(ctx)` is false in a scene without `sceneThree()` and in headless `testScene` (no renderer).

| Member | What |
|---|---|
| `THREE` | The three.js namespace (the engine's copy). |
| `scene` | The visit's `THREE.Scene`: environment, fog and every drawn entity. Traverse it freely. |
| `root` | A group the kit owns inside `scene`. Add your objects here. |
| `camera` | The live camera; the engine moves it from `ctx.view.camera` before each draw. |
| `renderer`, `canvas` | The visit's `WebGLRenderer` (the pool leases a fresh one per visit) and its canvas. |
| `size()` | CSS width and height and the pixel ratio. |
| `requestRender()` | Mark the picture changed and ask for a frame. |
| `onFrame(fn)` | Each frame, in the frame phase, with `{t, dt, calm}`. While any is set, the scene draws every frame. |
| `onBeforeRender(fn)` | Just before each drawn frame. |
| `onResize(fn)` | After the size or pixel ratio changed: resize an `EffectComposer` here. |
| `setRenderOverride(fn)` | Draw frames yourself (`fn({renderer, scene, camera, t, dt, calm})`); `null` gives the draw back. |
| `own(resource)` | Dispose anything with `dispose()` when the visit ends: composers, passes, controls, render targets. |

`sceneThree({ objects, max, shadows, setup })`: `shadows` turns the renderer's shadow maps on before program
preparation (`true` is PCF soft); `setup(three)` runs once per visit, before program preparation, so what it builds is
compiled with the scene.

## The convenience path: `customObject`

```ts
export const lantern = customObject({
  id: 'lantern',
  limits: {triangles: 2_000, textures: 0},          // checked after create(); over: refused and reported
  create({own}) { /* return a THREE.Object3D */ },
  update(object, {t, dt, calm}) { /* optional; return true when the picture changed */ },
  dispose(object) { /* optional; before the engine disposes the tree */ },
});
defineScene({extensions: [sceneThree({objects: [lantern], max: 16})], entities: [[Transform({x: 2}), ThreeObject({use: 'lantern'})]]});
```

An entity with `Transform` and `ThreeObject({ use })` shows one object, placed by its Transform (position, rotation,
uniform scale) and render mask. `update` gets no world and no scene context: a custom object cannot write game state.
At most `max` objects at once (default 16, at most 256); each must stay within its `limits` (default 20 000 triangles
and 8 textures). A refused entity stays undrawn and is reported once.

## What the engine still guarantees

- **Disposal.** When the visit ends: every `own()`ed resource (newest first), every custom object (`dispose`, then
  what `create` owned, then its tree), everything under `root`, every light's shadow map in the scene (including the
  environment's sun if you made it cast), and then the rest of the scene's tree, are disposed.
  In dev and test builds a geometry, material or texture that was under `root` when a frame drew, then left the scene
  without being disposed, is reported as a leak. The renderer pool's release audit (`engine.probe('render.pool')`)
  counts anything left at the end of the visit and deletes it.
- **Budgets.** Draws, triangles, textures and heap are measured from the real renderer by `play:snap`, the bench and
  the gate, whatever made them. A render override's passes (a composer's bloom) count as scene draws: the kit cannot
  tell them apart.
- **Render on change.** A still scene draws nothing. `onFrame` hooks and custom objects with `update` keep frames
  running. Anything you change outside a hook (a loader callback, a timer, an event) needs `requestRender()`.
- **Renderer state.** The renderer is this visit's alone, so its tone mapping, output colour space and shadow map
  settings are the scene's choice. The engine owns the render target, the drawing-buffer size and the pixel ratio: a
  hook or override that leaves them changed is restored after it runs, and reported once in dev builds. Use `onResize`
  for sizes. An override must draw to the canvas (leave the render target at `null`).
- **Determinism.** Replays and determinism checks digest game state (`ctx.state`, Transforms, or the scene's
  `replay.digest`), never the three.js scene. Visuals driven only by the kit (an animation mixer, a shader's time) are
  not part of a replay unless the game keeps them in state.

## Limitations

- WebGL2 only. A `ShaderMaterial` or `onBeforeCompile` will not run on a future WebGPU backend; the kit does not yet
  refuse them there (planned).
- No dev warning yet when an object changes outside a hook without `requestRender()` (planned); the picture simply
  does not update until the next drawn frame.
- A light added after the first frame recompiles every lit material once (three.js); build lights in `setup`.
- The courtyard fixture (`tools/visual-courtyard`, `npm run test:three-kit-browser`) is the browser evidence: software
  GL, desktop and phone-sized viewports; no physical device or GPU timing.
