# Dodge (arcade template)

<!-- The brief (game/build.brief.ts) is the contract; this block mirrors it. Change the brief first, then this block,
     then add a changelog row. Budgets are re-derived from the brief and only fall without a Perf-Budget trailer. -->

## Brief

| | |
|---|---|
| **Goal** | A small 3D arcade game with a score, a fail state and an instant restart. |
| **Pitch** | Blocks rain down a lane; steer the ball left and right to dodge them for as long as you can. |
| **Audience** | Neutral (`kids: false`); policy `default` |
| **Genre** | arcade |
| **Core loop** | steer to dodge → a point per block that passes → get hit, see score and best → restart at once |
| **Devices** | targets desktop, laptop, tablet, phone; minimum **phone**; input keyboard, pointer, touch, gamepad |
| **Performance** | 60 fps; per scene at most 100 draws, 150 000 triangles (phone tier); measured budget in `game/budgets.json` |
| **Modes** | play |

### Success criteria

| Id | Check | How |
|---|---|---|
| S1 | steering right moves the ball right and stops at the lane edge | test: `game/play.test.ts` |
| S2 | a block that reaches the ball ends the run and shows the game-over banner | test: `game/play.test.ts` |
| S3 | the restart action after game over starts a fresh run with score zero | playtest: `game/playtest/restart.json` |
| S4 | the best score survives a restart and a reload (save section `run.best`) | test: `game/play.test.ts` |
| S5 | the play scene stays inside its budgets.json counts on the gate | gate |

## What is in it

| File | What |
|---|---|
| `game/game.ts` | `defineGame` with the `ui` kit and the English strings |
| `game/play.ts` | the scene and its systems: `steer`, `spawn`, `fall`, `collide`, `again`, `show-hud` |
| `game/components.ts` | `Hazard`, the lane size, the `ball`, `block` and `lane` prefabs |
| `game/steer.ts`, `game/restart.ts` | the inputs: a steer axis (arrows, A/D, stick, d-pad; drag on touch) and play again (Space, Enter, A, tap) |
| `game/best.ts` | save section `run.best` (maximum score, runs) |
| `game/playtest/restart.json` | S3 in a real browser: get hit, restart, check the fresh run |
| `game/playtest/best-reload.json` | S4 in a real browser: get hit, reload the page, check the best score is still there |

Controls: ← → or A D, the left stick or d-pad; on touch or with a mouse, hold and drag. Randomness is `ctx.random()`, so `?seed=5` replays a run.

## Milestones

1. **Vertical slice**: dodge, score, fail, restart, best score; tests, playtest and budget pass the gate. *(done)*
2. Feel: a short hit pause, a camera shake that respects Calm, a sound for each point.
3. Variety: block sizes and patterns by time survived.

## Changelog

| Date | Change | Budgets |
|---|---|---|
| 2026-09-28 | Template created | `play` measured on software GL |
| 2026-10-02 | The scripted playtest moved into the game folder (`game/playtest/`), so `npm run new-game` copies it with the game instead of into the engine's root `playtest/`; the success criterion's `by` names the new path. Same script, same check. | Unchanged |
| 2026-10-02 | Polish (ui kit): Score, Best and the steering/restart prompt sit on a translucent dark plate; the prompt and banner start hidden, so no empty plate shows. Evidence: emulated SwiftShader play:snap at 1280×800 and 390×844, screenshots inspected; physical devices unverified. | Unchanged |
| 2026-10-03 | S4 ("survives a restart and a reload") is now tested across a reload: `game/play.test.ts` saves, re-opens the store with `createTestSaves().reload()` and reads the best back; `game/playtest/best-reload.json` reloads the real page. Same criterion, stronger evidence (emulated headless Chromium only). | Unchanged |
