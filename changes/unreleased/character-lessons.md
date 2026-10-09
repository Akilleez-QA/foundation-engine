- **Docs: lessons from a character-crowd lab.** Two new guides record practices learned building skinned, mocap-driven
  characters and a crowd in a lab, written generically and marked as practices rather than engine features:
  [character pipeline lessons](docs/guides/character-pipeline-lessons.md) (rest-pose alignment on limb chains only,
  heel-flat-ball foot planting and gait-symmetry gates, re-cleaning skin weights on every LOD, resampling and loop
  seams, clip QA) and [crowd and night rendering lessons](docs/guides/crowd-and-night-rendering-lessons.md) (per-pass
  character cost, animation cadence by on-screen rank, inertialized transitions, specular and HDR caps under bloom,
  mirror reflection cost, fitted grading tables, GPU and warm-up honesty in measurement). Each says where the engine
  has no such step, and points at the engine features that cover part of it (inertialized transitions, post
  lookup tables and HDR ceiling, interior reflections, blob shadows, settled snaps). Linked from the docs index, the labs guide and the load-a-model recipe.
