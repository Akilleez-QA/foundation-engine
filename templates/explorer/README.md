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
| `game/garden.test.ts` | the criteria's tests |
| `game/playtest/door.json` | a scripted browser playtest through the door |

## Controls

- Move: WASD or arrows, the left stick or d-pad, or hold a point on the ground.
- Use the nearest thing (or go through a door): E, Enter, Space, gamepad A, or a tap.

## What to change first

1. `game/garden.ts`: move, recolour or add entities; an `Interactable({ id, label })` becomes usable, and adding `to: '<scene>'` makes it a door.
2. `game/world.ts`: `THINGS` lists what counts towards "Found n of total".
3. A new area: `npm run new -- area <id>`, then a door to it with `npm run new -- interactable <id> --door <scene>`.
4. The camera: `cameraSystem('orbit', …)` in `game/world.ts` ([camera and lighting](../../docs/recipes/camera-and-lighting.md)).
