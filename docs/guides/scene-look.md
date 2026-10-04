# Scene look: output, lights, shadows and sky

How a scene turns lit geometry into the picture on screen. Every capability here is
plain data on `@engine` scene options and components; game code never imports
three.js. Each one is **opt-in**: a scene that does not use it draws exactly the
picture it drew before, with the same draws and budgets.

| Capability | Opt in with | Section |
|---|---|---|
| Tone mapping and exposure | `defineScene({ view: { output } })` | [Output](#output-tone-mapping-and-exposure) |
| Point and spot lights | `defineScene({ lights: sceneLights() })`, `PointLight`, `SpotLight` | [Local lights](#local-lights-point-and-spot-lights) |

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
  `lights()` give `slots`, `admitted` and `refused` by cause.
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
- **Budgets:** lights add no draws. A per-scene `localLights` budget row is not
  implemented: the bench does not measure slots yet, so slot cost is bounded only
  by `sceneLights` and the knob.
- **Not verified:** physical devices. Forward-rendered lights multiply fragment
  cost, so fill rate on phones (DV-01) is unmeasured; that is why `low` caps the
  slots at 2.
- **Quality knob screen:** `lights.local-max` is registered but not wired to the
  Graphics screen yet, like `effects.particles`: a game that has no lights would
  show a control that changes nothing.
