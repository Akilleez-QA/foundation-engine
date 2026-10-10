# ADR 0115: ledge, ladder and pushable traversal helpers

- **Status:** Proposed
- **Date:** 2026-10-09
- **Area:** Optional kits / Locomotion
- **Tracking:** linked from the pull request

## Context

Characters need a few common traversal checks beyond kinematic movement and jumping:

- whether there is a ledge they can climb;
- attaching to and climbing ladders;
- pushing blocks that stop at walls or move in cells.

Each check needs geometry queries. The optional volume-query kit provides sphere sweeps
over authored colliders. A small adapter backs the cast and ground queries with it,
mapping every sweep status explicitly. It has no box body, so other games, and box
pushing, use their own collision.

## Decision

Add pure helpers to the locomotion kit that take creator query functions: a sphere
cast, a ground probe and a box sweep. `findLedge` performs a fixed sequence of at most
four queries and reports a reason when it fails. `createLadders` handles attachment,
movement along the ladder within horizontal and vertical reach, and exits at both ends.
`pushStep` covers pushing with mass, kinetic friction and its static threshold, and
per-axis sliding; or edge-triggered pushes to the next grid line.

No owner, clock or physics engine is installed; the caller switches its own movement
mode.

## Consequences

Correctness depends on the creator's queries. There is no animation, shimmying or
stacking. Ledge tops are assumed near flat. Evidence is headless tests over a sampled
box-world query and the volume-query adapter; no game, browser or device acceptance.
