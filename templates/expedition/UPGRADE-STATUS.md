# Engine upgrade coverage

Audit date: 2026-09-30. This inventory describes inspected engine mechanisms and
bounded diagnostic consumers. It replaces the earlier phase-one checklist, which
incorrectly listed several completed phase-two mechanisms as absent. It is not a
completion percentage, a promise of every possible feature, or a release certificate.
Paths below are relative to the repository root.

Foundation Engine supplies reusable mechanisms. Optional kits compose those
mechanisms; templates demonstrate them. Game rules, authored worlds, progression
balance and production content remain application responsibilities. All code and
fixtures must be independently authored or carry compatible license notices.

**Implemented** describes the stated contract only. A **limitation** defines what
that contract does not provide. A **candidate** is an identified improvement that
still needs a concrete consumer, scope and acceptance evidence before implementation.
Utility tests, browser diagnostics, integration gates and publication are separate
forms of evidence; none substitutes for the others.

## Terrain and spatial representation

| Implemented contract and source | Consumer or test evidence | Remaining boundary |
|---|---|---|
| Canonical finite Float32 heightfield, triangle contact/rays, material identity and exclusions: `src/kits/terrain/surface.ts` | `surface.test.ts`, `raycast.test.ts`; terrain diagnostic samples the same surface it renders; ray tests include 250 independent triangle-oracle comparisons | A finite heightfield, not volumetric caves, overhangs or a planetary surface |
| Shared incident-triangle vertex normals and canonical fine tile borders: `terrain/{surface,chunk}.ts` | `upgrade.test.ts`, `chunk.test.ts`, `templates/terrain/verification/attributes/` | Coarse material transitions fall back to an exact tile; no texture blending system is implied |
| Stride 1/2/4 chunk construction, conservative error, camera-projected pixel error and hysteresis: `terrain/{chunk,lod}.ts` | Terrain template selects near/far representations using the actual view | Finite tile layout; no adaptive quadtree, cross-region coverage or large-coordinate precision system |
| Local patch bounds with normal dependency margins and reuse of unchanged chunks: `terrain/generation.ts` | Tests preserve unaffected chunk identity and reject forged patch ancestry | Patch data/normal processing remains bounded by the full finite lattice; chunk reuse is not an incremental world database |
| Atomic render/contact/navigation revision publication: `terrain/{generation,residency}.ts` | Terrain diagnostic changes revision through real input; all three epochs reach 2 together | Renderer adapter must synchronously install every view or leave them unchanged; multi-region transactions are not provided |
| Shared-host sliced patch jobs, admission before payload construction, stale/cancel rejection and validated outputs: `terrain/{patch-job,surface}.ts`, `terrain/workers/patch.job.ts` | `upgrade.test.ts`; `templates/terrain/verification/worker-smoke.mjs` exercises the real application worker | Finite payload and logical slices; not a hard frame-time guarantee or a separate worker scheduler |
| Stable cell-based scatter with exclusion/slope filtering and bounded candidates: `terrain/scatter.ts` | Partition/revision tests; terrain diagnostic combines eligible points into one mesh | Rendering/collision pools for arbitrary generated objects and persistent region identity remain separate adapters |

## Ownership, preparation and resource lifetime

| Implemented contract and source | Consumer or test evidence | Remaining boundary |
|---|---|---|
| Shared immutable leases and owner cancellation: `src/platform/assets/{lease-cache,models,textures}.ts` | Cache/model/texture ownership and late-result tests | Resource-specific byte accounting is not total browser or decoder peak memory |
| Bounded dependency DAG, critical readiness, optional partial readiness and reverse cleanup: `platform/assets/dependency-lease.ts` | `dependency-lease.test.ts`, `dependency-lease-router.test.ts`; expedition routed preparation | Optional shared admission reserves entire declared closures atomically across owners; cancellation retains resources and reservations until pending acquires settle. Conservative claims count repeated ownership, not physical cache-deduplicated bytes |
| Restricted CPU/data preparation context: `src/author/{defs,compile}.ts` and `src/core/router/handover.ts` | `author/preparation.test.ts`; expedition `game/shelter.ts` prepares required contact before activation | Failed preparation retains the old run; after successful preparation the old renderer is released before entering the new one. First-render failure does not restore the old scene |
| Owned GPU replacement, detach-before-dispose and cleanup error containment: `author/{scene-resources,scene-cubes,scene-model}.ts` | Unit cleanup/cancellation/replacement tests and mechanics repeated visits | Tests cover specific resource owners; they do not certify every future adapter automatically |
| Save sections, migrations, quarantine and explicit flush status: `src/core/save/` | Store/migration tests; diagnostic combined save envelopes | A queued mutation is not durable storage, and a local save envelope is not a distributed transaction |

## Frames, input, cameras and navigation

| Implemented contract and source | Consumer or test evidence | Remaining boundary |
|---|---|---|
| Generation-aware affine frames and dependency-delayed updates: `src/kits/frames/{frame,updates}.ts` | `frames.test.ts`; mechanics moving platform | No network transport, replication audience, reconnect or remote authority protocol |
| Atomic control ownership, input cancellation, motion reset and camera reset revision: `kits/control/index.ts` | `control.test.ts`; mechanics boarding/exit uses fresh input after transitions | Applications still define legitimate owners, exit policy and persistent occupancy recovery |
| Camera target loss, discontinuity reset and obstruction probes: `kits/camera/{index,clearance}.ts` | Camera/clearance/control-reset tests | Five segment probes are not a swept-sphere or viewport-derived near-plane collision solver |
| Per-view unsigned 32-bit render masks: `author/render-mask.ts`, runtime view binding | `author/render-mask.test.ts`; shape, mesh and model bindings | Does not imply portal occlusion or an automatic visibility hierarchy |
| Owned scene input layer, activation after first frame and cancellation on lost capture/blur/visibility/owner loss: `author/{scene-input,scene-pointer}.ts`, `platform/input/` | Input/pointer tests and diagnostic phone flows | Every application's overlay, joystick and focus composition still needs integration coverage |
| Immutable prepared graph, bounded A* work and fair admitted route queue: `kits/navigation/{search,queue}.ts` | Navigation/lifecycle tests and expedition route consumer | Graph creation is count-bounded; there is no navmesh generator or elapsed-time deadline |
| Frame/revision/clearance-aware portals and crossing revalidation: `navigation/portals.ts` | Stale/closed/scaled-frame tests; expedition doorway crossing | Caller supplies contact/readiness checks and graph topology |
| Resolved-position route follower with blocked state and bounded replans: `navigation/follower.ts` | Follower tests; expedition stop/resume/arrival flows | General local steering, dynamic obstacle avoidance and vehicle-specific movement adapters are not supplied |

## Models, animation and environment

| Implemented contract and source | Consumer or test evidence | Remaining boundary |
|---|---|---|
| Lazy GLB loading, bounded admission and independent skeleton clones sharing leased assets: `src/platform/assets/models.ts` | Model tests; `templates/mechanics/verification/models.json` records desktop/phone re-entry | External/data-URI GLB dependencies are rejected; no general asset conversion pipeline or skeleton LOD system |
| Native clip playback and model node sockets: `author/{model-playback,scene-model}.ts` | Scene-model tests; mechanics original skinned fixture and socket probe | Animated presentation root is isolated from simulation transform; imported clip motion is not automatically simulation motion |
| Bounded pose sampler, masked quaternion layers and two-link IK: `kits/animation/{pose-clip,pose-layers}.ts` | Pose/layer tests; mechanics combines native playback and IK overlays | No full-body solver, retargeting or general animation state graph |
| Authored planar root-motion cursor with loop composition and seek suppression: `animation/root-motion.ts`; authority-checked collision application: `kits/locomotion/index.ts` | Motion/layer and locomotion tests; mechanics fixture encounters a blocker | Uses authored planar curves and existing character collision subdivision, not arbitrary imported root extraction or full rigid-body dynamics |
| Stable action markers, bounded crossings and owned sockets: `animation/{markers,sockets}.ts` | Marker/socket tests; mechanics result timing is independent of presentation markers | Applications define action completion, missing-marker fallback and crossfade policy |
| Independent leased cube background/reflection bindings, retained old value until replacement and cleanup after cancellation: `platform/assets/cube.ts`, `author/scene-cubes.ts` | Cube/scene-cube tests; mechanics original labeled faces | Cube byte accounting is bounded but not a physically based atmosphere or weather simulation |
| Camera-relative directional environment, stable nested seeded stars and endpoint transition helper: `author/scene-environment.ts`, `kits/space/index.ts` | Environment/space tests; expedition directional backdrop | No catalog-backed astronomy, distant-to-near body handoff or continuous surface atmosphere model |
| Owned spatial voices, camera listener, global voice/buffer/decoded-byte limits: `platform/audio/audio-output.ts`, `author/scene-audio.ts` | Audio/listener tests; mechanics positioned cue; tests remain silent | Spatial virtualization, acoustic regions and smooth region transitions are not implemented |
| Priority cue mixer and owner-scoped ducking: `kits/audio-mixer/` | Mixer/ducking tests; expedition cues | Narration/music bus policy, ambient crossfades and accessible equivalents belong to explicit consumers |

## Optional kit mechanisms

These are reusable local contracts, not a complete game or a requirement that every
application enable them. Each kit remains optional and outside core/platform/author.

| Contract and source | Integrated evidence | Limits and application responsibilities |
|---|---|---|
| Stable objective events, guarded dialogue and retryable reward claims: `src/kits/{objectives,dialogue}` | Expedition physical arrival, cancellation and combined reward/inventory save | No remote reward authority; applications provide narrative, assessments and presentation |
| Atomic quantity transfer/reservations and explicit checkpoint epochs: `kits/inventory` | Mechanics delivery and expedition production; 200-cycle checkpoint tests | No general unique-object containment graph; ordinary ledger history is explicitly bounded |
| Definition/instance/appearance separation, slot validation and source-owned capability modifiers: `kits/{equipment,capabilities}` | Expedition functional/cosmetic separation and assistance; mechanics equipment eligibility | Applications supply role content, progression curves, persistent schema migrations and explanatory UI |
| Deterministic fields separate from reserves, stepped surveys, weighted material properties and atomic bounded production: `kits/resources` | Expedition survey/production/reload and 100-epoch regression coverage | Spawn lifecycle, tool ownership, editable design documents, power/storage presentation and geological meaning are application adapters |
| Integer balances, revisioned quotes, expiry and retryable delivery claims: `kits/market` | Mechanics persists market and inventory in one envelope | Local transactions only; no remote settlement, paginated service, bank access UI or distributed commerce |
| Permission checks, bounded placement footprint/overlap and occupied teardown refusal: `kits/housing` | Mechanics place/occupy/leave/pack; adversarial placement tests | Application defines geometry, access presentation, relocation and resumable restoration of complex owned objects |
| Swept moving-sphere contact, deterministic tie-breaking and single terminal result: `kits/combat` | Mechanics moving-target diagnostic and adversarial tests | No broadphase for a world, arbitrary geometry solver, authored damage policy, weapon balance or remote authority |
| Seat/socket ownership and validated exit: `kits/vehicles` | Mechanics moving platform and control handoff | Vehicle simulation, models and persistence recovery are application adapters |
| Observable lesson progress and hint/retry primitives: `kits/learn` | Existing lesson/timeline tests and learn template | Independent age, knowledge, motor ability and assistance paths are authored content; no universal curriculum is claimed |

## Authoring and publication

Stable author definitions, registry/manifest validation, generated strings, brief
checks and build gates already exist. `scripts/lib/content-bundle.mjs` and
`scripts/publish-content.mjs` stage a bounded manifest, verify copied bytes, retain
prior releases and promote an atomic active pointer. Fault tests cover failed
publication; this does not claim power-loss durability.

A general dependency-directed incremental content compiler, editor integration and
versioned content migration graph remain candidates. Save migrations already exist;
content compilation and save migration must not be conflated. Social sessions,
notifications delivered remotely, moderation, scientific catalogs and authored
world content need application requirements rather than automatic expansion of core.

## Evidence and next implementation boundaries

The phase-two code is present in integrated baseline `2859031`. Historical evidence
is stored under `templates/terrain/verification/attributes`,
`templates/mechanics/verification/{models,interaction}.json` and
`templates/expedition/verification/navigation`. The terrain worker report records one
worker, a 212,888-byte peak payload reservation, zero reservations after completion,
coherent revision 2, seven draws and 5,092 triangles. Mechanics model revisits record
one fetch, four parses, three disposed templates and one live instance. These are
bounded diagnostic results, not physical-device certification or current-head gates.

The next concrete engineering work should preserve these boundaries:

1. **Shared resource admission:** aggregate declared reservations now span overlapping
   dependency owners, with cancellation, failed acquisition, late completion and
   reentrant cleanup coverage. Applications must inject one shared budget across the
   intended owners; these conservative claims do not measure physical cache residency.
2. **Spatial scaling:** specify region/frame precision, dependency residency and
   coverage before extending the finite terrain layout. Existing screen-space LOD
   and local chunk invalidation must be reused rather than reimplemented.
3. **Movement adapters:** connect existing queue/portal/follower contracts to a
   justified navigation geometry or steering consumer. Do not equate a route proposal
   with resolved physical movement.
4. **Content tooling:** define stable inputs, dependency hashes, invalidation and
   versioned outputs around the existing staged publication contract.

Network authority/reconnect, full-body animation and continuous atmosphere systems
are absent capabilities, not commitments to build a particular game. Their adoption
requires a bounded generic design and diagnostic consumer. New work must refresh
this inventory and run relevant exact-head tests, browser evidence and integration
gates without weakening budgets. Publication status must be recorded separately.
