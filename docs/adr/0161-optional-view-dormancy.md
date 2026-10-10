# ADR 0161: optional zone and view-volume entity dormancy

- Status: Proposed for this implementation; integration is gated by independent review and full CI.
- Date: 2026-10-10
- Area: Optional kits / simulation scale

## Context

Creator requirement: in zone-structured or camera-framed games, entities that are neither in an active zone nor near
what the camera can see should stop updating (and may stop drawing), then resume when they come back, without
flickering at a boundary and without a burst of wake work when a whole zone appears at once. A well-known technique
gates each entity on the current and previous zone (so a transition keeps both alive) and on a per-entity culling
volume made of a forward frustum plus a box behind the camera; entities can opt out of either test.

Existing seams: `@kits/population` update tiers decide how much time a tracked entity is simulated with, from
Euclidean distance to observers (near, background round-robin, always); `@kits/region-activation` decides which grid
regions are active from observers, with linger, pins and per-update budgets; `@kits/visibility` combines cell
coverage; `@kits/entity-pool` caps live members by eviction class. None decides per-entity dormancy from zones or a
camera-relative volume, and tiers have no input besides positions and observers.

## Decision

Add a small kit, `@kits/dormancy`, that consumes those owners instead of extending one of them:

- Zones are integer ids supplied per step (`activeZones`). Region-activation region indices are used directly, so no
  second region registry, geometry or observer table exists. Authored zone numbers work the same way.
- The view volume (plan-view frustum ahead, box behind, optional height band) is the new signal.
- Per-entity policy `always`, `zone`, `view`, `zone-or-view`; per-entity bounding radius and a `hide` flag.
- Hysteresis: separate wake and sleep margins plus minimum awake and dormant dwell in steps.
- Wakes are budgeted per step; overflow waits in one first-in-first-out queue with a computed maximum latency
  (`floor((maxEntities - 1) / maxWakesPerStep)` steps), reported as deferred counts; sleeps are not budgeted.
- Output per step: frozen `woke` (with dormant duration) and `slept` lists, deferred, withdrawn and oldest-wait counts.
- `dormantAsFar` feeds dormancy into population tiers through the tiers' existing position callback (a dormant entity
  reads as far), so tiers stay the single owner of simulated time.

Why a new kit rather than extending tiers or region activation: tiers are a distance-and-time policy with no notion
of zones or a camera volume, and adding both would turn their compact contract into a second activation system.
Region activation is per region, not per entity, and is deliberately observer-distance based. Entity-pool eviction
removes members permanently, which dormancy must not do; visibility cell sets can be passed as zone ids by the
creator, so no dependency is taken.

Inputs/outputs, owner, bounds, overload, cancellation, failure and recovery are tabled in the kit README: the caller
owns the instance and steps it once per fixed step; `zones` up to 4,194,304, `maxEntities` up to 65,536, up to 16
zones per entity, up to 8 views, dwell up to 10,000 steps; unknown zone ids, degenerate volumes and malformed input
throw `RangeError` before any change; a throwing position callback leaves state untouched; untracking a queued entity
cancels its wake and is counted.

## Alternatives and consequences

- New tier policies in population (`zone`, `view`): rejected as above; it would also force every tiers user to pay for
  zone tables.
- Zones as region-activation regions only: rejected because authored zones need not be a uniform grid; plain ids
  admit both.
- A priority queue by distance or visibility: rejected for now; FIFO gives a simple, provable latency bound and stable
  order. A creator who needs nearest-first can order `track` calls or lower the budget's latency.
- Consequences: a dormant `background`-tier entity still receives conserved round-robin slices through `dormantAsFar`;
  a creator wanting strict no-update pairs dormancy with `near` tiers or checks `isAwake`. Margins are along camera
  axes, not Euclidean, and pitch is not modelled. Hiding is a reported flag; no renderer is touched.

## Evidence

Twelve headless tests (10 unit, 2 composition with real population tiers and real region-activation objects),
including an oscillating camera that flickers without hysteresis and does not with it, a deterministic budgeted
drain, and a 2,000-step churn run within the latency bound. No browser, template or physical-device evidence;
independent review and hosted CI remain required.
