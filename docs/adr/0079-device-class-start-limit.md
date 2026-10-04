# ADR 0079: a constrained mobile GPU starts on a lighter preset

- **Status:** Accepted
- **Date:** 2026-10-03
- **Area:** Quality
- **Amends:** [ADR 0070](0070-device-runtime-diagnostics.md) ("resource constraints continue to produce a lighter
  suggestion rather than silently lowering quality") for one device class only.

## Context

Local lights (VIS-02) and shadows (VIS-03) made the start preset matter on phones. `high` gives 8 local-light slots
per kind and 2 shadowed local lights; `reference` gives 16 and 4. A shadowed point light renders six shadow faces,
and on a measured 10-object fixture each one added about 18 off-screen draws and 6 framebuffer binds per moved
frame. Four shadowed point lights reached 92 draws in that scene. These numbers come from software GL in headless
Chromium (POODO observation of 2026-10-03), so they show the shape of the cost, not phone milliseconds.

Before this ADR no device started on `low`:

- A direct `createQuality` caller with no authored preset ran `detectPreset`, which returned `high` for a 2 GB
  Mali-G52 phone and for a 4 GB Adreno 740 phone. Weak signals produced only a suggestion.
- An application composed by `layerModules` always passed `brief.quality.tier` as the authored start, and
  `defineBuild` defaults that tier to `reference`. No template declares a tier, so every template started every
  device, phones included, on `reference`. Detection never ran.

## Decision

`deviceClassCap(signals)` in `src/platform/render/quality.ts` returns a start limit for a constrained mobile GPU:

| Signals | Start limit |
|---|---|
| Renderer string from a mobile GPU family (`Mali`, `Immortalis`, `Adreno`, `PowerVR`, `Xclipse`, `Maleoon`) and any of: an entry-level mobile GPU (Mali-4xx, T6xx-T8xx, G3x, G5x; Adreno 3xx-5xx, 60x-61x; PowerVR), `deviceMemory` of 2 GB or less, a texture limit under 4096 | `low` |
| Mobile GPU family and any of: `deviceMemory` of 4 GB or less, 4 or fewer cores, data saver | `medium` |
| Mobile GPU family otherwise (for example an 8 GB Adreno 740 or a Mali-G710) | no limit |
| Any other renderer string, software GL, an unreported GPU, or `Apple GPU` | no limit |

The limit only lowers a start; it never raises one. It applies to two start paths:

1. `detectPreset` (a direct factory caller without an authored preset) starts at the limit and saves it as the
   detection, with the reasons, as before.
2. An application whose brief does **not** declare `quality.tier` (`BuildBrief.quality.tierDeclared === false`) starts
   at the limit when it is below the authored default. That start is reported with source `detected` and the reasons
   (so the Graphics screen can say why), and stays **unsaved** like the authored default, so a later brief change
   still applies. To spare desktops a throwaway WebGL context, the probe is skipped when the browser reports 8 GB
   and more than 4 cores (`mayBeLimited`).

Precedence is unchanged at the top: a verification pin, then the player's saved choice, then a tier the creator
declared in the brief. None of them is ever limited.

Signals not used:

- **Pointer and touch.** ADR 0070 stands: input capability selects nothing. A Mali Chromebook without touch starts
  the same as a Mali phone.
- **Screen size.** STD-RUN-42: a small viewport does not imply a weak GPU, and a desktop window can be small.
- **`Apple GPU`.** Safari reports that string on iPhones and on Macs alike, and reports no `deviceMemory`, so an
  iPhone-class device cannot be told apart from a Mac. It keeps its authored start (a documented gap).

## Consequences

- Phones and Android tablets with a constrained mobile GPU start lighter: a 2 GB Mali-G52 starts on `low` (2 light
  slots per kind, no shadowed local lights, pixel ratio 1, scale 0.85, 30 fps cap); a 4 GB Adreno 740 starts on
  `medium` (4 slots, 1 shadowed light, pixel ratio 1.5, 60 fps cap). This is an intentional tradeoff recorded in
  [DEVICE-EXPERIENCE.md](../policy/DEVICE-EXPERIENCE.md): first-run cost falls on those devices at the price of
  first-run image quality. Content floors are untouched; `low` is a preset, not a content change (STD-SET-10).
- Desktops, software GL, unreported GPUs, iPhone-class devices and capable phones start exactly as before.
- Gates, benches and automated browsers never probe (`navigator.webdriver`, pinned `?quality=`), so no gate number
  moves.
- A creator who wants every device to start on a tier declares it (`quality: {tier: 'reference'}`); the player can
  always pick any preset.
- Saved choices, including earlier detections, are never re-probed or rewritten.

## Acceptance

- Unit tests over representative signals: 2 GB Mali-G52 → `low`; 4 GB Adreno 740 → `medium`; 8 GB Adreno 740 →
  unchanged; iPhone-class (`Apple GPU`, no memory) → unchanged; desktop RTX, Intel HD, VideoCore, SwiftShader and an
  unreported GPU → unchanged; a declared tier, a saved choice and a pin each win over the limit.
- **Not verified:** physical phones. The renderer strings come from vendor naming; the cost the limit avoids was
  measured only on software GL. A device that reports a mobile GPU string under another vendor name is not limited.
