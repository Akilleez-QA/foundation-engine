# ADR 0154: optional presentation kit

- **Status:** Proposed
- **Date:** 2026-10-09
- **Area:** Optional kits

## Context

Finished games share a set of presentation mechanisms:

- screen transitions that hide scene swaps and teleports and stop input from leaking through them;
- lighting that follows a game clock;
- weather that changes gradually;
- score counters that roll up rather than jump.

Foundation has the outputs these drive (environment, haze, particles, the HUD overlay) but no helpers to drive them.

## Decision

Add an optional `@kits/presentation`. All of it is pure and driven by caller time:

- a screen-transition state machine with phase-aware reversal and an input lock, CSS for fade, wipe and iris, a
  decorative overlay element tied to the visit signal, and a neutral input view while the lock is held;
- a day clock with cyclic keyframe curves;
- a weather director that blends named parameter states without jumps;
- a roll-up counter.

There is no scheduler, persistence or scene writing.

## Consequences

Creators decide what each value drives and when to publish environment changes. Transitions are 2D overlays.
Weather and time of day emit parameters only. There is no browser or device evidence of appearance.
