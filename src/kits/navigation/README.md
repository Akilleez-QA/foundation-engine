# Navigation

Optional, incremental shortest-path planning over an immutable directed graph. No rendering, frame loop, workers, automatic movement, collision, or save data. A completed route means the planner reached its goal node; it does **not** mean an actor physically arrived. The game owns steering, arrival checks, topology revisions, and scene/coordinate-frame identity.

```ts
import { createNavigationGraph, createPathSearch } from '@kits/navigation';
const graph = createNavigationGraph([
  { id: 'outside', edges: [{ to: 'door', cost: 2 }] },
  { id: 'door', edges: [] },
]);
const request = createPathSearch(graph, 'outside', 'door');
// From the existing game system; share a total budget fairly between requests.
const { result, work } = request.step(32);
// result.status: pending | arrived | no-route | cancelled
// arrived includes a frozen path (including both endpoints) and total cost.
// On unload, target removal, or replacement:
request.cancel();
```

Preparation copies, sorts and validates topology, so do it at a preparation boundary, not every frame. Node ids must be unique/nonempty; edges require existing destinations, no duplicate neighbors, finite nonnegative costs. Each request owns its search records and a topology snapshot, allowing interleaved searches without graph marks. Source array order cannot change ties: equal priorities use lexical node id, with neighbors sorted the same way.

`step(maxWork)` bounds logical work **inside** the search: each node selection, edge examination, and path reconstruction/copy entry consumes one unit. High-degree nodes yield between edges. Heap operations are O(log V); memory is O(V + E) per request (snapshot plus records). This is not a millisecond deadline: garbage collection, allocation and final freezing are not real-time bounded. No draws or triangles. A scene must cap simultaneous requests, share its total step budget, and cancel stale requests. This kit does not install a queue or scheduler.

The default zero heuristic is Dijkstra. An optional fourth argument is a per-node estimate record; missing entries are zero. Estimates must be finite, nonnegative, zero at the goal, and consistent for every edge (`h(from) <= cost + h(to)`). This preserves shortest-path correctness; arbitrary weighted heuristics are deliberately rejected. Path costs or priorities outside finite number range cancel the request and throw. Exact real-number arithmetic is not promised; costs use JavaScript numbers.

Topology changes require a new graph and cancellation/replanning. Terrain samples are not automatically walkable: the author must validate slope, clearance, obstacles, portal links, and coordinate frames when building the graph. `navigation()` supplies the optional kit registration; pure helpers work without a frame system.

The queue extension admits bounded request records before allocation and shares
factory-prepared immutable topology. `createRouteQueue({maxRequests,maxNodes})`
rotates one logical work unit per pending request; terminal results occupy admission
until `release`. Owner generations reject superseded requests. Owner tombstones are
bounded by maxRequests; create a new queue for a new bounded owner cohort. Limits
are counts, not millisecond deadlines, and topology preparation remains explicit.

`definePortal` binds local endpoint positions to frame generations. `crossPortal`
checks authored width/height, revision, open state, dependency readiness and the
application's swept-clearance callback, then verifies frame transforms again after
callbacks. Check this at crossing time, not only when planning. This does not
infer collision geometry from a frame matrix. `createRouteFollower` observes actual
collision-resolved position; proposals never count as arrival. A progress timeout
returns blocked, `replan` advances its generation up to the configured retry limit,
and stale route completions cannot replace the current route.

For changing owner cohorts in one long-lived queue, the optional
`createLifetimeRouteQueue({maxOwners,maxRequests,maxNodes})` adapter offers
`openOwner({label,signal?})`. Admission returns `{status:'accepted',owner}` or
`saturated`, `closed`, or `retired` (an already aborted signal). The returned
in-process handle has `offer`, `result`, `release`, and idempotent `retire` methods.
Its label is diagnostic: two handles with the same label are distinct lifetimes.
Requests omit the legacy `owner` string; request IDs and monotonically increasing
nonnegative generations are local to the handle. A replacement lifetime may start
at generation zero and reuse request IDs. Handles are not serializable identities.

All handles share the existing queue's round-robin `pump(maxWork)` and node bound;
there is no installed system, timer, worker, persistence owner, or additional search
scheduler. `maxOwners` bounds live handles; `maxRequests` bounds all retained route
records, including terminal results. Release a route explicitly. Retirement or abort
releases all that handle's records and owner capacity. A retired handle cannot
release or observe a replacement's routes, and `offer` returns `retired` (`closed`
after queue disposal). Completed result snapshots already held by the caller remain
snapshots: the application must check its actor lifetime before applying them.

The adapter reuses at most `maxOwners` private legacy owner slots, retaining one
safe-integer epoch per slot rather than per historical label. Epoch exhaustion
saturates that slot; dispose and recreate the queue at a cohort boundary to recover.
Owner labels, caller-retained handles/results and topology preparation are not heap
budgets. Diagnostic `stats` reports live owners, allocated slots, shared request/node
counts, and closure. Saturation allocates no search records; malformed admitted
inputs throw without replacing existing routes. Reentrant synchronous mutation
from input accessors is rejected; abort and disposal during admission defer cleanup
until admission unwinds. A consumer supplies frame/scene lifetime cancellation and
calls `pump` within its existing work budget. This adds no serialized lifetime,
network-delivery, actor movement, or physical-device performance guarantee.

### Optional accepted-world route dependencies

`createRouteDependencies(routeOwner, limits)` exclusively borrows a W1 `RouteOwner`.
Do not submit/release requests directly through that owner while the adapter owns
its request IDs; external retirement remains supported. The caller still owns and
retires the route owner. Adapter disposal releases its routes, not the borrowed owner.
No queue, scheduler, spatial partition or navigation generator is added.

Creators define bounded dependency scopes `{id, incarnation, revision, ready}`.
Call `acceptScope` only after a change is actually accepted/published. An identical
version/readiness is `unchanged`; older incarnation/revision is `stale`; changed
readiness at the same version is `conflict`. A higher incarnation permits revision
reset. Readiness loss must advance revision (or incarnation). Scope identities stay
retained up to `maxScopes` for this adapter lifetime to prevent stale resurrection;
there is no automatic eviction or deletion that forgets that history.

`offer(request, expectedScopes)` verifies current readiness/versions and borrows the
existing queue's admission. Accepted offers return an exact opaque ticket. Check
`check(ticket) === 'valid'` before adopting a completed result **and before each motion
using an already copied route**. `result(ticket)` cannot return an invalidated route.
Copied/foreign tickets are stale. Scope changes release affected queued/completed
requests and return their IDs; unaffected scopes and routes keep progressing.
Invalidation does not physically stop an actor: the consuming movement adapter must
honor tickets. New requests may reuse an invalidated ID; old tickets remain invalid.
A higher request generation supersedes all routes on the borrowed owner, consistently
with W1. To preserve independent actors, use separate generations/owners appropriately,
or the same owner generation for independently identified requests as in the test.

Limits explicitly bound retained scopes, live routes, total live dependency references
and each ID's UTF-16 length. All are positive safe integers. Limit admission returns
`saturated`; malformed/duplicate dependencies throw without admission. Under a full
adapter route/dependency budget, release existing routes before requesting replacement;
capacity is conservatively checked before queue supersession. Empty dependency sets
are permitted when the creator deliberately declares no world dependencies.

`release` retires an individual ticket; `dispose` permanently retires the adapter.
Reentrant mutations throw; disposal during input/graph access prevents an admission
from surviving. Callback work, graph preparation cost and caller-retained historical
snapshots are outside these retained-data bounds. Use the engine's existing queue work
budget. No notifications or arbitrary movement/publication callbacks are invoked.

Creators map affected bounds into independently versioned scopes. This helper does
not infer coordinate spaces, swept corridors or overlap from endpoints. Pending or
failed world preparation makes no accepted-change call while the old world is valid.
If old data ceases to be usable, publish explicit readiness loss. A notification alone
is not proof that render/contact/navigation views were installed coherently; the
creator publication adapter must establish that before accepting the scope revision.
This helper cannot roll back arbitrary partial external installation.

`dependencies.test.ts` independently enumerates actual headless actor positions:
west invalidation prevents motion along an adopted old route, east reaches its target,
and west replans around a blocked segment. Queued invalidation, unavailability,
no-op/stale changes, owner loss, ticket reuse and disposal are exercised. This proves
that consumer's ticket discipline, not universal collision/render atomicity, browser
integration or physical-device performance. Existing `crossPortal` checks remain
necessary immediately before crossing even when no dependency notification arrives.

## Shared distance fields

`createDistanceField(graph, goals)` incrementally prepares distances to any supplied
goal for many origins. It borrows the same immutable directed `NavigationGraph` as
route searches. No kit registration, scheduler, worker, movement policy or cache is
required. Goals must be a nonempty array of distinct existing node IDs, no longer
than the admitted node count; malformed goals are rejected before construction.

Call `step(maxWork)` from an existing system. The allowance is a nonnegative safe
integer; zero does nothing and invalid values leave construction unchanged. The
result is `pending`, `cancelled`, or `complete` with an immutable `field`. `phase`
reports index, reverse, seed, search, publish, or terminal. Cancellation releases
pending scratch state; it never exposes partial labels. Completed data survives
cancellation as an immutable snapshot. Terminal steps consume zero work.

`field.graph` identifies its admitted snapshot; `field.goals` is frozen and sorted.
`field.get(id)` returns null for unknown IDs, `{status: 'unreachable'}` for nodes
with no route, `{status: 'goal', distance: 0, rank}`, or
`{status: 'reachable', distance, next, rank}`. Each next hop follows an original
outgoing edge and has a smaller settlement rank. This terminates even on zero-cost
cycles, where strict distance descent would fail. Equal-cost ties use canonical
node order and never rewrite settled successors. Arbitrary alternate equal-cost
neighbors do not inherit this termination guarantee.

Graph admission retains the existing 8192-node/65536-edge limits. Unprepared graphs
pay the existing synchronous validation/copy/sort cost; node lookup, typed-array
allocation and goal validation/sorting are also synchronous O(V + G log G). The
index phase creates incoming-edge buckets. Reverse-edge construction, goal seeding,
node selections, edge examinations and final output rows each consume logical work.
Heap operations within a unit cost O(log V), with at most V heap entries; retained
construction/output storage is O(V + E). No user callback runs inside stepping.
Logical work does not bound milliseconds, garbage collection, string bytes or
caller-retained completed fields. The creator caps concurrent requests and results.

Costs use JavaScript numbers, adding each original edge cost to the settled suffix
distance. A nonfinite sum cancels construction and throws RangeError. Reverse
addition order can differ from forward route searches for arbitrary floating-point
weights: no bit-identical cost or tie equivalence is promised. Small integer costs
are useful where exact comparison is required. No relaxation epsilon or negative
edge support is added.

The creator retains the current graph/goal request record and visit lifetime.
Before adopting a completed field, require that exact record to remain current and
that its visit is still live; cancel pending construction on replacement. A completed
old snapshot is not current authority. `createRouteDependencies` is route-specific
and does not accept fields. Destination capacity, reservations, actual arrival and
changes to which goals are eligible remain separate creator responsibilities.

Tests compare directed multi-goal fields with an independent dense-relaxation oracle,
including zero cycles and disconnection; verify slicing, cancellation, overflow,
maximum-node publication and immutability; and compose real activity lifetimes
with entity exit choices and service claims. A logical-work comparison includes
a negative control where one short route costs less than a complete field. These
are headless contract checks, not browser, physical performance or movement acceptance.

## Navigation meshes, funnel paths and local avoidance

For continuous walkable surfaces, author a mesh of convex polygons (from a level
editor or an offline navmesh generator) and query it here. Generation is tooling, not
part of the kit.

```ts
import { defineNavMesh, navMeshGraph, createPathSearch, corridor, findStraightPath, locate, walkMesh, createAvoidance } from '@kits/navigation';
const mesh = defineNavMesh({ vertices, polygons });         // validate once
const graph = navMeshGraph(mesh);                           // reuse for every request
const from = locate(mesh, start)!, to = locate(mesh, goal)!;
const search = createPathSearch(graph, `p${from}`, `p${to}`); // the same incremental search
// ... step(budget) until arrived, then:
const straight = findStraightPath(mesh, corridor(result.path), start, goal, agentRadius);
```

| Contract | Definition |
|---|---|
| Mesh | `defineNavMesh({vertices, polygons, cellSize?})` takes 3–65,536 vertices and 1–8,192 strictly convex, planar polygons of 3–16 vertex indices, counter-clockwise in (x, z) coordinates (positive (b − a) × (c − a) with x first and z second, as in the terrain kit). Vertices at the same position must share an index to connect; T-junctions do not connect, and polygons overlapping along an edge are refused. Each edge is shared by at most two polygons, and shared edges become portals. A uniform locator grid is built once (at most about 4 million cell entries). Invalid meshes throw `RangeError`. |
| Locate | `locate(mesh, point, maxHeight = 2)` returns the polygon containing the point's x/z whose surface is nearest its height within `maxHeight`, or null. |
| Routing | `navMeshGraph(mesh)` returns a `NavigationGraph` whose nodes are `p<index>` and whose edge costs are centroid → shared-edge midpoint → centroid. Plan with the existing `createPathSearch` and queues (bounded steps, cancellation), then turn the path back into polygons with `corridor(path)`. A mesh with more than 65,536 portal edges is refused with `RangeError`, because the navigation graph admits no more. |
| Funnel | `findStraightPath(mesh, corridor, start, goal, radius)` string-pulls through the corridor's portals in x/z and returns corner waypoints including both ends. A positive `radius` shrinks each portal from both ends, so corners keep that clearance from walls; this approximates a disc's path and can add corners near tight turns. Corner heights are interpolated along their portal edge, and the ends keep the caller's points. Consecutive duplicate corners are removed. It returns `too-narrow` when a portal is narrower than 2 × radius, `off-corridor` when start or goal is outside the first or last polygon, `broken` for non-adjacent polygons, and `too-many-corners` above 1,024. |
| Walk | `walkMesh(mesh, polygon, from, [dx, dz], slide = true)` moves across shared edges and stops at the first boundary edge. With `slide`, the remaining motion continues once along that edge. `from` must lie in the start polygon. It returns the end position on the end polygon's plane, the end polygon, whether a boundary was hit, and `truncated` when the 256-crossing bound stopped the move early. |
| Avoidance | `createAvoidance({horizon, neighborRadius, maxNeighbors, directions, weight, maxAgents})` gives local avoidance in x/z among up to 4,096 agents. Each step, every agent picks from its preferred velocity, a stop and a fan of directions × three speeds. The chosen candidate minimises the distance to the preferred velocity plus weight / time-to-collision, using the reciprocal relative velocity (2·candidate − own − other) so both agents share the swerve. Overlapping agents prefer moving apart, and coincident agents part along x in id order. Neighbours are the nearest `maxNeighbors` within range (ties by id), found through a uniform hash sized for the largest radius. Results are deterministic and capped at each agent's max speed. Cost is O(agents × nearby agents × samples): with everyone packed in one cell, that grows quadratically. Dense crowds with large agents can deadlock or fail to arrive; this is local avoidance, not a crowd planner. Static walls are not considered: run the result through `walkMesh` or character collision. |
