# ADR 0092: placements with persistent depletion and update tiers

- **Status:** Proposed
- **Date:** 2026-10-09
- **Area:** Optional kits / Simulation scale
- **Tracking:** linked from the pull request

## Context

Large authored worlds need two related mechanisms that every game otherwise
re-implements: authored things should exist as live entities only near the
observers, while remembering which ones play destroyed (some for good, some until
the player leaves); and far entities should either pause or run cheaply without
losing simulated time. The spatial kit answers proximity queries and interest sets
but nothing consumes them for spawning or update fidelity, and the ECS has no
notion of dormancy.

## Decision

Add an optional `population` kit requiring `spatial`, with two pure helpers. A
placement field indexes authored placements in a spatial grid and returns bounded
spawn/despawn intents with enter/exit hysteresis in definition order; `destroyed`
applies a `never`/`visit`/`leave` respawn policy, and only `never` depletion is
persisted through a strict save section validated against the set's fingerprint.
Update tiers classify tracked entities each fixed step as always, near or
background; far background entities share round-robin slots and receive
accumulated time with a capped catch-up. Systems ask `due(entity)`.

No system, scheduler or persistence owner is installed; the creator's systems
create and remove entities, simulate them and save.

## Consequences

Live placement state is not saved (placements respawn by proximity after a load).
Visibility is distance-based only; area, portal and frustum visibility are the
creator's observers to supply. Slots are not rebalanced after untracking. Evidence
is headless tests, including a real save store reload and fixed-step ECS
consumers; no browser, device or performance acceptance is claimed.
