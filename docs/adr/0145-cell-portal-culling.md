# ADR 0145: optional cell and portal render culling

- **Status:** Proposed
- **Date:** 2026-10-09
- **Area:** Optional kits / Rendering scale
- **Tracking:** discussion issue linked from the pull request

## Context

Levels built from enclosed spaces joined by openings hide most of their content behind walls. The renderer culls
objects outside the view frustum but draws everything inside it, including content behind solid walls. Creators were
left to hand-roll cell assignment, portal traversal, the near-plane and degenerate-projection cases, cycle handling,
door state and render-on-change application.

## Decision

Add `@kits/cells`, a set of pure bounded helpers: a validated cell graph (axis-aligned boxes, planar convex portals
with open state), a view that floods from the camera's cells through open portals, narrowing a screen-space rectangle
per portal, a depth-bounded reachability table (PVS) stored as bits, and a culler that writes visibility through a
creator-chosen sink only for targets that flip. Portal polygons are clipped against the eye plane rather than the
near plane, and a camera within tolerance of a portal passes the whole rectangle, so the result stays conservative.
A worklist that grows a per-cell bounding rectangle and least depth makes cycles terminate without dropping any
rectangle. An exhausted visit budget falls back to the PVS rows or to every cell, never to a partial answer.

The kit installs no system and no renderer hook. It writes through existing render owners: the `visible` field of
engine components with one `World.touch()` per apply, or `Object3D.visible` under the three.js kit.

## Alternatives and consequences

Hardware occlusion queries would catch occlusion by arbitrary geometry but need GPU readback latency and a renderer
change; they are out of scope. A geometric anti-penumbra PVS would be tighter but costs much more precomputation; the
reachability table is conservative and cheap, and the per-frame flood supplies the tightness. A renderer-integrated
cull pass would duplicate the existing visibility owners. The chosen kit leaves cells, portals, doors, the outside
fallback, the horizon and shadow casters to the creator, and makes the culler the single writer of the visibility
flags it is given.

## Evidence

Nineteen headless tests, including 960 seeded cameras on 24 generated multi-level grids compared with an independent
ray-marching reference (no cell the reference sees is ever hidden), culled-object counts on a generated fixture and a
composition with the real `World`, `Shape` and three.js objects. No browser, GPU or device measurement.
