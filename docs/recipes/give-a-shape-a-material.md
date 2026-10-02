# Recipe: give a shape a texture and a material

A `Shape` draws a matte primitive in one colour. Add a `Material` to the same entity for a texture, its repeat and
wrap, roughness, metalness, emission and transparency.

```ts
// game/crate.asset.ts: the file, under public/, with its provenance
import { defineAsset } from '@engine';
export default defineAsset({ id: 'crate', type: 'texture', url: '/textures/crate.png', width: 256, height: 256,
  licence: 'CC0-1.0', author: 'You', source: 'drawn for this game' });
```

```ts
// in a scene's entities
import { defineMaterial, Shape, Transform } from '@engine';

[Transform({ y: .5 }), Shape({ kind: 'box', color: 0xffffff }), defineMaterial({ texture: 'crate' })],
[Transform({ y: -.05 }), Shape({ kind: 'box', size: [20, .1, 20], color: 0x8899aa }),
  defineMaterial({ texture: 'crate', repeat: [10, 10], roughness: .9 })],
[Transform({ x: 2, y: 1 }), Shape({ kind: 'sphere' }), defineMaterial({ metalness: 1, roughness: .2 })],
[Transform({ x: -2, y: 1 }), Shape({ kind: 'box' }), defineMaterial({ emissive: 0xff8800, emissiveIntensity: 2 })],
[Transform({ x: 4, y: 1 }), Shape({ kind: 'box', color: 0x66ccff }), defineMaterial({ opacity: .5, transparent: true })],
```

| Field | Default | Meaning |
|---|---|---|
| `texture` | `''` | A `defineAsset({ type: 'texture' })` id (png, jpg or webp under `public/`). Multiplied by `Shape.color`: use white to keep the texture's own colours. |
| `repeat` | `[1, 1]` | Repeats across each face, `[u, v]`, each in (0, 1024]. |
| `wrap` | `'repeat'` | `'repeat'`, `'clamp'` (stretch the edge) or `'mirror'`. |
| `roughness` / `metalness` | `1` / `0` | 0…1, physically based. |
| `emissive` / `emissiveIntensity` | `0` / `1` | Light the surface gives off; intensity 0…16. It does not light other things. |
| `opacity` / `transparent` | `1` / `false` | Opacity below 1, or a texture's alpha, shows only with `transparent: true`. |

`defineMaterial` checks the data and throws on a bad field, and building the game fails when a scene's own entities
name a texture that is not a `defineAsset({ type: 'texture' })`. Change a `Material` at run time by mutating it
(`ctx.world.get(e, Material)!.opacity = .3`) or adding/removing it, then `ctx.world.touch()`. Roughness, metalness,
emission, opacity and transparency change in place, so animating them every frame costs no new material or texture.

## What the engine does

- **Owner:** the scene visit (`author/scene-materials.ts`). A shape with a `Material` gets a three.js
  `MeshStandardMaterial`; a shape without one keeps the original matte `MeshLambertMaterial`, so existing scenes look
  exactly as before.
- **Textures** come from the shared texture library (`platform.assets`): one fetch, decode and GPU upload per texture
  and wrap, however many shapes use it. A repeating or mirrored texture is its own library texture (counted in the
  library's resident bytes and residency budgets). Shapes with the same texture, wrap and repeat share one view of it;
  a view uploads nothing again. The last shape to let go of a view (or leaving the scene) disposes it and releases
  the texture; the library frees it with its last user.
- **Changing the texture** (or its wrap or repeat) keeps drawing the old one until the new one has arrived, then
  releases the old one: no untextured frame.
- **Quality:** the sampler's anisotropy is the Graphics setting *Sharp textures at an angle* (`textures.anisotropy`: 16 on
  reference, 8 high, 4 medium, 1 low), capped by the device. It applies when a scene is entered.
- **Loading and failure:** the shape draws untextured (its colour) until the texture arrives, then draws once more.
  A missing or broken file is reported once in the console and the shape keeps what it drew; nothing retries until
  the scene is entered again. A texture that arrives after the scene was left is released, never applied.
- **Cost:** no extra draws or triangles; a standard material costs more per pixel than the matte one and transparent
  shapes are sorted each frame. Keep textures small for phones and measure (`npm run play:snap`); budgets only fall.

## Limits

- Only `Shape` entities. `Mesh` (indexed geometry has no texture coordinates) and `Model` (glTF brings its own
  materials) ignore `Material`.
- One variant per texture: `textures.max-size` does not shrink an author texture; ship the size you want drawn.
- No normal, roughness or metalness maps, no per-face textures, no texture animation. Write a kit or extend the
  engine when a game needs them.

Check: `npm run test:material-browser` (one load for three textured shapes, anisotropy per preset, no redraw when
idle, everything released on exit; desktop Chromium with software GL only). The mechanics template draws its floor
and kiosk this way.
