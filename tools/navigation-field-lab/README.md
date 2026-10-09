# Shared navigation field experiment

This headless tool tests whether many routes to one destination justify a shared
reverse search. It is not exported by the navigation kit and changes no game
default. Use `node --import tsx --test tools/navigation-field-lab/field.test.mjs`
and `node --import tsx tools/navigation-field-lab/bench.mjs`.

## Contract and precommitted comparison

Use the existing immutable, directed navigation graph; build reverse edges once
per batch and run resumable Dijkstra. Each step charges node selection or one
incoming edge, including high-degree nodes. Compare reachable status and exact
integer route cost against independent `createPathSearch` calls. Equal-cost
route geometry may differ; this is not a drop-in replacement for authored route
tie behavior. Zero-cost cycles must not create successor cycles.

The experiment accepts only nonnegative safe-integer costs. Independent review
found that reversing floating-point addition changes the exact sum of legal
fractional paths (0.1+0.2+0.3); those inputs are now explicitly refused. Accumulated
integer overflow fails. The production search retains its broader numeric
contract unchanged. Cancellation preserves terminal outcomes and stale revision
queries are refused.

Prepared topology is bounded by the existing 8192-node/65536-edge graph limits.
Algorithm typed buffers cost 21 bytes per node. That figure excludes topology,
strings, objects, returned paths, allocator and runtime overhead. Topology
preparation and route reconstruction are synchronous; only field expansion is
resumable. No production cache, eviction, WorkerHost admission, owner lifetime,
automatic graph invalidation or browser publication has been added.

## Recorded result

See `evidence.json` for raw samples, CPU/Node and source hashes. Serial Node run,
32x32 open four-neighbor grid, one common corner goal, three warmups and nine
alternating samples. Includes per-batch preparation/build/route copies; common
input graph creation is excluded equally.

| Requests | Independent Dijkstra median | Independent A* median | Shared median |
|---|---:|---:|---:|
| 1 adjacent | 0.314 ms | 0.475 ms | 0.633 ms |
| 1 distant | 0.719 ms | 0.852 ms | 0.865 ms |
| 8 spread | 5.249 ms | 3.876 ms | 0.482 ms |
| 64 spread | 36.953 ms | 20.402 ms | 0.714 ms |
| 256 spread | 146.714 ms | 80.906 ms | 1.492 ms |

The single-request counterexample matters: sharing has an up-front cost and
should be workload-selected. The field uses specialized dense arrays; the
reference includes the general search contract and its per-request preparation.
The timings do not isolate algorithmic reuse from representation overhead.
Heuristic A* uses consistent Manhattan estimates. Open-grid ties are a narrow
workload, not a complete navigation benchmark.

Five tests cover directed weighted random graphs, zero-cost cycles, high degree,
cancellation, revisions, long costs, invalid fractional costs and overflow.
A separate reviewer compared 6400 integer routes with a Floyd-Warshall oracle.
Source inspection and Node CPU timing do not certify browser latency, mobile
performance, dynamic obstacles, route ownership or a production backend.

## Decision

The reuse benefit merits a later bounded kit proposal for many actors sharing a
goal. Do not switch the default or translate the search to Rust based on this
experiment. Before promotion: representative obstacle/goal distributions,
ownership and byte admission, resumable preparation/path output, explicit cache
lifetime, graph revision integration, deterministic tie policy and browser checks.
