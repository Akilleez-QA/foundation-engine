# ADR 0142: Optional prediction correction smoothing and predicted-event deduplication

- **Status:** Proposed
- **Date:** 2026-10-09
- **Area:** Network kit / Prediction presentation
- **Tracking:** [Issue #293](https://github.com/Akilleez-QA/foundation-engine/issues/293)

## Context

`createPrediction` replays pending inputs over each coherent baseline and publishes the
exact corrected state with a `correction` fact. It deliberately supplies no smoothing
and no effects. A creator who presents predicted state directly sees a visible jump on
every correction. Effects derived from predicted ticks can repeat when those ticks are
re-simulated, repeat again on confirmation, or survive a misprediction. Each creator
would otherwise build both mechanisms again, without the same bounds or tests.

## Decision

Add two optional, separately constructed helpers to `@kits/network`. Neither changes
`createPrediction` or its defaults. Both compose by comparing `read()` snapshots
taken around one `push` or `reconcile`.

- `createPredictionSmoothing`: a fixed-width offset over a creator projection of state.
  The offset absorbs each correction, then decays by half-life or linearly, capped per
  component per millisecond. A snap threshold and an explicit one-shot discontinuity
  flag cover large corrections and invalidation. Simulation state is never offset. The
  helper has no clock; the caller passes elapsed time from the existing frame scheduler.
- `createPredictedEvents`: a bounded identity table keyed by creator event key and tick.
  It emits each identity once, suppresses re-simulated and confirmed repeats, and
  cancels mispredictions once at replay end or settlement. Entries expire at settlement.
  Under overload it drops or forgets, reporting the loss, and never emits an identity
  twice.

Rejected alternatives: smoothing inside `createPrediction` (it would mix presentation
with exact state and change the default contract); interpolating between snapshots (that
is a different owner, and smoothing must start from the presented value); emitting
effects from the reducer (the reducer must stay pure); and an unbounded seen-set.

## Consequences

Creators choose projection, rates, snap distances and event identities. Offsets are
per-component sums, so rotations need a suitable projection. Exactly-once delivery
depends on the confirmed state's event log covering each settle gap. Evidence is
headless: unit tests and seeded randomized tests drive the real reconciliation path. They
are not device, browser, latency or multiplayer acceptance. See the
[guide](../guides/prediction-presentation.md).
