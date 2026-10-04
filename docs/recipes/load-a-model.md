# Recipe: load a model and play its animation

Show a `.glb` model in a scene and play one of its animation clips. The engine loads the file when a scene that uses it opens, shares it between entities, and frees it once no scene needs it (it may keep a recently used file warm within a memory budget).

## 1. Put the file in `game/public/`

Files in your game's own `public/` folder are served from the site root (or the build's base), so `game/public/models/robot.glb` is fetched as `/models/robot.glb`, and a build ships them with your game and no other game's files. The mechanics template ships a tiny CC0 test model, `templates/mechanics/game/public/models/mechanics/beacon.glb` (one box with a one-second `pulse` clip), so you can try this recipe before you have a model of your own: copy it to `game/public/models/mechanics/beacon.glb`.

The loader accepts **binary glTF (`.glb`) with everything embedded**: a `.gltf` with a separate `.bin` or image files is rejected (`models: GLB dependencies must be embedded`). Export from Blender with *glTF Binary (.glb)*. Textures embedded in the GLB are drawn: PNG, JPEG, WebP, and KTX2 (see [KTX2 textures for phones](#ktx2-textures-for-phones)). To texture a primitive `Shape` instead, see [give a shape a material](give-a-shape-a-material.md).

For a reproducible Blender export with metre scale, a base-centre pivot, material bounds and an actual engine consumer, follow the [Blender export example](../../tools/blender-export/README.md). Its checked-in original asset runs without installing Blender. To make a new model with an agent, set its size and budget first, export it headless and check it with `npm run asset:verify`: see [make assets with Blender through MCP](make-assets-with-blender-mcp.md) (the MCP part is optional).

## 2. Declare it as an asset

Any `.ts` file in `game/` with a default export is a definition; the `.asset.ts` ending is only a naming habit. Every asset names its licence, author and source:

```ts
// game/beacon.asset.ts
// A model the game ships. The file lives in game/public/; the URL is its path from there.
import { defineAsset } from '@engine';

export default defineAsset({
  id: 'beacon', type: 'model', url: '/models/mechanics/beacon.glb',
  licence: 'CC0-1.0', author: 'Foundation Engine contributors', source: 'templates/mechanics/game/tools/generate-fixture.mjs',
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

## KTX2 textures for phones

PNG, JPEG and WebP make the download smaller, but the GPU still holds every texel as 4 bytes (plus a third for mipmaps).
KTX2 (Basis Universal) textures stay compressed on the GPU too: the engine transcodes them to the format the device
supports (BC7 on desktops, ASTC or ETC2 on phones), typically 4 to 8 times smaller in GPU memory. Use them when a phone
target runs short of memory for textures.

1. With [KTX-Software](https://github.com/KhronosGroup/KTX-Software/releases) 4.4 or later (`ktx` on your `PATH`),
   let the optimiser write KTX2 textures (its contract must list `KHR_texture_basisu`; see
   [model contracts](../guides/model-contracts.md#optimise)):

   ```
   npm run asset:optimize -- game/tools/robot/out/robot.glb --out game/public/models/robot.glb --ktx2
   ```

   Without `ktx`, it says so and falls back to WebP. It uses UASTC for normal and other data maps, which keeps them
   accurate, and ETC1S, which is smaller, for colour. Keep each texture side a
   multiple of 4. The result declares `KHR_texture_basisu` with the textures embedded, as the loader requires.
2. Declare and use it like any other model. Nothing else changes: the engine loads its KTX2 support (a code chunk and
   the 0.6 MB transcoder) only when a model with KTX2 textures loads, so games without one pay nothing for it.
3. If the model has a [contract](../guides/model-contracts.md), add `KHR_texture_basisu` to its `extensions`.

`npm run play:snap` then shows it drawn. In the dev build, `engine.probe('models')` reports `compressedTextures` and
`compressedTextureMiB` (the GPU bytes of the transcoded textures). A device with no compressed format still draws the
model, with RGBA8 textures. Limits and failure behaviour are in the [KTX2 guide](../guides/compressed-textures.md).

## Limits

- One GLB per asset; embedded buffers and images only. Large files cost load time and memory against the scene's budget (`npm run play:snap` reports draws and triangles).
- Mesh compression is meshopt only (no Draco). KTX2 images must be Basis Universal (ETC1S or UASTC), one 2D image each, at most 16,384 texels a side.
- Clips play one at a time per entity; there is no blending between clips in the `Model` component.
- Asset URLs are resolved against the build base. For a sub-path, build with `npm run build -- --base ./` or a known prefix; see [host under a sub-path](host-under-a-sub-path.md). Arbitrary root-absolute URLs outside asset declarations still need your own base handling.
- More: [model attachments](../guides/model-attachments.md), [model readiness](../guides/model-readiness.md), [model inspection](../guides/model-inspection.md), and the `mechanics` template, which uses this same fixture.
