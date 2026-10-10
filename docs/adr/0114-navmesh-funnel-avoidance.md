# ADR 0114: navigation mesh queries, funnel paths and local avoidance

- **Status:** Proposed
- **Date:** 2026-10-09
- **Area:** Optional kits / Navigation
- **Tracking:** linked from the pull request

## Context

The navigation kit plans over authored directed graphs, follows routes and builds
distance fields. Games with continuous traversable floors also need three more things:

- polygon meshes, so routes are not limited to hand-placed nodes;
- straight paths through those meshes that hug corners with agent clearance;
- crowds that do not run into each other.

Mesh generation from level geometry is offline tooling and stays outside the engine.

## Decision

Extend the navigation kit with pure helpers:

- validated convex-polygon meshes with adjacency and a locator grid;
- a polygon graph for the existing incremental `createPathSearch`, so budgets, queues
  and cancellation are reused rather than duplicated;
- funnel string-pulling with portal shrinking for agent radius;
- surface movement with boundary sliding (`walkMesh`);
- sampling-based reciprocal velocity avoidance with deterministic neighbour selection.

## Consequences

Meshes are authored or generated elsewhere and must be convex and counter-clockwise.
The radius clearance is the portal-shrinking approximation. Avoidance ignores static
walls, so callers clamp the result with `walkMesh` or collision; it is not
guaranteed collision-free in dense crowds. Evidence is headless tests; no game, browser
or device acceptance.
