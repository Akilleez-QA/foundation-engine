# Recipe: load a model and play its animation

Show a `.glb` model in a scene and play one of its animation clips. The engine loads the file when a scene that uses it opens, shares it between entities, and frees it once no scene needs it (it may keep a recently used file warm within a memory budget).

## 1. Put the file in `game/public/`

Files in your game's own `public/` folder are served from the site root (or the build's base), so `game/public/models/robot.glb` is fetched as `/models/robot.glb`, and a build ships them with your game and no other game's files. The mechanics template ships a tiny CC0 test model, `templates/mechanics/game/public/models/mechanics/beacon.glb` (one box with a one-second `pulse` clip), so you can try this recipe before you have a model of your own: copy it to `game/public/models/mechanics/beacon.glb`.

The loader accepts **binary glTF (`.glb`) with everything embedded**: a `.gltf` with a separate `.bin` or image files is rejected (`models: GLB dependencies must be embedded`). Export from Blender with *glTF Binary (.glb)*. Textures embedded in the GLB are drawn. To texture a primitive `Shape` instead, see [give a shape a material](give-a-shape-a-material.md).

## 2. Declare it as an asset

Any `.ts` file in `game/` with a default export is a definition; the `.asset.ts` ending is only a naming habit. Every asset names its licence, author and source:

```ts
// game/beacon.asset.ts
// A model the game ships. The file lives in game/public/; the URL is its path from there.
import { defineAsset } from '@engine';

export default defineAsset({
  id: 'beacon', type: 'model', url: '/models/mechanics/beacon.glb',
  licence: 'CC0-1.0', author: 'Foundation Engine contributors', source: 'templates/mechanics/assets/generate-fixture.mjs',
});
```

`id` is kebab-case and is what entities refer to. For your own model, change `id`, `url` (the path under `game/public/`, starting with `/`), `licence`, `author` and `source`.

## 3. Use it in a scene

Generate the scene first (`npm run new -- scene showcase` writes the scene, its test and its budget row), then give an entity a `Transform` and a `Model`:

```ts
// game/showcase.ts
// A model on a floor, playing its 'pulse' clip. The turn action (Space, pad A, tap) pauses and resumes it.
import { defineScene, defineSystem, Model, Name, Shape, Transform } from '@engine';

export const pause = defineSystem({
  id: 'pause-model',
  run(ctx) {
    if (!ctx.input.pressed('turn')) return;
    const e = ctx.named('beacon'), model = e === undefined ? undefined : ctx.world.get(e, Model);
    if (model) model.playing = !model.playing;
  },
});

export default defineScene({
  id: 'showcase', title: 'Showcase', type: 'scene',
  view: { camera: { position: [0, 2.5, 6], target: [0, 1, 0], minWidthFov: 50 }, background: 0x141a24 },
  entities: [
    [Name({ name: 'floor' }), Transform(), Shape({ kind: 'plane', size: [10, 0, 10], color: 0x2a3342 })],
    [Name({ name: 'beacon' }), Transform({ y: 0.8 }), Model({ asset: 'beacon', clip: 'pulse' })],
  ],
  systems: [pause],
});
```

The `pause` system reads the `turn` action from the `blank` template; in another game, use one of your own actions.

`Model` fields (all optional except `asset`):

| Field | Default | Meaning |
|---|---|---|
| `asset` | | the asset id |
| `clip` | `''` | the animation clip's name in the GLB; empty shows the bind pose |
| `playing` | `true` | `false` pauses the clip where it is |
| `loop` | `true` | `false` plays once and holds the last frame |
| `speed` | `1` | playback rate, 0 to 16 |
| `revision` | `0` | add one to restart the clip from the beginning (also when the clip name is unchanged) |
| `visible` | `true` | hide without unloading |

Systems change these fields in place: switch `clip` to change animation, flip `playing`, or bump `revision` to replay. The clip names are the animation (action) names stored in the GLB; a name that does not match exactly one clip logs `model: unknown or ambiguous clip <name>` in the browser console. Size and turn the model with the entity's `Transform` (`scale`, `ry`).

`ctx.modelState(entity).status` reports `'loading'`, `'ready'` or `'failed'` if a system needs to wait for the model.

## 4. Test it

Node tests do not load files, so test what your systems do to the `Model` data:

```ts
// game/showcase.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Model, testScene } from '@engine';
import game from './game';
import showcase from './showcase';

test('the turn action pauses and resumes the model clip', async () => {
  const t = await testScene(showcase, { game });
  const model = t.world.get(t.ctx.named('beacon')!, Model)!;
  assert.equal(model.clip, 'pulse');
  t.press('turn'); t.run(1 / 60);
  assert.equal(model.playing, false);
  t.press('turn'); t.run(1 / 60);
  assert.equal(model.playing, true);
});
```

## 5. Check it and look at it

```
npm run check
npm run play:snap -- --scene showcase
```

In the snap, the model should be visible and `probe.json` should have no page errors. A 404 for the model in the console means the `url` does not match a file under `game/public/`.

## Limits

- One GLB per asset; embedded buffers and images only. Large files cost load time and memory against the scene's budget (`npm run play:snap` reports draws and triangles).
- Clips play one at a time per entity; there is no blending between clips in the `Model` component.
- Model and texture URLs are fetched from the **site root**. A build hosted under a sub-path (for example `https://<user>.github.io/<repo>/`) cannot find them yet: see [share your build](share-your-build.md).
- More: [model attachments](../guides/model-attachments.md), [model readiness](../guides/model-readiness.md), [model inspection](../guides/model-inspection.md), and the `mechanics` template, which uses this same fixture.
