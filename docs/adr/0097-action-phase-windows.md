# ADR 0097: optional action phase windows

- **Status:** Proposed
- **Date:** 2026-10-09
- **Area:** Optional kits / Capabilities
- **Tracking:** [Issue #229](https://github.com/Akilleez-QA/foundation-engine/issues/229)

## Context

Action runs report readiness and expiry for a whole interaction. Input history buffers
presses. Combat resolves consequences. Animation markers are presentation-only. None of
them answers a position-dependent question inside one action: which follow-ups may
interrupt now, whether the actor is protected, or whether a cost or contact for this
range has already happened. Independently studied action implementations solve this with
ad hoc per-action windows and bit sets. Their failure modes repeat: double charges on
handover, skipped milestones on large steps, and contact applied every tick.

## Decision

Add an optional pure `createActionPhases` helper to the existing capabilities kit. Creator
definitions declare windows (half-open ranges) and marks (once-only positions). Instance
state is a frozen plain value with a definition fingerprint, a position and two bit sets,
capped at 32 marks and 32 ranges per timeline. Because the bits are positional, the
fingerprint makes any definition edit invalidate older states instead of reinterpreting
them. `advance` delivers every due mark once in a deterministic order. `claim` records one use per open range. `suppress` retires marks for handover. `restore` validates untrusted data without throwing. There is no clock, scheduler, callback, service
or persistence owner.

## Consequences

Creators keep every rule: units, timings, costs, interruption policy, hit-stop and
migration. The bit-set bound keeps states small and comparisons cheap for rollback. A
timeline that needs more than 32 marks or ranges must split into several timelines. The
helper does not replace action runs, input history or combat. Evidence is headless only.
