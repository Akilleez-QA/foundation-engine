# ADR 0015: One frame loop; activities render on demand; covered activities pause

- **Status:** Accepted
- **Date:** 2026-09-28
- **Area:** Runtime
- **Related:** [0032 Activities return a run; one loop renders on demand; coverage pauses; preview layers keep the scene live](0032-activity-runs-coverage-preview.md)

## Context

Every screen running its own `requestAnimationFrame` wastes power, keeps covered scenes rendering, and makes pause and Calm unenforceable.

## Decision

- One `FrameLoop` (`core/activity/loop.ts`) is the only `requestAnimationFrame` (lint: `raf-outside-loop`).
- A frame renders only when a ticker is invalidated or continuous. With nothing to draw, no frame is scheduled.
- Covered tickers pause or throttle according to their `whenCovered` behaviour.
- Hidden tabs stop the loop.
- The frame carries `calm` and the preset.

## Consequences

- A still scene renders zero frames (STD-RUN-9); the bench's idle windows prove it.
- Refined by ADR 0032.
