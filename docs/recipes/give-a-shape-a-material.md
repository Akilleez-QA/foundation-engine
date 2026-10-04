# Recipe: give a shape a texture and a material

A `Shape` draws a matte primitive in one colour. Add a `Material` to the same entity for a texture, its repeat and
wrap, roughness, metalness, emission, transparency, a shading style (matte, flat, toon), both sides, cut-out alpha and
vertex colours. The same `Material` also shades a custom `Mesh` (`defineMesh`) and recolours, lights or restyles a
`Model`.

```ts
// game/crate.asset.ts: the file, under game/public/, with its provenance
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

Shading, sides, cut-outs and the other kinds of entity:

```ts
import { defineMaterial, defineMesh, Model, Shape, Transform } from '@engine';

const gem = defineMesh({ color: 0x40281a, positions: [0, .34, 0, .22, 0, 0, 0, 0, .22, -.22, 0, 0, 0, 0, -.22, 0, -.34, 0],
  indices: [0, 2, 1, 0, 3, 2, 0, 4, 3, 0, 1, 4, 5, 1, 2, 5, 2, 3, 5, 3, 4, 5, 4, 1] });
const looks = [
  // A cel-shaded tree: three flat bands of light instead of a smooth gradient.
  [Transform({ y: 2 }), Shape({ kind: 'cone', size: [2, 2.6, 2], color: 0x2f6b3a }), defineMaterial({ shading: 'toon', toonSteps: 3 })],
  // A faceted, glowing gem from your own geometry (a Mesh has no texture coordinates, so no texture).
  [Transform({ y: .9 }), gem, defineMaterial({ shading: 'flat', emissive: 0xff7a1a, emissiveIntensity: 2.5 })],
  // A leaf drawn from both sides, its transparent pixels cut out (no sorting, unlike `transparent`).
  [Transform({ y: .4, rx: 1.1 }), Shape({ kind: 'plane', size: [.9, 0, 1.3] }), defineMaterial({ texture: 'leaf', alphaCutoff: .5, side: 'double' })],
  // A model, cel-shaded and glowing; its own colours and textures are kept.
  [Transform({ x: 3 }), Model({ asset: 'beacon' }), defineMaterial({ shading: 'toon', emissive: 0x2a6bff, emissiveIntensity: 1.2 })],
];
```

| Field | Default | Meaning |
|---|---|---|
| `texture` | `''` | A `defineAsset({ type: 'texture' })` id (png, jpg or webp under `game/public/`). Multiplied by `Shape.color`: use white to keep the texture's own colours. |
| `repeat` | `[1, 1]` | Repeats across each face, `[u, v]`, each in (0, 1024]. |
| `wrap` | `'repeat'` | `'repeat'`, `'clamp'` (stretch the edge) or `'mirror'`. |
| `roughness` / `metalness` | `1` / `0` | 0…1, physically based. |
| `emissive` / `emissiveIntensity` | `0` / `1` | Light the surface gives off; intensity 0…16. It does not light other things. Above about 1 it clips to a flat colour unless the scene opts into tone mapping (`view.output`, [scene look](../guides/scene-look.md#output-tone-mapping-and-exposure)). |
| `opacity` / `transparent` | `1` / `false` | Opacity below 1, or a texture's alpha, shows only with `transparent: true`. |
| `shading` | `'standard'` | `'standard'` physically based; `'matte'` Lambert (cheaper, ignores roughness and metalness); `'flat'` physically based with faceted faces; `'toon'` banded light. |
| `toonSteps` | `3` | Light bands for `'toon'`, 2…5. |
| `side` | `'front'` | `'double'` also draws back faces (leaves, cloth, open shells). |
| `alphaCutoff` | `0` | Above 0, pixels whose alpha (texture alpha × opacity) is below it are cut out. Hard edges, no sorting cost; below 1. |
| `vertexColors` | `true` | Draw the geometry's own vertex colours when it has them (a `Mesh`'s `colors`, a model's); `false` ignores them. A `Shape` has none. |

`defineMaterial` checks the data and throws on a bad field, and building the game fails when a scene's own entities
name a texture that is not a `defineAsset({ type: 'texture' })`. Change a `Material` at run time by mutating it
(`ctx.world.get(e, Material)!.opacity = .3`) or adding/removing it, then `ctx.world.touch()`. Roughness, metalness,
emission, opacity, transparency, side, cut-out, vertex colours, toon steps and switching between `'standard'` and
`'flat'` change in place, so animating them every frame costs no new material or texture. Changing `shading` to
another class (`'matte'`, `'toon'`, or back to `'standard'`/`'flat'`) builds one new material and releases the old one:
do it on an event, not every frame.

### On a `Mesh` and on a `Model`

- **`Mesh`** (`defineMesh`): every field except the texture works as on a shape. A mesh's `colors` keep drawing under a
  `Material` unless `vertexColors: false`. Naming a texture is reported once in the console and draws untextured,
  because indexed meshes carry no texture coordinates. Without a `Material` a mesh keeps its original matte look.
- **`Model`**: a `Material` overrides the model's own materials for that entity only; other entities using the same
  asset are untouched. **A field left at its default keeps the model's own value**, so `defineMaterial({ emissive:
  0xff8800 })` makes a model glow without changing its colours, roughness or textures. `emissiveIntensity` alone
  scales the model's own emission. `shading: 'matte'` or `'toon'` redraws every part in that class, keeping its colour,
  textures, emission, opacity and side; `'flat'` facets it. `texture`, `repeat` and `wrap` are not applied: a model
  keeps its own textures (naming one is reported once).

## What the engine does

- **Owner:** the scene visit (`author/scene-materials.ts` for shapes and meshes, `author/model-looks.ts` for models).
  A shape or mesh with a `Material` gets the three.js class its `shading` names (`MeshStandardMaterial` for
  'standard' and 'flat', `MeshLambertMaterial` for 'matte', `MeshToonMaterial` for 'toon'); one without keeps the
  original matte `MeshLambertMaterial`, and a `Material` with every new field at its default draws exactly as it did
  before these options existed, so existing scenes look exactly as before.
- **Toon bands** are a tiny 1-row gradient texture per step count, shared by every toon surface in the scene and
  released with its last user. No custom shader code is involved, so the same data can be drawn by a future WebGPU
  backend (ADR 0078), and every authored surface stays eligible for static batching.
- **Models:** one override material per (model material, look), shared by every entity showing that look on that
  asset, released with its last user or when the scene is left. The model's textures stay the model library's.
- **Shader programs are bounded:** four shadings draw with three material classes, and each other option is
  two-valued (side, cut-out on/off, vertex colours, texture, transparency), so a scene can only ever need a fixed,
  small set of programs. A class change is one new program at most, compiled once.
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
- **Cost:** no extra draws or triangles; a standard material costs more per pixel than the matte and toon ones, and
  transparent shapes are sorted each frame (prefer `alphaCutoff` for foliage). Keep textures small for phones and
  measure (`npm run play:snap`); budgets only fall.

## Limits

- Textures only on `Shape` entities: `Mesh` has no texture coordinates, and a `Model` keeps its own textures.
- `toonSteps` is the only band control: no custom gradients, outlines or rim light.
- One variant per texture: `textures.max-size` does not shrink an author texture; ship the size you want drawn.
- No normal, roughness or metalness maps, no per-face textures, no texture animation. Write a kit or extend the
  engine when a game needs them.

Check: `npm run test:material-browser` (one load for three textured shapes, anisotropy per preset, no redraw when
idle, everything released on exit) and `npm run test:material-options-browser` (toon bands, a glowing `Mesh`, double
sides, cut-outs, vertex colours, a restyled `Model`, a class swap costing one redraw and at most one program, release
on exit; it also writes before/after pictures of a courtyard corner). Both run desktop Chromium with software GL only:
no physical-device or visual-quality acceptance. The mechanics template draws its floor and kiosk this way.
