# Crowd and night rendering lessons: cost, cadence, transitions, wet looks and measuring

Lessons from a lab that put up to a few hundred skinned characters into a lit night scene with wet, reflective
ground (see [labs](labs.md)). Each item is a **practice**. Where the engine ships a related feature, the item names
it; otherwise the work was the lab's own code (raw three.js through `@kits/three`) and the item says the engine does
not provide it. The numbers are the lab's measurements on its own assets and machine, given for scale; they are not
budgets, and none of them was measured on a phone or tablet.

The character pipeline side (retargeting, weights, LOD building, clip QA) is in
[character pipeline lessons](character-pipeline-lessons.md).

## What one character costs

A detailed character is expensive in every pass, not just the main one. The lab's full-detail person had about
37k triangles and 8 to 11 materials (body, eyes, brows, lashes, hair, garments, shoes, hat):

- **Draws.** Each material group is a separate draw, in every pass that draws the mesh: main, ambient occlusion
  normals, reflection, and each shadow map. That came to 8 or 9 draws per pass per person; a few hundred people
  reached thousands of draws a frame, and the draw count, not triangles, was the wall.
- **Textures.** A colour and a normal map per part came to about 14 to 20 MiB of uncompressed texture memory per
  distinct character.
- **Heap.** One cloned skeleton per person dominated the JavaScript heap, ahead of mixers and clips. The glTF
  loader also gave every cubic-spline track its own interpolant factory (about 26k closures for eleven characters);
  sharing one cut a few MiB per scene.

What brought it down, in order of effect:

1. **Keep geometry indexed.** Merging parts with a step that de-indexes them (`toNonIndexed()`) multiplied the
   skinned vertex count about fivefold in every pass. Give index-less parts a trivial index instead.
2. **Merge the parts onto one skeleton** and **atlas the textures into two material groups**: opaque (skin, cloth,
   eyes) and cut-out (hair, brows, lashes). One alpha-tested material for everything discards across the whole body
   and loses early depth rejection. Packing each part's own 0..1 UV square into an atlas tile is a scale and offset,
   so normal maps stay valid without a re-bake.
3. **Compress textures** with KTX2 ([compressed textures](compressed-textures.md)); the engine's model loader draws
   KTX2 textures embedded in a GLB.
4. **Build at least three LOD levels** (the lab used about 37k, 9k and 2 to 3k triangles) and drop brows and lashes
   from the reduced ones.
5. **Remove body faces covered by clothing** on every level.
6. **Cull skinned meshes properly.** A skinned mesh's bounding sphere is computed once from whatever pose it is in;
   compute it per character at load, pad it for limb reach, and leave frustum culling on. Turning culling off on
   people put every one of them into every shadow map, including the cones of spot lights they were nowhere near.

The engine does not merge character parts, build atlases or swap character LODs; the engine's
[instanced scatter](scatter.md) draws many copies of a static `Shape` or `Mesh` in one draw, not skinned characters.

## Animation cadence

Update animation by **on-screen rank**, not by distance alone. Rank the visible people by projected size and give
the nearest few every frame, the next band every second frame and the rest every fourth, staggered by index so the
work spreads across frames. Off-screen people stop posing but their **clocks keep running**: accumulate the elapsed
time and pass it on the next update, so a person who comes back into view is where they should be in their clip.
Interpolate between reduced-rate pose samples, or a half-rate person visibly steps.

In the lab, one animation mixer per person was fine up to about 150 people on a desktop; past that the per-person
skeleton work and the draw count mattered first. Beyond that scale the usual next steps are instanced skinning (a
bone texture per instance) or baked animation textures; the lab researched both and built neither, and the engine
provides neither.

Give a crowd variety cheaply: a seeded per-person rate spread of a few percent, random start phases, several clips
per activity, and a rule that neighbours do not start the same clip at the same moment. Use `ctx.random()` so a
`?seed=` run replays the crowd exactly.

## Transitions: inertialize rather than crossfade

A linear crossfade between two clips blends two moving poses and can kick a limb or slide a planted foot. An
**inertialized** switch was smoother in the lab: at the switch, take the offset between the outgoing pose and the
incoming one, and decay that offset to zero along a curve that starts with the offset's own velocity and ends with
none. The incoming clip plays from its first frame at full weight, so its contacts stay intact. Fold an offset still
in flight into the next one when a switch interrupts another, and stretch the decay for large offsets so peak
acceleration stays bounded. Phase-match locomotion switches (start the new gait at the foot phase the old one is in).

`@kits/animation`'s `createInertializer` (#182) implements the pose-level switch: position and shortest-arc rotation
offsets with their velocity, decayed to zero by a quintic over a bounded blend time, a new switch replacing one in
flight ([kit README](../../src/kits/animation/README.md)). It does not stretch the decay for large offsets or
phase-match locomotion, and `Model` still plays one glTF clip at a time with no blending, so feeding glTF clips
through it is the game's own code.

## Night, wet and graded looks

- **Cap specular below the bloom threshold.** A polished wet surface under a bright light produces tiny highlights
  far above 1.0 in linear light; bloom rounds each one into a glowing orb. Clamp the surface's direct specular (the
  lab capped at about half the bloom threshold) so highlights read as glints. The engine's [post-processing](post-processing.md)
  exposes the bloom `threshold`; a specular cap is part of the surface's own material code.
- **Put an HDR ceiling before bloom.** One glossy edge near a lamp could bloom a white disc across the sky. Clamping
  scene colour to a ceiling before the bloom pass stops a single hot pixel from dominating. The engine's post has an
  opt-in `view.post.ceiling` for this (#179, [post-processing](post-processing.md)).
- **Planar mirror reflections redraw the scene.** A mirror reflection renders the scene again from a mirrored camera
  every frame it updates, with its own draws for every visible person. Budget that pass like any other, keep far and
  small things out of it (layers work for the mirror camera), update it at reduced resolution, and give lower quality
  tiers a fallback that samples only a cube or environment map. The engine has no planar reflection; the lab built
  one through `@kits/three`. For a fixed dark surround with a few lamps, an `environment.reflection` of kind
  `interior` (#183, [scene look](scene-look.md)) is built once from data and costs nothing per frame.
- **Grade with a lookup table fitted to reference art.** Fitting a 3D colour lookup table from untreated renders to the
  creator's reference images (a tone curve on lightness plus a colour transfer, blended rather than applied at full
  strength) matched the art faster than tuning lights. Record the fit's inputs as provenance. The engine's grade
  applies a `.cube` table through `view.post.grade.lut` (#179, [post-processing](post-processing.md)), and
  `cubeLutText` writes one from a game's own tool; fitting the table to reference art is the game's work.
- **Shadow the static world once per light.** Redrawing every shadow map every frame because people move is the
  expensive case. Draw static geometry into a light's map once and add only the moving casters per frame (or keep a
  separate map for them), and limit people's shadows by distance with a cheap blob under the rest. The engine's
  [shadows](scene-look.md) redraw a map only when something in it moves; they do not keep a separate static layer,
  and `Model` entities do not take part in them yet. Opt-in [blob shadows](blob-shadows.md) (#184) draw soft contact
  ellipses, in one instanced draw, under entities no real sun shadow reaches.
- **Fewer real lights.** Every light compiles into every lit shader. Keep real shadowed lights for the few near the
  action and give the rest glowing heads and painted pools. The engine's scene lights have caps for the same reason
  ([scene look](scene-look.md)).

## Measuring

- **Check which GPU the benchmark used.** Headless Chromium on Linux silently fell back to software GL when asked
  for a GPU, so a "GPU" run was a software run. `npm run bench` uses software GL by default and records the renderer
  string in each run's `gpu` field; `--gpu` now selects ANGLE on Linux and fails a run whose renderer is a software
  rasteriser, but still read that field before believing the numbers.
- **Warm up, then judge, and report the warm-up.** First frames compile shaders and fill shadow maps and reflection
  targets; the lab also staged its expensive passes over the first frames to avoid losing the WebGL context on a cold
  start. Judge snapshots after warm-up, but report the warm-up hitches separately rather than hiding them.
  `npm run play:snap` waits (bounded) for each view's counts to settle before judging and prints the warm-up window
  apart (#180).
- **Count every pass.** Read draw and triangle counts after the whole frame, including post-processing and
  off-screen passes; a counter reset per `render` call under-reports a multi-pass frame.
- **Budgets per tier, measured on the real minimum device.** A desktop measurement does not certify a laptop's
  integrated GPU, and browser emulation certifies no physical device. Keep budgets per quality tier and re-measure
  when the minimum device changes ([device experience](../policy/DEVICE-EXPERIENCE.md)). Budgets only fall unless the
  creator agrees to a raise.

## Process

- **Prove one system in a lab first** ([labs](labs.md)): crowd cost, a transition scheme or a wet surface each
  answered faster alone than inside a full game.
- **Integrate parallel work serially.** Many branches touching one scene file merge best one at a time, each checked
  before the next.
- **Commit evidence**: measured before and after counts in the commit message or a committed summary, not only on
  one machine.
- **No personal paths in tool defaults**; take them from arguments or the repository.
