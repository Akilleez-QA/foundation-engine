# Particle emitters (FX-01)

Status (2026-10-03): integrated through batch PR #65 (`main` `1f9d10d`; PR #63 merge `b7b5550`);
earlier an implemented candidate. Optional and opt-in per scene: only a scene with
`defineScene({ particles: sceneParticles() })` simulates and draws emitters. A game that never imports it carries no
particle simulation or drawing code: the stock runtime keeps only the contract (`particle-contract.ts`) and a small
lazy-loading proxy (about 3 kB minified in the scene runtime chunk), and its draws and budgets do not change. The how-to is the
[hit sparks and pickups recipe](../recipes/hit-sparks-and-pickups.md); this guide records the contract.

## Requirement and existing seams

Demo builders asked for hit sparks, pickups, trails and smoke. The previous workaround (short-lived `Shape`
entities) costs one draw per particle. The extension reuses existing owners instead of adding a new scheduler,
cache or registry:

| Responsibility | Existing owner | Particle extension |
|---|---|---|
| Data on entities, validation | Author components (`defineComponent`, like `Material`) | `Emitter` / `defineEmitter` / `burst` in `src/author/particles.ts` |
| Scene opt-in and bounds | `defineScene` (like `modelPoseLinks`) | `sceneParticles({ max, emitters })` carries the limits and the simulation; contract types in `src/author/particle-contract.ts` |
| Fixed-step simulation, seeded randomness | The visit's system runner (60 Hz); the `?seed=` / named-stream scheme of `ctx.random` | Engine fixed system `engine.particles`, run after the scene's own fixed systems; pure `src/author/particle-sim.ts` |
| Drawing, render on change | Scene runtime `sync`/`dirty` and the frame loop (STD-RUN-9) | `src/author/scene-particles.ts`, a lazy chunk behind `src/author/particle-view.ts`: one instanced mesh per admitted emitter, written in place |
| Textures | Shared texture library leases (STD-REN-33), RES-01 residency | One lease per textured emitter under the visit's signal |
| Quality | Knob registry (`platform/render/quality.ts`) | Knob `effects.particles`, read once per visit |
| Headless tests | `testScene` | Steps the same field; `t.particles.stats` and `t.particles.reports` |

## Inputs and outputs

- **Input:** an `Emitter` component on an entity with a `Transform` (fields in the recipe), in a scene with
  `defineScene({ particles: sceneParticles({ max, emitters }) })` (both limits optional). `defineEmitter` validates and throws naming the field; at run time
  the data is re-checked every step without allocating, because systems may mutate it.
- **Output:** pixels only. Particles are presentation state owned by the visit and are not saved, inspected as
  entities or read back by systems. The one world change is `despawn: true`, which removes the entity in the fixed
  step at a time that depends only on the emitter's data and the step count.
- **Diagnostics:** `testScene(...).particles.stats`, and `particles.sample(entity)` (one admitted emitter's live
  count, spawn attempts since admission and the bounds of its live particles at the latest step; null when the entity
  has no admitted emitter; it allocates, so it is for tests, not the frame loop); in dev/test builds the scene handle's `particles()` adds the
  draws per frame and texture counts (`requested`, `leases` held now, `applied`, `failed`); refusals and invalid data are reported through the scene's error log.

## Owner and lifetime

Without `sceneParticles()` a scene creates no field and no engine particle system; the first `Emitter` it sees (on a
structural world change) is reported once and is never simulated or drawn. `testScene` reports the same in
`particles.reports` and its `particles.stats` is null.

One particle field per scene visit, created with the visit's world and disposed (with its meshes, geometries,
materials and texture leases) when the visit ends, before the scene tree's own cleanup. An emitter's slot is created
when it is admitted and released when its entity is despawned or loses its `Emitter` or `Transform`. Replacing the
component, or changing `max`, `texture` or `blending`, releases the slot and admits a new one (live particles are
cleared); the burst count carries over, so a rebuild never re-fires bursts already fired. A renderer that cannot bind
an emitter is reported once and that emitter is not admitted again this visit. Covered or hidden scenes do not step (the frame loop does not run them), so particles freeze with the
scene.

## Bounds and overload

| Bound | Value | Outcome when exceeded |
|---|---|---|
| Particles per emitter | `max`, 1…4,096 (validated) | A spawn into a full pool is dropped and counted (`dropped`); no recycling |
| Bursts per emitter per step | 4 | Further requested bursts in that step are dropped and counted |
| Continuous spawns per emitter per step | `max` | The excess is dropped and counted |
| Emitters per scene | default 16, cap 256 | Refused: not drawn, counted in `stats.refused` and by cause in `stats.refusals` (`emitters` or `particles`); the first refusal of each cause in a visit is reported. A refused burst is dropped and counted in `dropped` (never fired late), and a refused `despawn: true` one-shot is removed at once; a refused continuous emitter is admitted when capacity frees (same step) |
| Reserved particles per scene (sum of admitted `max`) | default 4,096, cap 65,536 | As above |
| Curve keys, lifetime, speed, gravity, drag, rate | 8 keys, 30 s, 1,000 m/s, ±1,000 m/s², 10/s, 10,000/s | `defineEmitter` throws; mutated data freezes the emitter with one report until fixed |
| Flipbook grid, frame rate | `cols` and `rows` 1…16 each (256 frames), `fps` up to 120 | As above; the message names the 16×16 cap |

Admission uses the unscaled `max`, so the same emitters are admitted on every preset. A work-count limit is not a
CPU deadline: the per-step cost is proportional to live particles plus spawn attempts, bounded by the table.

## Rendering and cost

- The drawing code is a separate lazy chunk (about 3.8 kB minified), requested when the first emitter is admitted, or
  while the scene opens (whenever it has `sceneParticles()`). Simulation never waits for it: until it arrives
  admitted emitters simulate and are not drawn, then they are bound and drawn from the next frame. A failed chunk load
  is reported once and particles stay undrawn for the rest of the visit.

- One `InstancedBufferGeometry` (a unit quad: 4 vertices, 2 triangles) and one `ShaderMaterial` per admitted emitter;
  the vertex shader billboards each instance to the camera. Per-particle centre, size and linear colour with opacity
  are three `DynamicDrawUsage` instance attributes over the emitter's pool arrays, allocated once at admission.
- Each frame in which a fixed step ran writes the latest step's values while particles are (or were just) live (the
  same state `Shape` meshes show, so particles never trail their emitter) for
  the live prefix only, and uploads that range (`addUpdateRange`). Nothing is rebuilt per frame (STD-REN-36) and the
  step, spawn and write paths do not allocate per particle (finding emitters uses the world's ordinary query, which
  allocates its iterator once per step).
- Draws: one per emitter with live particles; triangles: two per live particle. An emitter with nothing alive is
  hidden (no draw). When the last particle dies the picture is drawn once more without it; then an idle scene renders
  no frames, and a scene without other systems returns to on-demand frames.
- Additive blending (default) needs no sorting; `'normal'` blending is not depth-sorted within an emitter (three.js
  sorts each emitter against other transparent objects by its mesh origin, the world origin, not by its particles). `depthWrite` is off. No frustum culling (bounds
  move every step), lighting, soft particles, shadows or tone mapping.
- The particle program is compiled at its first draw, not during the scene's program preparation, so the first burst
  of a visit may show a compile hitch on slow drivers.

## Flipbooks (sprite sheets)

`frames: { cols, rows, count?, fps?, mode }` on an emitter makes its `texture` a grid of frames (frame 0 top left,
left to right, then down). Owner and cost are the emitter's: still one mesh and one draw. At admission a flipbook
emitter's pool also allocates two `Float32Array`s of its capacity (the drawn frame and the start frame per particle);
the renderer adds one instanced `frame` attribute (1 float per particle) over the first, uploaded with the live
prefix like the others, and compiles the particle program with `FLIPBOOK` defined, where the vertex shader maps the
quad's uv into the frame's cell (`grid` uniform; `flipbookUv` in `particles.ts` is the same formula, unit-tested).
Emitters without `frames` keep the plain program and their three attributes, so their output is unchanged. The frame
is computed in the same per-frame write as size and colour (`flipbookFrame`): `'over-life'` from age / life,
`'loop'` from age × fps, `'random-start'` from age × fps plus a start frame drawn at spawn. Nothing is allocated per
particle or per frame.

Bounds: the grid is capped at 16 × 16 and `fps` at 120 (refused by `defineEmitter`, or frozen with one report when
mutated). A flipbook needs a texture. Changing `cols` or `rows` restarts the emitter (new pool shape); `count`, `fps`
and `mode` may change every step. Until the sheet arrives (or if it fails) the emitter draws its soft dot.

Determinism: `'random-start'` takes a fifth draw from the emitter's own stream on every spawn attempt (before thinning,
so the stream stays preset-independent); `'over-life'` and `'loop'` take none, so such an emitter moves exactly as it
does without `frames`. No flipbook draws from `ctx.random()` or `Math.random` (regression tests in
`particle-flipbook.test.ts`, with and without a seed).

Limitations: frames are packed edge to edge with no padding or half-texel inset, so bilinear filtering and mipmaps blend
neighbouring cells at the cell borders (visible as a one-pixel seam on a large opaque test sheet); author frames with
transparent borders. No frame blending between cells, no per-emitter sheet atlas sharing beyond the texture library's
own sharing, no compressed sheet formats beyond the texture library's. `npm run fx:pack` (`scripts/fx-pack.mjs`) packs
8-bit RGB/RGBA PNG sequences only (palette, 16-bit and interlaced files are refused), offline and with no
dependency; its sidecar records the grid, sizes, input hashes and stated provenance, which the creator copies into
`defineAsset` (nothing checks the two agree).

## Quality

Knob `effects.particles` (group Effects, applies on scene re-entry): 1 on reference and high, 0.75 medium, 0.5 low.
For non-essential emitters the pool is `ceil(max × scale)` and spawn index k is drawn when
`floor((k+1)·scale) > floor(k·scale)`, a deterministic subset of the reference particles. Every spawn attempt still
takes its four random draws (five for a `'random-start'` flipbook), so the stream, the despawn time and everything the game computes are identical on
every preset (STD-SIM-10). `essential: true` emitters are never thinned: they are the content floor (STD-SET-10).
The knob is registered and resolved but not yet `wired` (not shown on the Graphics screen), like texture anisotropy;
a template that uses particles can wire it. Only the reference preset is gated (STD-SET-5).

## Determinism

**Step rate.** Particles step on the fixed 60 Hz lane, like every fixed system. On a 120 or 144 Hz display they move
every second (or so) displayed frame, the same as `Shape` entities moved by fixed systems; frames in between redraw
nothing for particles. This is deliberate (identical simulation on every display) and not interpolated.

Particles have their own random stream, separate from gameplay: with `?seed=` (or `testScene({ seed })`) it is
`createRng(deriveSeed(seed >>> 0, 'particles'))` (any number is accepted and wrapped to 32 bits, as for
`ctx.random`; `testScene` creates it only for a scene with `sceneParticles()`), otherwise the visit's named stream `scene.<id>.particles`. Each admitted
emitter seeds its own mulberry32 stream from one draw of it at admission, in spawn order. **An emitter's particles
therefore depend on its admission order within the visit:** the same emitter admitted after a different set of earlier
emitters (another spawn order, a refusal, a rebuild) gets a different stream. With the same seed and the same
tick-addressed input that order, and so every stream, is reproduced: a run's particles are identical after N ticks. Particles never feed back into game state and never draw from `ctx.random()`: adding, removing or rebuilding
an effect leaves the gameplay sequence and existing `?seed=` replays unchanged (regression test in
`particles.test.ts`). Cross-browser floating-point identity is not claimed (as for replay and rollback).

## Cancellation and failure recovery

- The texture check at build time covers a scene's own entities and prefabs listed in the game's definitions
  (`defineEntity` passed to `compileGame`); a prefab that is only imported by a system is checked when its texture
  fails to load (reported once).

- Leaving the visit aborts pending texture loads; a texture that arrives later is released, never applied. Leased
  textures are released, never disposed by the emitter (the library owns them).
- A texture that arrives while its emitter has nothing alive is applied without a redraw (the next particles show it);
  arriving while particles are live redraws once. The renderer chunk arriving redraws nothing by itself: bound
  emitters draw from their next step.
- A waiting emitter that cannot be bound when the renderer chunk arrives is handed back to the field
  (`bindFailed`): reported once, its slot released, not admitted again this visit. If the scene refuses the mesh
  (`scene.add` throws), its geometry and material are disposed at once and nothing is tracked.
- A missing or failing texture is reported once; the emitter keeps drawing its soft dot. Nothing retries until the
  emitter is rebuilt or the scene is entered again.
- Invalid data, admission refusal and renderer exceptions are reported and contained to that emitter; the step and
  other emitters continue. A renderer failure while binding releases the slot.
- Context loss: three.js re-uploads geometry, attributes and textures on restore; the pool is CPU-side and survives.

## Evidence

| Level | Evidence | Scope |
|---|---|---|
| Unit | `src/author/particles.test.ts` (validation, burst/continuous, seeded determinism, gameplay stream unchanged by effects, bounded refusal under sustained hits with no late firing, no re-fire on rebuild, bind failure not retried, thinning subset, overload, admission and refusal, invalid-data freeze, rebuild, interpolation and curves, rotation, trail spacing, `testScene`, compile-time texture check); `src/author/scene-particles.test.ts` (one hidden instanced mesh per emitter, live-prefix upload ranges, blending, texture lease/apply/release/failure/late arrival, visit disposal); `src/author/particle-view.test.ts` (lazy renderer: loads once on first need, binds waiting emitters, ignores a late arrival after the visit, reports a failed load or a failed renderer creation once); `src/author/particles-recipe.test.ts` (the recipe's code, plus a check that its definitions still match the recipe's code blocks) | Node, no GPU |
| Browser | `npm run test:particle-browser` (`scripts/play/particle-check.mjs`): reference and low presets; idle emitters 0 draws and 0 frames; one burst +1 draw with 2 triangles per particle (48 on reference, 24 on low); three live emitters 3 draws; back to the baseline draws and still once particles die; the drawing chunk fetched once; 3 emitter geometries disposed and the texture released on exit; a 2 × 2 flipbook packed by `fx:pack` (`'over-life'`) is one draw while live, its frame attribute steps 0, 1, 2, 3 and the screen shows the cells in reading order (red, green, blue, yellow) | Desktop headless Chromium, software GL |
| Browser (on-demand) | Same check: a scene without systems plays its own one-shot burst, removes the entity and then renders no frames | As above |
| Unit (flipbook) | `src/author/particle-flipbook.test.ts` (UV and frame maths, shader formula and attribute only on flipbook emitters, 16×16 cap refusal at definition and at run time, determinism with a seed and from the unseeded visit stream, no extra draw for over-life and loop, gameplay stream unchanged); `scripts/fx-pack.test.mjs` (grid choice and cap, layout, sidecar, natural order) | Node, no GPU |
| Bundle (flipbook) | Blank template build: lazy `scene-particles` chunk 3,401 → 3,850 bytes minified (1,698 → 1,879 gzip); scene runtime chunk 462,401 → 462,427 bytes | Blank template only |
| Gate | Template budgets unchanged: no template uses `Emitter`. Blank template build: scene runtime chunk +3.0 kB (489.6 → 492.6 kB, including the particle seed derivation), first-load JS +0.5 kB | Per-scene counts and bundle of the checked templates |

Not established: physical-device or GPU timing, fill-rate cost of large or overlapping particles, visual quality
beyond screenshots, phone/tablet acceptance (DV-01), and cross-browser floating-point determinism.
