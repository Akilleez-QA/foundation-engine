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
import { createQueryResult, createSpatialGrid, type SpatialGrid } from '@kits/spatial';
import { Agent } from './agent';

let grid: SpatialGrid | null = null;                // one owner: the current visit
const indexed = new Set<number>();                  // ids currently in the grid
const near = new Float64Array(6);                   // Float64Array or number[]; allocated once
const res = createQueryResult();                    // reused: no allocation per query

const proximity = defineSystem({ id: 'game-proximity', run(ctx) {
  if (!grid) return;
  for (const e of indexed) if (!ctx.world.exists(e)) { grid.remove(e); indexed.delete(e); }   // despawned
  for (const [e, , tr] of ctx.world.query(Agent, Transform)) {
    let status: string = grid.move(e, tr.x, tr.z);
    if (status === 'absent') status = grid.insert(e, tr.x, tr.z);
    if (status === 'moved' || status === 'inserted') indexed.add(e);
    else { grid.remove(e); indexed.delete(e); }     // out-of-bounds or saturated: never stale
  }
  for (const [e, agent, tr] of ctx.world.query(Agent, Transform)) {
    const r = grid.queryNearest(tr.x, tr.z, agent.senseRadius, near, e, res);
    // near[0 .. r.count) are the closest ids, nearest first; ties by ascending id.
  }
} });

export default defineScene({ id: 'field', title: 'field.title', systems: [proximity],
  enter() { grid = createSpatialGrid({ cellSize: 8, minX: -256, minY: -256, maxX: 256, maxY: 256,
    maxEntries: 4000, maxCells: 4096, maxCellsPerQuery: 16 }); },
  exit() { grid?.dispose(); grid = null; indexed.clear(); },
});
```

An `out-of-bounds` move leaves the entry at its old position, so remove it as above rather
than ignoring the status; otherwise a stale position keeps being found (and, for disclosure,
keeps being sent). A `saturated` or `out-of-bounds` insert means the entity is not indexed.
Keep `k` (the `near` length) small: `queryNearest` costs O(entries examined x k).

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
