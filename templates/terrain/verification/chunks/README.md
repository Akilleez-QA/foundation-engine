# Finite chunk replacement verification

2026-09-30 working tree, terrain template. Existing scene budgets unchanged.

- `GAME_DIR=templates/terrain/game npm run play:snap -- --scene yard --mobile`: desktop and phone images inspected. Initial complete coverage: 6 draws, 5,036 triangles, 60fps / 16.7ms p95 moving; zero still renders. This local browser sample is not a target-device performance guarantee.
- `GAME_DIR=templates/terrain/game npm run play:script -- templates/terrain/verification/chunks-smoke.json`: passed, no page errors. Teleporting between opposite corners produces `[1,2,2,1]` then `[2,2,2,1]`, with three far variants built total. Both screenshots inspected; authored pad tile stays exact to retain its visible material boundary.
- Twelve focused terrain/chunk tests pass: full projected area every frame, all four shared seams, bounded publications/builds, canonical contact, reuse, isolated visits and idempotent cleanup.
- Full integration gate belongs to the combined branch validation; these files do not claim it ran.

The probe and report retain their original local paths for traceability. PNGs here are the corresponding copies. This is finite cached LOD; it does not exercise an external asset stream or residency adapter.
