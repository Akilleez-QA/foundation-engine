# Template: shared-world

Two players in one world in ten minutes: a board where every player walks a capsule and paints cells, run by the same
rules in each browser (prediction) and on a small development host (authority). It plays locally with no host too.

```
npm run new-game -- --template shared-world --id my-world --title "My world"
npm run play            # terminal 1: the game, http://127.0.0.1:5173
npm run host            # terminal 2: the session host; it prints the link to open
```

Open the link `npm run host` prints in two browser tabs (or two browsers). Move with WASD, the arrows or a stick;
paint with Space, pad A or a tap. Each tab is a player; both see one board. The walkthrough, the API and the limits
are in the recipe [two players in one world](../../docs/recipes/two-players-one-world.md).

This README stays with the template; your copy lives in `game/` and `GAME.md`.

## What is in it

| File | What |
|---|---|
| `game/session.ts` | the shared rules: `defineSessionRules({ initial, join, leave, action, apply, integrity })`; `npm run host` loads this file |
| `game/world.ts` | the scene: `createSession` in `enter`, `session.update(ctx.time.now)` each frame, `session.act(action)` on input, `dispose` in `exit` |
| `game/move-x.ts`, `game/move-z.ts`, `game/paint.ts` | inputs |
| `game/world.test.ts` | S1 with `testScene` and the host core, no sockets |
| `game/build.brief.ts`, `game/budgets.json` | the brief and the measured budget of `world` |

## What to change first

1. `game/session.ts`: your world (entity id to JSON fields), your actions and `apply`. Bump `version` when the rules
   change: a host and a client with different versions refuse each other.
2. `game/world.ts`: how the world is drawn (`project`) and which actions input sends (`controls`).
3. `game/build.brief.ts` and the top of `GAME.md`.

## Limits

Development only. Restarting the host makes a new join code unless you pass `--join <old code>`. The host listens on 127.0.0.1 unless you pass `--lan`; it speaks unencrypted `ws://` with one shared
join code, keeps the world in memory, and has no accounts, matchmaking, NAT traversal or Internet hardening. Phones and
tablets are not targets of this template (no touch movement yet). See the recipe for the full list.
