# Recipe: add an entity and a component

A **component** is plain data on an entity. An **entity** prefab is a named list of component initialisers, spawned fresh each time.

```ts
import { defineComponent, defineEntity, Name, Shape, Transform } from '@engine';

export const Health = defineComponent('health', { hp: 3, max: 3 });
export const Velocity = defineComponent('velocity', { x: 0, z: 0 });

export const coin = defineEntity({ id: 'coin', components: [
  Name({ name: 'coin' }), Transform({ y: 0.4 }), Shape({ kind: 'cylinder', size: [0.6, 0.1, 0.6], color: 0xffd23f }),
] });
```

- `defineComponent(id, initial)`: the initial value fixes the shape. `Health({ hp: 5 })` overrides fields for one entity.
- The built-ins the engine reads: `Transform` (position, rotation, scale), `Shape` (a primitive the scene runtime draws: box, sphere, cylinder, cone, plane, capsule) and `Name` (so systems, tools and tests find an entity with `ctx.named('player')`). A `Material` gives a shape a texture and a physically based look ([recipe](give-a-shape-a-material.md)).
- Components hold data only: logic belongs in systems. Mutate them in place; call `ctx.world.touch()` when you change something the renderer should redraw outside `Transform`/`Shape`.

## Use them

- In a scene: `entities: [coin, [Name({ name: 'player' }), Transform(), Health()]]`.
- At run time: `ctx.spawn(coin, Transform({ x: 2 }))` and `ctx.world.despawn(e)`.
- Query: `for (const [e, tr, hp] of ctx.world.query(Transform, Health)) { … }` (spawn order, deterministic). Spawning, despawning, adding or removing components inside the loop is safe: an entity is visited only if it matched when the loop began and still matches when it is reached (never with an `undefined` component); anything spawned or newly matching during the loop appears in the next query.
- Optional, when a system should only look at what changed: `ctx.world.trackChanges(Health)`, `ctx.world.markChanged(e, Health)` after editing it directly, and a `sinceLastRun` system iterating `ctx.world.queryFiltered(since, [changed(Health)], Health)`; observers (`ctx.world.observe`) and cached queries (`ctx.world.cachedQuery`) are there too. Nothing changes for a world that does not use them ([guide](../guides/world-change-detection.md)).

## Test

```ts
const t = await testScene(level);
const player = t.ctx.named('player')!;
assert.equal(t.world.get(player, Health)!.hp, 3);
```
