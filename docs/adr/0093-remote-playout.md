# ADR 0093: optional remote playout and clock offset

- **Status:** Proposed
- **Date:** 2026-10-09
- **Area:** Optional kits / Network presentation
- **Tracking:** [Issue #244](https://github.com/Akilleez-QA/foundation-engine/issues/244)

## Context

The network kit delivers complete scoped views and supports local prediction, but
a client presents each accepted view as it arrives. Irregular arrival makes remote
subjects stutter, and nothing estimates the authority's clock, so a client cannot
present on the authority's timeline. The network-views guide leaves interpolation
to creators.

## Decision

Add optional `@kits/playout` with two pure helpers. `createClockOffset` estimates
the authority clock from creator round-trip samples, choosing the minimum round
trip in a bounded window and slewing the applied offset at a bounded rate, with a
snap threshold (larger differences step the estimate, while render time still never goes back). `createPlayout` keeps bounded per-subject snapshot rings stamped
with authority time, presents a render time behind the estimated clock by a delay
that adapts to smoothed lateness, interval and deviation within creator bounds,
interpolates between bracketing snapshots, extrapolates for a capped span, holds
across creator-marked discontinuities and never moves render time backwards.

No clock, loop, timer, transport, registry or persistence owner is added. Views
still flow through the existing receiver; prediction keeps the local subject.

## Consequences

Memory and work are bounded by construction-checked limits; overload is counted.
The ping protocol, time units, presented fields and discontinuity rules are
creator choices. Evidence is headless, including a jittered composition with the
real receiver; WAN, browser and device acceptance are not claimed.
