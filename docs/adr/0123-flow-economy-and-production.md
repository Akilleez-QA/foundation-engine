# ADR 0123: flow economy, production queues and reclaim

- **Status:** Proposed (candidate implementation)
- **Date:** 2026-10-09
- **Area:** Optional kits / Rules

## Context

The resources kit owns discrete material batches, exact recipes and deposit extraction through the inventory
ledger. Real-time strategy and base-building games also need a continuous economy: per-tick income and upkeep,
storage caps with overflow, build queues whose cost is paid up front or drawn while work progresses, equal slowdown
when stock runs short, prerequisites unlocked by completed items, cancellation refunds and reclaimable pools that
decay. Hand-written versions usually accumulate floating-point stock and check-then-subtract, which drifts and
starves later queues. The creator asked for this as an optional starting point.

## Decision

Add an optional `economy` kit with validated rules (resources, items, cost model, refund percent) and one owner per
economy on the caller's integer tick. Amounts are integers in a creator-chosen unit; streamed payment is
⌊cost × progress / total⌋ computed exactly, so totals are exact at completion; a shortage sets one fraction for
every active queue. Per-tick order (income/upkeep, reclaim, pool decay, production) and processing order (id order)
are fixed. Every mutation runs on a copy and publishes on success. Snapshots carry the rules signature and are
validated for internal consistency (payment matches progress, extraction matches work).

## Consequences and evidence

Creators get a deterministic economy that saves and replays exactly; spatial rules (reclaim range, spawn points)
and what items mean remain theirs. Discrete inventory items stay with the resources and inventory kits. Bounds are
configured per owner and overload returns `false`. Focused headless tests cover rule refusal, storage overflow and
upkeep shortfall, upfront waiting and repeat, prerequisites and lost unlocks, streamed equal slowdown with
conservation, refunds and atomic refusals, reclaim with storage stalls and decay, and snapshot continuation with
inconsistency refusal. No game integration, browser or device acceptance is claimed.
