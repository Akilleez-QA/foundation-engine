---
name: fix-budget
description: Bring a scene back under its performance budget, or measure a new scene's budget, without raising any number unless the author approves. Use when play:snap says OVER BUDGET, the gate fails on perf budgets, or a scene's budget is still the brief's unmeasured ceiling.
---

# Fix a budget

Budgets only fall. A raise needs the author's explicit approval and a `Perf-Budget: <key> <old> -> <new>: <reason>` commit trailer (docs/recipes/add-a-budget.md).

1. Find the breach: `npm run play:snap -- --scene <id>` (draws, triangles per frame) or the gate's report (which metric, which window: idle or active).
2. **Count draw calls before triangles.** Each draw has a fixed CPU and driver cost, so on phones the draw count usually runs out long before the triangles do. The numbers that bind are the scene's row in `budgets.json` and the brief's per-scene ceiling for its minimum device (`brief.performance.perScene.draws`; the phone tier's default is 100 per scene). As guidance, about 100 draws per scene is what phones carry well; the brief's and `budgets.json`'s numbers always win. Cut triangles only once the draws fit, or when triangles are the metric over.
3. Recover, in this order, and re-measure after each:
   1. **Simplify**: fewer entities, simpler shapes (a box instead of a capsule), fewer segments, hide what the camera cannot see.
   2. **Instance and scatter**: many copies of one thing should be one draw, not one entity each. The author API has no general instancing yet (an instanced scatter API is planned, not landed), so:
      - Static repeats (rocks, grass tufts, fence posts, crates in a row): build them into **one** `defineMesh({ positions, indices, colors })` on a single entity with `Mesh(...)`, as `templates/terrain/game/scatter.ts` does. Place them with `createSurfaceScatter` from `@kits/terrain` (seeded, bounded to 4,096 cells, stable identities), or with `ctx.random()` for a flat area. Rebuild the mesh only when the placement changes, never per frame. `defineMesh` caps a mesh at 262,144 vertices; the scene's budget is the real limit.
      - Many small moving things (sparks, debris, dust, pickups' glints): one `Emitter` (`defineEmitter`) is one instanced draw per emitter, fixed-step and seeded (docs/guides/particles.md).
      - Many copies that must each move or be picked on their own: merge what can stay still; otherwise explain the cost to the author before proposing an engine change.
   3. **Bake**: merge static scenery into one `Mesh` (`defineMesh` with vertex colours; the builders in the [art-direction recipe](../../../docs/recipes/art-direction.md) section 5); fewer materials means fewer draws. A `Mesh` takes no `Material`, so textured, glowing or see-through things stay `Shape`s.
   4. **LOD**: less detail far from the camera.
4. Nothing redraws when nothing changed (render on change): a system that touches the world every frame without a visible change breaks the idle window. Only touch what moved.
5. Measure: `npm run bench -- --only <first>,<id> --no-check`, then `npm run perf:derive -- perf/runs/<file>.json`; write the derived numbers and provenance into `budgets.json`. Lowering needs nothing.
6. If none of that is enough, stop and ask the author: explain the cost, what it buys, and the exact trailer you would add. Never raise a budget or loosen a tolerance on your own.
