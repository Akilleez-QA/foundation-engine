# ADR 0049: World-host capacity is derived, and dilation is budgeted

- **Status:** Accepted
- **Date:** 2026-09-28
- **Area:** Simulation
- **Related:** [0039 Tick-addressed input and explicit world/local time](0039-simulation-time-and-input.md)

## Context

A simulation that silently drops time under load changes outcomes on slower machines.

## Decision

- World-host capacity is derived from the maximum warp, the frame budget and the step, never hand-picked.
- A request that cannot be delivered is clamped to the largest deliverable warp and shown as that warp.
- Dilation on the reference preset is none.

## Consequences

- `domain/sim/host.ts` reference frame budget.
