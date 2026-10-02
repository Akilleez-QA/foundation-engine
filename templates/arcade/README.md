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
| `playtest/restart.json` | a scripted browser playtest |

## Controls

- Steer: ← → or A D, the left stick or d-pad, or hold and drag on the view.
- Play again after a hit: Space, Enter, gamepad A, or a tap.

## What to change first

1. `game/play.ts`, `spawn`: how often blocks appear and how fast they fall (`Math.min(12, 4 + time * 0.15)`).
2. `game/components.ts`: shapes, sizes and colours of the ball, blocks and lane.
3. `game/play.ts`, `collide`: what a hit does (it ends the run and saves the best score).
4. `game/game.ts`: the words. Add a test in `game/play.test.ts` for each rule you change.
