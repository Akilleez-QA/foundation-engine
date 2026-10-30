# ADR 0039: Tick-addressed input and explicit world/local time

- **Status:** Accepted
- **Date:** 2026-09-28
- **Area:** Simulation
- **Related:** [0033 One game clock, driven only by the loop](0033-game-clock-driver.md), [0049 World-host capacity is derived, and dilation is budgeted](0049-world-time-dilation-budget.md)

## Context

Frame-sampled input and frame-length steps make simulations machine-dependent and unrepeatable.

## Decision

- Input is addressed to simulation ticks. Commands carry sequence ids and are consumed exactly once.
- A simulation declares its clock:
  - `clock: 'local'` gets unwarped, pause-aware time;
  - `clock: 'world'` uses the committed game time.
- The loop commits world time once, by the common accepted interval.
- Pause and coverage release input intent and warp requests.

## Consequences

- `domain/sim/host.ts`: fixed-step hosts with force stages.
- Replays record the seed and tick inputs.
