# ADR 0090: optional per-member update cadence

- Status: Proposed for this implementation; integration is gated by full CI.
- Date: 2026-10-09
- Discussion: issue linked from the pull request
- Area: Optional kits / simulation scale

## Context

Large simulations commonly run each member at its own rate: near or busy members every step, distant or idle ones
every few steps, with start phases spread so a population does not wake in lockstep and a per-step bound so a burst
of due work is spread instead of dropped. Foundation's fixed lane runs every system every step and drops whole steps
beyond `maxSteps`; the clock schedules callbacks at times; interest sets rank what an observer is sent. None of them
gives a bounded, deterministic per-member period with deferral, elapsed-time reporting and saveable phase.

## Decision

Add `@kits/cadence`, a pure bounded helper: members with integer periods on the caller's tick; deterministic spread by
id or explicit phase; `take(now)` returning at most `maxDuePerTake` due members, earliest due first, with elapsed and
lateness; deferral instead of loss; phase-grid rescheduling that skips missed occurrences; `setPeriod`, `remove`;
JSON-safe `snapshot`/`restore`. No system, clock, callback, persistence owner or registration is installed.

## Alternatives and consequences

Per-entity clock callbacks would allocate per occurrence, run inline as time passes and are dropped on timeline
restore. A round-robin batch gives fairness without periods. A priority accumulator would rank by importance but not
honour periods. The helper keeps policy (periods, jitter, bands) with the creator and uses integer ticks only, so it
stays deterministic; earliest-due-first means a population whose steady due rate exceeds the budget is served late
rather than starved of order, and the creator must size budgets or periods.

## Evidence

Seven unit tests including a 4,000-step comparison with an independent per-tick scan model, and two consumer tests
(ECS fixed-step agents with distance-banded periods; interest-set refresh cadence). Headless only.
