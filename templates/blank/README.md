# Template: blank

The smallest complete game: one scene, one entity, one input, one test file. Start here for any genre that no other template fits.

```
npm run new-game -- --template blank --id my-game --title "My game"
```

This README stays with the template; your copy lives in `game/` and `GAME.md`.

## What is in it

| File | What |
|---|---|
| `game/game.ts` | `defineGame`: id, title, first scene `main`, no kits |
| `game/main.ts` | the scene: a floor, a cube, and the `spin` system that turns the cube a quarter per press |
| `game/turn.ts` | the `turn` action: Space, pad A, or a tap |
| `game/main.test.ts` | criterion S1 and a still-world check, with `testScene` |
| `game/build.brief.ts` | the brief: goal, devices, success criteria |
| `game/budgets.json` | the measured budget of `main` |

## Controls

Space, gamepad A, or tap/click the view: turn the cube.

## What to change first

1. `game/main.ts`: swap the cube's `Shape` for your first object and the `spin` system for your first rule.
2. `game/turn.ts`: rename or rebind the action (each key and pad button may belong to only one action; P, M and pad X are the engine's).
3. `game/build.brief.ts` and the top of `GAME.md`: your goal and success criteria (`npm run lint:brief` keeps them in step).
4. Add kits when you need them: `ui()` for HUD text, `camera()` and `character()` for a moving player ([cookbook](../../docs/recipes/README.md)).
