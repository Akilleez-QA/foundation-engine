# ADR 0030: Budgets gate structure in software GL at every integration; time and pixels on the reference GPU

- **Status:** Accepted
- **Date:** 2026-09-28
- **Area:** Performance
- **Related:** [0025 Per-scene performance budgets are contracts enforced before integration](0025-performance-budgets-as-contracts.md), [0046 Cache measurements only when the complete experiment matches](0046-bench-cache-evidence.md), [0053 Measure normal work, including recurring uploads](0053-workload-valid-performance-windows.md)

## Context

Frame time measured in a software renderer is noise, while counts (draws, memory) are near-deterministic everywhere.

## Decision

- One budget type: `PlaceBudget = Ported<PlaceBudgetValues> & {provenance}`. Flat fields are the reference values; `ports` add lighter-preset overrides that fall back upward.
- `npm run gate` runs on the rebased head before every integration merge. It checks types, lint ratchets, tests, the bundle check and a software-GL bench, and gates counts only.
- A count fails only when two consecutive runs breach it.
- The deploy guard runs the bundle check and refuses on failure.
- The reference run (the reference GPU, `npm run bench:ref`) gates frame time and pictures, including the quality guard.
- Starting budgets are measured values plus headroom.
- Raising a budget needs a `Perf-Budget:` trailer; lowering happens in the change that earns it.
- Baselines are sharded per scene (ADR 0036).

## Consequences

- `scripts/perf/gate.mjs`, `scripts/perf/budget-ratchet.mjs`, `scripts/perf/quality-guard.mjs`.
