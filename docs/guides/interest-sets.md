# Interest sets for scoped views (SC-02)

Status: implemented, candidate (branch `feat/sc02-interest-sets`); not integrated.

The optional `spatial` kit adds `createInterestSets`, a bounded per-observer relevancy
set built on the [spatial grid](spatial-index.md) (SC-01). It answers, for each observer,
which entity ids are relevant now, ranked and capped, and what entered or left since the
observer's previous update. It is the spatial policy that
[complete scoped views](network-views.md) (NW-02) deliberately leave to the creator, and
it is equally usable without networking (a team view, a sensor, an AI perception list).
Contract table and API: [kit README](../../src/kits/spatial/README.md#interest-sets-sc-02);
how to wire it: [recipe](../recipes/use-interest-sets.md).

## Why this shape

Large-population games keep one coarse grid, gather per-connection candidates from nearby
cells, order them by priority and distance, cut them to a send budget, and hold a newly
hidden entity briefly so it does not flicker at the edge of view. Server-side visibility
also means an observer must never learn about entities outside its set, not even through
frame timing. These sets supply the ordering, budget, hysteresis and change events; the
reference host shows the disclosure discipline.

## Contract summary

| Aspect | Behaviour |
|---|---|
| Inputs | A caller-owned grid; observer ids and positions; optional `self` id per observer; optional integer priority tiers per entity id |
| Outputs | Into a reusable record: ranked relevant ids (tier desc, distance asc, id asc), entered ids, left ids, `status`, `dropped`, `candidates`, the grid revision scanned |
| Owner | The caller. No scheduler, timer, worker, transport or callback |
| Bounds | `maxObservers x maxRelevant` member slots, `maxCandidates` per scan, `maxPrioritized` tiers; all allocated at construction. The exit-radius scan is checked against the grid's per-query cell bound at construction |
| Hysteresis | Enter `<= enterRadius`, stay `<= exitRadius`, then `holdUpdates` more updates while still indexed; removal from the grid leaves at once |
| Overload | `over-budget` (lowest-ranked dropped), `incomplete` (fail closed: nothing new enters, unseen members leave), `unavailable` (closed grid: all leave), `saturated` tables |
| Cancellation | Synchronous only; `removeObserver` and terminal `dispose()`; later calls report `closed` |
| Recovery | Malformed input and unusable result records throw before any change |

## Reference host: feeding NW-02 views

[`tools/interest-host/host.mjs`](../../tools/interest-host/host.mjs) composes a grid, the
interest sets and one `createViewPublisher` per connection, in process (no sockets):

- `project()` lists only the connection's current members, in rank order, with an
  incarnation per id; `maxRelevant` must not exceed the view protocol's `maxEntities`.
- A view is marked dirty only when its membership changes or a member changes. Activity
  outside the set produces no frame, and the frame's `worldRevision` is a per-connection
  counter, so neither timing nor revision numbers reveal hidden changes.
- An entity moved outside the grid rectangle is despawned rather than left at a stale
  indexed position.
- Application credit is unchanged: while a frame is unacknowledged, changes coalesce and
  the next frame after acknowledgment carries current state.

## Evidence

Runtime-enforced: limit validation and ceilings; the construction-time scan check;
bounded member, candidate and priority tables; fail-closed handling of partial scans;
terminal disposal.

Checked (Node): `src/kits/spatial/interest.test.ts` (9 tests) including a 3,000-step
seeded comparison against an independent reference model (tiers, hold, budget, observer
motion, removals, self exclusion) and mutation checks during development (breaking
hysteresis, hold counting or the id tie-break each fails tests);
`tools/interest-host/host.test.mjs` (5 tests) using real NW-02 view receivers;
`tools/spatial-bench/bench.test.mjs` (per-update candidates flat from 1,000 to 10,000
entities).

Not established: a browser or socket host, WAN behaviour, priority accumulation for
dropped ids, occlusion or team-shared vision, physical devices, and template integration.
No budget changed.

### Measured cost

`npm run bench:spatial` (Node v22.23.3, `nice -n 15`, load average near 24 from other
work). Entities move randomly at constant density (about one per 100 square units), cell
16; 100 observers each follow an entity with enter 48, exit 56, hold 1 and a budget of 64.
Ten warm-up ticks excluded; 60 measured ticks.

| Entities | 100 observer updates (median) | p95 | Candidates per update | Relevant per update | Entered / left per update | Brute-force distance pass (one tick, no ranking) |
|---:|---:|---:|---:|---:|---:|---:|
| 1,000 | 0.937 ms | 1.69 ms | 81.4 | 59.4 | 0.53 / 0.51 | 2.28 ms |
| 10,000 | 1.89 ms | 2.90 ms | 96.3 | 62.7 | 0.87 / 0.86 | 7.81 ms |

At this density most updates were `over-budget` (more than 64 qualifying), which exercises
the ranking path; none were `incomplete`. The brute-force column only tests distances; it
does no ranking, hysteresis or change detection. These are headless CPU figures, not a frame
or server-tick budget.
