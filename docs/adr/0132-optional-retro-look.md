# ADR 0132: optional retro software-raster look

- Status: Proposed for this implementation; integration is gated by full CI.
- Date: 2026-10-10
- Area: Optional kits / Rendering

## Context

Early software renderers had a recognisable look: low resolution, sometimes wide pixels from column-based drawing, a
fixed palette and ordered dithering. Creators want it as an art direction. Rasterising on the CPU in the browser
would be slow and would bypass the engine's lights, shadows and budgets; the look itself can be reproduced on the GPU.

## Decision

Add `@kits/retro`, requiring `@kits/three`: a render override that draws the scene into a low-resolution viewport of
the canvas (keeping the engine's tone mapping, output encoding and main-pass accounting), copies it into a texture,
and draws one full-screen triangle that applies an ordered Bayer dither and quantises to a creator palette through a
nearest 3D lookup table, or to per-channel levels. A CPU reference of the same arithmetic is exported and tested.
The look is per scene, creator chosen and not a quality knob.

## Alternatives and consequences

A true CPU column renderer would need its own geometry pipeline and would ignore the engine's materials and budgets.
An off-screen render target was tried first; the bench counts off-screen bursts as shadow passes, which pushed the
scene over its shadow budgets, so the viewport-and-copy path is used. A post-pass inside the engine's built-in post
would be an engine change; as a kit it stays optional. The look replaces built-in post on its scene, is WebGL2 only,
and quantises in display sRGB.

## Evidence

Nine headless tests (reference arithmetic, lookup table against brute force, draw sequence, ownership, state
restoration), software-GL screenshots of the showcase courtyard (desktop and emulated phone), a GPU bench at 4K and an
independent pixel-by-pixel comparison of the shader with the reference in software GL (zero mismatches over nine
configurations), recorded in the verification folder. No quality-guard comparison, GPU time, phone or physical-device
evidence. A scene using the look should drop `view.post`, whose target is still allocated.
