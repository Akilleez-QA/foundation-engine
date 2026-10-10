# ADR 0141: optional world change detection, observers and cached queries

- Status: Proposed for this implementation; integration is gated by full CI.
- Tracking: discussion issue linked from the pull request.
- Date: 2026-10-10
- Area: Core / ECS

## Context

`World` offers structural queries and one change counter (`version`, bumped by structural changes and `touch()`), so
a renderer can skip a frame that did not move. A system that cares about which entities changed (redrawing a bar
when health changes, releasing a resource when a component is removed) must scan every match each step or keep its
own bookkeeping, and every query pass scans the smallest store and sorts the candidates. Mid-iteration semantics were
settled by the query-iteration fix: an entity is visited only if it matched when the pass began and still matches
when reached.

## Decision

Add opt-in, bounded mechanisms to the existing `World` owner (no new owner), allocated on first use:

1. Per-component change ticks for types the creator opts in (`trackChanges`), recorded on add, replace and an
   explicit `markChanged(entity, Type)` (components are mutated in place, so there is no hidden write barrier), read
   through `added(T)`/`changed(T)` filters in `queryFiltered(cursor, filters, ...types)` relative to a caller-held,
   registered `ChangeCursor`. Wraparound: ticks stay below a configurable `maxTick`; at the limit the world shifts all
   ticks by the oldest cursor (at least half the range), marking any passed cursor `overflowed`, which makes its
   filters a conservative superset until advanced. `sinceLastRun` gives a system a per-world cursor that advances on
   success.
2. Observers on add, remove, change and despawn: mutations queue events; `flushObservers` delivers them in mutation
   order then registration order, never reentrantly (a nested flush is a no-op), with bounded queue and per-flush
   delivery, counted drops, an overflow callback, unsubscribe and aggregated errors. The system runner gains a
   generic `afterSystem` hook; the scene runtime and `testScene` flush observers there.
3. Cached queries maintained from structural changes, iterating the same rows in the same order with the same
   mid-iteration rules as `query`, disposable and bounded.

`query`, `version`, `touch()` and every existing method keep their behaviour.

## Alternatives and consequences

Automatic change detection by proxying component objects would hide cost in every field write and break identity
assumptions; explicit marks keep cost visible. Per-system ticks advanced by the runner would tie the world to the
runner; caller-held cursors keep the world independent and testable. Modular 32-bit ticks would silently misreport
for stale readers; the rebase reports overflow instead and is conservative. Synchronous observers would run user code
inside world mutation and query passes; queuing avoids reentrancy at the cost of delivery latency up to the end of the
current system. Cached queries add set work to structural changes; local measurement shows a modest iteration gain
and none under heavy churn, so they stay opt-in.

## Evidence

Unit tests, seeded randomized model tests against an independent brute-force reference (thousands of operations per
seed, including despawn and add/remove during uncached, cached and filtered iteration, with and without rebases), a
scene composition test through `testScene`, and a local microbenchmark recorded in the
[guide](../guides/world-change-detection.md). Headless only; no device, browser or multiplayer acceptance.
