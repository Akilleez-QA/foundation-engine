# ADR 0099: optional grid-step actor movement

- **Status:** Proposed
- **Date:** 2026-10-09
- **Area:** Optional kits

## Context

Tile-based adventure, puzzle and tactics games move actors one tile at a time. They need facing, turning in place, classified refusals (walls, one-way tiles, water versus land, elevation layers, other actors, home leashes), ledge jumps, forced movement tiles and lines of followers. Independent decompilations of classic handheld games show these as one ordered collision classifier, with an actor holding both its previous and current tile while it moves. Foundation has continuous character movement, navigation search and static raster occupancy, but no tile-stepping actor owner.

## Decision

Add an optional `@kits/grid-step` that owns a bounded set of tile actors. Each request is classified in a fixed order before anything changes. A moving actor reserves its source and destination tiles. `step()` advances moves in id order and emits frozen arrival, forced-move and follower events. Tile rules come from a deterministic creator function. Snapshots restore after full validation. A handheld-style preset supplies tunable defaults.

## Consequences

The creator owns the map data, the clock, drawing, pathfinding and what arrival events trigger. Movement uses four directions with no diagonals. A rule change during a move does not cancel it. Raster occupancy and navigation compose with the kit rather than being replaced by it.
