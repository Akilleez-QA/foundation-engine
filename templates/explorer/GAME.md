# Garden (explorer template)

<!-- The brief (game/build.brief.ts) is the contract; this block mirrors it. Change the brief first, then this block,
     then add a changelog row. Budgets are re-derived from the brief and only fall without a Perf-Budget trailer. -->

## Brief

| | |
|---|---|
| **Goal** | A small explorable world: walk around, use things, go through a door into another scene and back. |
| **Pitch** | A garden and a shed. Find the three things you can use: the bench, the lamp and the crate. |
| **Audience** | Neutral (`kids: false`); policy `default` |
| **Genre** | explorer |
| **Core loop** | move around → walk up to something and see its prompt → use it → go through the door to the next scene |
| **Devices** | targets desktop, laptop, tablet, phone; minimum **phone**; input keyboard, pointer, touch, gamepad |
| **Performance** | 60 fps; per scene at most 100 draws, 150 000 triangles (phone tier); measured budgets in `game/budgets.json` |
| **Modes** | play |

### Success criteria

| Id | Check | How |
|---|---|---|
| S1 | holding up moves the player away from the camera and the garden walls stop them | test: `game/garden.test.ts` |
| S2 | standing by the bench shows its prompt and using it counts one of three things | test: `game/garden.test.ts` |
| S3 | the shed door leads into the shed and its door back arrives beside the garden door | playtest: `game/playtest/door.json` |
| S4 | using all three things shows the found-everything banner, and it stays after a reload | test: `game/garden.test.ts` |
| S5 | both scenes stay inside their budgets.json counts on the gate | gate |

## What is in it

| File | What |
|---|---|
| `game/game.ts` | `defineGame` with the `ui`, `camera`, `character` and `explore` kits, and the English strings |
| `game/garden.ts` | the garden: hedges (`Solid`), the shed and its door, the bench, the lamp and the `lamp-switch` system |
| `game/shed.ts` | the shed: the crate and the door back |
| `game/world.ts` | the player prefab, the list of things to find, the shared systems (move, interact, orbit camera, HUD) |
| `game/playtest/door.json` | S3 in a real browser: through the door and back |

Controls: WASD or arrows, the left stick or d-pad; on touch or with a mouse, hold where you want to go. Use things with E, Enter, Space, pad A or a tap.

## Milestones

1. **Vertical slice**: two scenes, three things, a door each way, progress saved; tests, playtest and budgets pass the gate. *(done)*
2. Replace the primitives with the game's own models (`defineAsset`), keeping each scene under its budget.
3. Add the game's own reason to explore: what using each thing changes.

## Changelog

| Date | Change | Budgets |
|---|---|---|
| 2026-09-28 | Template created | `garden` and `shed` measured on software GL |
| 2026-10-02 | The scripted playtest moved into the game folder (`game/playtest/`), so `npm run new-game` copies it with the game instead of into the engine's root `playtest/`; the success criterion's `by` names the new path. Same script, same check. | Unchanged |
| 2026-10-02 | Polish (ui kit): HUD lines and the use prompt sit on a translucent dark plate, so "Found 0 of 3" stays readable over the light sky on a phone. Evidence: emulated SwiftShader play:snap at 1280×800 and 390×844, screenshots inspected; physical devices unverified. | Unchanged |
