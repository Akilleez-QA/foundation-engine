# Recipe: use a spatial index for neighbours, range and interest

When a scene has many entities that need "who is near me" answers every frame (local
avoidance, area effects, sensing, per-observer visibility, per-connection interest), use
the optional `spatial` kit instead of comparing every pair. Contract and limits:
[kit README](../../src/kits/spatial/README.md); evidence: [guide](../guides/spatial-index.md).

## 1. State the requirement and bounds

Write down, in GAME.md or the application record: the plane and units (for example the
`Transform` x/z ground plane in metres), the world rectangle, the largest population, the
query radii, and what an incomplete answer must do. Then choose:

- `cellSize`: about the most common query radius (neighbour radius to twice it).
- `maxEntries`: the largest population you admit; an extra insert returns `saturated`.
- `maxCells`: at least `ceil(width / cellSize) x ceil(height / cellSize)`.
- `maxCellsPerQuery`: the widest query you accept, in cells (a radius `r` needs about
  `(2r / cellSize + 1)^2`). Wider queries return `too-wide` without work.
- Buffer lengths: the most ids one query may return (`k` for nearest queries).

## 2. Own the grid per scene visit and feed it from a system

```ts
import { defineScene, defineSystem, Transform } from '@engine';
import { createSpatialGrid, type SpatialGrid } from '@kits/spatial';
import { Agent } from './agent';

let grid: SpatialGrid | null = null;                // one owner: the current visit
const near = new Float64Array(6);                   // allocated once, outside the frame

const proximity = defineSystem({ id: 'game-proximity', run(ctx) {
  if (!grid) return;
  for (const [e, , tr] of ctx.world.query(Agent, Transform)) {
    if (grid.move(e, tr.x, tr.z) === 'absent') grid.insert(e, tr.x, tr.z);
  }
  for (const [e, agent, tr] of ctx.world.query(Agent, Transform)) {
    const r = grid.queryNearest(tr.x, tr.z, agent.senseRadius, near, e);
    // near[0 .. r.count) are the closest ids, nearest first; ties by ascending id.
  }
} });

export default defineScene({ id: 'field', title: 'field.title', systems: [proximity],
  enter() { grid = createSpatialGrid({ cellSize: 8, minX: -256, minY: -256, maxX: 256, maxY: 256,
    maxEntries: 4000, maxCells: 4096, maxCellsPerQuery: 16 }); },
  exit() { grid?.dispose(); grid = null; },
});
```

Remove ids when entities despawn (`grid.remove(e)`). Check the `insert` status: a
`saturated` or `out-of-bounds` entity is not indexed and will not be found.

## 3. Treat incomplete results deliberately

`truncated` means the buffer filled: the set is incomplete. For disclosure (what a player
or connection may see) fail closed: show or send nothing new from that query, or split it.
For steering, `queryNearest` returns the closest `k` by design and never reports
`truncated`. `too-wide` means the query exceeded the cell bound: narrow it or raise the bound
with the creator's agreement.

## 4. Test and measure

- Test the consumer with `testScene`, as `src/kits/spatial/spatial.test.ts` does, including
  movement across cells, despawn and the incomplete case.
- Measure with `npm run bench:spatial`, and the scene with `npm run play:snap`. The index
  adds no draws or triangles; its CPU cost is per-frame work for the scene budget.
