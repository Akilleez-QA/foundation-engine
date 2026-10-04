# Template: showcase

A lantern-lit courtyard at night and a garden in daylight, made to look good with the author API alone: a limited
palette, environment presets, haze, a framed camera, low-poly forms baked into one mesh each, lantern light baked into
vertex colours, generated textures and particles. Find the six embers; turn the garden's sundial to see the same garden
under each light preset.

```
npm run new-game -- --template showcase --id my-game --title "My game"
```

This README stays with the template; your copy lives in `game/` and `GAME.md`. The techniques, with before and after
pictures, are in the [art-direction recipe](../../docs/recipes/art-direction.md).

## What is in it

| File | What |
|---|---|
| `game/look.ts` | the palette and the light presets: change the whole look here |
| `game/forms.ts` | low-poly builders that add faceted triangles to a bake, `bakeLight`, and `toMesh` (one draw per bake) |
| `game/courtyard.ts`, `game/courtyard-scenery.ts` | the night courtyard: stonework with baked lantern light, glowing glass, fountain, embers |
| `game/garden.ts`, `game/garden-scenery.ts` | the garden: ground with contact shadows, hedges, shed, trees beyond the haze, the sundial |
| `game/world.ts` | the player (body, head, hat, shadow), motes, and every scene's systems |
| `game/embers.ts` | which embers are taken (a save section) |
| `game/tools/generate-textures.mjs` | writes the plank and crate textures (run with `node game/tools/generate-textures.mjs`) |

## Controls

- Move: WASD or arrows, the left stick or d-pad, or hold a point on the ground.
- Take an ember: walk into it.
- Use the gate or the sundial: E, Enter, Space, gamepad A, or a tap.

## What to change first

1. `game/look.ts`: the palette, then a preset's sun, fill and haze.
2. `game/courtyard-scenery.ts`: move `POSTS` (the lanterns) and watch the baked light follow.
3. `game/forms.ts`: a new form (a well, a cart) built from `prism`, `box` and `rock`.

## Limits

The engine has no local lights, cast shadows, tone mapping or bloom yet. The courtyard fakes them: lantern light is baked
into the stonework's vertex colours (it does not light the player or the embers), the player's shadow is a see-through
disc, and glass glows with an emissive material. Baked light is fixed: moving a lantern means rebuilding the mesh.
