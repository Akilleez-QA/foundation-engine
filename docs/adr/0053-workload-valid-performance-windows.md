# ADR 0053: Measure normal work, including recurring uploads

- **Status:** Accepted
- **Date:** 2026-09-28
- **Area:** Performance
- **Related:** [0030 Budgets gate structure in software GL at every integration; time and pixels on the reference GPU](0030-budget-gating-two-harnesses.md), [0046 Cache measurements only when the complete experiment matches](0046-bench-cache-evidence.md)

## Context

A measurement window that caught loading, or that had recurring work switched off, measures a game nobody plays.

## Decision

- Every window belongs to one run epoch and route, and is guarded against hash changes and a replaced scene.
- Windows are classified before comparison (`platform/perf/window-class.ts`):
  - entry;
  - steady;
  - first use;
  - unclassified (unknown provenance: not comparable);
  - inconclusive (an active window whose held keys drive the scene, yet that rendered no frame: the scene had ended,
    frozen or paused, so its counts are zeros by observation; not comparable, and never a pass or a budget source).
    The held keys drive the scene when the scene's `budgets.json` row names them as its `activeKeys`, or when they press
    one of the game's own input actions (game or kit rows, not the engine's Back, pause or mute). When the game's
    bindings cannot be read, they are assumed to drive it. An active window whose keys press nothing in the game, and
    that renders nothing, is a still window like an idle one (classification version 3; version 2 called every active
    window without a frame inconclusive);
  - invalid.
- Uploads are recorded with their purpose: initial, recurring, first use or unknown.
- A non-comparable window is never counted as a budget failure or a regression, but it does block: the bench
  re-samples it (up to three times), and if a check is still inconclusive after that, the gate fails with the label
  "perf inconclusive" (`scripts/perf/gate.mjs`, `gate-verdict.ts`), not "perf budgets". What blocks the gate, then:
  - a check that fails (over budget, missing, or a blocking regression) on comparable windows in two consecutive runs
    ("perf budgets");
  - a check still inconclusive in the latest run: an unclassified window that would fail, or any inconclusive window,
    whose every row is inconclusive even when its numbers would pass ("perf inconclusive");
  - a rejected (invalid) window, which leaves the run incomplete.
  `perf:derive` derives no budget for a scene with a rejected or non-comparable window. A still window that renders
  nothing stays valid, idle or active with keys that press nothing in the game: that is on-demand rendering.

## Consequences

- `scripts/perf/bench.mjs` re-samples up to three times; `gate-verdict.ts` decides.
