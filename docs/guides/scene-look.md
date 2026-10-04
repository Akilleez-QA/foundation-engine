# Scene look: output, lights, shadows and sky

How a scene turns lit geometry into the picture on screen. Every capability here is
plain data on `@engine` scene options and components; game code never imports
three.js. Each one is **opt-in**: a scene that does not use it draws exactly the
picture it drew before, with the same draws and budgets.

| Capability | Opt in with | Section |
|---|---|---|
| Tone mapping and exposure | `defineScene({ view: { output } })` | [Output](#output-tone-mapping-and-exposure) |

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
