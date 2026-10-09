# ADR 0084: persisted recurring phase experiment

- **Status:** Proposed (unexported lab)
- **Date:** 2026-10-09
- **Area:** Optional composition / Time / Persistence
- **Tracking:** [Issue #206](https://github.com/Akilleez-QA/foundation-engine/issues/206)

## Context

The existing clock schedules owned callbacks, respects pause and drops scheduled
work on timeline restore. It intentionally does not persist recurring-event policy.
Reconstructing a deadline from last activity loses phase, while replaying every
elapsed period can produce unbounded catch-up work.

## Decision

Prove a creator composition in `tools/recurring-lab`. Retain exact definition,
revision, phase ordinal and committed firing identity. A pure bounded planner
requires explicit skip, coalesce or replay semantics and uses checked arithmetic
for elapsed periods. No new public kit, clock or task owner is installed.

Two consumers compose existing scheduling with a single save envelope containing
phase, simulation time, receipt and outcome. Fresh callback identity rejects work
from the retired owner. Hosts explicitly rearm at their chosen dispatch boundary;
callbacks do not recursively schedule the next period.

## Consequences

The initial format uses safe-integer game-second phase boundaries. Definition
migration, offline policy and delivery semantics belong to creators. Save failure
does not reverse accepted memory. External side effects need their own receipt
authority. The fixture stages callback results and flushes only at an explicit
host save boundary. Production integration must coordinate the existing clock's restore with consumer restore; this headless lab
does not grant itself clock-driver access.

Twelve tests cover two consumers, real clock pause and SaveStore continuation,
bounded catch-up, mid-period reload, malformed state, stale callbacks, reentry and
failure. Public API graduation, rendering and device acceptance remain separate.
