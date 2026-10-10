# Optional world change detection, observers and cached queries

`World` (`src/core/ecs/world.ts`, with the optional parts in `src/core/ecs/world-tracking.ts`) can, when a game asks,
record per-component change ticks, queue observer events, and keep a query's matching set up to date. Nothing is
allocated until a world first uses one of these; a world that never does keeps its previous behaviour (same rows,
order, `version` counts and errors) and, locally, its previous cost within measurement noise.

The creator decides whether to use any of it. Plain `query` plus `version`/`touch()` remain the default and are
unchanged.

## Change ticks and filters

```ts
import {changed, added, sinceLastRun, defineSystem} from '@engine';

// once, for example in enter(ctx)
ctx.world.trackChanges(Health);

// wherever a system edits a component in place
hp.hp -= 1;
ctx.world.markChanged(e, Health);

// a system that only looks at what changed since it last ran
defineSystem(
  sinceLastRun({
    id: 'health-bars',
    world: ctx => ctx.world,
    run(ctx, dt, since) {
      for (const [e, hp] of ctx.world.queryFiltered(since, [changed(Health)], Health)) redraw(e, hp);
    },
  }),
);
```

- **Inputs:** `trackChanges(...types)` opts component types in. `add` records an add (both the added and changed
  tick); `add` over an existing component (replace) and `markChanged(e, Type)` record a change only; `remove` and
  `despawn` forget the entity's ticks. Components are mutated in place, so an edit without `markChanged` is not seen.
- **Since:** a `ChangeCursor` from `world.changeCursor()` (starts now; `{fromStart: true}` starts at 0) holds the
  caller's tick; `advance()` moves it to the world's current tick. `sinceLastRun` keeps one cursor per world for a
  system, sees everything on its first run on a world, and advances only when `run` returns, so a throwing run sees
  the same changes again.
- **Output:** `queryFiltered(since, filters, ...types)` yields what `query(...types)` would, in the same order and
  with the same rules for changes made while iterating, restricted to entities passing every filter (`added(T)`,
  `changed(T)`) when they are reached. A filter on an untracked type, a cursor from another world or a disposed cursor
  is refused with an error.
- **Ticks and wraparound:** one world counter, advanced once per recorded add, replace or `markChanged`, never above
  `maxTick` (default `Number.MAX_SAFE_INTEGER - 1`). When it reaches `maxTick` the world rebases around `base`, the
  oldest live cursor's tick but at least half the range below the current tick: stored ticks at or below `base` become
  1, later ones shift down by `base - 1` and cursors at or after `base` shift with them, so every stored tick stays at
  least 1 and a `fromStart` cursor (tick 0) created after any number of rebases still sees every present component. A
  cursor older than `base` is marked `overflowed` and, until its next `advance()`, every filter treats every present
  component as added and changed: a conservative superset, never a missed change. Rebases and overflowed cursors are
  counted in `trackingStats()`. Disposing a cursor during a filtered pass stops that pass with an error.
- **`version`:** `markChanged` bumps `version` like `touch()`. Nothing else about `version` changes.

## Observers

```ts
const sub = ctx.world.observe({on: 'remove', type: Body, run: ev => releaseBody(ev.entity, ev.value)});
// later
sub.unsubscribe();
```

- **Kinds:** `add`, `remove` and `change` (replace or `markChanged`) take a component type; `despawn` takes none. A
  despawn queues one `remove` per component the entity held (in the order the world first saw each type), then
  `despawn`. Events carry the entity, the type and the value at the time (the removed value for `remove`).
- **When they run:** mutations only queue events; an observer never runs inside `add`, `remove`, `despawn`,
  `markChanged` or a query. Delivery happens in `world.flushObservers()`. The scene runtime and `testScene` call it
  after every system run (the runner's new `afterSystem` hook), so a system's observers have run before the next
  system starts, also after a system that threw. Outside a scene, call it yourself. A scene with no systems never
  flushes (its runner runs no system), so its observers' events wait, bounded by `maxQueued`; such a scene should call
  `flushObservers()` itself. The time a flush takes is not part of any system's time in the dev system-timing probe.
- **Order:** the order the changes happened, then observer registration order. Deterministic for a deterministic run.
- **Reentrancy:** events queued by observers during a flush are delivered in the same flush (subject to the per-flush
  bound). `flushObservers()` called from inside an observer does nothing and says so (`reentrant: true`).
  `unsubscribe()` takes effect immediately, also mid-flush, and its queued events stop counting toward `maxQueued`.
- **Bounds and overload:** pending deliveries are capped by `maxQueued` (default 4096); beyond it, events are dropped,
  counted on the observer (`dropped`), in `trackingStats().dropped` and in the flush report, and the observer's
  optional `overflow(count)` is called once at the end of the next flush. One flush delivers at most
  `maxDeliveriesPerFlush` (default 16384); the rest stay queued (`deferred`). `maxObservers` (default 256) caps
  registrations.
- **Failure:** an observer that throws does not stop the others; the flush finishes, then throws one `AggregateError`.
  In a scene this is reported as a failure of the system after which the flush ran (the last system to run, which may
  not be the one whose change queued the event, for example when events were queued in `enter` or deferred by the
  per-flush bound). When that system also threw, both errors are reported once together as one `AggregateError`.

## Cached queries

```ts
const movers = ctx.world.cachedQuery(Transform, Velocity);
for (const [e, tr, v] of movers) { ... }
movers.dispose();
```

- Maintained from structural changes (`add` of a new component, `remove`, `despawn`); it never scans stores after
  construction. Rows, values and order are those of `query(Transform, Velocity)`, including the rules for changes
  made while iterating: an entity is visited only if it matched when the pass began and still matches when reached;
  entities that join during a pass appear in the next one.
- `size`, `has(e)`, `dispose()`. Disposing ends a pass in progress; iterating a disposed query throws. At least one
  type is required. `maxCachedQueries` (default 256) caps live caches.
- Cost: adds and removes of a listed type do extra set work, and a pass after out-of-order joins or after leaves
  rebuilds the order once (sort or filter of the members).

## Limits

Set with `world.configureTracking({maxQueued, maxDeliveriesPerFlush, maxObservers, maxCursors, maxCachedQueries,
maxTick})` before the first cursor, observer or cached query (later calls are refused). Each must be a positive safe
integer; `maxTick` at least 8. Exceeding a registration bound throws `RangeError`; disposing frees the slot.

## Evidence

- Unit tests (`src/core/ecs/world-tracking.test.ts`): filter semantics, refusals, a deterministic rebase with
  overflowed and in-range cursors, observer order, reentrancy, unsubscribe mid-flush, queue overflow, deferral, error
  aggregation, cached-query join/leave/dispose during iteration, bounds, the runner hook and `sinceLastRun`.
- Seeded model tests (`src/core/ecs/world-tracking-model.test.ts`): 4 seeds x 4,000 random operations, plus 3 seeds
  with `maxTick: 64` (many rebases, overflowed cursors), compared with an independent brute-force reference for filter
  results, observer event logs, cached-query contents and `version`, including spawns, despawns, adds and removes made
  while uncached, cached and filtered queries iterate. A third test shows a world that never uses tracking matches the
  reference and reports all-zero stats.
- Composition (`src/author/world-tracking-scene.test.ts`): a `testScene` with a system that marks changes, an observer
  delivered before the next system, a `sinceLastRun` system, and an observer error reported as a system failure.
- Local, unofficial microbenchmark (`npx tsx scripts/perf/ecs-queries.ts`, Node 26, one machine): iterating a cached
  `(A, B)` query matching half of the entities took about 41-49 ns per row against 61-82 ns uncached at 1,000 entities
  (about 1.2-2x) and about 59-70 ns against 80-83 ns at 10,000 (about 1.1-1.4x); with 1% of entities despawned and
  respawned before every pass there was no gain (0.9-1.04x). Spawning and despawning every entity with one cached
  query and three tracked types cost about 40% more than without. A world not using the features measured within
  about 5% of the previous implementation on a spawn/query/despawn loop.

## Not established

- No physical device, browser or multiplayer acceptance; the numbers above are one local Node run.
- No automatic change detection: direct edits need `markChanged`. Built-in engine systems do not call it, so
  `changed(Transform)` sees only adds, replaces and explicit marks.
- Observers are not persisted, replicated or saved; cursors and caches are per world and per scene visit. Tracking
  state (ticks, cursors, queued events, cached sets) is not part of saves, world snapshots, rollback or replay
  digests; a restored or replayed world starts tracking afresh.
- A cursor whose owner stops advancing it can, after a rebase, report false positives (never misses).
- No archetype storage: cached queries remove the per-pass candidate scan and sort, not per-row map lookups.
