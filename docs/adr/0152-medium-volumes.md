# ADR 0152: optional medium volumes

- **Status:** Proposed
- **Date:** 2026-10-09
- **Area:** Optional kits

## Context

Water and similar media change how a body moves. A body wades, swims or dives, is buoyed and slowed, and is carried
by currents. Classic 3D action games implement these as box volumes with a surface height, classify a character
against configurable depth thresholds, and apply buoyancy, drag and current forces. They have edge cases worth
avoiding:

- strict bounds that leave seams between flush volumes;
- state flicker at a threshold.

Foundation has solid collision and movement owners but no medium owner.

## Decision

Add an optional `@kits/media`. It has:

- a bounded set of creator volumes with half-open edges, priority and replaceable heights;
- a probe returning depth and submerged fraction;
- a per-actor tracker with hysteresis on each threshold, reporting enter, exit and state events;
- a pure acceleration helper for buoyancy, drag and current;
- tracker snapshots.

It has no clock, entity binding or physics world.

## Consequences

Creators own movement integration, controls per state and every presentation effect. Volumes are axis-aligned with
flat surfaces, and bodies are vertical extents. Rigid-body floating and wave simulation need other owners.
