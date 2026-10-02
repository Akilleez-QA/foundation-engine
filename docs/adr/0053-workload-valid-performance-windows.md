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
  - inconclusive (an active window, input held, that rendered no frame: the scene had ended, frozen or paused, so its
    counts are zeros by observation; not comparable, and never a pass or a budget source; classification version 2);
  - invalid.
- Uploads are recorded with their purpose: initial, recurring, first use or unknown.
- A non-comparable window never blocks. It is re-sampled, and the gate reports it as inconclusive if it stays so.
  An inconclusive window is reported as inconclusive even when its numbers would pass, and `perf:derive` derives no
  budget for its scene. A still idle window that renders nothing stays valid: that is on-demand rendering.

## Consequences

- `scripts/perf/bench.mjs` re-samples up to three times; `gate-verdict.ts` decides.
