---
name: art-direction
description: Make a scene look good with the engine's look features (palette, environment presets with gradient skies, haze, camera framing, low-poly forms from defineMesh, tone mapping, point and spot lights, shadows, baked light, scatter, generated textures, particles), then check the screenshots against the look checklist. Use when the author asks to make the game look better, prettier, nicer, more atmospheric or less like programmer art, or for a mood, a time of day or lighting.
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
3. **Light**: start from a preset (golden hour, overcast, moonlight, studio; each with a gradient `sky`) and adjust.
   Daylight: fill + key × sun height near 3; key to fill about 2 : 1; warm key, cool fill; a low sun from the side.
   Haze `color: 'sky'`.
4. **Haze**: `near` just past the play area seen from the camera, `far` before the ground ends.
5. **Camera**: a lower pitch and a longer distance than top-down; the scene's `view.camera` set to the pose the camera
   system settles on.
   **Phone framing** (recipe section 4, "Phone framing"): on 390×844 a `minWidthFov` of 55 widens the vertical view
   to about 97°, so a 1.5 m player at distance 16 is only about 35 px tall. Aim for the player at least 48 px and each
   pickup at least 24 px: on portrait, bring the camera closer and raise the pitch with the camera kit's per-frame
   `options` (`options: ctx => (ctx.view.aspect < 1 ? {distance: 10, pitch: 0.9} : {})`), lower `minWidthFov` when
   the whole play area need not show at once, or scale the subject up. Fill the top (a steeper pitch keeps the horizon
   near the top edge; tall things behind the play area; a sky with discs or stars) and the bottom (a path, hedge or
   rocks in front of the play area). Check the phone picture of `play:snap --mobile` for those sizes and for a top and
   bottom quarter that are more than flat sky or bare ground.
6. **Forms**: replace boxes with `rock`, `tree`, `prism`, `ring`, `box`, `roof` from `forms.ts`, all baked into one
   `Mesh` per scenery group. Keep `Solid`/`Walls` for collision.
7. **Lights and shadows** (recipe section 6): the environment holds the darkness (dim ambient, palette colours left
   alone); `PointLight`/`SpotLight` for lamps near the action (`sceneLights`; `low` admits 2 per kind); `bakeLight`
   with a white ambient for the rest (a faint glow round every lamp, windows, water); **one** shadowed light (the sun
   or night key, `sceneShadows()`): a 2048 map is about 32 MiB of textures, a shadowed point light about 6 extra passes
   and 18 draws, so on phones bake or leave fills unshadowed, or use contact darkening and a shadow disc instead. Tone
   mapping `'aces'` once there are point lights. Keep `emissiveIntensity` about 1: 2 to 6 washes out to white under
   tone mapping and clips without it; every glow needs something lit beside it.
   **Craft** (recipe section 6, "Four common misses"): flat sides: key light 45 to 135 degrees round from the camera
   seen from above, two-colour ambient, 6 or more sides on round forms, `k: 0.8` on faces away from the key. Faint
   shadows: the key's share on the ground (`intensity × sun height`) at least the ambient intensity, a tight
   `shadow.extent`, and a shadow disc under floating things. A glow that lights nothing: a `PointLight` on the glowing
   entity, `essential: true` on the one or two that matter (`low` admits 2 per kind), and a `bakeLight` pool under each
   for when its light is refused. `bakeLight` is per vertex and multiplies the vertex colour: a ground needs grid cells
   no larger than about a third of the pool's `range`, and a near-black colour stays black.
8. **Repeated things** (moss, grass, pickets, hedge blobs) are one `defineScatter` of a small mesh (`blobMesh`), with
   `essential: true` where gaps would show.
9. **Textures** for doors, crates and floors on `Shape`s, painted by a `game/tools/` script (`png(name, size, paint)`).
10. **Particles** for life: one or two slow emitters; decorative motion stops under Calm. Step time is the `dt` in
    `run(ctx, dt)` (there is no `ctx.time.dt`); `ctx.time.t` is seconds since the visit began.

## The look checklist (run it on the desktop and phone pictures)

1. The subject reads in under a second.
2. Foreground, middle and background differ in brightness (squint).
3. No placeholder colours: everything from the palette.
4. Solid things show a lit and a shaded side.
5. Things sit on the ground: contact darkening or a shadow disc; nothing floats.
6. Every glowing thing lights something.
7. The world's edge is hidden by haze or framing.
8. The phone view works: play area fits, empty space filled, HUD covers nothing important, dark setups readable.
9. Within budget: draws, triangles and texture memory (shadow maps) against `budgets.json`; static scenery baked,
   repeated things scattered.
10. Calm motion: no flicker; decoration stops under Calm.

Report: before and after pictures, what changed, the checklist result, draws, triangles and texture memory against the
budget. The engine has tone mapping, point and spot lights, shadows, gradient skies, exp2 haze, post-processing (bloom,
vignette, grade with an optional `.cube` lookup table, an HDR `ceiling` against bloom fireflies: `view.post`,
docs/guides/post-processing.md), AgX tone mapping (`view.output: {toneMapping: 'agx'}`, kinder to saturated night lamps), `Material` on a `Mesh` and instanced scatter. Bloom is
built in: use `view.post`, never `@kits/three`, for it. Not available yet (say so instead of promising it): textures on
a `Mesh`, per-copy scatter motion, scattering a `Model`. The recipe's last table lists today's workaround. When the
author agrees the look needs more (a post pass beyond the built-in tiers, a custom shader, a loader), a game can opt
into `@kits/three`; the game owns that code across three.js upgrades: docs/recipes/use-three-directly.md.

**Reusing the showcase for another game** (recipe, "Making a different game from the showcase"): renaming or removing a
palette key breaks `forms.test.ts` and the other files that use it (change values freely; rename in every user; keep
the `bakeLight` test's light warm); delete the courtyard, garden, embers and texture files together once your scene
replaces them, and fix the brief's `by:` files and the budget rows; the copied budgets note's `showcase/` prefix is
wrong for `game/` (keys have no prefix); the template's budgets are your starting budgets, so a redesigned kept scene
that needs more is a raise with a `Perf-Budget:` line anywhere in the commit message, agreed with the author.
