---
name: playtest
description: Run a playtest round and report it against the brief's success criteria, with screenshots, performance and page errors. Use after a change is ready to show, or when the author asks how the game is doing.
---

# Playtest round

1. `npm run check` must pass first.
2. See it: `npm run play:snap -- [--scene <id>] [--mobile]`. Open the PNGs in `playtest/latest/` and look at them yourself: is everything framed, readable, not overlapping? Read `playtest/latest/probe.json` for fps, draws, triangles, budget status and page errors. A still scene is redrawn on request so the budget is judged on real frames; `not measured (no frames rendered)` is not a pass. The budget is judged after the scene settles; the `warm-up` line shows the first frames after open next to the settled ones (and says when a scene did not settle within the wait).
3. Check the criteria: `npm run play:criteria` (tests and playtest scripts per the brief; add `-- --gate` to include the gate).
4. Report to the author in this shape:
   - what changed since the last round (one line);
   - the screenshots (desktop, and phone when phones are targets);
   - the criteria table from play:criteria (PASS / FAIL / NOT RUN / for the author);
   - performance: fps, draws and triangles against the budget;
   - anything you noticed that the criteria do not cover (clipping, tiny text, a confusing prompt);
   - one question: what to do next.
5. A new scripted check goes in `game/playtest/<name>.json` (the game owns it; `playtest/latest/` is only evidence) (steps: goto, key, press, teleport, wait, snap, expect) and is named as a criterion's `by`.
