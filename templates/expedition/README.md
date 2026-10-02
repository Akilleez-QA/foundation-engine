# Template: expedition

A guided survey over small terrain: read a briefing, follow routes to three stations, earn a badge once, then survey, collect and craft. It is the integration example for many optional kits (navigation, objectives, dialogue, inventory, resources, equipment, capabilities, audio mixer, space, terrain), so it is larger than the other templates. For a first game, `blank`, `arcade` or `explorer` are easier to reshape.

```
npm run new-game -- --template expedition --id my-game --title "My game"
```

This README stays with the template; your copy lives in `game/` and `GAME.md`.

## What is in it

| File | What |
|---|---|
| `game/game.ts` | the game, its kits, and every word |
| `game/field.ts` | the main scene: terrain, station positions, route planning and following, the action panel |
| `game/session.ts` | the briefing dialogue, objective and inventory options, and the saved session |
| `game/resources-station.ts` | the survey, collect and craft steps after the badge |
| `game/shelter.ts`, `game/shelter.body.mts` | a second scene whose ground is prepared before it opens |
| `game/doorway.ts` | a doorway portal that routes cross, with a bounded preparation allowance |
| `game/next.ts`, `game/cancel.ts` | the two actions |
| `game/*.test.ts` | the criteria's tests |

## Controls

- Continue: the action button at the bottom, Enter or Space, or gamepad A.
- Stop moving: the Stop button, Escape, or gamepad B.
- In the briefing, *Guided pace* chooses slower movement.

## What to change first

1. `game/game.ts`: the words of the briefing and progress messages.
2. `game/field.ts`: `stations` (where the three stops are) and the `surface` layers.
3. Read `GAME.md` and `UPGRADE-STATUS.md` before changing the save sections or the reward logic: they record what each guarantee covers.
