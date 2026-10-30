# Template: showcase

A lantern-lit courtyard at night and a garden in daylight, made to look good with the author API alone: a limited
palette, environment presets with gradient skies, haze, a framed camera, low-poly forms baked into one mesh each,
lanterns that are point lights, one shadowed night light, tone mapping and bloom, a scatter of moss, light baked into vertex
colours where a real light is not worth its cost, generated textures and particles. Find the six embers; turn the
garden's sundial to see the same garden under each light preset.

```
npm run new-game -- --template showcase --id my-game --title "My game"
```

This README stays with the template; your copy lives in `game/` and `GAME.md`. The techniques, with before and after
pictures, are in the [art-direction recipe](../../docs/recipes/art-direction.md).

## What is in it

| File | What |
|---|---|
| `game/look.ts` | the palette and the light presets: change the whole look here |
| `game/forms.ts` | low-poly builders that add faceted triangles to a bake, `bakeLight`, `toMesh` (one draw per bake) and `blobMesh` (for scatters) |
| `game/courtyard.ts`, `game/courtyard-scenery.ts` | the night courtyard: point-lit lanterns, a shadowed night light, a ground mesh and a standing mesh, moss scatter, fountain, embers |
| `game/garden.ts`, `game/garden-scenery.ts` | the garden: ground with contact shadows, hedges, shed, trees beyond the haze, the sundial |
| `game/world.ts` | the player (body, head, hat, shadow), motes, and every scene's systems |
| `game/embers.ts` | which embers are taken (a save section) |
| `game/tools/generate-textures.mjs` | writes the plank and crate textures (run with `node game/tools/generate-textures.mjs`) |

## Controls

- Move: WASD or arrows, the left stick or d-pad, or hold a point on the ground.
- Take an ember: walk into it.
- Use the gate or the sundial: E, Enter, Space, gamepad A, or a tap.

## First steps

Draws are per rendered frame from `npm run play:snap -- --scene <id>` (software rendering, 1280×800) at the look update. A baked mesh is one draw however many forms it holds.

| | |
|---|---|
| Scenes | `courtyard` (first), `garden` |
| Tests | `node --import tsx --test game/*.test.ts`: 11 tests in three files |
| Playtest | none ([write one](../../docs/recipes/write-a-playtest-script.md)) |
| Draws | `courtyard`: 41 of 46 (the shadow pass counts) plus 10 post passes; `garden`: **10 of 10, at its budget** |

**First edit.** In `game/world.ts`, in `player`, change the hat (the `cone` shape) from `color: P.roof` to `color: P.accent`. You should see a yellow hat on the player in the courtyard, and the 11 tests still pass. To recolour lantern light, edit `palette.lantern` in `game/look.ts`, but keep it warm: `game/forms.test.ts` checks that baked light warms the stone.

**The garden is at its draw budget.** One more separate visible entity in the garden makes `npm run play:snap` report OVER BUDGET. Add new scenery to an existing bake in `game/garden-scenery.ts` instead (one draw for all of it), or follow the [fix-budget skill](../../.claude/skills/fix-budget/SKILL.md). Raising the budget is the author's decision; it needs a `Perf-Budget:` commit trailer ([add a budget](../../docs/recipes/add-a-budget.md)).

## What to change first

1. `game/look.ts`: the palette, then a preset's sun, fill and haze.
2. `game/courtyard-scenery.ts`: move `POSTS` (the lanterns); their point lights follow, and the faint baked glow is rebuilt with the mesh.
3. `game/forms.ts`: a new form (a well, a cart) built from `prism`, `box` and `rock`.

## Limits

- The courtyard draws one 2048 shadow map (about 32 MiB of textures at the reference preset) and eight point lights;
  on the `low` preset only two lanterns get a light slot, and the faint glow baked into the stone keeps the others
  from lighting nothing.
- Bloom, vignette and grade come from `view.post`: 10 fullscreen passes at the `full` tier, 1 at `basic`, none on
  `low`; the post targets add about 10 MiB of textures. Glass keeps its emissive near 1 and the bloom threshold is
  below 1, so the halo comes from the bloom, not from a washed-out glow.
- Baked light is fixed: moving a lantern means rebuilding the mesh (its point light moves on its own).
