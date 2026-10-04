# Post-processing: bloom, vignette and grade

A scene can ask for post-processing with plain data, and the player's **Post-processing** setting (the `post.mode`
graphics knob) decides how much of it runs. Game code never names a pass or imports three.js. A scene without
`view.post` loads no post code and draws exactly as before.

```ts
import {defineScene} from '@engine';

export default defineScene({
  id: 'courtyard',
  title: 'Courtyard',
  view: {
    environment: night,
    output: {toneMapping: 'aces', exposure: 0.9}, // tone mapping: docs/guides/scene-look.md
    post: {
      bloom: {strength: 0.65, threshold: 0.9, radius: 0.5}, // `full` only
      vignette: {amount: 0.45}, // `basic` and `full`
      grade: {lift: [0, 0.005, 0.03], gain: [1.05, 1, 0.95], saturation: 1.05}, // `basic` and `full`
    },
  },
});

// At run time: replace the value. One redraw, then the scene is still again.
ctx.view.post = {...ctx.view.post, vignette: {amount: 0.2}};
```

## Tiers

| `post.mode` | Presets | What is drawn | Post draws per frame |
|---|---|---|---|
| `off` | low | The scene straight to the canvas, as without post. Tone mapping still comes from `view.output`. | 0 |
| `basic` | medium | The scene into a half-float target (MSAA when **Smooth edges** is on), then one combined pass: tone map, grade, vignette, sRGB. | 1 |
| `full` | high, reference | `basic` plus bloom: a threshold pass, 4 downsamples and 4 upsamples at half resolution and below (5 mips). | 10 |

The mapping is exact and is part of the knob (`src/platform/render/quality.ts`). Post is cosmetic, so it has no floor:
the player may choose `off` on any preset. The knob is live: a change draws one frame.

## Inputs, outputs and bounds

- **Input:** `view.post`, every field optional. Without a field, its default applies: bloom `{strength: 0.6,
  threshold: 1, radius: 0.5}`, vignette 0, grade identity. `bloom: false` turns the glow off even at `full`.
- **Bounds** (a data error outside them, naming the field): `strength` 0 to 3, `threshold` 0 to 16 (linear light; 1 is
  "brighter than white", emissive 2 to 6 glows), `radius` 0 to 1, `vignette.amount` 0 to 1, `lift` channels -0.5 to
  0.5, `gain` channels 0 to 4, `saturation` 0 to 2.
- **Output:** pixels only.
- **Order** in the combined pass: scene plus bloom (linear light), tone mapping (the scene's `view.output`, the same
  mapping and exposure as `off`), then grade (`c * gain + lift * (1 - c)`, then saturation) and vignette on the
  tone-mapped picture, then sRGB.

## Owner, lifetime and render on change

- **Owner:** `platform.render.post`. The settings and the plan are backend-neutral
  (`src/platform/render/post/settings.ts`). The WebGL2 implementation is GLSL in
  `src/platform/render/backends/webgl/post.ts`, a lazy chunk. A future WebGPU backend adds its own implementation of
  the same plan (ADR 0078); until then a WebGPU visit reports that post is unavailable and draws without it.
- **Loading:** the chunk is requested while the scene prepares. Its first picture waits up to 4 s for it, so a scene
  normally opens already composed. A chunk that arrives later draws once more. A chunk that fails, or a context that
  cannot render to a half-float target, is reported once, and the scene stays on `off` for the visit.
- **Render on change:** post runs only inside a frame the scene draws anyway. An idle scene still draws no frame, and
  the last composed picture stays on the canvas.
- **Targets:** the scene target, its depth and the bloom mips are visit resources. They are allocated on the first
  composed frame and reallocated only when the drawing-buffer size, the MSAA sample count or the need for bloom
  changes (resize, pixel ratio, Smooth edges), never per frame. They are disposed when the visit ends.
- **Program preparation:** the scene's target variant and the passes are compiled during preparation (STD-REN-37).
- **Context loss:** three re-creates its GPU objects on next use; the visit's preparation runs again with post.
- **Failure:** an invalid `ctx.view.post` is reported once and the last valid settings stay. A pipeline error is
  reported once, its targets are released, and the scene draws direct for the rest of the visit. A shader link
  failure is the scene's own failure (the scene's recovery card).

## Budgets and cost

- **`postDraws`** (budgets.json, per scene, per preset port): fullscreen post passes per rendered frame, counted
  **apart** from `draws`. `draws` keeps measuring the scene's own complexity, its draws into the scene target
  included. This is a contract change of the draw count, stated here on purpose: before post existed, every draw
  was a scene draw. The bench, `play:snap` and the gate read it through the probe's post bracket
  (`scripts/perf/probe-inject.mjs`). It has no noise allowance, and a derived budget is the exact tier count (10, 1, 0).
  Give a scene with post a `postDraws` row with ports, for example `{"postDraws": 10, "ports": {"medium":
  {"postDraws": 1}, "low": {"postDraws": 0}}}`.
- **Memory:** the scene target is half-float colour (8 B/px) and depth, with multisampled storage when MSAA is on. The
  bloom mips add about a third of a half-resolution target. `engine.post()` reports `targetBytes` in dev and test
  builds. The same textures also count in `textureMiB`.
- **Bundle:** the chunk is 5.9 kB minified / 2.5 kB gzip (both tiers, hand-written, against an estimated 20 kB / 5 kB
  for three's EffectComposer and UnrealBloomPass). First-load JS grows by 2.5 KiB (settings validation in
  `defineScene`, measured with `npm run perf:bundle`: 167.8 to 170.3 KiB).
- **GPU cost per preset:** not measured on the reference GPU yet (`bench:ref`), and phone fill-rate cost is
  unverified. Post is full-screen fill work: on a phone, prefer `basic` or `off`.

## Differences from `off` worth knowing

- Transparent surfaces blend in linear light before tone mapping, instead of after it. Glass and particles can look a
  little different from `off`.
- Particles are tone-mapped like everything else in `basic` and `full`.
- MSAA follows the **Smooth edges** setting. Without it, edges inside the scene target are not antialiased.

## Evidence

Unit tests:
- settings, tiers and target sizes: `src/platform/render/post/settings.test.ts`;
- the GLSL pipeline against a recording renderer (draw sequence, allocation, compile, disposal, state restore):
  `backends/webgl/post.test.ts`;
- the scene seam (lazy load, fallback, runtime settings): `author/scene-post.test.ts`;
- preparation and drawing through post: `author/program-preparation.test.ts`;
- the budget metric: `platform/perf/budget-check.test.ts`.

Browser: `npm run test:post-browser`, on the courtyard fixture, in software GL. No physical-device, GPU timing or
visual-quality acceptance.
