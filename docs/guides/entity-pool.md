# Entity pool with eviction classes

Choose `@kits/entity-pool` when a scene spawns more transient things than it should keep (sparks, debris, ambient
creatures, dropped pickups) and you want a hard cap that removes the least important first instead of refusing
something important. The [kit contract](../../src/kits/entity-pool/README.md) lists inputs, outputs, bounds,
overload and evidence. The helper is optional and installs nothing.

## Choose the existing owners

- World: spawn through `spawnPooled(world, pool, cls, inits, out)` and end members through
  `despawnPooled(world, pool, e)`. Evicted entities are despawned before `POOL_EVICTED` events are read by later
  systems in the same frame.
- Budgets: the cap is a creator number. A useful choice is the headroom a scene's measured budget leaves for pooled
  things, in one unit (triangles or draws), with each class's `cost` its per-member share. The pool keeps the count
  under the cap; the gate still measures the scene.
- Time and order: drive it from fixed-step systems. Eviction order comes from admission order or your scores, so
  `?seed=` runs replay the same evictions.
- Placements and dormancy: if a pooled thing comes from an authored placement, treat an eviction like any other
  removal by its owner (mark the placement dormant again, not destroyed). The pool itself remembers nothing across
  saves.

## Choosing classes

Give each class a priority. Only `evictable` classes can lose members, and only to higher-priority requests;
`replaceOwn` lets a class recycle its own oldest (or lowest-score) member when it or the pool is full. Pin members
the player is holding or that a script needs. Set `maxEvictionsPerAdmit` so one admission cannot clear a large share
of the scene at once; a refusal with `eviction-limit` or `capacity` means the request was less important than what
is there, or the cap is too low for the scene's design.

## Evidence and limits

Headless tests only: an independent model comparison, a World fixed-step consumer with a cost cap and events, and
owner recovery. No template consumer, browser or device acceptance.
