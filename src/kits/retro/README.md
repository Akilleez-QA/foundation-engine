# kits/retro

An optional **retro software-raster look** as a render mode: the scene is drawn at a low resolution, optionally with
wide pixels (the column look of column-based software renderers), then each displayed colour is quantised to a
creator palette or to a number of levels per channel, with an ordered (Bayer) dither so gradients stay readable. It
runs on the GPU through `@kits/three`'s render override; a CPU reference of the same arithmetic runs headless.

```ts
// game/game.ts: the look needs the three.js kit.
import {three} from '@kits/three';
import {retro} from '@kits/retro';
export default defineGame({ /* … */ kits: [three(), retro()] });

// game/cellar.ts
import {sceneRetro} from '@kits/retro';
export default defineScene({
  id: 'cellar',
  extensions: [sceneRetro({ width: 320, pixelAspect: 2, palette: myPalette, dither: 'bayer4' }, {
    onReady(look) { /* look.set({ ditherAmount: 0.5 }), look.enable(false) from a hook or a setting */ },
  })],
  // …
});
```

| Contract | Definition |
|---|---|
| Creator-owned semantics | Whether a scene uses the look, its resolution, pixel shape, palette (up to 256 colours the creator owns) or levels, and dither. It is art direction, not a quality knob: it is not tied to presets and never turns itself on or off |
| Inputs | `width` 16..1920 low-res columns (default 320); `pixelAspect` 0.25..4 (default 1; 2 doubles the rows for the same columns, so pixels are twice as wide as tall and shading cost doubles; for the classic column look use a smaller `width`, for example 160 with 2); `palette` 2..256 colours as `0xRRGGBB` in display sRGB, or null for `levels` 2..256 per channel (default 32); `dither` `none`/`bayer2`/`bayer4`/`bayer8` (default `bayer4`); `ditherAmount` 0..1 (default 1); `lutSize` 8..64 (default 32) |
| Outputs | The scene's drawn frames. `RetroController`: `set(look)` (validated; `undefined` keeps a value, `palette: null` switches to levels, unknown keys throw; a refused change keeps the previous look), `enable(on)`, `stats()` (low-res size and texture bytes). Pure helpers: `resolveRetroLook`, `retroTargetSize`, `bayerMatrix`, `buildPaletteLut`, `nearestPaletteIndex`, `ditherThreshold`, `paletteSpread`, `retroReference` |
| How a frame is drawn | The scene renders to the canvas inside a low-res viewport, so tone mapping, output encoding, shadows and the light rig are the engine's own and the scene pass stays the frame's main pass. The corner is copied into a nearest-filtered texture (one GPU copy), and one full-screen triangle applies the dither and the palette lookup (a nearest 3D table; nearest colour by weighted sRGB distance, ties to the lowest index) or per-channel levels |
| Owner | The visit's `@kits/three` handle: the override, the lookup table, the dither texture and the frame copy are owned by the visit and disposed with it. The renderer, its size and pixel ratio stay the engine's |
| Bounds and cost | Per drawn frame: the scene shaded at the low resolution, one copy of the low-res corner and one extra draw of one triangle. Textures: low-res RGBA8 copy (320×180: 225 KiB), the lookup table (`lutSize`³ × 4 bytes; 32³: 128 KiB) and the dither matrix. Building the table is O(lutSize³ × palette) once per palette change, on the main thread: measured on a desktop CPU, 256 colours take about 16 ms at `lutSize` 32 and about 110 ms at the maximum 64 (expect several times longer on a phone), so set the palette at scene setup, not during play. The owned list does not grow with palette changes: replaced tables are disposed at once |
| Overload and failure | Malformed looks throw at definition (`sceneRetro`) or in `set` before anything changes. A scene in a game without `three()` gets no handle and draws normally (the three.js kit reports why) |
| Cancellation and recovery | `enable(false)` hands the draw back to the engine; the visit's end disposes everything. A throw during the draw restores the viewport and clearing before it propagates. Context loss is handled by the renderer pool like any override; re-upload of the table and textures after a loss is expected from three.js but untested |
| Interactions | The look replaces the scene's draw, so built-in `view.post` (bloom, vignette, grade) does not run on that scene, but its full-resolution target is still allocated and its programs compiled during preparation: remove `view.post` from a scene that uses the look (at 4K that target is about 62 MiB). HUD and DOM UI are unaffected. Picking, sockets and simulation are unaffected |
| Evidence | `look.test.ts` (5 tests): validation, low-res size and pixel aspect, Bayer matrices, the lookup table against a brute-force nearest colour, and the CPU reference (exact levels; dithered tiles averaging back to the input; two-colour dithering). `pass.test.ts` (4 tests): the override's draw sequence (low-res viewport, scene, copy, full viewport, triangle without clearing) at pixel ratios 1 and 2 and a buffer smaller than the look, palette rebuilds only on palette change with replaced tables disposed and no growth of the owned list, merge semantics of `set`, `enable`, state restored after a throw during the draw, and definition-time refusal. Browser: the showcase courtyard with the look, through `play:snap` (software GL, desktop and emulated phone viewports) and the GPU bench at 4K; an independent reviewer also compared the real shader with `retroReference` pixel by pixel in headless Chromium (software GL) over nine configurations (levels and palettes, every dither, LUT sizes 8–64, pixel ratios 1–2.625, pixel aspects 0.5 and 2) with zero mismatches, using an uncommitted harness; see [verification](../../../docs/verification/retro-look-20261010/README.md) |
| Limits | WebGL2 only (a `ShaderMaterial`; not ported to a WebGPU backend). The GPU pass is not compared pixel-for-pixel with the CPU reference in a browser. The palette lookup quantises in display sRGB with a fixed channel weighting; no error-diffusion dither. No phone, tablet or physical-device evidence; cost was measured only at the reference preset on one desktop GPU, GPU time was not measured, and no `quality:guard` comparison is recorded (STD-PRF-9 and STD-REN-24 evidence is incomplete); no per-preset knob. The dither origin is the bottom-left of the low-res image (as `retroReference` takes `x`, `y`); a scene cleared to transparent comes out opaque |
