# ADR 0083: portable timed contribution checkpoints

- **Status:** Proposed (candidate implementation)
- **Date:** 2026-10-09
- **Area:** Capabilities / Persistence
- **Tracking:** [Issue #204](https://github.com/Akilleez-QA/foundation-engine/issues/204)

## Context

Timed contributions already own finite lifetime, conflict policy and aggregation.
Their live inspection rows contain runtime cancellation handles, so serializing
those rows cannot establish a portable continuation contract. Applying saved rows
individually can overflow before reaching an otherwise valid final aggregate.

## Decision

Extend the existing owner with separate versioned `checkpoint()` and
`restore(unknown)`. Include accepted simulation time, base, limits and ordered
live contributions. Exact configuration and plain data validate before a single
existing modifier transaction publishes the candidate. Do not duplicate arithmetic,
persistence, clock, delivery or admission-queue ownership.

A successful restore deliberately replaces local time, even backward, and issues
fresh local handles only after preflight succeeds. Preexisting handles cannot
cancel restored rows. Same-key array ordering preserves arithmetic order.
The creator restores at a load boundary and reconciles its existing simulation
clock, pending work, receipts and other coupled data in one SaveStore envelope.

## Consequences and evidence

Configuration changes require explicit creator migration. Malformed, oversized,
expired or arithmetically unsafe candidates leave live state and handles intact.
Normal time advancement remains monotonic. Restore does not replay outcomes,
advance offline time or guarantee idempotency of external operations.

Seven focused checkpoint tests cover exact deadlines, stack ordering, fresh handles,
reentry, immutable/malformed data, atomic overflow and real SaveStore continuation
after a failed write. Existing lifetime tests remain passing. Full integration CI,
arbitrary consumer migration and physical-device acceptance are separate.
