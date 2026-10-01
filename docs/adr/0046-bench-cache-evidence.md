# ADR 0046: Cache measurements only when the complete experiment matches

- **Status:** Accepted
- **Date:** 2026-09-28
- **Area:** Performance
- **Related:** [0030 Budgets gate structure in software GL at every integration; time and pixels on the reference GPU](0030-budget-gating-two-harnesses.md), [0053 Measure normal work, including recurring uploads](0053-workload-valid-performance-windows.md)

## Context

Re-benching every scene on every gate is slow, but a cache that reuses evidence across a changed input approves a regression.

## Decision

- The key is the digest of the whole executable build plus the complete experiment descriptor:
  - harness, browser and launch flags;
  - viewport, preset, route and windows;
  - the hash of every harness helper.
- The cache stores raw evidence, never a verdict. Reused counts are re-checked against today's budgets and baselines.
- Only complete evidence is stored or read: every scene and window, no errors, a hermetic network.
- Frame times and pixels are never reused for the reference run.

## Consequences

- `scripts/perf/cache.ts` with mutation tests (`cache.test.ts`).
