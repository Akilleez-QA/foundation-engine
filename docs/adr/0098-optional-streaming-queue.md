# ADR 0098: optional on-demand streaming queue

- Status: Proposed for this implementation; integration is gated by full CI.
- Date: 2026-10-09
- Area: Optional kits / Assets

## Context

Memory-constrained runtimes stream animation data and level content on demand through a request queue that orders
transfers, bounds what is in flight and drops requests that are no longer needed. Foundation's owners cover the
pieces around such a queue: lease caches deduplicate loads and keep released assets warm within residency budgets,
the model library refuses work beyond its pending limit, the dependency lease owner prepares a fixed closure before a
scene activates, and the worker host bounds jobs. Nothing ranks a changing set of play-time requests, holds them
until a slot and bytes are free instead of refusing them, re-ranks them as the player moves, retries failures with
backoff or keeps a cancelled load's slot until its execution has settled.

## Decision

Add `@kits/streaming`: a pure queue over a poll-based port, with distinct-key and request caps, a concurrency limit,
a byte budget that charges estimates while loading and actual bytes when ready, priority order with head-of-line
blocking and optional preemption of lower-priority loads, per-key reference-counted requests, cancellation that
releases values and aborts loads while holding slots until settlement, deterministic backoff in caller ticks, and
ports onto existing owners (`leasePort`, `promisePort`, `modelPort`). No system, loader, cache, worker or
registration is installed.

## Alternatives and consequences

Raising the model library's pending limit would admit more work but not rank it or defer it. Extending the dependency
lease owner would mix a fixed preparation closure with an open-ended play-time set. A per-frame byte quota on
uploads would require the renderer to know game priorities. The queue keeps priorities and estimates with the
creator and leaves residency with the asset owners; its byte budget is an admission bound over its own requests, not a
measure of process memory, and the model owner's per-asset bytes are not visible to scenes, so `modelPort` charges
estimates.

## Evidence

Ten unit tests including a randomised run asserting budgets every tick, release-exactly-once and replay of the
event log, and four consumer tests (a real lease cache, a fixed-step model-owner consumer, promise cancellation and a
throwing late release). An independent adversarial review found two high (a throwing late release could hold a slot
forever; preemption could cancel loads without freeing enough capacity) and four medium problems; all were fixed with regression
tests. Ports settle when their owner rejects delivery, not necessarily when the owner's work stops; that remaining
work is bounded by the owner.
Headless only; a local micro-probe is recorded in the kit README as an order-of-magnitude indication.
