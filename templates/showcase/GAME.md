# Lantern Courtyard (showcase template)

<!-- The brief (game/build.brief.ts) is the contract; this block mirrors it. Change the brief first, then this block,
     then add a changelog row. Budgets are re-derived from the brief and only fall without a Perf-Budget trailer. -->

## Brief

| | |
|---|---|
| **Goal** | Show how good a small game can look with the author API alone: palette, light presets, haze, camera, low-poly forms, baked light, textures and particles. |
| **Pitch** | A lantern-lit courtyard at night with six embers to find, and a garden through the gate whose sundial turns the light. |
| **Audience** | Neutral (`kids: false`); policy `default` |
| **Genre** | showcase |
| **Core loop** | walk around the courtyard → walk into an ember to take it → go through the gate to the garden → turn the sundial to change the light |
| **Devices** | targets desktop, laptop, tablet, phone; minimum **phone**; input keyboard, pointer, touch, gamepad |
| **Performance** | 60 fps; per scene at most 100 draws, 150 000 triangles (phone tier); measured budgets in `game/budgets.json` |
| **Modes** | play |

### Success criteria

| Id | Check | How |
|---|---|---|
| S1 | holding up moves the player away from the camera and the courtyard walls stop them | test: `game/courtyard.test.ts` |
| S2 | walking into an ember takes it, counts it and remembers it after a reload | test: `game/courtyard.test.ts` |
| S3 | the gate leads to the garden, and using the sundial moves the garden to the next light preset | test: `game/garden.test.ts` |
| S4 | both scenes pass the art-direction look checklist on play:snap's desktop and phone pictures | manual |
| S5 | both scenes stay inside their budgets.json counts on the gate | gate |

## What is in it

| File | What |
|---|---|
| `game/look.ts` | the palette and the environment presets (golden hour, overcast, moonlight, studio, and the lantern night) |
| `game/forms.ts` | low-poly builders (rock, tree, crystal, prism, ring, box, roof, ground) that bake into one `Mesh`, and `bakeLight` |
| `game/courtyard.ts`, `game/courtyard-scenery.ts` | the night courtyard: point-lit lanterns, a shadowed night light, moss scatter, the fountain, embers |
| `game/garden.ts`, `game/garden-scenery.ts` | the garden in daylight, and the sundial that cycles the presets |
| `game/world.ts` | the player and its following parts, drifting motes, the shared systems |
| `game/embers.ts` | the save section of taken embers |
| `game/tools/generate-textures.mjs` | paints the plank and crate textures into `game/public/textures/showcase/` |

## Milestones

1. **Vertical slice**: two scenes, six embers, a gate each way, the sundial; tests and budgets pass the gate. *(done)*
2. Your own look: change the palette and the presets in `game/look.ts`, then your own forms.

## Changelog

| Date | Change | Budgets |
|---|---|---|
| 2026-10-03 | Template created from the courtyard trial, built with the author API only (no engine change) | `courtyard` and `garden` measured on software GL |
| 2026-10-04 | The courtyard uses the engine's own lights: eight lanterns are point lights (the stonework keeps only a faint baked glow, the water and the windows), the cold night key light casts shadows, a gradient sky with a moon disc and stars and exp2 haze, ACES tone mapping, bloom with a vignette and grade (`view.post`), moss as one scatter. The stonework is two meshes: a ground that casts no shadow and the standing walls that do. The garden's presets gain gradient skies. | **Raised** courtyard draws 40 → 46, triangles 20 000 → 31 000, textureMiB 8 → 47 (measured 41, 27 860, 42.5 MiB: the shadow pass, the 2048 shadow map and the post targets); new postDraws row 10 (1 medium, 0 low); garden unchanged (10 draws, 9 676 triangles) |
