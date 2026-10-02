# Working with your agent

You describe the game; a coding agent (Claude Code or another) builds it with you on this engine, in small rounds you can see. This page is your side of [AGENTS.md](../../AGENTS.md).

## Start

```
npm ci
npx --no-install playwright-core install chromium   # the muted test browser, once
claude            # or your agent of choice, in this folder
```

[Getting started](getting-started.md) covers the same steps by hand.

Say what you want to make ("a game where you guide a paper boat down a stream"). The agent uses the **new-game** skill: a short interview (pitch, genre, audience, devices, how you will know it works), then it proposes a **build brief** (`game/build.brief.ts`, mirrored at the top of `GAME.md`) and a milestone plan with a small vertical slice first. Work proceeds within your agreed scope; existing authorization remains valid and does not need repeated confirmation.

## Your game lives on your branch

When you clone this repository to make a game, `npm run new-game` writes `game/`, `GAME.md` and the template's playtest scripts into the folder you cloned. Ask the agent to commit them on a branch of your own (`git switch -c my-game`) and to keep working there, committing each step that passes `npm run check`. AGENTS.md's worktree, gate-before-merge and production rules are for changes to the engine repository itself: a fresh worktree from `origin/main` has no `game/` folder and would quietly build the blank template, and `npm run deploy:production` releases this repository's `main`, not your game. To share your game, the agent runs `npm run build` and you upload `dist/` to a static host ([share your build](../recipes/share-your-build.md)).

## The round

The stock repository suggests this review loop; adapt it to your project and preferences:

1. The agent restates your idea and which success criterion it serves.
2. It makes the smallest change, runs `npm run check` (types, rules and tests; duration depends on the checkout and machine).
3. It runs `npm run play:snap`: screenshots for the selected, affected device profiles, taken in a muted browser. Phone screenshots are required when phone support is part of the affected scope.
4. It shows you the pictures, the criteria table (`npm run play:criteria`), and how fast it runs against the budget.
5. It asks only for missing decisions that materially affect the work; otherwise it continues within your existing authorization.

Useful things to say:

| You say | The agent |
|---|---|
| "/idea the ball should bounce off the walls" | plans it against the brief before building |
| "/playtest" | runs a playtest round and reports every criterion |
| "/budget" | shows each scene against its performance budget |
| "make it feel better" | runs a polish pass (feedback, readability, phone layout) |
| "it's slow on my phone" | measures, then simplifies, instances, bakes or adds detail levels |
| "ship it" | for your game: checks the criteria, commits, and builds `dist/` to share; for engine changes: gates, integrates and, only if you ask, deploys |

## The brief is the contract

The brief says who the game is for, which devices it must run on (the weakest one sets every performance ceiling), and how you will know it works. When you change your mind, the agent changes the brief with you and writes it in GAME.md's changelog. Budgets only go down unless you agree to raise one, and that agreement is written into the commit (`Perf-Budget: …`).

## What the agent will not do on its own

- Change the engine (`src/`): game code lives in your game folder. Ask if you want the engine extended.
- Raise a performance budget, delete a test or loosen a check to make something pass.
- Deploy to production.
- Touch your computer's audio: test browsers are always muted.

## Example round

In a game started from the `arcade` template:

> **You:** Blocks are too easy to dodge. Make them speed up faster.
>
> **Agent:** That serves S2 (a block that reaches the ball ends the run). Smallest change: in `game/play.ts`, the `spawn` system's speed ramp goes from 0.15 to 0.3 m/s per second, capped at 12. I'll add a test that after 20 s blocks fall at least twice as fast as at the start. *(runs `npm run check`: PASS in 9 s; runs `npm run play:snap -- --mobile`)* Here are the desktop and phone screenshots at 20 s. Criteria: S1–S4 PASS, S5 not run (gate). 60 fps, 7 draws of 10. Should the gap between blocks shrink too, or only their speed?


## Choose and change your frameworks

You choose the game’s simulation, mechanics, content, audience, platforms, quality
and workflow. Foundation provides useful frameworks; select, configure, extend,
replace or omit them as needed. The agent follows your direction, including changes
to defaults and framework choices. The stock repository workflow is a starting point
and contribution process, not an order governing every independent game.

Read the [creator contract](../CREATOR-CONTRACT.md) for the current `defineBuild`
example and an optional extension record: owner, inputs, outputs, bounds,
cancellation, recovery and evidence. A frozen brief prevents accidental drift;
you can create a new brief snapshot whenever your requirements change.

Delegate routine choices if you want uninterrupted progress. Existing direction
remains valid. Ask the agent to explain which guarantees a replacement keeps or
changes, and to assess the new requirement honestly. It should not silently weaken
checks to hide a failure, or add mechanics merely because another game has them.

“Passed in Chromium emulation” does not mean “verified on my tablet.” Choose
desktop-only quality or separate editions freely; phone acceptance applies when
phone support is promised. Keep unverified claims visible without inventing
measurements. Changing frameworks may need code changes and a rebuild; no universal
runtime hot-swap capability is implied.
