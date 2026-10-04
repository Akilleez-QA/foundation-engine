# Scene look: output, lights, shadows and sky

How a scene turns lit geometry into the picture on screen. Every capability here is
plain data on `@engine` scene options and components; game code never imports
three.js. Each one is **opt-in**: a scene that does not use it draws exactly the
picture it drew before, with the same draws and budgets.

| Capability | Opt in with | Section |
|---|---|---|
| Tone mapping and exposure | `defineScene({ view: { output } })` | [Output](#output-tone-mapping-and-exposure) |
| Point and spot lights | `defineScene({ lights: sceneLights() })`, `PointLight`, `SpotLight` | [Local lights](#local-lights-point-and-spot-lights) |
| Shadows | `defineScene({ shadows: sceneShadows() })`, light `shadow`, `Shadow` | [Shadows](#shadows) |
| Gradient sky, discs, stars, exp2 haze | `defineEnvironment({ sky, haze })` | [Sky and haze](#sky-and-haze) |

## Output: tone mapping and exposure

Without tone mapping, any light above 1 clips: an `emissiveIntensity` of 6 or a
strong lamp turns into a flat patch of the brightest colour, and warm light reads
as yellow paint. Tone mapping rolls bright light off smoothly instead, so glowing
things keep their hue and the rest of the scene keeps its contrast.

```ts
import { defineScene } from '@engine';

export default defineScene({
  id: 'courtyard',
  title: 'Courtyard',
  view: {
    environment: night,
    output: { toneMapping: 'aces', exposure: 0.9 },
  },
  // ...
});

// At run time (a system, `enter`, a settings toggle): replace the value.
ctx.view.output = { ...ctx.view.output, exposure: 1.2 };
```

### Inputs and outputs

- **Input:** `view.output` on `defineScene`, both fields optional:
  - `toneMapping`: `'none'` (the default), `'aces'` (filmic, contrasty, warm
    highlights roll towards white), `'agx'` (desaturates highlights more gently)
    or `'neutral'` (keeps hues closest to the authored colours).
  - `exposure`: a multiplier on the light before tone mapping, in (0, 16]. The
    default is 1. It has no effect under `'none'`.
- **Run time:** `ctx.view.output` always holds the complete output. Replace the
  object to change it.
- **Output:** pixels only. The renderer's tone mapping and exposure are set for
  the scene's visit.

### Owner, bounds and cost

- **Owner:** the scene visit. The output is part of the renderer lease's profile
  (`RenderProfile.toneMapping` / `toneMappingExposure`), so it starts with the
  visit and ends with it: every lease gets a fresh renderer, and the next scene
  starts from its own output.
- **Bounds:** the two fields above. `defineScene` refuses anything else and names
  the field (`scene courtyard: view.output.exposure must be a number in (0, 16]`).
- **Render on change:** the runtime compares the output once per frame. A changed
  value draws exactly one frame. An equal value, or none, draws nothing, so a
  still scene stays at zero frames.
- **Cost:** tone mapping is per-fragment work in the existing pass; no draw, target
  or texture is added. Changing `toneMapping` recompiles the scene's lit materials
  once (three keys programs on it). Changing `exposure` only sets a uniform.
- **Defaults are byte-identical.** `'none'` with exposure 1 is a fresh renderer's
  own setting, so a scene without `output` sets exactly what it had before.
  `quality:guard` reports *identical* pictures for the blank and explorer
  templates.

### Overload, cancellation and recovery

- **Overload:** none; there is nothing to queue.
- **Cancellation:** leaving the scene releases the lease, and the renderer with it.
- **Invalid run-time value:** it is reported once per distinct problem
  (`<scene>: view.output refused`), and the last valid output stays on screen.
  Assign a valid value to recover.
- **Context loss:** three keeps the renderer's tone mapping; the restored context
  recompiles programs with it.

### Choosing values

- Emissive surfaces above 1 (`emissiveIntensity` 2 to 6) need tone mapping to
  read as light. Without it they clip.
- `'aces'` darkens mid-tones a little. Start with an exposure of 0.9 to 1.2 and
  compare `npm run play:snap -- --mobile` pictures. Dark scenes may need more
  exposure or brighter lights.
- Tone mapping alone does not make light spread. A glow that reaches its
  surroundings needs a light, and a halo needs bloom (post-processing).

### Backend seam

The author data is backend-neutral names. The WebGL mapping onto three's
constants lives in
[`backends/webgl/output.ts`](../../src/platform/render/backends/webgl/output.ts);
a WebGPU backend maps the same names onto its renderer (ADR 0078). The contract
type is `RenderOutput` in
[`render-backend.ts`](../../src/platform/render/render-backend.ts).

### Evidence and limitations

- **Unit:** `src/author/scene-output.test.ts` (defaults, validation naming the
  field, one apply per change, an invalid run-time value reported once) and
  `src/platform/render/backends/webgl/output.test.ts` (profile mapping).
- **Browser:** `npm run test:output-browser`, on the reference and low presets, in
  desktop headless Chromium with software GL. An emissive-6 lantern clips under the
  default and stays below clipping, and warm, under `'aces'`. An idle scene renders
  0 frames, one change renders exactly one frame, and the next scene starts from
  the defaults.
- **Pictures:** `quality:guard` in `identical` mode on the blank (`main`) and
  explorer (`garden`, `shed`) templates.
- **Bundle:** first-load JS +1.0 kB (the `defineScene` validation), the lazy scene
  runtime +0.6 kB (explorer template build); no new chunk.
- **Not verified:** physical devices, and colour on HDR or wide-gamut displays.
  The picture is judged by its pixels in software GL only.

## Local lights: point and spot lights

`PointLight` and `SpotLight` are components on an entity with a `Transform`. The
light sits at the entity's position, and a spot light aims along the entity's
forward axis (−z, turned by its rotation) or at an explicit `target`. A scene
opts in with a fixed number of **light slots**:

```ts
import { defineScene, PointLight, SpotLight, sceneLights, Shape, Transform, defineMaterial } from '@engine';

const lantern = (x: number, z: number) => [
  Transform({ x, y: 2.45, z }),
  Shape({ kind: 'box', size: [0.42, 0.5, 0.42], color: 0xffd28a }),
  defineMaterial({ emissive: 0xffa040, emissiveIntensity: 4 }),
  PointLight({ color: 0xffa850, intensity: 6, distance: 8, decay: 2 }),
];

export default defineScene({
  id: 'courtyard',
  title: 'Courtyard',
  lights: sceneLights({ point: 8, spot: 2 }),   // fixed slots for each visit
  view: { environment: night, output: { toneMapping: 'aces', exposure: 1 } },
  entities: [
    lantern(-9, -9), lantern(9, -9),
    [Transform({ y: 6, rx: -Math.PI / 2 }), SpotLight({ color: 0xbfd4ff, intensity: 20, distance: 14, angle: 0.5, penumbra: 0.4 })],
  ],
});
```

Systems may change a light's fields at run time (flicker the `intensity`, switch
`visible`, move the `Transform`); each change draws one frame.

### Fields

| Field | Default | Meaning |
|---|---|---|
| `color` | `0xffffff` | 24-bit sRGB |
| `intensity` | `1` | Candela, 0…1000 |
| `distance` | `0` | Where the light cuts off, 0…50 m; 0 never cuts off |
| `decay` | `2` | Fall-off with distance, 0…4; 2 is physically correct |
| `essential` | `false` | Admitted before other lights, so it keeps its slot on lighter presets |
| `visible` | `true` | `false` keeps the slot but gives no light |
| `shadow` | `false` | Ask for a shadow ([Shadows](#shadows)); read when the light is admitted |
| `angle` (spot) | `π/3` | Half-angle of the cone, (0, π/2] |
| `penumbra` (spot) | `0` | Soft edge, 0…1 |
| `target` (spot) | `null` | A world point to aim at; `null` aims along the entity's forward axis |

`PointLight(...)` and `SpotLight(...)` validate when they are written and name the
field (`PointLight: distance must be in [0, 50] metres`).

### Why slots

three.js compiles the number of lights into every lit material's shader. Adding
or removing a light would recompile them all (STD-REN-11), which is a visible
hitch. So the visit creates its slots once and never changes their number:

- An entity's light claims the lowest free slot of its kind and keeps it until
  the entity is despawned or loses its light or `Transform`. The slot then goes
  dark (intensity 0); a dark slot is still a light, so nothing recompiles.
- Lights waiting for a slot are admitted essential first, then in spawn order.
  An admitted light is never moved or evicted, and nothing is re-chosen per
  frame.
- Every slot costs fragment work on every lit surface, even when it is dark. Ask
  for the lights the scene shows at once, not for everything it might spawn.

### Inputs and outputs, owner and bounds

- **Input:** `defineScene({ lights: sceneLights({ point, spot }) })`, with
  `point` in 0…16 (default 4) and `spot` in 0…4 (default 0); the components above.
- **Output:** pixels only. The environment's directional and hemisphere lights,
  and `view.lights: 'default' | 'none'`, are unchanged; the slots are additive.
- **Owner:** the scene visit. `author/light-slots.ts` decides admission (it runs in
  `testScene` too), and `author/scene-light-rig.ts` holds the three.js lights,
  built with the platform's fixed light rig (`platform/render/light-rig.ts`).
- **Quality:** the `lights.local-max` knob (reference 16, high 8, medium 4, low 2)
  is read once per visit and caps the slots of **each** kind. The `low` preset
  therefore draws at most 2 point and 2 spot lights. Lights beyond the cap are
  refused like any other overflow: essential lights are kept first.
- **Render on change:** the rig compares each slot's holder, `Transform` and
  fields once per frame and marks the frame dirty only when one changed. A still
  scene draws zero frames.

### Overload, cancellation and recovery

- **Overload:** a light with no free slot is refused (cause `full`) and admitted
  later when a slot frees. Invalid data written by a system darkens the light
  (cause `invalid`) until a valid value is written. A scene without `sceneLights()`
  refuses every light (cause `no-slots`). Each cause is reported once per visit,
  for example `courtyard: 1 PointLight(s) not drawn: the scene's 8 point slot(s)
  are full (sceneLights({ point }) or the lights.local-max quality knob)`.
- **Counters:** `testScene(...).lights.stats` and the dev scene handle's
  `lights()` give `slots`, `admitted` and `refused` by cause. `refused` counts
  **lights**, not reports: eight point lights in two slots give `refused.full`
  6 on every frame they stay refused, while the report still appears once.
- **Cancellation:** leaving the scene disposes the rig with the visit.
- **Recovery:** the rig is CPU-side state; after a context loss three recreates the
  programs with the same light count.
- **A refused light keeps its look:** its `Shape` and emissive `Material` still
  draw; only its light is missing.

### Evidence and limitations

- **Unit:** `src/author/lights.test.ts` (validation, slot bounds, knob caps, claim
  and release, deterministic refusal reported once, invalid data, `testScene`).
- **Browser:** `npm run test:lights-browser` on the reference and low presets
  (desktop headless Chromium, software GL). The floor under a lantern is brighter
  than the floor 10 m away. The rig keeps its size, and spawning or despawning a
  light links no program and draws one frame. An idle scene draws no frames. At
  `low` the third lantern is refused, reported once, and admitted when a slot
  frees. Leaving removes every light.
- **Bundle:** the light rig is a lazy chunk (`scene-light-rig`, about 3 kB, plus
  three's point and spot light classes, about 2 kB) that only a scene with
  `sceneLights()` loads, before its first frame. First-load JS grows by about
  0.8 kB (the components and their validation) and the scene runtime by about
  4 kB (admission and refusal reports), explorer template build.
- **Budgets:** a light without a shadow adds no draws to the scene pass; its
  cost is fragment work (see
  [Cost per light and per shadow](#cost-per-light-and-per-shadow)). A light with
  `shadow: true` (in a scene with `sceneShadows()`) adds scene passes: its shadow
  map draws every caster in its reach again, once for a spot light and once per
  face (six) for a point light, on each frame the map redraws. The bench's
  `shadowPasses` and `shadowCasters` rows count those passes and draws. A
  per-scene `localLights` budget row is not implemented: the bench does not
  measure slots, so slot cost is bounded only by `sceneLights` and the knob.
- **Not verified:** physical devices. Forward-rendered lights multiply fragment
  cost, so fill rate on phones (DV-01) is unmeasured; that is why `low` caps the
  slots at 2. A phone reaches `low` by the player's choice or, for a constrained
  mobile GPU, by the device-class start (ADR 0079).
- **Quality knob screen:** `lights.local-max` is registered but not wired to the
  Graphics screen yet, like `effects.particles`: a game that has no lights would
  show a control that changes nothing.

## Shadows

Shadows put things on the ground. A scene opts in once, each light opts in on
its own, and each entity can opt out:

```ts
import { defineEnvironment, defineScene, PointLight, sceneLights, sceneShadows, Shadow, Shape, Transform } from '@engine';

export const night = defineEnvironment({
  // ...
  directional: { color: 0x8ea8ff, intensity: 0.5, position: [-6, 12, -4], shadow: { extent: 14 } },
});

export default defineScene({
  id: 'courtyard',
  title: 'Courtyard',
  lights: sceneLights({ point: 8 }),
  shadows: sceneShadows({ cast: 'all-shapes', receive: 'all' }),   // the defaults
  view: { environment: night, output: { toneMapping: 'aces', exposure: 1 } },
  entities: [
    [Transform({ x: 3, y: 2.45 }), PointLight({ intensity: 9, distance: 9, shadow: true })],
    // The glass around a light must not shadow its own light:
    [Transform({ x: 3, y: 2.45 }), Shape({ kind: 'box', size: [0.4, 0.5, 0.4] }), Shadow({ cast: false })],
    // Small things that always move would redraw every shadow map every frame:
    [Transform({ y: 0.9 }), Shape({ kind: 'sphere' }), Shadow({ cast: false })],
  ],
});
```

### Inputs and outputs

- **Scene:** `shadows: sceneShadows({ cast, receive })`. `cast: 'all-shapes'`
  (default) makes every `Shape` and `Mesh` entity cast; `'none'` makes none cast.
  `receive: 'all'` (default) or `'none'` does the same for receiving.
- **Entity:** `Shadow({ cast, receive })` overrides the scene default for one
  `Shape` or `Mesh` entity. `Model` entities neither cast nor receive yet.
- **Sun:** `defineEnvironment({ directional: { …, shadow: { extent, softness } } })`.
  `extent` (0…200 m) is the half-size of the square around the world origin that
  receives sun shadows; keep it just larger than the play area, because a larger
  square spreads the same map over more ground. `softness` is `'soft'` (default)
  or `'hard'`.
- **Local lights:** `PointLight({ shadow: true })` and `SpotLight({ shadow: true })`.
- **Output:** pixels only.

### Owner and bounds

- **Owner:** the scene visit. The renderer's shadow map is enabled through the
  lease profile only for a scene with `sceneShadows()` (PCF filtering; each
  light's softness is its filter radius). The sun's shadow and the local lights'
  shadows come from the lazy `scene-light-rig` chunk, through the platform's live
  shadow map (`liveShadowMap`) and the shadow scheduler (`scheduleShadows`).
- **Shadowed local lights are fixed per visit.** When the visit starts, the
  scene's own lights that ask for a shadow are ranked essential first, then in
  entity order, and the first `lights.shadowed-max` of them get shadowed slots
  for the whole visit. Shadowed slots are the first slots of each kind; a light
  without `shadow` never takes one. This keeps the number of shadow lights, which
  three compiles into every lit program, constant.
- **Tiers:**

  | Preset | Sun | Local shadowed lights (`lights.shadowed-max`) | Map sizes |
  |---|---|---|---|
  | reference | yes | 4 | sun 2048, spot 1024, point 512 per face |
  | high | yes | 2 | sun 2048, spot 512, point 512 per face |
  | medium | yes | 1 | sun 2048, spot 512, point 512 per face |
  | low | yes | 0 | sun 1024 |

  The sun's map follows the existing `shadows.quality` knob (its floor is `low`;
  `off` is a player choice and turns every shadow off). A point light's shadow is
  six faces packed into one 4 × 2 map, so it stays at 512 per face. In the
  courtyard trial, the sun at 2048 and two point lights at 512 measured 56.9 MiB
  of textures in all; with 1024 point maps it was 128.9 MiB.
- **Render on change:** the shadow scheduler redraws a map only when a caster or
  its light changed (STD-REN-12, STD-REN-13). A still scene draws no frames, and a
  redraw of a still scene draws no shadow pass. A moving caster redraws the maps
  of the lights it can affect on each frame it moves. Mark small, always-moving
  decorations `Shadow({ cast: false })`.
- **Cascades** stay a reference-only, sun-only platform option behind
  `shadows.quality === 'ultra'`; creator scenes do not get them.

### Cost per light and per shadow

Measured on a 10-object fixture (a floor, nine crates, point lights on a ring),
one crate moving every frame, in headless Chromium with **software GL**. Software
GL rasterises on the CPU, so the milliseconds show the shape of the cost, not
phone or desktop times. Draws and passes are counts and transfer.

| Added | Passes per moved frame | Off-screen draws per moved frame | Frame time, software GL |
|---|---|---|---|
| An unshadowed point or spot light | 0 | 0 | about +1.5 ms per megapixel (+2.1 ms at 1.24 MP, +8.6 ms at 6.1 MP) |
| The sun's shadow | 1 | casters inside its box | +10 ms at 1.24 MP, +33 ms at 6.1 MP |
| A shadowed spot light | 1 | casters in its cone | not measured; one map like the sun's, at 512 or 1024 |
| A shadowed point light | 6 (one per face) | casters in range of each face, summed (about 18 here) | about +10 ms at 1.24 MP, +27 ms at 6.1 MP |

- **Unshadowed lights cost per lit pixel.** Every slot is evaluated in every lit
  fragment, dark or not, so cost grows with slots × pixels. They add no draws.
- **Shadows are the cliff.** Each shadow map re-renders its casters. In the
  fixture, four shadowed point lights raised the frame from 10 to 92 draws, close
  to the guidance of about 100 draws per scene on phones. A denser scene grows
  faster: off-screen draws scale with the casters in each light's range.
- **Worst case per preset** (all shadowed slots used, something moving): passes
  are 1 for the sun plus 6 per shadowed point light, so reference 25, high 13,
  medium 7 and low 1 (spot lights use 1 each instead of 6).
- **Idle frames are free.** A still scene draws no frames, and a redraw of a
  still scene draws no shadow pass; the cost applies only while a caster or a
  shadow light moves.
- **Cheaper first:** one shadowed sun and unshadowed local lights; `Shadow({ cast:
  false })` on small moving things; a shadowed spot light (1 pass) before a
  shadowed point light (6); bake static light into the art. Budget the scene's
  `shadowPasses` and `shadowCasters` from a bench run.

Source: the 2026-10-03 POODO observation (fixture derived from
`scripts/play/fixtures/shadows-entry.mjs`; 390 × 844 at DPR 3 = 1.24 MP and
1600 × 1000 at DPR 2 = 6.1 MP). Not verified on physical devices.

### Overload, cancellation and recovery

- **Overload:** a light that asks for a shadow when no shadowed slot is free still
  shines, without a shadow (cause `shadow`). In a scene without `sceneShadows()`
  the request is reported the same way (cause `no-shadows`), and an environment's
  sun `shadow` is reported once as well. Each cause is reported once per visit;
  `testScene(...).lights.stats.refused` counts the lights drawn without their
  shadow now (one per light, not per report), and `stats.shadowed` gives the
  shadowed slots.
- **Changing it while playing:** a light's `shadow` is read when it is admitted to
  a slot. Adding or removing the sun's `shadow` in a new environment recompiles
  lit materials once; changing its `extent` or `softness` does not.
- **Cancellation:** leaving the scene disposes the rig and the sun's live map
  with the visit; the renderer lease ends with it.
- **Recovery:** a restored context has lost every map; the scheduler redraws them
  on the next frame.

### Evidence and limitations

- **Unit:** `src/author/shadow-casting.test.ts` (validation, flags, tier bounds,
  shadowed-slot choice and admission, reports, rig shadow slots, the sun's shadow
  box, direction and switch-off, no change without `sceneShadows()`).
- **Browser:** `npm run test:shadows-browser` on the reference and low presets
  (desktop headless Chromium, software GL). The floor where a crate's shadow falls
  has luminance 86 with shadows and 163 without; open floor is unchanged. The sun
  casts at both presets, and the lantern's point light only at reference. A
  redraw of the still scene draws **0** shadow-map draws; moving the crate redraws
  them. A scene without `sceneShadows()` draws no off-screen pass. Each report
  appears exactly once.
- **Budgets:** three bench rows count shadow work for scenes that opt in.
  `shadowPasses` is the most off-screen passes in one frame: one per shadow-map
  face that drew, so the sun or a spot light is 1 and a point light 6.
  `shadowCasters` is the most off-screen draws in one frame: for each shadow
  light, the casters in range of each face, summed (a caster near a point light
  counts up to six times). Both also count any other render-target pass or draw
  in that frame, and both are set by frames where something moves, because maps
  redraw only then. `shadowDrawsIdle` is the off-screen draws per frame while
  still (0 = static maps). `npm run test:shadows-browser` checks the bench's
  probe: the sun alone is 1 pass and the sun plus one shadowed point light 7.
  Every template budgets `shadowPasses: 1` (measured 0, rounded up to the step):
  one sun shadow fits, a shadowed point light (6 passes) needs a measured row.
  The courtyard trial (sun plus two shadowed lanterns, about 60 casters) measured
  `shadowCasters` 215, 0 off-screen draws per frame while idle (particles still
  animating), 168 while the character moves, and 56.9 MiB of textures, under
  software GL. Shadow-map memory counts in `textureMiB`; there is no separate
  `shadowMapMiB` row.
- **Templates:** a scene without `sceneShadows()` is unchanged; `quality:guard`
  reports identical pictures for blank and explorer.
- **Not verified:** physical devices, GPU time per shadow pass and phone memory.

## Sky and haze

A flat background colour makes a hard seam where the world ends. A gradient sky,
with haze in the same horizon colour, hides it:

```ts
import { defineEnvironment } from '@engine';

export const night = defineEnvironment({
  background: 0x070b1a,
  sky: {
    kind: 'gradient',
    top: 0x02040f, horizon: 0x1d1838, bottom: 0x070b1a, exponent: 0.6,
    discs: [{ direction: [-0.4, 0.5, -0.7], size: 3, color: 0xdfe6ff, glow: 0.4 }],
    stars: { count: 300, seed: 7 },
  },
  haze: { kind: 'exp2', color: 'sky', density: 0.035 },   // fog that meets the sky
  ambient: { sky: 0x2b3a6b, ground: 0x1a1008, intensity: 0.55 },
  directional: { color: 0x8ea8ff, intensity: 0.45, position: [-6, 12, -4] },
  points: [], pointSize: 2,
});
```

### Inputs and outputs

- **`sky`** (optional): `{ kind: 'gradient', top, horizon, bottom, exponent?, discs?, stars? }`.
  - `top`, `horizon` and `bottom` are packed sRGB colours, straight up, at the
    horizon and straight down. The gradient blends them in sRGB, so the authored
    colours come out exactly.
  - `exponent` (0…8, default 1) shapes the curve: below 1 the colour leaves the
    horizon sooner, above 1 the horizon band is wider.
  - `discs` (at most 4: a sun, or any body seen from the ground), each with
    `direction` (towards the disc), `size` (angular diameter, 0…20°, default 3),
    `color` (default white) and `glow` (halo, 0…1, default 0.3).
  - `stars: { count, seed, brightness }` adds up to 4,096 deterministic stars on
    the upper hemisphere, dimmer towards the horizon. The same seed gives the
    same sky.
- **`haze`** (existing field, new options):
  - the linear form `{ color, near, far }` is unchanged and still the default;
  - `{ kind: 'exp2', color, density }` thickens with distance (density 0…1; about
    2 / density metres is where things vanish);
  - either form takes `color: 'sky'`, which uses the sky's horizon colour.
- `sky` and `cube` are both backgrounds: an environment with both is refused.
- **Output:** pixels only. Without `sky` the background is the `background`
  colour (or the `cube`), exactly as before.

### Owner, bounds and cost

- **Owner:** the environment binding of the scene visit
  (`author/scene-environment.ts`). `author/sky.ts` holds the data and validation,
  `author/sky-pixels.ts` the pixel maths, and `author/scene-sky.ts` the three.js
  layer, a lazy chunk (about 3 kB) that a scene loads before its first frame when
  it starts with a sky, or when a later environment first has one (that sky then
  appears one frame after the chunk arrives; a failed load is reported).
- **One texture, no custom shader.** The sky is a CPU-generated `DataTexture` on
  an inverted sphere drawn with three's built-in unlit material (`fog: false`,
  `toneMapped: false`, centred on the camera like the star points). Nothing here
  is WebGL-specific, so the WebGPU backend draws the same data (ADR 0078).
- **Cost:** one draw for the sky and one for the stars. The texture is 1 KiB for a
  plain gradient and 512 KiB with discs (512 × 256 RGBA).
- **Render on change:** the environment is applied only when the value changes. The
  sky texture is regenerated only when the sky's own fields change (a key
  compare), and the stars only when `stars` changes. An idle scene draws nothing.
- **Tone mapping:** the sky and the haze colour are not tone-mapped (three applies
  fog after tone mapping), so a sky and a haze in its horizon colour meet without
  a seam under any `view.output`.

### Overload, cancellation and recovery

- **Overload:** none. Bounds are validated by `defineEnvironment` (and again when a
  new environment is published), naming the field
  (`environment: sky.discs[0].size must be in (0, 20] degrees`).
- **Cancellation:** leaving the scene disposes the sky mesh, its texture and the
  stars with the environment. A replaced sky texture is disposed at once.
- **Recovery:** the texture is CPU data; three re-uploads it after a context loss.

### Evidence and limitations

- **Unit:** `src/author/sky.test.ts` (gradient values, deterministic pixels, disc
  placement, deterministic stars, validation, one mesh and one additive star
  draw, regeneration only on a sky change, unchanged output without a sky).
- **Browser:** `npm run test:sky-browser` on the reference and low presets
  (desktop headless Chromium, software GL). The horizon and the top of the view
  match the authored gradient within 10/255 per channel. A far crate in exp2
  haze with `color: 'sky'` takes the horizon colour, and a near crate keeps its
  own. The sky and its stars cost two draws. An idle scene draws no frames, a
  sky change replaces and disposes the texture once, and leaving disposes it.
- **Templates:** no template uses `sky`, so `quality:guard` reports identical
  pictures for blank and explorer.
- **Bundle:** the scene runtime grows by about 3 kB (validation and exp2 haze);
  the sky layer is its own lazy chunk.
- **Not verified:** physical devices, and banding on 8-bit displays for very dark
  gradients.
- The disc is texture-based: at 512 × 256 a 3° disc is about 4 texels across, so
  it is soft-edged, not a crisp disc. A sharp disc needs a later sprite or shader
  module.
