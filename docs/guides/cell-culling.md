# Cell and portal culling

Choose `@kits/cells` when a level is divided into enclosed spaces joined by openings (interiors, tunnels, ships,
segmented arenas) and most of it is hidden behind walls from any viewpoint. The [kit contract](../../src/kits/cells/README.md)
lists inputs, outputs, bounds, overload, cancellation, recovery and evidence. The kit is optional and installs nothing;
open terrain with long sight lines gains little from it.

## Author the cells and portals

- A **cell** is an axis-aligned box. Cover every position the camera can reach; overlapping boxes are allowed (a camera in
  both starts in both). A camera in no cell gets the `outside` fallback you choose: everything, nothing, or a list
  of cells (for example the cells seen from an exterior viewpoint).
- A **portal** is a planar convex polygon in the opening between two cells, its vertices in order, each within the
  graph `tolerance` of both cells' boxes. Make it at least as large as the real opening: a portal smaller than the
  hole can hide geometry that is actually visible. Several portals may join the same two cells.
- A **door** is a portal you open and close with `graph.setOpen(portal, open)`. A closed portal is never traversed,
  so close it only once the door geometry fully covers the opening.

## Choose the bounds

`maxVisits` caps the work of one update. If it runs out, the result is not a partial flood: it falls back to the PVS
rows of the camera's cells, or to every cell, and reports `overflow`. Size it from the evidence in your own levels
(the generated tests need a few visits per update; `visits` reports the actual count). `maxDepth` is a horizon: cells
more portal steps away are not drawn even when a straight line of openings would show them. Set it to the cell count
unless distant cells are deliberately hidden (for example by fog).

## Precomputed PVS

`buildCellPvs(graph, {maxDepth})` stores, per cell, the cells reachable within `maxDepth` portal steps, counting
closed portals as passable, so the table stays valid whatever doors do. Use it as a pre-filter (`pvs` option), as the
overflow fallback, or alone (`mode: 'pvs'`) when the per-frame flood is not wanted. It is reachability, not geometric
visibility: it is conservative and coarse. A pre-filter shallower than the view's `maxDepth` also acts as a horizon.

## Apply the result

Register each render target in the cells it occupies; a target spanning an opening lists both cells. Choose a sink:

- `entityVisibility(world, Shape)` (or `Mesh`, `Model`, `Scatter`, or your own component with a boolean `visible`)
  for entities drawn by the engine renderer. The culler then owns that `visible` field: hide an entity for game
  reasons through another channel, or write a custom sink that combines both reasons.
- `objectVisibility(() => three.requestRender())` for `Object3D`s under `@kits/three`.
- Your own `{set, commit}` for anything else.

Update the view for the frame being drawn and call `apply` after every update (targets added since the last apply are written even when the cell set did not change). With three.js, read the camera's world position and `matrixWorldInverse` after `updateMatrixWorld()`, not its local `position`. A still camera costs one comparison; a moving camera
re-evaluates only the targets of cells whose visibility changed, and a target is written only when it flips. The
renderer's own frustum culling still runs on every visible target.

## Evidence and limits

Headless tests only: geometry cases, a seeded comparison on generated multi-level grids against an independent
ray-marching reference (no visible cell is ever hidden), culled-object counts on a generated fixture, and composition
with the real `World` and three.js objects. Hardware occlusion queries are out of scope. No browser, GPU or
physical-device measurement of draw calls or frame time was made, and shadow casters outside the visible cells need
the creator's own decision. A perspective camera closer than its near plane to a wall can see through the clipped
wall into a cell the kit hides; keep cameras at least `near` from walls.
