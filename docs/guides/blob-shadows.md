# Blob shadows

A blob shadow is a soft dark ellipse on the ground under an entity. It is the
cheapest way to keep things from floating where no shadow map reaches: far from
the sun's shadow box, in a scene without shadows, or when the player has turned
shadows off. Every blob of a scene is **one instanced draw**. This page is the
contract (VIS-10); [Scene look](scene-look.md#shadows) covers real shadows.

```ts
import { BlobShadow, defineScene, sceneBlobShadows, sceneShadows, Shape, Transform } from '@engine';

export default defineScene({
  id: 'field',
  title: 'Field',
  shadows: sceneShadows(),                       // optional: real shadows where the sun's box reaches
  blobShadows: sceneBlobShadows({ max: 64 }),    // the opt-in, with its bound
  view: { environment: day },                    // day's sun has shadow: { extent: 14 }
  entities: [
    [Transform({ x: 3, y: 0.9 }), Shape({ kind: 'capsule' }), BlobShadow({ width: 0.7, depth: 0.5 })],
    [Transform({ x: 40, y: 0.5 }), Shape({ kind: 'box' }), BlobShadow()],   // beyond the box: a blob
  ],
});
```

## Inputs and outputs

- **Scene:** `blobShadows: sceneBlobShadows({ max, ground, crossfade, distance })`.
  - `max` (default 64, 1…1024): blobs drawn at once. It is the instance capacity,
    allocated once per visit.
  - `ground` (default 0): the world height blobs lie on. The engine has no ground
    height query, so the surface is flat unless an entity says otherwise.
  - `crossfade` (default 2 m, 0…200): the band inside the sun's shadow box where a
    casting entity's blob fades in (see the policy below).
  - `distance` (default `null`, else 0…10,000 m): camera depth at which blobs have
    faded out, starting at 75 % of it. Scene fog (`haze`) fades blobs either way.
- **Entity:** `BlobShadow({ width, depth, opacity, ground, visible })`.
  - `width` and `depth` (default 0.8 m, up to 100): the ellipse across the
    entity's own x and z, times its `Transform.scale`, turned with its `ry`.
  - `opacity` (default 0.5, 0…1): darkness at the centre.
  - `ground` (default `null`): this entity's surface height, overriding the
    scene's.
  - `visible` (default `true`): hide the blob without removing the component.
  - `validateBlobShadow` throws on a bad field, naming it.
- **Position:** the blob sits at the entity's `Transform` x and z, on the ground
  height, never at the entity's own y. A jumping entity keeps its blob on the
  ground under it.
- **Output:** pixels from one `InstancedMesh` named `blob-shadows`. The dev handle
  `engine.blobShadows()` (scenes that opted in) gives `capacity`, `candidates`,
  `drawn`, `dropped`, `draws` (0 or 1) and `uploads`.

## Policy: where a blob is drawn

A blob stands in for a real shadow where there is none:

| The entity | Real sun shadow live? | Blob |
|---|---|---|
| A `Shape` or `Mesh` that casts (`sceneShadows` flags and `Shadow`) | yes, and within `extent` of the origin | none |
| the same | yes, in the last `crossfade` metres inside `extent` | fades in (smoothstep) |
| the same | yes, beyond `extent` | full |
| any entity | no (no `sceneShadows()`, no sun `shadow`, or `shadows.quality` is `off`) | full |
| a `Model`, `Shadow({ cast: false })`, or no drawn body | any | full |

- The sun's real shadow is guaranteed for ground points within `extent` of the
  world origin (its box is ±`extent` across the light and 4 × `extent` deep), so
  the test is the distance of the blob's ground point from the origin.
- **Presets:** presets gate real shadows only through `shadows.quality`, whose
  floor is `low`, which still keeps a 1024 sun map. So the policy is the same on
  every preset (reference, high, medium, low), and blobs cost the same on each.
  Only a player's `shadows.quality: off` turns blobs on for every caster. Local
  (point and spot) light shadows do not hide blobs: a blob is the sun's contact cue.
- **Without `sceneBlobShadows()`** a `BlobShadow` is not drawn, and the first one
  is reported once per visit.

## Owner and bounds

- **Owner:** the scene visit. `author/scene-blob-shadows.ts` is a lazy chunk,
  loaded while a scene with `sceneBlobShadows()` prepares (so its first frame
  already has the blobs) and never by other scenes. It reads the world and the
  policy (`author/blob-shadow.ts`, pure). The GPU layer is
  `platform/render/blob-shadows.ts`: one unit ground quad, a shared procedural
  soft-ellipse shader (no texture), matrices and alphas allocated once at `max`.
- **Render on change:** each frame the visit reconciles the blobs after the
  camera and environment. The layer writes its buffers in place and uploads only
  when a matrix, an alpha or the count changed. A still scene uploads nothing and
  draws no frame. Under capacity, a moving camera changes no blob; over capacity
  it can change which are nearest.
- **Program preparation:** with no blob drawn the instance count is 0, so three
  issues no draw call, but the mesh stays in the scene and its program is
  compiled with the scene's before activation (STD-REN-37).
- **Randomness:** none. Selection is deterministic (distance, then entity order).

## Overload, cancellation and recovery

- **Overload:** when more blobs want drawing than `max`, the `max` nearest the
  camera (horizontal distance, ties by entity order) are drawn and the rest are
  dropped and counted in `dropped`. The first overload of a visit is reported
  once, at info level (designed behaviour, not an error). Hidden blobs (inside the
  sun box, `opacity: 0`, `visible: false`) never take capacity.
- **Changing it while playing:** every field is read each frame. A player's
  `shadows.quality` change applies on the next drawn frame.
- **Cancellation:** leaving the scene removes the mesh and disposes its geometry,
  material and instance buffers once.
- **Recovery:** the buffers are CPU-side and re-upload after a context loss with
  the rest of the scene. A failed chunk load is reported and the visit draws
  without blobs.

## Cost per tier

| | Reference | High | Medium | Low |
|---|---|---|---|---|
| Draw calls | +1 when any blob is drawn, else 0 | same | same | same |
| Triangles | +2 per drawn blob | same | same | same |
| Shadow passes and `shadowCasters` | 0 (the mesh never casts) | 0 | 0 | 0 |
| Texture memory | 0 (procedural) | 0 | 0 | 0 |
| CPU | one pass over `BlobShadow` entities per frame; a sort only when over `max` | same | same | same |

- **Fill:** each blob is a transparent quad over its own ellipse; overlapping
  blobs blend. Big blobs on a phone cost fill-rate, so size them to the body.
- **Budgets:** a scene that opts in should allow one more draw in its `draws`
  row. No template uses blob shadows, so no template budget changed.

## Evidence and limitations

- **Unit:** `src/author/blob-shadow.test.ts` (validation, policy and crossfade,
  preset gating against the `shadows.quality` knob, capacity and nearest-N
  overload, one draw at a fixed capacity that casts no shadow, uploads only on
  change, Models and non-casters, overload reported once, disposal) and
  `src/platform/render/blob-shadows.test.ts` (the layer: capacity, clamp, lift,
  change-only uploads, disposal).
- **Browser:** `npm run test:blob-shadows-browser` on reference and low (desktop
  headless Chromium, software GL) checks one draw call and 2 × drawn triangles
  against a blob-less twin, the same shadow casters, the in-box/beyond-box policy,
  the cap, shadows off, idle 0 frames and 0 uploads, a move uploading once and
  disposal on exit. Result: passed 2026-10-05 in local software GL on the reference and low presets (7 candidates, 4 drawn in 1 draw, +8 triangles, 1 dropped; shadows off 4 drawn, 3 dropped; idle 0 frames; a move uploads once; disposed on exit).
- **Not covered:** no physical-device, GPU timing, fill-rate or visual-quality
  acceptance. Blobs lie on a flat height (no terrain or slope following), are not
  occluded by walls they pass under, do not shrink with the entity's height, and
  ignore local lights. The real-shadow test is the sun box's guaranteed sphere,
  so near the box's corners a caster can show both a real shadow and part of a
  blob.
