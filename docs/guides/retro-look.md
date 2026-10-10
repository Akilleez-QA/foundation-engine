# Retro look

Choose `@kits/retro` when a scene should look like it was drawn by an early software renderer: few, large (optionally
wide) pixels, a fixed palette and ordered dithering. It is an art-direction choice made per scene, built on
[`@kits/three`](../../src/kits/three/README.md); the [kit contract](../../src/kits/retro/README.md) lists inputs,
cost and evidence.

## Choose the existing owners

- Rendering: the look is a render override on the visit's renderer. Lights, shadows, environment and tone mapping
  are the engine's; the scene is drawn at the low resolution and then quantised. Built-in post does not run on a scene
  with the look.
- Palette: use colours you own. A palette of up to 256 colours becomes a lookup table once; changing it at run time
  rebuilds the table on the main thread, so prefer setting it once.
- Settings: the look is not a quality knob. To let players turn it off, keep a setting in a save section and call
  `enable` from the scene.
- Post: remove `view.post` from a scene with the look. The look replaces the draw, but a declared post still
  allocates its full-resolution target and compiles its programs.
- Budgets: the scene's draws gain one triangle draw, post draws drop to zero, and textures gain the low-res copy and
  the table. The gate measures the scene as usual.

## Evidence and limits

Headless tests of the arithmetic and the draw sequence, a software-GL screenshot and a GPU bench of the showcase
courtyard with the look. WebGL2 only. No phone, tablet or physical-device acceptance.
