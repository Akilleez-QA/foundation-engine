---
name: fix-budget
description: Bring a scene back under its performance budget, or measure a new scene's budget, without raising any number unless the author approves. Use when play:snap says OVER BUDGET, the gate fails on perf budgets, or a scene's budget is still the brief's unmeasured ceiling.
---

# Fix a budget

Budgets only fall. A raise needs the author's explicit approval and a `Perf-Budget: <key> <old> -> <new>: <reason>` commit trailer (docs/recipes/add-a-budget.md).

1. Find the breach: `npm run play:snap -- --scene <id>` (draws, triangles per frame) or the gate's report (which metric, which window: idle or active).
2. Recover, in this order, and re-measure after each:
   1. **Simplify**: fewer entities, simpler shapes (a box instead of a capsule), fewer segments, hide what the camera cannot see.
   2. **Instance**: many copies of one primitive `Shape` or one `Mesh` should be one draw. Replace the copies with a
      `Scatter` (`defineScatter({ shape | mesh, points | area + count, seed, ... })`, optional `Material` on the same
      entity) in a scene with `scatter: sceneScatter()`; see docs/recipes/scatter-grass-and-rocks.md. It draws one
      `InstancedMesh` per scatter: draws fall to one, triangles stay `copies x triangles per copy` (play:snap's probe
      lists them per scatter). A scatter has no collision: keep the `Solid` or `Walls` rows that block movement. Many
      short-lived sprites (sparks, dust) are particles (`defineEmitter`), also one draw each. glTF `Model` copies cannot
      be scattered yet (bake or simplify them).
   3. **Bake**: merge static scenery into one `Mesh` (`defineMesh` with vertex colours; the builders in the
      [art-direction recipe](../../../docs/recipes/art-direction.md) section 5). A `Material` on the `Mesh` shades it
      (flat, toon, emissive), but a `Mesh` has no texture coordinates, so textured things stay `Shape`s.
   4. **LOD**: less detail far from the camera.
3. Nothing redraws when nothing changed (render on change): a system that touches the world every frame without a visible change breaks the idle window. Only touch what moved.
4. Measure: `npm run bench -- --only <first>,<id> --no-check`, then `npm run perf:derive -- perf/runs/<file>.json`; write the derived numbers and provenance into `budgets.json`. Lowering needs nothing.
5. If none of that is enough, stop and ask the author: explain the cost, what it buys, and the exact trailer you would add. Never raise a budget or loosen a tolerance on your own.
