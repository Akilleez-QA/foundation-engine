# kits/entity-pool

Optional bounded **entity pool with eviction classes** under a creator cap. A game declares classes of pooled things
(effects, debris, ambient creatures, pickups, enemies), each with a priority, a cost, an optional class cap and an
eviction order. The pool admits ids under a cap on member count and total cost. When a cap would be exceeded,
expendable (`evictable`) members of lower-priority classes are evicted first, lowest priority first, then in each
class's deterministic order; a class with `replaceOwn` may then recycle its own members. Pinned members are never
evicted. Admission is atomic: the whole eviction plan fits the limits and is applied, or nothing changes and the
result says why. It is a pure helper plus a small `World` adapter imported from `@kits/entity-pool`: no system,
clock, callback or registration is installed.

```ts
import { createEntityPool, createPoolResult, spawnPooled, despawnPooled, POOL_EVICTED } from '@kits/entity-pool';
const limits = {
  maxMembers: 512,
  maxCost: 20_000,                 // e.g. the triangle headroom left in the scene's budget
  maxEvictionsPerAdmit: 16,
  classes: {
    spark:  { priority: 0, evictable: true, cost: 20, max: 128, replaceOwn: true },
    debris: { priority: 1, evictable: true, cost: 400, order: 'score' },  // lowest score evicted first
    enemy:  { priority: 5, cost: 1200, max: 12 },                        // never evicted
  },
};
const pool = createEntityPool(limits);
const out = createPoolResult(limits);           // reusable; overwritten by each call
// In an ordinary fixed-step system:
const e = spawnPooled(world, pool, 'debris', [Transform({ x, z })], out); // undefined when refused (out.reason)
if (e !== undefined) pool.setScore(e, -distanceToCamera);                // far debris goes first
// A later system the same frame:
for (const ev of world.read(POOL_EVICTED)) puffAt(ev.entity /* already despawned */, ev.class);
// When play ends a member: despawnPooled(world, pool, e). Held or on-screen: pool.pin(e).
```

| Contract | Definition |
|---|---|
| Creator-owned semantics | What a member is and costs (draws, triangles, update slots: one unit per pool), class priorities and caps, which classes are expendable, the eviction order and score (distance, age, importance), what an eviction means (a puff, a placement returned to dormant, nothing), the cap values (a scene budget's headroom, a device profile) |
| Inputs | `maxMembers` 1..1,048,576; optional `maxCost` (positive safe integer; default `maxMembers` × the largest class cost); `maxEvictionsPerAdmit` 1..maxMembers (default min(16, maxMembers)); 1..64 classes with `priority` 0..1e6, `cost` 1..1e6 (default 1), `max` 1..maxMembers, `order` `oldest`/`newest`/`score` (default `oldest`), `evictable` and `replaceOwn` (default false). Ids are nonnegative safe integers (ECS entities fit). Scores are finite numbers |
| Outputs | `admit(id, cls, out)` writes `status` (`admitted`, `refused`, `duplicate`, `closed`), `reason` (`none`, `class-full`, `capacity`, `eviction-limit`) and the evicted ids with their classes in eviction order. `check(cls, out)` reports the same outcome and eviction count without changing membership. `spawnPooled` despawns evicted entities and emits one `POOL_EVICTED` world event each (`{entity, class, by}`), in eviction order, before returning. `stats()` gives per-class live, pinned, admitted, evicted, refused and released counts |
| Eviction order | A request of class C may evict evictable classes with a priority below C's, ascending by priority then declaration order; then, with `replaceOwn`, C's own members. When C is at its `max`, C's own members are replaced first (with `replaceOwn`) or the request is refused (`class-full`). Within a class: `oldest` (admission order), `newest`, or `score` (lowest first, ties by admission order). Pinned members are skipped. The plan takes the fewest members from each class in that order that meets the count and cost caps |
| Owner | The caller creates, drives and disposes it from an existing system; the World adapter uses the World's own `spawn`, `despawn` and `emit`. It borrows no clock, scheduler or worker and never calls back except `sweep`'s `alive` predicate |
| Bounds | Slot tables (ids, classes, order, score, heap positions, free list) and one heap per class (sized by the class `max`) are allocated at construction; the id map holds at most `maxMembers` entries. `admit`, `release`, `pin` and `setScore` are O(log n) per change plus O(k log n) for k evictions (k ≤ `maxEvictionsPerAdmit`); planning is O(classes). `sweep` checks at most `maxChecks` members from a rotating cursor |
| Overload | No eligible members to evict: `refused`/`capacity`. A plan larger than `maxEvictionsPerAdmit`: `refused`/`eviction-limit`. A full class without `replaceOwn`: `refused`/`class-full`. Refusals change nothing and are counted per class; nothing is queued or retried by the pool |
| Cancellation and replacement | Synchronous only. `release` ends a membership (died, collected, scene left); `pin(id, false)` returns a member to its class's eviction order; `dispose()` is terminal and idempotent, after which calls report `closed`, `false` or empty values |
| Failure and recovery | Malformed limits, classes, ids, scores, results that are too small and unknown class names throw before any change. Members destroyed outside the pool are recovered with `pool.sweep(e => world.exists(e), n)`. Membership is runtime state: after a reload, re-admit live entities (in a stable order for determinism). Remembering destroyed placements across saves is the placement owner's job, not the pool's |
| Determinism | All ordering is integer admission order or creator scores; no clock or randomness. The same admissions, releases, pins and scores give the same evictions |
| Evidence | `pool.test.ts` (6 tests): validation; class-ordered eviction with oldest and newest order and refusals; pins, score order and `replaceOwn`; cost caps with atomic `eviction-limit` refusal; duplicates, release, sweep and dispose; and a 6,000-operation randomised comparison with an independent one-victim-at-a-time array model over five classes, mixed caps, pins and scores, checking every status, reason and eviction list and covering all three refusal reasons. `consumers.test.ts` (2 tests): a `World` + fixed-step runner spawner holding a triangle-cost cap with sparks, scored debris and capped enemies, reading `POOL_EVICTED` events in a later system after the entities are gone; owner recovery with `sweep` and `despawnPooled`, and refused spawns creating nothing |
| Limits | One cost unit per pool (use two pools, or the scarcer unit, for draws and triangles together). No spatial or visibility knowledge: pass distance or on-screen state as a score or a pin. Evicted members are destroyed, not parked: the pool does not keep components for reuse (World entities are cheap; reuse of GPU resources stays with the asset lease cache and instancing). No persistence, network or worker offload. Headless evidence only; no browser, template or physical-device acceptance |

## Measured cost (headless, not a device budget)

One local probe run (Node 26, desktop CPU; the probe script is not committed): 10,000-member pool, three classes with
cost, class caps, `replaceOwn` and scores, 200,000 mixed admissions (including refusals and evictions) with 10%
releases: median 0.38 µs and p99 1.1 µs per operation over batches of 1,000. Order-of-magnitude indication only.
