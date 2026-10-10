# ADR 0087: optional bounded rewind history

- **Status:** Proposed
- **Date:** 2026-10-09
- **Area:** Optional kits / Network authority
- **Tracking:** [Issue #230](https://github.com/Akilleez-QA/foundation-engine/issues/230)

## Context

Foundation's network kit admits and authorizes remote commands and publishes
complete views; `@kits/combat` sweeps probes against targets. A host that tests a
remote command against current state judges moving targets where they are when
the command arrives, not where the sender saw them. There is no owner for bounded
past state, and nothing caps how far back a sender may claim to have looked.
Rollback (`@kits/rollback`) solves a different problem (peer resimulation) and
must not be combined with server authority for the same state.

## Decision

Add optional `@kits/rewind`: a pure, bounded, per-subject ring of fixed-width
numeric samples with time-addressed queries that interpolate between bracketing
samples, never extrapolate, never cross a creator-marked discontinuity, and write
into a caller buffer instead of moving live state. A separate pure
`chooseRewindTime` clamps an untrusted claimed time to `[now - maxRewind, now]`
and can replace a claim that disagrees with the host's own estimate by more than
a creator-chosen skew.

No clock, scheduler, registry, transport or persistence owner is added. The host
records from its existing fixed-step lane and queries from its existing command
dispatch. The kit is not registered with games.

## Consequences

Memory is fixed by limits and checked at construction; overload evicts the oldest
sample per subject and refuses new subjects, both counted. Discontinuities are
explicit creator facts rather than inferred distance thresholds, so a creator's
own teleport rule decides them. Queries are linear in samples newer than the
target. Latency estimation, protocol fields, which commands rewind, poses and
physics stay creator-owned. Evidence is headless tests including a composition
with `@kits/combat`; multiplayer, browser and device acceptance are not claimed.
