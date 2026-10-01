# ADR 0032: Activities return a run; one loop renders on demand; coverage pauses; preview layers keep the scene live

- **Status:** Accepted
- **Date:** 2026-09-28
- **Area:** Runtime
- **Related:** [0015 One frame loop; activities render on demand; covered activities pause](0015-activity-loop-render-on-demand.md), [0033 One game clock, driven only by the loop](0033-game-clock-driver.md), [0045 Prepare a scene, then activate only the current request](0045-handover-activation.md)

## Context

Screens with their own lifecycles leak listeners and resources, and do not agree on pause.

## Decision

- `Activity {id, kind, enter(ctx, params) → ActivityRun}`.
- `ActivityRun {update?, render?, frameMode, whenCovered, ready?, activate?, leave?, contextRestored?}`.
- `ActivityContext` gives `signal`, `own()`, `layer()`, `ticker()`, `invalidate()`, `start(child)`, `calm()`, `coverage()` and `surface()`.
- Everything is owned and released in reverse order. Children leave before their parent.
- The loop is the only `requestAnimationFrame`. Tickers are on-demand or continuous.
- Coverage comes from the layer manager. A `preview` layer keeps the covered scene live.
- `FrameInfo` carries `dt`, `ut`, `calm`, `preset` and `coverage`, and no kit nouns.
- The loop is the only holder of the clock driver (ADR 0033).

## Consequences

- `core/activity/activity.ts`, `core/activity/loop.ts`, `platform/ui/runtime.ts`.

### Ticker diagnostic failure isolation

A failed ticker is removed before its diagnostic reporter runs. If that reporter
throws, the shared loop continues healthy tickers and schedules their next frame.
A best-effort console diagnostic carries both the original ticker failure and the
reporter failure; even a throwing console sink cannot stop the loop. If reporting
disposes the loop, removed ticker handles cannot revive it or schedule more frames.
