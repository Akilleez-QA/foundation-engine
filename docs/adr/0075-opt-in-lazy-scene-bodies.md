# ADR 0075: opt-in lazy scene bodies

- **Status:** Accepted
- **Date:** 2026-09-30
- **Area:** Author tooling and loading boundaries

## Decision

`new scene <id> --lazy-body` generates a lightweight `.ts` scene definition and
an `<id>.body.mts` module, loaded through the existing dynamic `SceneBody` callback.
The default generator retains its inline body. The flag does not introduce a new
runtime API, change device requirements or lower authored quality.

Definition discovery continues scanning ordinary `.ts` files. A `.body.mts` module
is intentionally outside that scan, so it is evaluated through its scene callback.
Body-only transitive helpers must also remain outside eager discovery and static
imports from startup definitions; a filename alone does not guarantee laziness.
Shared eager dependencies stay eager. Existing `.ts` exports remain discoverable.

The learn template's day/night body demonstrates the convention. Tests must prove
that definition loading does not evaluate the body and that entering it still runs
the scene. Bundle and startup savings require separate emitted-chunk inspection and
measurement; this decision claims no unmeasured size or performance improvement.

## Author workflow

See [add a scene](../recipes/add-a-scene.md). Generated scene tests, budget entries
and changelog rows are retained for either mode. Existing output files are never
overwritten; lazy output collisions are checked before writing the scene files.
