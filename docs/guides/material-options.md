# Material options: shading, sides, cut-outs and vertex colours on shapes, meshes and models

`Material` (`defineMaterial`) describes how a surface looks beyond its colour. Besides texture, roughness, metalness,
emission and transparency it has five options, and it applies to three kinds of entity. The how-to is the
[recipe](../recipes/give-a-shape-a-material.md); this page is the contract.

## Inputs and outputs

| Field | Default | Values |
|---|---|---|
| `shading` | `'standard'` | `'standard'` (`MeshStandardMaterial`), `'matte'` (`MeshLambertMaterial`), `'flat'` (`MeshStandardMaterial` with faceted normals), `'toon'` (`MeshToonMaterial`) |
| `toonSteps` | `3` | integer 2…5: the bands of `'toon'` |
| `side` | `'front'` | `'front'`, `'double'` |
| `alphaCutoff` | `0` | [0, 1): 0 is off; above it, pixels whose alpha is below the value are discarded |
| `vertexColors` | `true` | draw the geometry's vertex colours when it has them |

| Entity | What a `Material` does |
|---|---|
| `Shape` | Every field. Without a `Material`: the original matte material. |
| `Mesh` (`defineMesh`) | Every field except `texture`/`repeat`/`wrap` (no texture coordinates: a named texture is reported once and not drawn). Without a `Material`: the original matte material with its vertex colours. |
| `Model` | Overrides the model's own materials for that entity. A field at its default keeps the model's own value. `'matte'`/`'toon'` convert every part to that class, carrying colour, colour/alpha/ao/light/emissive/normal/bump maps, emission, opacity, transparency, side and cut-out. `texture`/`repeat`/`wrap` are reported once and not applied. Without a `Material`: the model's own materials. |

Output is pixels only. Validation (`validateMaterial`) throws on a bad field with the field named; invalid runtime
data is reported once and drawn with the original material.

## Owner and lifetime

- **Shapes and meshes:** the scene visit's surfaces (`src/author/scene-materials.ts`). One material per entity, kept
  while the data stays in the same class. Every field except a class change applies in place: side, cut-out on/off,
  faceting and vertex colours ask three to re-check its program once (`needsUpdate`); values like the cut-off, emission
  or opacity change uniforms only.
- **Class change** (`'standard'`/`'flat'` ↔ `'matte'` ↔ `'toon'`): the runtime builds one new surface and releases the
  old material through the visit's resources. One redraw; at most one new program, compiled once.
- **Toon gradients:** one 1-row, nearest-filtered `DataTexture` per step count, shared by every toon surface and model
  look of the visit, disposed with its last user or the visit.
- **Models:** `src/author/model-looks.ts`. One override material per (model material, look), shared by every entity of
  the visit showing that look on that asset, counted and released with its last user; the instance's own materials
  are restored when the `Material` is removed. The shared template materials and textures belong to the model library
  and are never changed or disposed by an override.

## Bounds

- **Programs:** four shadings draw with three material classes, and every other program-affecting option is two-valued
  (side, cut-out on/off, vertex colours, texture, transparency, plus faceting for the standard class). The set of
  programs a scene can need is therefore fixed and small, whatever the data. There is no runtime cap beyond this.
- **Model overrides:** at most the model's material count times the distinct looks in use, per visit.
- **Gradients:** at most four (one per step count).

## Overload, cancellation, recovery

- **Overload:** none of its own; textures go through the texture library's existing admission.
- **Cancellation:** leaving the scene disposes every surface material, override material and gradient (checked by
  `npm run test:material-options-browser`).
- **Context loss:** materials are CPU-side descriptions; three recreates programs and the gradient upload on restore.

## Backend seam (ADR 0078)

No shader code and no `onBeforeCompile`: every option maps to a built-in three.js material class or property, and toon
bands are a data texture. A WebGPU backend can draw the same data with its node materials. Every authored surface stays
eligible for static batching (`bakeStaticMeshes`; unit-tested).

## Evidence and limits

- **Unit:** validation, keys, class mapping, changes on the same material and class refusal, gradient sharing and disposal,
  untextured meshes, model overrides (defaults keep model values, sharing, restore, toon/matte conversion, reports),
  batching eligibility, the recipe's code.
- **Browser** (`npm run test:material-options-browser`, reference and low, desktop headless Chromium with software
  GL): three flat bands cover a toon sphere where a standard sphere shades continuously; a `Mesh` with an emissive
  `Material` glows and the same mesh without one does not; a back face draws only with `side: 'double'`; `alphaCutoff`
  removes the transparent half of a texture with no sorting; vertex colours stay under a flat `Material`; a `Model`
  gets visit-owned toon overrides while another keeps its shared materials; idle scenes draw nothing; a class swap
  redraws once and adds at most one program; leaving disposes everything owned. It writes before/after pictures of a
  courtyard corner ported from a creator trial.
- **Pictures:** every template draws identically, because none uses the new fields and their defaults reproduce the
  previous materials (quality guard, `identical` mode, against the base revision).
- **Budgets:** no new draws or triangles; no budget changes.
- **Not verified:** physical devices, GPU cost per shading, visual quality beyond the screenshots. No outlines, rim
  light, custom gradients, normal/roughness maps or `Mesh` texture coordinates.
