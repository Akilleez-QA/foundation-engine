# Shared world (shared-world template)

<!-- The brief (game/build.brief.ts) is the contract; this block mirrors it. Change the brief first, then this block,
     then add a changelog row. Budgets are re-derived from the brief and only fall without a Perf-Budget trailer. -->

## Brief

| | |
|---|---|
| **Goal** | A starting point for a small shared world: two or more players on one board, over a LAN or loopback host. |
| **Pitch** | Walk a capsule around a board and paint cells; open a second tab against npm run host and both players see one world. |
| **Audience** | Neutral (`kids: false`); policy `default` |
| **Genre** | shared-world |
| **Core loop** | move a cell at a time → paint the cell under you → watch the other player paint the same board |
| **Devices** | targets desktop, laptop; minimum **laptop**; input keyboard, pointer, gamepad |
| **Constraints** | Development host only: loopback by default, LAN on request; no accounts, matchmaking, NAT traversal or Internet deployment. |
| **Modes** | play |

### Success criteria

| Id | Check | How |
|---|---|---|
| S1 | moving and painting change the shared world through the same rules locally and on the host | test: `game/world.test.ts` |
| S2 | two browser tabs joined to one local host see each other move and paint | manual (automated in Chromium by `npm run test:session-browser`, which is not device evidence) |
| S3 | the world scene stays inside its budgets.json counts on the gate | gate |

## What is in it

| File | What |
|---|---|
| `game/game.ts` | `defineGame`: id `shared-world`, first scene `world`, the `ui` kit, the HUD strings |
| `game/session.ts` | the shared rules (`defineSessionRules` from `@kits/network`): join, leave, the action schema, `apply`, one integrity rule |
| `game/world.ts` | the scene: one session owner per visit, `controls` (actions), `sync` (network, redraw, HUD), `glide` (smooth avatars) |
| `game/move-x.ts`, `game/move-z.ts`, `game/paint.ts` | the inputs: WASD, arrows, stick or d-pad; Space, pad A or a tap |
| `game/world.test.ts` | S1 (local play and the host give the same world) and a still-world check |
| `game/playtest/paint.json` | a scripted local playtest |
| `game/budgets.json` | the measured budget of `world` |

## Milestones

1. **Vertical slice**: one board, local play, the same rules on `npm run host`, two tabs in one world. *(done)*
2. Replace painting with your game's first shared rule; keep the rules pure and small.

## Changelog

| Date | Change | Budgets |
|---|---|---|
| 2026-10-02 | Template created (MP-01): shared session rules, local play, `npm run host` reference host | `world` measured on software GL |
