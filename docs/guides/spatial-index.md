# Bounded spatial index (SC-01)

Status: implemented, candidate (branch `feat/genre-rts-slice1`); not integrated.

The optional `spatial` kit adds `createSpatialGrid`, a bounded uniform-grid index for
"which ids are near here" questions over many entities. It is the shared building block
behind neighbour queries for local avoidance, range checks, per-observer visibility and
per-connection interest. It answers proximity only: the creator decides what a nearby
entity means, who may see it, and what to do with an incomplete answer. Contract table,
API and limits: [kit README](../../src/kits/spatial/README.md). How to use it from a
scene: [recipe](../recipes/use-a-spatial-index.md).

## Why a uniform grid

Large-population engines studied for this slice converge on one coarse spatial index
with hard per-query caps: crowd libraries refill a proximity grid every frame and cap
neighbours per agent; an open-source strategy engine keeps fixed-size cells for range
queries; replication frameworks bucket actors into 2D grid cells per connection. A uniform
grid in preallocated typed arrays gives O(1) insert/move/remove and query work that follows
local density, not population. It needs no rebuild per frame and no allocation per move.

## Contract summary

| Aspect | Behaviour |
|---|---|
| Inputs | Nonnegative safe-integer ids; finite positions inside an inclusive rectangle; a caller-owned id buffer per query |
| Outputs | Ids written to the buffer plus `{status, count, cellsVisited, entriesExamined, revision}` |
| Owner | The caller (a scene system or host loop). No engine service, scheduler, worker or timer is borrowed or created |
| Bounds | `maxEntries`, `maxCells` (columns x rows), `maxCellsPerQuery`, buffer length; ceilings 1,048,576 entries and 4,194,304 cells. All memory allocated at construction |
| Overload | `saturated`, `out-of-bounds`, `too-wide` (zero work), `truncated` (explicitly incomplete). Nothing grows or queues |
| Cancellation | Synchronous only, no callbacks. `revision` stamps every result; `dispose()` is terminal and later calls report `closed` |
| Recovery | Malformed input throws before mutation; every refusal leaves state unchanged |

## Evidence

Runtime-enforced: limit validation and ceilings; admission before any write; the cell
bound refuses wide queries before scanning; the buffer bounds results; disposal closes
every operation.

Checked (unit, Node): `src/kits/spatial/spatial.test.ts` (10 tests): limits, refusal
without mutation, a 4,000-operation seeded oracle against brute force including cell
edges and the maximum corner, too-wide and truncated behaviour, nearest ordering
independent of insertion history, disposal, revision accounting, and an ECS consumer
(`testScene`) maintaining per-observer interest sets from `Transform` that fails closed
when a result is truncated. `tools/spatial-bench/bench.test.mjs` checks that per-query
work stays flat from 1,000 to 10,000 entries at constant density.

Not established: browser or physical-device frame cost, worker offload, integration with
the network view publisher in a running host, fog-of-war presentation, or any template
consumer. No budget changed and no template uses the kit, so the gate exercises it only
through `npm test`.

### Measured cost

`npm run bench:spatial` on the development machine (Node v22.23.3, 32 threads, run under
`nice -n 15` while the machine carried a load average near 56 from other work). Agents
move randomly at constant density (about one per 100 square units), cell size 16. Ten
warm-up ticks are excluded; 60 measured ticks.

| Entries | Move all (median) | 1 nearest-6 query per entry, radius 8 (median) | 64 interest circles, radius 64 (median) | Brute-force neighbour pass (one tick) |
|---:|---:|---:|---:|---:|
| 1,000 | 0.045 ms | 0.375 ms | 0.159 ms | 8.3 ms |
| 10,000 | 1.39 ms | 4.53 ms | 0.187 ms | 256 ms |

Per query, the nearest pass visited 3.8 to 4.0 cells and examined 10.6 to 11.2 entries at
both sizes; an interest circle examined 158 to 195. p95 and maxima (up to 387 ms at
10,000) reflect machine contention and garbage collection on a shared, heavily loaded
host; treat them as unmeasured, not as the structure's cost. These are headless CPU
figures for the index alone, not a frame budget.
