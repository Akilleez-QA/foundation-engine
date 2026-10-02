# kits/spatial

Optional bounded uniform-grid index for neighbour, range and interest queries over many
entities (hundreds to tens of thousands). It is a pure data structure: no system, renderer,
worker, timer, network policy or save data. A game decides what a query means (who an agent
avoids, what a player may see, which entities a connection is sent); the grid only answers
"which ids are near here" within declared bounds.

```ts
import { createSpatialGrid } from '@kits/spatial';
const grid = createSpatialGrid({
  cellSize: 16, minX: 0, minY: 0, maxX: 1024, maxY: 1024,   // world units; the caller picks the plane (e.g. x/z)
  maxEntries: 10000, maxCells: 4096, maxCellsPerQuery: 100,
});
grid.insert(entity, tr.x, tr.z);          // 'inserted' | 'duplicate' | 'saturated' | 'out-of-bounds' | 'closed'
grid.move(entity, tr.x, tr.z);            // 'moved' | 'absent' | 'out-of-bounds' | 'closed'
const near = new Float64Array(6);         // the buffer length is the result bound (k for queryNearest)
const r = grid.queryNearest(tr.x, tr.z, 8, near, entity);   // nearest first, ties by ascending id
const seen = new Float64Array(512);
const v = grid.queryCircle(px, pz, 64, seen);
if (v.status !== 'complete') { /* truncated or too-wide: the set is incomplete; fail closed */ }
grid.remove(entity); grid.dispose();
```

Use it from an ordinary scene system (see the ECS consumer in `spatial.test.ts`): move the
entries that moved, then query. Register `spatial()` in `defineGame({ kits })` if you want the
kit listed; `createSpatialGrid` works without it.

| Contract | Definition |
|---|---|
| Creator-owned semantics | Coordinate plane and units, cell size, which entities are indexed, query radii, what a result discloses or steers, and what to do with an incomplete result |
| Inputs and outputs | Ids: nonnegative safe integers (ECS entity numbers fit). Positions: finite numbers inside the inclusive rectangle. Queries write ids into a caller buffer (typed array or pre-sized `number[]`) and return `{status, count, cellsVisited, entriesExamined, revision}` |
| Owner | The caller (a scene system or a host loop) creates, feeds and disposes the grid. It borrows no engine service, scheduler or worker |
| Bounds | Every array is allocated once from `maxEntries` and `columns x rows <= maxCells` (hard ceilings 1,048,576 entries and 4,194,304 cells). Insert/move/remove are O(1). A query scans at most `maxCellsPerQuery` cells and writes at most `out.length` ids. `queryNearest` keeps a top-k by bounded insertion (O(examined x k)). Memory is about 40 bytes per entry slot plus 4 bytes per cell, plus the id map |
| Overload | Full grid: `saturated`. Outside the rectangle: `out-of-bounds`. A query wider than `maxCellsPerQuery`: `too-wide` with zero work and the buffer untouched. A full buffer: `truncated`, scanning stops, and the result is explicitly incomplete. Nothing grows, queues or retries |
| Cancellation and replacement | No callbacks, promises or deferred work: nothing to cancel. `revision` advances on every accepted mutation and stamps each result, so a caller can detect a result that predates later changes. `clear()` keeps capacity; `dispose()` is terminal and idempotent and later calls report `closed` |
| Failure and recovery | Malformed input (non-integer id, NaN/infinite coordinates, inverted rectangle, negative radius) throws before any mutation. Every refusal leaves the grid unchanged, including `move` to an out-of-bounds position (the entry stays where it was) |
| Evidence | `spatial.test.ts`: limit validation, refusals without mutation, a 4,000-operation randomised brute-force oracle including cell edges and the max corner, too-wide/truncated behaviour, history-independent nearest ordering, disposal, and an ECS consumer keeping per-observer interest sets that fail closed on truncation. `tools/spatial-bench`: headless CPU micro-benchmark at 1,000 and 10,000 entries with a work-count test |
| Limits | 2D only (one plane). Points only: an entity with extent must be inserted by the creator's convention (e.g. its centre, with queries padded by the largest radius). Uniform cells suit roughly even density; heavy clustering raises per-query work up to the cell bound. Iteration order of rect/circle results follows insertion history (deterministic for an identical operation sequence, as lockstep needs, but not sorted). JavaScript doubles, not fixed point. No worker offload, no shared-memory snapshot, no visibility/occlusion model, no network delta or priority policy, no browser or physical-device timing evidence |

## Measured cost (headless, not a device budget)

`npm run bench:spatial` (`node --import tsx tools/spatial-bench/bench.mjs`) random-walks agents at
constant density (about one per 100 square units), cell 16. Each tick moves every agent, runs one
k = 6 nearest query (radius 8) per agent, and 64 interest circles (radius 64). The recorded run is in
the [spatial index guide](../../../docs/guides/spatial-index.md#measured-cost). Medians
are the meaningful figures; tails depend on machine load and garbage collection.
