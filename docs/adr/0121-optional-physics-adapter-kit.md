# ADR 0121: optional physics adapter kit over a lazily loaded WebAssembly library

- **Status:** Proposed (candidate implementation)
- **Date:** 2026-10-09
- **Area:** Optional kits / Simulation / Dependencies

## Context

<!-- docs-claims: allow PHYSICS the stance before this ADR -->
Until now the engine had no physics engine. The README listed rigid-body physics
under "Not here yet", and the collision recipe pointed to overlap tests and the
character kit's kinematic blocking. The creator reversed the earlier rejection
of physics middleware:

- Physics middleware is allowed as an optional adapter kit over a maintained,
  permissively licensed WebAssembly rigid-body library.
- The kit needs fixed-step integration, a deterministic mode where the library
  supports one, and snapshot/restore for rollback.
- The volume-query and character kits must compose on top.
- One new runtime dependency is approved, for this kit only.

The candidates, criteria, verified facts and a critic pass are in
[the physics middleware study](../research/physics-middleware.md).

## Decision

1. **Scope of the stance change.** <!-- docs-claims: allow PHYSICS names the amended stance --> This ADR amends the "no physics engine" stance
   only for creators who opt in by importing `@kits/physics`. Core, platform and the
   author API stay physics-free and import nothing from the kit (`lint:layers`).
2. **One dependency, exact-pinned.** `@dimforge/rapier3d-deterministic-compat` 0.21.0
   (Apache-2.0) is the one new runtime dependency.
3. **Lazy loading.** The library enters a build only through one dynamic `import()`
   in `src/kits/physics/loader.ts`; every other kit file imports its types only. A game
   that does not import the kit ships none of it: stock first-load JS was 175.6 KiB
   both before and after. A game that does import it fetches the library chunk only
   when a scene's `prepare` loads it.
4. **One owner per visit.** A physics world belongs to one scene visit. It owns its
   library world, event queue and character controllers, and frees each exactly once
   on exit or abort.
5. **Fixed step.** The world advances on the existing fixed lane: one call per 60 Hz
   tick, `substeps` (1–8) library steps of `timeScale / (60 × substeps)` seconds each.
   A `timeScale` other than 1 is an explicit creator decision.
6. **Explicit bounds.** Admission of bodies, colliders and characters, collision events
   per tick, query hits, snapshot bytes and debug vertices all have configured limits.
   Overload is refused or counted and reported, never silently truncated.
7. **Rollback.** Snapshots are text (JSON with the library bytes in base64, the
   entity↔handle mapping and the tick), so they plug into `@kits/rollback`'s
   `save`/`load` ports. A restore is validated before it commits.
8. **Character composition.** `physicsCharacterSystem` reuses the character kit's
   inputs, motion integrator and facing, and resolves the displacement through the
   library's kinematic character controller. The only character-kit change is an
   additive `createMotion({velocity})` option, so a restored integrator resumes its
   ramp.

## Consequences

- Determinism evidence is same-process Node only:
  - byte-identical snapshots from identical operations;
  - restore at step k and replay matching an uninterrupted run;
  - a passing rollback sync test;
  - two rollback peers that agree.

  Cross-browser and cross-device bit-identity is the library's upstream claim and is
  not established here.
- A game using the kit carries a 4,366,824-byte (1,658,896 bytes `gzip -9`) lazy chunk.
  That exceeds the 500 kB large-chunk rule, so the game must list the chunk in its
  own `largeChunkAllow`. That is a creator budget decision; no budget changed here.
- WebAssembly linear memory does not shrink after `dispose()`.
- The library is pre-1.0. Upgrades are deliberate, with the tests re-run.
- Physics state is the creator's game rule (STD-SIM-10). Presets must not change
  `substeps`, `timeScale` or `solverIterations`.

## Alternatives

Nineteen other options, ranging from other Rapier builds, Jolt, PhysX, Bullet,
Havok and 2D libraries to an in-house solver, worker- or server-hosted physics and
the status quo, are compared in the study. Jolt is the strongest runner-up, pending a
documented deterministic WebAssembly build and binding-level state recording.
