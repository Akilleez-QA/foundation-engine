# Template: terrain

A small authored landscape (a ridge, a basin and a level pad) that the player moves over. The rendered ground and the ground the character stands on come from one surface, so they always agree. It is an engine diagnostic as much as a starting point.

```
npm run new-game -- --template terrain --id my-game --title "My game"
```

This README stays with the template; your copy lives in `game/` and `GAME.md`.

## What is in it

| File | What |
|---|---|
| `game/game.ts` | the game and the `terrain`, `character` and `camera` kits |
| `game/region.ts` | the landscape as data: grid size and spacing, `radial` hills and hollows, `noise`, and flat `pads` |
| `game/yard.ts` | the scene: terrain chunks, the player kept on the surface, pointer picking against the terrain |
| `game/chunks.ts`, `game/scatter.ts` | four terrain tiles with detail levels, and seeded rocks that avoid the pad |
| `game/revise.ts` | the revise action: raises a ridge patch and swaps render, contact and paths together |
| `game/yard.test.ts` | the criteria's tests |

## Controls

- Move: WASD or arrows, the left stick or d-pad, or hold a point on the terrain.
- Revise the terrain: R or gamepad Y.

The camera is fixed so the whole landscape stays in view.

## First steps

Draws are per rendered frame from `npm run play:snap -- --scene <id>` (software rendering, 1280×800) at 986d06b. Each visible `Shape` is about one draw.

| | |
|---|---|
| Scenes | `yard` (the only scene) |
| Tests | `node --import tsx --test game/yard.test.ts`: 7 tests |
| Playtest | none yet ([write one](../../docs/recipes/write-a-playtest-script.md)) |
| Draws (budget 10) | `yard`: 7 (terrain tiles, scattered rocks, the player and the pad marker) |

**First edit.** In `game/yard.ts`, in the `player` entity, replace `color: 0xf2c14e` with `color: 0xff7a45`. You should see an orange player standing on the pad. It still follows the ground when it moves, and the 7 tests still pass.

**Budget.** `yard` uses 7 of its 10 draws. More terrain tiles or another kind of scattered object cost draws, so check `npm run play:snap` after each.

## What to change first

1. `game/region.ts`: change the `layers` (a hill is `{ kind: 'radial', x, z, radius, height }`; a negative height is a hollow) and `pads` (flat areas).
2. `game/yard.ts`: the player's start and the marker on the pad.
3. Keep the tests green: S1 checks the character stays on the surface, S3 that picking hits the terrain.

## Limits

No slope limits, gravity, jumping, caves or rigid-body collision; a finite area, not streaming. See the [terrain kit README](../../src/kits/terrain/README.md).
