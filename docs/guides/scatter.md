# Instanced scatter

`Scatter` (`defineScatter`) draws many copies of one primitive `Shape` or one `Mesh` in a single instanced draw. A scene
opts in with `defineScene({ scatter: sceneScatter({ max, instances }) })`. The how-to is the
[recipe](../recipes/scatter-grass-and-rocks.md); this page is the contract.

## Inputs and outputs

- **Inputs:** the `Scatter` data, the entity's `Transform` (the origin) and an optional `Material` on the same entity.
- **Placement:**
  - exact `points: [x, z][]`; or
  - `area` with `count`: `rect`, `ring`, or `edge` (a band along the inside of a rect).
- **Per-copy variation:** `scale` range, `ry` (fixed or `'random'`), `tilt`, and `colorJitter` (HSL amplitudes,
  written as per-copy instance colours).
- **Validation:** `validateScatter` throws on a bad field, naming it. Invalid runtime data is refused, counted and
  reported once.
- **Output:** pixels, one `InstancedMesh` per admitted scatter. There are also counters:
  - `testScene(...).scatter` gives stats, reports and each entity's placement, headless;
  - the dev handle `engine.scatter()` gives admitted scatters, copies, refusals by cause, draws, and triangles per
    scatter;
  - `play:snap` writes the same counters to `probe.json`.

## Owner and lifetime

- **Owners:** the scene visit owns the drawing. `author/scene-scatter.ts` is a lazy chunk: it is loaded while a
  scene with `sceneScatter()` prepares, so its first frame already has the scatters, and is never loaded by other
  scenes. The batching layer builds the instances: `instanceStatic` in `platform/render/batching/instance.ts`, per
  ADR 0055, where features never instance geometry themselves.
- **Geometry:** a `shape` uses the visit's shared primitive geometry lease. A `mesh` scatter owns its own indexed
  geometry.
- **Surface:** the visit's surfaces (see [material options](material-options.md)). A look change within the same
  class is applied to the existing material. A class change rebuilds the scatter once.
- **Instance buffers:** written once with static usage. Moving the `Transform` moves the object without touching
  them. New data rebuilds once and disposes the previous buffers.
- **Removal:** removing the component or the entity, or leaving the scene, disposes the instance buffers, returns the
  geometry and releases the surface. The browser check counts these disposals.

## Determinism

Each scatter draws from its own stream, `deriveSeed(root, 'scatter', seed)`. The root is
`deriveSeed(?seed= or 0, 'scatter', sceneId)`. Every copy takes the same fixed number of values whatever the data, so:

- copy *i* lands in the same place at every density;
- a lighter preset keeps a subset of what a heavier one keeps;
- the layout is identical on every visit with the same inputs.

Nothing reads `ctx.random()`. A unit test runs a gameplay system's `ctx.random()` sequence with and without scatters
and requires it to be identical. That guards against the defect the particle stream once had.

## Bounds and overload

| Bound | Default | Cap | Over the bound |
|---|---|---|---|
| Copies per scatter (`count` or `points`) | — | 65,536 | data error (`validateScatter`) |
| Scatters drawn at once (`sceneScatter({ max })`) | 32 | 256 | refused (`refused.scatters`) |
| Copies drawn at once (`sceneScatter({ instances })`, after thinning) | 65,536 | 262,144 | refused (`refused.instances`) |

How refusals work:

- Admission is deterministic: essential scatters first, then entity order.
- The first refusal of each cause per visit is reported in the console. Every refusal is counted.
- A refused scatter is offered again when its data changes or another scatter releases capacity. It is never
  re-offered every frame.
- A scatter that grows past the bound is withdrawn, counted and reported.

## Quality

The knob `effects.scatter-density` reads 1 on reference and high, 0.6 on medium and 0.35 on low. It is read once per
visit (`reenter-scene`) and thins non-essential scatters to their deterministic subset. Like `effects.particles`, it
is registered but not yet wired to a template, so the Graphics screen does not show it.

## Budgets

The renderer counts real GL calls:

- **Draws:** each scatter is one draw.
- **Triangles:** each scatter adds the triangles of one copy times the copies drawn. The browser check asserts that
  the renderer's triangle count equals this sum.

Budgets are measured at the reference preset, where every copy is drawn. A scene that replaces repeated props with
scatters lowers its draws. In the ported courtyard, 24 lantern-part draws become 3 scatters, while the grass adds
triangles.

## Recovery

- **Context loss:** instance buffers are CPU-side arrays, and three re-uploads them on restore.
- **Failed chunk load:** reported once. The scene draws without scatters for that visit.

## Backend seam (ADR 0078)

The seam holds because the feature uses only standard engine objects:

- `InstancedMesh` with built-in materials.
- No shader hooks, so a WebGPU backend draws the same data.
- Per-copy sway, which would need a vertex hook, is deliberately not offered.

## Evidence and limits

**Unit tests** cover:

- validation and areas;
- determinism per seed, scene and `?seed=`;
- the nested density subset and essential scatters;
- colour jitter and admission bounds;
- one mesh per scatter with honest triangles;
- no rewrite when idle, a move without a rebuild, and new data rebuilding once;
- `Material` on scatters, and mesh geometry ownership;
- overflow, re-admission and essential-first ordering;
- invalid data and disposal;
- gameplay `ctx.random()` unchanged, `testScene` stats, and the recipe's code.

**Browser check** (`npm run test:scatter-browser`, reference and low presets; desktop headless Chromium with software
GL):

- a box and three scatters cost 4 draws;
- renderer triangles match the box plus the scatter sum;
- low thins grass and rocks while the essential posts stay;
- idle draws 0 frames, and a move redraws once without a rebuild;
- re-entry gives the same layout, and exit disposes the 3 instance buffers;
- it writes before and after pictures of the courtyard.

**Templates:** none uses `Scatter`, so their pictures and budgets are unchanged.

**Not here:**

- `Model` (glTF) scatter, planned as a follow-up through the model library's lease;
- per-copy animation or sway, collision, shadows and polygon areas.

**Not verified:** physical devices, GPU cost and fill rate.
