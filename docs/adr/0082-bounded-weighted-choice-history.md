# ADR 0082: bounded weighted choice and separately committed history

- **Status:** Proposed (candidate implementation)
- **Date:** 2026-10-09
- **Area:** Procedural generation
- **Tracking:** [Issue #200](https://github.com/Akilleez-QA/foundation-engine/issues/200)

## Context

The RNG supplies uniform draws and saved continuation. Procedural generation has
no bounded eligible weighted choice. Objective history owns events and stages, not
recent selections. A director would duplicate creator policy and existing owners.

## Decision

Extend procgen with `chooseWeighted` and optional `createChoiceHistory`. Validate
a finite ordered pool before one caller-supplied RNG draw. Empty eligibility takes
no draw. History excludes its own label's recent IDs, prepares one local ticket,
and records only an explicit commit after consumer admission. Eviction removes the
oldest entry in that label. No PRNG, scheduler, registry or game director is added.

Bound candidate count, labels, window length and ID length; refuse overflow without
changing history; reject stale tickets; validate immutable snapshots for existing
creator-owned save sections. RNG state remains caller-owned and must be saved with
history for continuation. Cancelling preparation does not rewind its consumed draw.

## Consequences and evidence

Creators choose eligibility, weights, ordering, history labels and failure/reset
policy. External admission and history commit are not a cross-owner transaction.
Durable effects use existing operation/save authority. Floating-point weights and
finite RNG output resolution do not promise exact rational probabilities. Focused
tests cover endpoints, no-draw refusals, overflow, eviction, atomic admission, two
consumers and real SaveStore continuation. No device-performance claim is made.
