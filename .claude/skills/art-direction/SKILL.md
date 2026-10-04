---
name: art-direction
description: Make a scene look good with what the engine already has (palette, environment presets, haze, camera framing, low-poly forms from defineMesh, baked light, generated textures, particles), then check the screenshots against the look checklist. Use when the author asks to make the game look better, prettier, nicer, more atmospheric or less like programmer art, or for a mood, a time of day or lighting.
---

# Art direction

The recipe is [docs/recipes/art-direction.md](../../../docs/recipes/art-direction.md); the `showcase` template is its
worked example (`templates/showcase/game/look.ts` for the palette and presets, `forms.ts` for the builders). Copy
`look.ts` and `forms.ts` into `game/` when the game does not have them yet.

Work in small rounds. Each ends with `npm run check`, `npm run play:snap -- --scene <id> --mobile`, a look at both
pictures yourself, and the checklist below.

1. **One sentence**: time of day, mood, two or three hues. Agree it with the author if the brief does not say.
2. **Palette** in `game/look.ts`: a few hues with a light and a dark step, one warm accent. Replace every loose colour
   in scenes with a palette entry. No pure primaries, no default grey.
3. **Light**: start from a preset (golden hour, overcast, moonlight, studio) and adjust. Daylight: fill + key × sun
   height near 3; key to fill about 2 : 1; warm key, cool fill; a low sun from the side. Haze colour = background.
4. **Haze**: `near` just past the play area seen from the camera, `far` before the ground ends.
5. **Camera**: a lower pitch and a longer distance than top-down; the scene's `view.camera` set to the pose the camera
   system settles on; fill a phone's extra height with something worth seeing.
6. **Forms**: replace boxes with `rock`, `tree`, `prism`, `ring`, `box`, `roof` from `forms.ts`, all baked into one
   `Mesh` per scenery group. Keep `Solid`/`Walls` for collision.
7. **Shadows and light**: contact darkening in ground colours, a see-through disc under moving things, `bakeLight` for
   lanterns, windows and anything that glows (glows need something lit beside them; keep `emissiveIntensity` near 1).
8. **Textures** for doors, crates and floors on `Shape`s, painted by a `game/tools/` script (`png(name, size, paint)`).
9. **Particles** for life: one or two slow emitters; decorative motion stops under Calm.

## The look checklist (run it on the desktop and phone pictures)

1. The subject reads in under a second.
2. Foreground, middle and background differ in brightness (squint).
3. No placeholder colours: everything from the palette.
4. Solid things show a lit and a shaded side.
5. Things sit on the ground: contact darkening or a shadow disc; nothing floats.
6. Every glowing thing lights something.
7. The world's edge is hidden by haze or framing.
8. The phone view works: play area fits, empty space filled, HUD covers nothing important, dark setups readable.
9. Within budget: draws and triangles from the snap against `budgets.json`; static scenery baked.
10. Calm motion: no flicker; decoration stops under Calm.

Report: before and after pictures, what changed, the checklist result, draws and triangles against the budget. Not
available yet in the engine (say so instead of promising them): local lights, cast shadows, tone mapping and bloom,
a gradient sky, instancing, a material on a `Mesh`. The recipe's last table lists today's workaround for each.
