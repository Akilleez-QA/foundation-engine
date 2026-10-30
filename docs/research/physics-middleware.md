# Physics middleware options for an optional adapter kit

Research pass: 2026-10-09. Decision record: [ADR 0121](../adr/0121-optional-physics-adapter-kit.md).
This note compares candidates for an optional rigid-body physics kit. It names public
libraries only. No library source was copied into the repository; the chosen
library is consumed as an exact-pinned npm package.

## Creator requirement

The creator authorised physics middleware as an optional adapter kit: a maintained,
permissively licensed WebAssembly rigid-body library. It must offer fixed-step
integration and a deterministic mode where the library supports one. It must also
offer snapshot and restore for rollback. The volume-query and character kits must
compose on top. Core stays physics-free. A game that does not use the kit must pay
no bundle cost. One new runtime dependency is approved, for this kit only.

## Criteria

1. **Licence** compatible with distribution inside a GPL-3.0-only browser build.
2. **Maintenance**: recent releases and an active upstream.
3. **3D** rigid bodies. 2D-only libraries do not meet the requirement as stated.
4. **Determinism**: a flag or build with a cross-platform guarantee, not just same-machine repeatability.
5. **Snapshot/restore**: a whole-world serialisation API usable for rollback.
6. **Character controller**: a kinematic controller with slopes, steps and snap-to-ground.
7. **Bundle and WebAssembly size.**
8. **Loading under Vite** without extra plugins. The engine's Vite configuration adds no WebAssembly plugin.
9. **API stability**, including the version series and the binding surface.

## Verification method

"Verified" facts come from `npm view <pkg> version license dist.unpackedSize time.modified`,
run on 2026-10-09 against the public registry. The chosen package was also checked
by installing and exercising it in Node: `init`, `World`, `takeSnapshot`/`restoreSnapshot`,
`EventQueue`, `createCharacterController` and `debugRender`. Upstream feature claims
not exercised here are marked **unverified**. Unpacked size is the whole npm package.
It is often several builds or source maps, not the shipped bytes.

## Comparison (20 options)

| # | Option | Licence (npm metadata) | Version, last publish | Unpacked | 3D | Determinism | Snapshot | Character controller | Vite loading | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Rapier 3D deterministic compat (`@dimforge/rapier3d-deterministic-compat`) | Apache-2.0 | 0.21.0, 2026-09-25 | 15.1 MB | Yes | Deterministic build; upstream states cross-platform bit-level determinism for identical operation sequences (cross-platform claim **unverified** here; same-process byte-identical snapshots verified) | `World.takeSnapshot()` / `World.restoreSnapshot()` (verified) | `KinematicCharacterController` (verified: slopes, autostep, snap) | Plain dynamic `import()`, wasm inlined as base64 (verified: one 4.37 MB JS chunk) | **Chosen** |
| 2 | Rapier 3D compat (`@dimforge/rapier3d-compat`) | Apache-2.0 | 0.21.0, 2026-09-25 | 15.0 MB | Yes | No cross-platform guarantee (the deterministic feature is a separate build) | Yes | Yes | Same as 1 | Rejected: no deterministic mode |
| 3 | Rapier 3D SIMD compat (`@dimforge/rapier3d-simd-compat`) | Apache-2.0 | 0.21.0, 2026-09-25 | 15.8 MB | Yes | No; requires WebAssembly SIMD support | Yes | Yes | Same as 1 | Rejected: faster but not deterministic; a creator may swap it in through the loader |
| 4 | Rapier 3D deterministic, non-compat (`@dimforge/rapier3d-deterministic`) | Apache-2.0 | 0.21.0, 2026-09-25 | 5.0 MB | Yes | As 1 | Yes | Yes | Imports a separate `.wasm` as an ES module; needs bundler WebAssembly-module support (a plugin under this Vite setup; **unverified** which plugin works with Rolldown) | Deferred: smaller transfer (no base64), revisit when a plugin is approved |
| 5 | Rapier 2D deterministic compat (`@dimforge/rapier2d-deterministic-compat`) | Apache-2.0 | 0.21.0, 2026-09-25 | 12.2 MB | No (2D) | As 1 | Yes | Yes (2D) | As 1 | Rejected: 2D only (a candidate for a later 2D kit) |
| 6 | Bullet via ammo.js (`ammo.js`) | Field absent in npm metadata; upstream Bullet is zlib (**unverified** for this build) | 0.0.10, 2022-06-13 | n/a | Yes | No cross-platform guarantee (**unverified**) | No whole-world snapshot in the binding (**unverified**) | `btKinematicCharacterController` exists in Bullet (**unverified** in binding) | Emscripten glue; usually loaded as a script or a separate wasm | Rejected: stale npm releases, unclear licence metadata |
| 7 | Jolt via `jolt-physics` | MIT | 1.1.0, 2026-07-11 | 46.4 MB (several builds) | Yes | Jolt has a cross-platform determinism compile option upstream; whether the npm WebAssembly builds enable it is **unverified** | Jolt `StateRecorder` save/restore upstream; binding exposure **unverified** | `CharacterVirtual` upstream (**unverified** in binding) | Multiple build flavours; wasm loading model per flavour **unverified** | Strong runner-up: revisit if its deterministic build is published and documented |
| 8 | PhysX via `physx-js-webidl` | MIT (binding); PhysX SDK BSD-3-Clause upstream (**unverified** in package) | 2.8.0, 2026-09-27 | 10.4 MB | Yes | PhysX "enhanced determinism" is same-platform; cross-platform **unverified** | No whole-scene serialisation in the binding (**unverified**) | Character controller extension upstream (**unverified** in binding) | Separate wasm with Emscripten loader (**unverified** under Vite without plugin) | Rejected: determinism and snapshot not established |
| 9 | Havok via `@babylonjs/havok` | MIT (npm metadata) | 1.3.14, 2026-09-07 | 4.4 MB | Yes | **Unverified** | **Unverified** | Character support **unverified** | Separate wasm | Rejected: the WebAssembly binary's corresponding source is not published (**unverified**), which is a risk for a GPL-3.0-only distribution |
| 10 | `cannon-es` | MIT | 0.20.0, 2022-08-12 | 0.77 MB | Yes | None (plain JS floats, no guarantee) | None built in | None built in | Plain JS | Rejected: no determinism or snapshot; maintenance stalled |
| 11 | OimoPhysics (`oimophysics`) | MIT | 1.2.2, 2024-03-18 | 1.76 MB | Yes | None documented | None built in | None built in | Plain JS | Rejected |
| 12 | Box2D v3 WebAssembly (`box2d3-wasm`) | MIT | 5.2.0, 2026-02-16 | 1.34 MB | No (2D) | Box2D v3 upstream claims cross-platform determinism (**unverified** for this build) | Upstream snapshot **unverified** | 2D mover upstream (**unverified**) | Separate wasm (**unverified** without plugin) | Rejected: 2D only |
| 13 | Box2D 2.4 WebAssembly (`box2d-wasm`) | Zlib | 7.0.0, 2022-04-12 | 2.02 MB | No (2D) | No | No | No | Separate wasm | Rejected: 2D, stale |
| 14 | planck.js (`planck`) | MIT | 1.5.0, 2026-04-07 | 9.1 MB | No (2D) | No guarantee | No whole-world API | No | Plain JS | Rejected: 2D |
| 15 | matter-js / p2-es | MIT / MIT | 0.20.0, 2024-06-23 / 1.2.3, 2023-11-01 | 0.93 MB / 0.67 MB | No (2D) | No | No | No | Plain JS | Rejected: 2D, no determinism |
| 16 | In-house minimal impulse solver | GPL-3.0-only (own code) | n/a | Small (estimate) | Yes, if written | Possible with `dmath` and fixed-point care | Possible (own state) | The existing character kit | Plain TS | Rejected for now: years of solver, contact and stability work before parity; a large correctness risk |
| 17 | Extend the kinematic character kit only | GPL-3.0-only | n/a | Small | Partial (ground plane, height queries) | Already `dmath`-capable | ECS state | Yes (planar) | Plain TS | Kept as the default lightweight path; it does not provide rigid bodies |
| 18 | Worker-hosted physics (any library in a worker) | n/a | n/a | As the library | As the library | As the library | As the library | As the library | Worker plus the library | Deferred: same-tick events, queries and synchronous snapshot for rollback need main-thread access; a worker adds at least a tick of latency |
| 19 | Server-only authoritative physics | n/a | n/a | No client cost | As the server library | Server is the authority | Server-side | Server-side | n/a | Rejected as the only option: needs a server; it does not serve single-player or local rollback |
| 20 | No kit (status quo) | n/a | n/a | 0 | n/a | n/a | n/a | Character kit | n/a | Rejected: the creator authorised the kit; it remains the choice of every game that does not opt in |

Not counted: Newton Dynamics, for which no maintained npm WebAssembly package was
found (search not exhaustive). The npm name `bounce` belongs to an unrelated error-handling
utility (BSD-3-Clause, 1.2.3, verified), not a physics engine.

## Decision

Rapier's deterministic compat build (option 1), exact-pinned at 0.21.0:

- It is the only verified candidate that meets every criterion at once: 3D, a deterministic build, a whole-world snapshot API, a kinematic character controller and permissive Apache-2.0 licensing.
- It also loads under the existing Vite configuration with a plain dynamic `import()`.
- The cost is transfer size: the WebAssembly binary is inlined as base64. Measured in a fixture build: a 4,366,824-byte chunk, 1,658,896 bytes with `gzip -9`.

## Critic pass

Objections raised against the choice, and the answers recorded:

1. **"A 4.4 MB chunk is unacceptable on phones."**
   - The chunk is fetched only by games that list the kit, and only when a scene's `prepare` loads it.
   - Stock first-load JS is unchanged (175.6 KiB before and after).
   - The 500 kB large-chunk rule still applies. A game using the kit must list the chunk in its own `largeChunkAllow`, which is a creator budget decision.
   - The non-compat deterministic build (option 4) would remove the base64 overhead once a WebAssembly bundling path is approved. The loader is injectable, so that change stays local.
2. **"The deterministic build is slower than SIMD."**
   - Accepted. The kit's snapshot, rollback and determinism claims depend on it.
   - A creator who does not need determinism can inject the compat or SIMD build through `createPhysicsLoader`. The kit's determinism evidence then no longer applies, and the guide says so.
3. **"0.x versions break APIs."**
   - The version is exact-pinned.
   - Library types are imported type-only, and all calls go through one adapter file (`world.ts`).
   - An upgrade is a deliberate change with re-run tests.
4. **"Cross-platform determinism is claimed, not shown."**
   - Correct. The evidence covers same-process Node runs only: byte-identical snapshots, restore-and-replay, and the rollback sync test.
   - Browser-versus-Node, browser-versus-browser and physical-device comparisons are not established. The kit README marks them unverified.
5. **"Two sources of truth: ECS `Transform` and the physics world."**
   - Authority is per body kind:
     - dynamic bodies: the physics world writes `Transform` back;
     - kinematic bodies and characters: `Transform` drives the physics world;
     - fixed bodies: read once on admission.
   - Dynamic `Transform` writes are never fed back, so a float round trip cannot diverge a replay.
6. **"WebAssembly memory never shrinks."**
   - True. `dispose()` frees every object the visit created, but the page's linear-memory high-water mark persists.
   - This is documented as a limitation.
7. **"A trap inside the WebAssembly module could poison the page."**
   - The adapter validates input before every library call: shapes, sizes, finite vectors, and handle existence before a restore commits.
   - A corrupt snapshot made `restoreSnapshot` return null in a test, rather than trap.
   - Other panics are not exhaustively tested.
8. **"Apache-2.0 with GPL-3.0-only."**
   - Apache-2.0 code may be combined into a GPLv3 work, per the FSF and Apache guidance already cited in THIRD_PARTY_NOTICES.md.
   - The notice and full licence text are reproduced there.
9. **"Snapshots are big for rollback."**
   - Measured text sizes: 41.6 KB for 14 boxes on a floor, 285 KB for 100, 1.76 MB for 500.
   - `maxSnapshotBytes` bounds them, and the rollback kit's `maxStateBytes` bounds them again.
   - The guide says that per-frame snapshots of large worlds are a garbage-collection cost.
10. **"The character adapter duplicates the character kit."**
    - It reuses the kit's inputs, integrator and facing helpers. Only resolution changes.
    - The one character-kit change is additive: `createMotion({velocity})`, needed to restore the integrator's velocity after a rollback or reload.
