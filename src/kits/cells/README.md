# kits/cells

Optional **cell-and-portal render culling** for interiors and segmented levels. The creator authors cells (rooms,
corridors, shafts: axis-aligned boxes) and portals (doorways, windows, hatches: planar convex polygons joining two
cells, open or closed). For a camera, the kit finds the camera's cells and floods through open portals, narrowing a
screen-space clip rectangle portal by portal, and returns the visible cell set. An optional precomputed table (PVS)
gives a cheap conservative cell-to-cell answer. A culler applies the set to registered render targets, writing only
targets whose visibility flips. It is a set of pure helpers imported from `@kits/cells`: no system, renderer hook,
clock, save data or registration is installed.

```ts
import {
  createCellGraph, createCellView, createCellViewResult, createCellCuller, entityVisibility,
  cellCameraFromView, createViewCellCamera, buildCellPvs,
} from '@kits/cells';
import {Shape} from '@engine';

const graph = createCellGraph({
  cells: [{min: [0, 0, 0], max: [4, 3, 4]}, {min: [4, 0, 0], max: [8, 3, 4]}],
  portals: [{a: 0, b: 1, points: [[4, 0, 1.5], [4, 2, 1.5], [4, 2, 2.5], [4, 0, 2.5]]}],
  limits: {maxCells: 64, maxPortals: 128, maxPortalVertices: 8},
});
const view = createCellView(graph, {maxVisits: 256, maxDepth: 16, outside: 'all', pvs: buildCellPvs(graph)});
const result = createCellViewResult(graph);
const culler = createCellCuller({cellCount: graph.cellCount, maxObjects: 1024, maxCellsPerObject: 2,
  sink: entityVisibility(world, Shape)});
culler.add(tableEntity, 0);
culler.add(doorFrameEntity, [0, 1]);                 // spans the doorway: visible when either room is
const camera = createViewCellCamera();
// In a scene system, after the camera moved:
view.update(cellCameraFromView(ctx.view, camera), result);
culler.apply(result);                               // writes only flipped targets; touches the world once
graph.setOpen(0, false);                            // a door shut: the next update recomputes
```

With `@kits/three`, register `Object3D`s with `objectVisibility(() => three.requestRender())` and pass the live
camera: `{position: camera.position.toArray(), viewProjection: m.multiplyMatrices(camera.projectionMatrix,
camera.matrixWorldInverse).elements}`.

| Contract | Definition |
|---|---|
| Creator-owned semantics | Which spaces are cells, where openings are, which openings are doors and when they open, the outside fallback, the depth horizon, which objects belong to which cells (an object spanning cells lists each), the visibility sink, and when to update |
| Inputs and outputs | Graph: cell boxes (`min <= max`), portals (3 to `maxPortalVertices` points, planar and strictly convex within `tolerance`, every vertex within `tolerance` of both cells' boxes), optional `open`. View: camera world position and a column-major view-projection (three.js convention, perspective or orthographic). `update` writes a reusable result: `visible` flags, ascending `cells`/`count`, per-cell clip rectangles in normalised device coordinates (useful for a scissor), `status` (`portals`, `pvs`, `outside`, `overflow`), `cameraCells`, `visits`, `depthLimited` and `changed` (the set differs from the result's previous one). PVS: `has(from, to)`, `visibleFrom(cell, out)`, the row-major bitset. Culler: `add` (handle or `-1`), `remove`, `apply` (targets written), `resync`, `stats` (objects, visible, culled, visible cells, written), `isVisible`, `dispose` |
| Geometry | The camera's cells are every box containing the position (expanded by `tolerance`); a camera on a shared wall starts in both. Each portal polygon is transformed to clip space and clipped against the eye plane (`w >= tolerance x 0.001`), not the near plane, because a ray can cross a portal closer than the near plane and still show the cell beyond. The projected bounding rectangle is intersected with the current rectangle; an empty intersection rejects the portal, a zero-width one is kept. A camera within `tolerance` of a portal polygon passes the whole current rectangle (the projection is degenerate there). A worklist keeps per cell the bounding rectangle of every rectangle that reached it and the least depth; a cell is processed again only when either grows. No rectangle that reaches a cell is dropped, so a cell reached first through a narrow opening and later through a wider one sees through the wider one. Portals are two-sided |
| Owner | The caller creates, drives and disposes the graph, view, PVS and culler, normally from one scene system after the camera moves and before drawing. The culler is the single writer of its targets' visibility flag; the sink decides how a write reaches the renderer (`objectVisibility`: `Object3D.visible`; `entityVisibility`: a component's `visible` and one `World.touch()` per apply; or the creator's own `set`/`commit`). The kit borrows no scheduler, clock, worker or store |
| Bounds | Checked at construction: `maxCells <= 65,536`, `maxPortals <= 262,144`, `maxPortalVertices` 3 to 32, `tolerance` in (0, 1]; view `maxVisits` 1 to 16,777,216 and `maxDepth` 1 to cellCount; PVS at most 4,096 cells (cells^2 bits, 2 MiB at the ceiling), `maxDepth` 1 to cellCount; culler `maxObjects <= 1,048,576`, `maxCellsPerObject` 1 to 64. All tables and scratch are allocated at construction: the view with its result about 85 bytes per cell, the culler about 16 bytes per object plus 12 per membership slot (`maxObjects x maxCellsPerObject`). An update scans the cell boxes once to place the camera (linear in cells), then processes at most `maxVisits` cell visits, each projecting that cell's portals. An apply compares the cell flags (linear in cells) and re-evaluates only the targets of cells that flipped. Steady-state updates and applies allocate nothing; `stats()` allocates its record |
| Overload | `maxVisits` exhausted: status `overflow`, and the result is conservative, every cell of the camera cells' PVS rows (or every cell without a PVS), never a partial flood. Portals past `maxDepth` are not followed (the creator's horizon, counted in `depthLimited`), so `maxDepth` below the level's real depth is a deliberate choice, not a safe default. A full culler returns `-1` from `add`. Nothing queues, grows or retries |
| Cancellation and replacement | Synchronous only. An update with the same camera, graph revision and result object reuses the previous answer (`changed: false`); `invalidate()` forces a recompute. `setOpen` advances the graph revision. `remove` and `dispose` show again (by default) what the culler hid. `dispose` is terminal and idempotent |
| Failure and recovery | Malformed graph, options, camera or result records throw before any change. A sink that calls back into the culler is refused (`busy`). A sink that throws leaves that target unknown and makes the next apply re-evaluate every target, so the visible state converges once the sink works. `resync()` re-writes every target after the creator changed visibility behind the culler. State is transient: after a reload, rebuild the graph and register targets again; persist door state through the creator's own save section |
| Determinism | Cells, visits and rectangles depend only on the graph, door states and the camera inputs; processing order is fixed (first-in-first-out by cell, portals ascending), so the same inputs give the same result on the same JavaScript engine. Results are floating point and not a cross-platform bit contract |
| Composition | Culling here only clears visibility flags; the renderer's own per-object frustum culling still runs for every target left visible, and render masks, LOD and quality tiers are untouched. The clip rectangles are reported for creator use (scissor, debug overlays); the kit does not set a scissor |
| Evidence | `view.test.ts` (12 tests): graph refusals and copied input, corridor narrowing, a cell reached through a slit then a wider door, closed portals and revision, portals behind the eye and crossing the eye plane, a camera on or a hair from a portal plane, outside fallbacks, a cycle of four rooms, depth horizon and overflow fallbacks with and without a PVS, the PVS alone, unchanged-camera reuse and input refusals, determinism. `reference.test.ts` (2 tests): 24 seeded grid-of-rooms levels (1 or 2 floors, several openings per wall, random sizes, doors toggled between frames, cameras pressed against openings at 0.00001 to 0.02 units), 960 cameras each compared with an independent reference that marches 1,609 jittered camera rays room to room through open openings: the flood never hides a room the reference sees, never overflows, stays within the PVS row, and a full-depth PVS pre-filter changes nothing; and an 8 x 8 generated interior with 768 objects counting culled objects per camera. `culler.test.ts` (5 tests): only flipped targets written and no writes when the set is unchanged, spanning targets, remove/dispose restore and handle reuse, reentrancy refusal and throwing-sink recovery, input refusals, and a composition with the real `World` and `Shape` (one `touch` per apply, none when the camera is still, a despawned entity skipped) and three.js `Mesh` objects, including the view-projection helper matched element by element against the three.js camera the renderer builds (also looking straight down) |
| Limits | Not established: hardware occlusion queries (out of scope), occlusion by objects inside a cell, convex cells other than boxes, portal-to-portal anti-penumbra refinement of the PVS (the table is depth-bounded graph reachability), multiple views or shadow-casting lights (a light outside the visible cells may still cast into them: keep shadow casters registered with care or exclude them), cell lookup faster than a linear scan, automatic cell or portal extraction from level geometry, mirrors and portals that transform space, streaming, persistence, worker offload and multiplayer. Unit tests and headless measurements are not browser, GPU or physical-device acceptance |

## Measured cost (headless, not a device budget)

One local probe run (Node 26, desktop CPU; the probe script is not committed), generated levels with doors 70 %
present and 85 % open, a walking camera turning in place at the room centre (fov 70, 16:9), 12 objects per cell,
2,000 frames:

| Level | Cells / portals / objects | Visible cells (mean) | Objects culled (mean) | Writes per frame | `update` median / p99 | `apply` median / p99 |
|---|---|---|---|---|---|---|
| 8 x 8, 1 floor | 64 / 88 / 768 | 3.0 | 95.2 % | 2.5 | 0.001 / 0.015 ms | 0.0002 / 0.002 ms |
| 16 x 16, 2 floors | 512 / 1,033 / 6,144 | 5.1 | 99.0 % | 7.0 | 0.003 / 0.041 ms | 0.001 / 0.008 ms |

Building the full-depth PVS took 0.6 ms and 4.8 ms. These numbers indicate order of magnitude only: draw-call and
frame-time savings depend on the scene and device and were not measured.
