---
description: Show where the game stands against its performance budgets and brief ceilings
---

Read game's budgets.json and build.brief.ts (the brief's per-scene ceilings come from its minimum device). Run `npm run play:snap $ARGUMENTS` and report per scene: draws and triangles measured against the budget and the ceiling, rows still at the unmeasured ceiling, and idle renders. If anything is over, follow the fix-budget skill; never raise a budget without the author's approval and a Perf-Budget trailer.
