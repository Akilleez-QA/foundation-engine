# Template: arcade

A lane dodger: steer a ball, avoid falling blocks, score, game over, instant restart, best score saved.

```
npm run new-game -- --template arcade --id my-game --title "My game"
```

This README stays with the template; your copy lives in `game/` and `GAME.md`.

## What is in it

| File | What |
|---|---|
| `game/game.ts` | the game, the `ui` kit and every word on screen |
| `game/play.ts` | the one scene and its systems: `steer`, `spawn`, `fall`, `collide`, `again`, `show-hud` |
| `game/components.ts` | the `Hazard` component, the lane size, and the ball, block and lane prefabs |
| `game/steer.ts`, `game/restart.ts` | the two actions |
| `game/best.ts` | the saved best score (a save section; never rename its id) |
| `game/play.test.ts` | criteria S1, S2 and S4, and a same-seed replay check |
| `game/playtest/restart.json` | a scripted browser playtest |
| `game/playtest/best-reload.json` | a scripted browser playtest that reloads the page |

## Controls

- Steer: ← → or A D, the left stick or d-pad, or hold and drag on the view.
- Play again after a hit: Space, Enter, gamepad A, or a tap.

## First steps

Draws are per rendered frame from `npm run play:snap -- --scene <id>` (software rendering, 1280×800) at 986d06b. Each visible `Shape` is about one draw.

| | |
|---|---|
| Scenes | `play` (the only scene) |
| Tests | `node --import tsx --test game/play.test.ts`: 5 tests |
| Playtests | `npm run play:script -- game/playtest/restart.json` and `game/playtest/best-reload.json` |
| Draws (budget 10) | `play`: 3 at the start; each falling block adds one, and up to about six fall at once |

**First edit.** In `game/components.ts`, in the `ball` definition, replace `color: 0xffcc33` with `color: 0x66ddff`. You should see a cyan ball; steering, scoring and restart still work, and the 5 tests still pass.

**Budget.** With blocks falling, `play` peaks close to its 10 draws. A new always-visible entity (a second lane stripe, a scenery prop) costs one draw at every moment, so check `npm run play:snap` with blocks on screen, and see the [fix-budget skill](../../.claude/skills/fix-budget/SKILL.md) if it says OVER BUDGET.

## What to change first

1. `game/play.ts`, `spawn`: how often blocks appear and how fast they fall (`Math.min(12, 4 + time * 0.15)`).
2. `game/components.ts`: shapes, sizes and colours of the ball, blocks and lane.
3. `game/play.ts`, `collide`: what a hit does (it ends the run and saves the best score).
4. `game/game.ts`: the words. Add a test in `game/play.test.ts` for each rule you change.
