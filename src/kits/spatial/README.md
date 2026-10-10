# kits/spatial

Optional bounded uniform-grid index for neighbour, range and interest queries over many
entities (hundreds to tens of thousands). It is a pure data structure: no system, renderer,
worker, timer, network policy or save data. A game decides what a query means (who an agent
avoids, what a player may see, which entities a connection is sent); the grid only answers
"which ids are near here" within declared bounds.

```ts
import { createQueryResult, createSpatialGrid } from '@kits/spatial';
const grid = createSpatialGrid({
  cellSize: 16, minX: 0, minY: 0, maxX: 1024, maxY: 1024,   // world units; the caller picks the plane (e.g. x/z)
  maxEntries: 10000, maxCells: 4096, maxCellsPerQuery: 100,
});
grid.insert(entity, tr.x, tr.z);          // 'inserted' | 'duplicate' | 'saturated' | 'out-of-bounds' | 'closed'
grid.move(entity, tr.x, tr.z);            // 'moved' | 'absent' | 'out-of-bounds' (entry NOT moved) | 'closed'
const near = new Float64Array(6);         // Float64Array or number[]; its length bounds results (k for queryNearest)
const res = createQueryResult();          // optional reusable record: no allocation per query
const r = grid.queryNearest(tr.x, tr.z, 8, near, entity, res);   // nearest first, ties by ascending id
const seen = new Float64Array(512);
const v = grid.queryCircle(px, pz, 64, seen);
if (v.status !== 'complete') { /* truncated or too-wide: the set is incomplete; fail closed */ }
grid.remove(entity); grid.dispose();
```

Use it from an ordinary scene system (see the ECS consumer in `spatial.test.ts`): move the
entries that moved, remove despawned ids, and remove (do not ignore) an entry whose `move` returns
`out-of-bounds`, or it stays indexed at its old position; then query. Register `spatial()` in `defineGame({ kits })` if you want the
kit listed; `createSpatialGrid` works without it.

| Contract | Definition |
|---|---|
| Creator-owned semantics | Coordinate plane and units, cell size, which entities are indexed, query radii, what a result discloses or steers, and what to do with an incomplete result |
| Inputs and outputs | Ids: nonnegative safe integers (ECS entity numbers fit). Positions: finite numbers inside the inclusive rectangle. Queries write ids into a caller buffer, a `Float64Array` or pre-sized `number[]` only (narrower typed arrays are rejected because they would silently wrap ids into other entities), and return `{status, count, cellsVisited, entriesExamined, revision}`. Pass a record from `createQueryResult()` as the last argument to have it overwritten and returned; without one each query allocates a small result object |
| Owner | The caller (a scene system or a host loop) creates, feeds and disposes the grid. It borrows no engine service, scheduler or worker |
| Bounds | Every typed array, including the nearest-query scratch, is allocated once at construction from `maxEntries` and `columns x rows <= maxCells` (hard ceilings 1,048,576 entries and 4,194,304 cells). Insert/move/remove are O(1). A query scans at most `maxCellsPerQuery` cells and writes at most `out.length` ids. `queryNearest` keeps a top-k by bounded insertion, O(examined x k): keep k small (4 to 10 for steering; a k of 20,000 over 20,000 entries took about 126 ms in review). Memory is about 48 bytes per entry slot plus 4 bytes per cell, plus the id map |
| Overload | Full grid: `saturated`. Outside the rectangle: `out-of-bounds`. A query wider than `maxCellsPerQuery`: `too-wide` with zero work and the buffer untouched. A full buffer: `truncated`, scanning stops, and the result is explicitly incomplete. Nothing grows, queues or retries |
| Cancellation and replacement | No callbacks, promises or deferred work: nothing to cancel. `revision` advances on every accepted mutation and stamps each result, so a caller can detect a result that predates later changes. `clear()` keeps capacity; `dispose()` is terminal and idempotent and later calls report `closed` |
| Failure and recovery | Malformed input (non-integer id, NaN/infinite coordinates, inverted rectangle, negative radius) throws before any mutation. Every refusal leaves the grid unchanged, including `move` to an out-of-bounds position (the entry stays where it was) |
| Evidence | `spatial.test.ts`: limit validation, refusals without mutation, a 4,000-operation randomised brute-force oracle including cell edges and the max corner, too-wide/truncated behaviour, history-independent nearest ordering, disposal, rejected narrow buffers, ids beyond 32 bits, reused result records, and an ECS consumer keeping per-observer interest sets that removes despawned and out-of-rectangle entities and fails closed on truncation. `tools/spatial-bench`: headless CPU micro-benchmark at 1,000 and 10,000 entries with a work-count test |
| Limits | 2D only (one plane). Points only: an entity with extent must be inserted by the creator's convention (e.g. its centre, with queries padded by the largest radius). Uniform cells suit roughly even density; heavy clustering raises per-query work up to the cell bound. Iteration order of rect/circle results follows insertion history (deterministic for an identical operation sequence, as lockstep needs, but not sorted). JavaScript doubles, not fixed point. No worker offload, no shared-memory snapshot, no visibility/occlusion model, no network delta or priority policy, no browser or physical-device timing evidence |

## Measured cost (headless, not a device budget)

`npm run bench:spatial` (`node --import tsx tools/spatial-bench/bench.mjs`) random-walks agents at
constant density (about one per 100 square units), cell 16. Each tick moves every agent, runs one
k = 6 nearest query (radius 8) per agent, and 64 interest circles (radius 64). The recorded run is in
the [spatial index guide](../../../docs/guides/spatial-index.md#measured-cost). Medians
are the meaningful figures; tails depend on machine load and garbage collection.

## Interest sets (SC-02)

`createInterestSets(grid, limits)` keeps a bounded, ranked set of relevant entity ids per observer
(a connection, a team view, a sensor) over a grid the caller already maintains. It is the spatial
policy that [complete scoped views](../../../docs/guides/network-views.md) leave to the creator;
the reference composition is [`tools/interest-host`](../../../tools/interest-host/host.mjs).

```ts
import { createInterestResult, createInterestSets } from '@kits/spatial';
const limits = { enterRadius: 40, exitRadius: 48, holdUpdates: 1, maxObservers: 64, maxRelevant: 64,
  maxCandidates: 512, maxPrioritized: 256 };
const interest = createInterestSets(grid, limits);   // the grid stays caller-owned
const out = createInterestResult(limits);            // reusable: relevant / entered / left buffers
interest.addObserver(connectionId, x, y, avatarId);  // avatarId is never reported to itself
interest.setPriority(flagId, 1);                     // higher tiers rank first (default 0)
const r = interest.update(connectionId, out);        // 'complete' | 'over-budget' | 'incomplete' | ...
// out.relevant[0 .. r.relevantCount): ranked by tier desc, distance asc, id asc
// out.entered / out.left: changes since this observer's previous update
```

| Contract | Definition |
|---|---|
| Creator-owned semantics | Radii, hold, budget and tiers; what an observer is; what a relevant id discloses; when to update; what an over-budget or incomplete set means for the game |
| Inputs and outputs | Observer ids and positions (nonnegative safe integers, finite numbers); entity ids are the grid's. `update` writes the ranked set, entered ids (rank order) and left ids (previous rank order) into a caller record, plus `status`, `dropped`, `candidates` and the grid revision it saw |
| Owner | The caller owns the grid, the interest sets and every observer. Nothing is scheduled, sent or called back. `dispose()` does not dispose the borrowed grid |
| Bounds | `maxObservers x maxRelevant` member slots (ceiling 4,194,304), `maxCandidates` per scan, `maxPrioritized` tiers, all allocated at construction. Construction refuses an `exitRadius` whose worst-case scan exceeds the grid's `maxCellsPerQuery`. An update scans one circle and ranks by bounded insertion: O(candidates x maxRelevant) |
| Hysteresis | Enter at `<= enterRadius`; stay while `<= exitRadius`; a member beyond `exitRadius` that is still in the grid stays for `holdUpdates` more updates, with no distance cap (keep it small). An id removed from the grid leaves at once; an id reused while between the radii keeps its membership without an `entered` event (carry an incarnation) |
| Overload | More qualifying ids than `maxRelevant`: `over-budget`, the lowest-ranked are `dropped` (they may enter later). A truncated or refused scan: `incomplete`, fail closed: no new id enters, unseen members leave, seen members stay. A closed grid: `unavailable`, every member leaves. Full observer/priority tables: `saturated` |
| Cancellation and replacement | Synchronous only. `removeObserver` forgets the set (the caller retires what it disclosed); `dispose()` is terminal and idempotent; later calls report `closed` |
| Failure and recovery | Malformed input or an undersized, frozen or non-`Float64Array` result throws before any change |
| Evidence | `interest.test.ts` (9 tests, including a 3,000-step randomised comparison with an independent reference model covering tiers, hold, budget, observer motion and removal); `tools/interest-host/host.test.mjs` (6 tests: real NW-02 receivers, per-connection disclosure, no frames for hidden activity while scans are complete, hysteresis, credit coalescing, budget, despawn, no leaked observer slots on duplicate sessions or refused publishers); `tools/spatial-bench` interest cases at 1,000 and 10,000 entities with a work-count test |
| Limits | Distance only: no occlusion, line of sight or team sharing (compose those in the creator's projection). No priority accumulation or starvation rotation for dropped ids, no per-entity update frequency, no delta encoding. Ranking is deterministic, but which ids an `incomplete` scan saw depends on grid history. Entity id reuse is the creator's: carry an incarnation in the view, as the reference host does. No browser, worker or physical-device evidence |

## Atomic edits and occupancy

See [the bounded cell occupancy guide](../../../docs/guides/cell-occupancy.md) for
atomic sparse batches and immutable point, rectangle and segment queries, with
explicit outside/contact semantics and separate persistence/publication owners.
