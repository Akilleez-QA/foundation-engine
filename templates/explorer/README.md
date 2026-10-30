# Template: explorer

Two areas to move around in (a garden and a shed), things to use, a door between them, and remembered progress.

```
npm run new-game -- --template explorer --id my-game --title "My game"
```

This README stays with the template; your copy lives in `game/` and `GAME.md`.

## What is in it

| File | What |
|---|---|
| `game/game.ts` | the game, the `ui`, `camera`, `character` and `explore` kits, and the words |
| `game/garden.ts`, `game/shed.ts` | the two scenes: ground, `Walls`, `Solid` obstacles, `Interactable` things and doors |
| `game/world.ts` | shared parts: the player, the list of things to find, the HUD, and every scene's systems |
| `game/look.ts`, `game/forms.ts`, `game/*-scenery.ts` | the palette and light, low-poly builders, and each scene's scenery baked into one mesh ([art direction](../../docs/recipes/art-direction.md)) |
| `game/garden.test.ts` | the criteria's tests |
| `game/playtest/door.json` | a scripted browser playtest through the door |

## Controls

- Move: WASD or arrows, the left stick or d-pad, or hold a point on the ground.
- Use the nearest thing (or go through a door): E, Enter, Space, gamepad A, or a tap.

## First steps

Draws are per rendered frame from `npm run play:snap -- --scene <id>` (software rendering, 1280×800) at 986d06b. Each visible `Shape` is about one draw.

| | |
|---|---|
| Scenes | `garden` (first), `shed` |
| Tests | `node --import tsx --test game/garden.test.ts`: 3 tests |
| Playtest | `npm run play:script -- game/playtest/door.json` |
| Draws (budget 10 each) | `garden`: **10, at its budget**; `shed`: 5 |

**First edit.** In `game/garden.ts`, find the bench (the `Interactable` with `id: 'bench'`) and replace `color: 0xb08a5a` with `color: 0xd2453a`. You should see a red bench; walking to it and pressing E still counts it, and the 3 tests still pass. Recolouring or moving an entity costs no draws.

**The garden is at its draw budget.** The ground, three hedges, the shed and its door, the bench, the lamp post, the lamp and the player are 10 draws, and the budget is 10. One more visible entity in `garden.ts` makes `npm run play:snap` report `OVER BUDGET (draws 11 > 10 …)` and fail. To add something to the garden, first make room: replace or remove an entity instead of adding one, or put the new thing in the shed (5 of 10). The [fix-budget skill](../../.claude/skills/fix-budget/SKILL.md) lists the recoveries in order (simplify, instance, bake, LOD). Raising the garden's budget is the author's decision; it needs a `Perf-Budget:` commit trailer ([add a budget](../../docs/recipes/add-a-budget.md)).

## What to change first

1. `game/garden.ts`: move, recolour or add entities; an `Interactable({ id, label })` becomes usable, and adding `to: '<scene>'` makes it a door.
2. `game/world.ts`: `THINGS` lists what counts towards "Found n of total".
3. A new area: `npm run new -- area <id>`, then a door to it with `npm run new -- interactable <id> --door <scene>`.
4. The camera: `cameraSystem('orbit', …)` in `game/world.ts` ([camera and lighting](../../docs/recipes/camera-and-lighting.md)).
