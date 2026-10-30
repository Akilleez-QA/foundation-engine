# ADR 0025: Per-scene performance budgets are contracts enforced before integration

- **Status:** Accepted
- **Date:** 2026-09-28
- **Area:** Performance
- **Related:** [0030 Budgets gate structure in software GL at every integration; time and pixels on the reference GPU](0030-budget-gating-two-harnesses.md)

## Context

Performance that is only measured after complaints regresses silently between releases.

## Decision

- Each scene declares budgets: draws, triangles, shadow casters, texture MiB, canvas MiB, heap MiB, contexts and frame ms, plus load ms and bytes.
- The app declares first-load JavaScript, startup and after-tour budgets.
- A muted, headless bench measures them.
- The gate fails on a confirmed breach (ADR 0030).

## Consequences

- `game/budgets.json`, `perf/budgets.ts`, `scripts/perf/bench.mjs`.
