# ADR 0100: optional entity pool with eviction classes

- Status: Proposed for this implementation; integration is gated by full CI.
- Date: 2026-10-09
- Area: Optional kits / simulation scale

## Context

Fixed-memory runtimes commonly hold transient objects in a bounded pool split into categories, and when the pool is
full they unload an object from an expendable category instead of failing the spawn of something important. In a
browser the memory reason is weaker, but the design reason remains: a scene's measured budget (draws, triangles,
update work) is finite, transient effects can exceed it in bursts, and a creator wants a deterministic rule for what
disappears first. Foundation's `World` grows on demand; the scene budget is measured by the gate but nothing at run
time keeps pooled things under a cap; region activation, cadence and placement helpers decide what simulates, not
what exists.

## Decision

Add `@kits/entity-pool`, a pure bounded helper: creator classes with priority, cost, class cap, eviction order
(oldest, newest, lowest score) and `evictable`/`replaceOwn` flags; a member-count cap and a cost cap; atomic
admission with a bounded eviction plan (lowest priority first, then unnecessary cheap victims given back); pins; per-class statistics; `sweep` recovery; and a `World` adapter that
spawns only on admission, despawns evicted entities and emits one world event per eviction. No system, clock,
callback, persistence owner or registration is installed.

## Alternatives and consequences

Parking evicted entities for reuse (object recycling) mainly avoids allocation and garbage collection; World
entities are integers in maps and GPU resources are already leased and instanced, so the kit destroys evicted
members and leaves reuse to those owners. Refusing at the cap without eviction is available (no evictable classes).
Evicting by random choice would break replays. A single global least-recently-used list would ignore creator
importance. The consequence is that the creator must choose priorities, costs and a cap; refusals and evictions are
reported, never silent. One cost unit per pool is a deliberate simplification.

## Evidence

Eight unit tests including a 6,000-operation comparison with an independent one-victim-at-a-time model with give-back, and two consumer
tests (World fixed-step spawner under a triangle-cost cap with events; owner recovery). Headless only; a local
micro-probe is recorded in the kit README as an order-of-magnitude indication.
