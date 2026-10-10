# Kits

Optional genre kits, chosen per game in `defineGame({ kits })` and imported as `@kits/<name>`. The engine runs with none. How to add one: [../recipes/add-a-kit.md](../recipes/add-a-kit.md). Candidates: [../ROADMAP.md](../ROADMAP.md).

| Kit | What | Used by |
|---|---|---|
| [rewind](../../src/kits/rewind/README.md) | Bounded per-subject sample history and capped time choice for judging remote commands against past state; pure helper | Headless tests and a combat-sweep composition; no integrated game |

| [playout](../../src/kits/playout/README.md) | Authority clock offset and adaptive playout buffers for smooth presentation of remote views; pure helper | Headless tests and a jittered receiver composition; no integrated game |

| [replication](../../src/kits/replication/README.md) | Quantized per-recipient deltas ranked to a byte budget with loss recovery and an order-safe replica; pure helper | Headless tests and a lossy interest-set composition; no integrated game |

| [formulas](../../src/kits/formulas/README.md) | Data-defined stat/damage formulas, stacking stages, damage model and presets; pure helpers | Headless tests only; no integrated game |

| [status](../../src/kits/status/README.md) | Stacked status effects: timers, decay, transforms, immunities, save/restore | Headless tests only; no integrated game |

| [behavior](../../src/kits/behavior/README.md) | Behaviour trees: bounded tick, blackboard, decorators, resume, abort, save/restore, trace | Headless tests only; no integrated game |

| [economy](../../src/kits/economy/README.md) | Flow economy: income/storage, production queues with prerequisites, reclaim, save/restore | Headless tests only; no integrated game |
| [visibility](../../src/kits/visibility/README.md) | Bounded source contributions, current visibility and explored history; pure helper | Two headless sensor/facility fixtures; no integrated game |
| [ui](../../src/kits/ui/README.md) | HUD lines, a banner and a prompt over a scene | arcade, explorer |
| [camera](../../src/kits/camera/README.md) | Camera poses: follow, orbit, first-person, top-down, side-scroll, fixed | explorer |
| [character](../../src/kits/character/README.md) | Kinematic character controller with walls and solids | explorer |
| [explore](explore.md) | Move-and-interact: interactable things, doors between scenes, remembered progress | explorer |
| [learn](../guides/learn-mode.md) | Lessons as data: objectives, cast, outline, timelines, the director, progress | learn |
| [chalkboard](../../src/kits/chalkboard/README.md) | A chalkboard drawn in SVG: strokes that draw on, text, arrows, axes, number lines | learn |
| [concept-explorer](../../src/kits/concept-explorer/README.md) | Orbit a model, tap parts, toggle layers, a parameter slider, a mini quiz | learn |
| [terrain](../../src/kits/terrain/README.md) | Canonical surface, exact contact queries, bounded chunks and coherent revisions | terrain, expedition |
| [procgen](../../src/kits/procgen/README.md) | Hierarchical seed derivation, bounded seeded grid generation on the worker host, a strict root-seed save section; sparse cell edits and a bounded IndexedDB chunk store (GEN-02) | None yet. GEN-01 integrated in v0.2.0 (PR #38); GEN-02 implemented, candidate (PR #56), not integrated |
| [itinerary](../../src/kits/itinerary/README.md) | Editable destination orders, preserved active cursor and owned completion attempts | Patrol and delivery/service headless lab consumers; public candidate, no device evidence |
| [navigation](../../src/kits/navigation/README.md) | Incremental bounded route search with cancellation | expedition |
| [dialogue](../../src/kits/dialogue/README.md) | Stable choices, revision guards and validated graph exits; optional declared variables, visit counts and bounded conditions (TB-02 candidate, PR #50) | expedition |
| [objectives](../../src/kits/objectives/README.md) | Counted event runs, explicit stage composition and retry-safe completion claims | expedition |
| [inventory](../../src/kits/inventory/README.md) | Conserved local transactions, reservations and epoch checkpoints | expedition, mechanics |
| [resources](../../src/kits/resources/README.md) | Deterministic fields and bounded production | expedition |
| [capabilities](../../src/kits/capabilities/README.md) | Evidence, prerequisite graphs, source-owned modifiers and optional action lifetimes | expedition, mechanics |
| [equipment](../../src/kits/equipment/README.md) | Unique-instance acquisition/release, arrangements and atomic multi-slot changes | expedition, mechanics |
| [frames](../../src/kits/frames/README.md) | Versioned coordinate frames and bounded delayed updates | mechanics |
| [alignment](../../src/kits/alignment/README.md) | Target-relative planar approach proposals and exact-ticket acknowledgment; creator-owned movement, clearance and effects | Two headless lab fixtures; no runtime template consumer |
| [vehicles](../../src/kits/vehicles/README.md) | Local seat ownership and validated exits | mechanics |
| [locomotion](../../src/kits/locomotion/README.md) | Authored root motion through character collision; tunable jump feel (coyote, buffer, variable height, apex gravity) with a fixed-step adapter; moving platforms (ride, leave policy, one-way catch) | mechanics (root motion); jump feel and moving platforms have no template consumer |
| [control](../../src/kits/control/README.md) | Explicit actor ownership and discontinuity resets | mechanics |
| [animation](../../src/kits/animation/README.md) | Bounded marker crossings, pose sampling and named sockets | mechanics |
| [audio-mixer](../../src/kits/audio-mixer/README.md) | Owned cue scheduling, real voice limits and ducking | expedition |
| [space](../../src/kits/space/README.md) | Stable directional populations and coordinated environments | expedition |
| [combat](../../src/kits/combat/README.md) | Relative sweeps and simulation-owned action results | mechanics |
| [market](../../src/kits/market/README.md) | Local settlement and durable delivery claims | mechanics |
| [network](../../src/kits/network/README.md) | Bounded connection/authentication intake, complete scoped views, durable authority and prediction; creator-supplied transport, disclosure and game policy | Admission integrated in PR #120; scoped views integrated on main at `ea48539` (PR #122 in the private development history), after clean rebased browser and all seven gates (1,965 tests, 129 performance checks); see [view guide](../guides/network-views.md). Authority/prediction integrated in PR #123 at `b6fb4a3` after all seven gates (2,018 tests, 129 checks) |
| [housing](../../src/kits/housing/README.md) | Permission-separated placement and recoverable manifests | mechanics |
| [turns](../../src/kits/turns/README.md) | Deterministic command logs: seeded per-position random, undo/redo, exact previews, replay, save snapshots with drift detection, durable-authority policies | None yet. Integrated in v0.2.0 (PR #24); headless unit tests only. [Recipe](../recipes/add-a-turn-log.md) |
| [spatial](../../src/kits/spatial/README.md) | Bounded uniform-grid index for neighbour, range and interest queries; per-observer interest sets | No template yet. Grid integrated in v0.2.0 (SC-01, PR #23, [guide](../guides/spatial-index.md)); interest sets implemented, candidate (SC-02, PR #51, [guide](../guides/interest-sets.md)) |
| [ballistics](../../src/kits/ballistics/README.md) | Drag-free trajectory solves (duration, speeds, apex, low/high arcs, moving-target lead), evaluation and arc samples; pure helpers | None yet; headless tests only |

| [breadcrumbs](../../src/kits/breadcrumbs/README.md) | Leader path ring with exact crumb-lag and path-distance retracing, segment cuts, snapshots and a wait/keep-pace/catch-up lag controller; pure helpers | None yet; headless tests only |

| [grid-step](../../src/kits/grid-step/README.md) | Tile-to-tile actors: facing, classified bumps, ledges, conveyor/ice tiles, reservations while moving, follower lines, snapshots; creator tile rules | None yet; headless tests only |

| [contact](../../src/kits/contact/README.md) | Layered contact volumes (cylinder, sphere, box): exact overlap, deterministic enter/stay/exit events, bounded admission, intangibility, snapshots | None yet; headless tests only |

| [media](../../src/kits/media/README.md) | Water, mud and other medium volumes: depth and submersion probes, dry/wade/swim/under tracking with hysteresis and events, buoyancy, drag and current accelerations; pure helpers | None yet; headless tests only |
| [spatial-audio](../../src/kits/spatial-audio/README.md) | Logical sound sources: virtual tracking, importance ranking with HRTF for the sounds that matter, class distance curves with a hard cutoff, budgeted occlusion driving the smoothed filter | None yet; implemented, candidate (AUD-02, PR #55, [recipe](../recipes/3d-sound-for-shooters.md)) |
| [physics](../../src/kits/physics/README.md) | Optional rigid bodies, colliders, ordered bounded collision events, queries, rollback snapshots and a slope/step character adapter over a lazily loaded WebAssembly library (ADR 0121) | None yet; candidate with Node tests and one software-GL fixture snapshot ([guide](../guides/physics-adapter.md)) |

The optional [scripting](../../src/kits/scripting/README.md) candidate runs sandboxed Lua 5.4 scripts with capability-scoped host functions, deterministic per-call instruction budgets, a memory cap, fixed-tick timers and save/restore of each script's `state`; its VM loads lazily. Headless unit, rollback sync-test and scene consumer tests plus headless Chromium fixture runs only; no template consumer or device acceptance is claimed. [Guide](../guides/scripting.md).

The optional [numeric](../../src/kits/numeric/README.md) candidate supplies strict deterministic number formats for lockstep, rollback and replay: fixed-point words with chosen rounding and overflow, binary-angle trigonometry and strict reduced-precision float. Headless oracle and golden tests plus a Chromium/Node vector comparison; no template consumer or device acceptance is claimed.

| [cells](../../src/kits/cells/README.md) | Cell-and-portal render culling: rooms and doorways, screen-rectangle narrowing, a conservative PVS bit table, render-on-change visibility for entities or three.js objects; pure helpers | None yet; implemented, candidate (CELLS-01, [guide](../guides/cell-culling.md)); headless tests only |

The optional [assignments](../../src/kits/assignments/README.md) candidate supplies exclusive actor claims, weighted target capacity and atomic transfer refusal. Two headless service/worksite fixtures and route-owner composition tests exercise it; no playable template consumer or browser/device acceptance is claimed. [Guide](../guides/assignments.md).

The optional [region-activation](../../src/kits/region-activation/README.md) candidate decides which grid regions a game simulates from observer positions, with release hysteresis, linger, pins, per-update transition budgets and epochs for stale loads. Headless model and ECS/chunk-store consumer tests only; no template consumer or browser/device acceptance is claimed. [Guide](../guides/region-activation.md).

The optional [cadence](../../src/kits/cadence/README.md) candidate runs members at their own integer periods on the caller's tick, spread by id, bounded per take with deferral, elapsed-tick reporting and saveable state. Headless model, ECS and interest-set consumer tests only; no template consumer or browser/device acceptance is claimed. [Guide](../guides/update-cadence.md).

The optional [entity-pool](../../src/kits/entity-pool/README.md) candidate keeps pooled entities under a creator count and cost cap, evicting expendable classes first in a deterministic order, with pins, atomic refusal and World eviction events. Headless model and World consumer tests only; no template consumer or browser/device acceptance is claimed. [Guide](../guides/entity-pool.md).

The optional [streaming](../../src/kits/streaming/README.md) candidate ranks play-time load requests under concurrency and byte budgets, with cancellation, retry and preemption, through ports onto the existing lease caches and model owner. Headless unit and consumer tests only; no template consumer or browser/device acceptance is claimed. [Guide](../guides/streaming-queue.md).

The optional [retro](../../src/kits/retro/README.md) candidate draws a scene at low resolution with wide pixels, a creator palette or levels and ordered dithering through `@kits/three`. Headless tests, a software-GL screenshot and a GPU bench of the showcase courtyard; no template uses it and no device acceptance is claimed. [Guide](../guides/retro-look.md).

The optional [car-handling](../../src/kits/car-handling/README.md) candidate steps a car on ray-cast wheels against a creator ground query (suspension, tyre slip and grip, drive, brake and steering curves, handbrake drifts, downforce, air control, upside-down reset) with bounded sub-steps, transactional steps and deterministic snapshot/restore; `arcade` and `sim-lite` presets. Headless tests with ECS, terrain and rollback consumers only; no template consumer or browser/device acceptance is claimed.

The optional [board-traversal](../../src/kits/board-traversal/README.md) candidate rides a board over a creator ground query: push, carve, charged ollies, landings judged by board angle, grinds on authored rail snapshots with balance, manuals and bails, with bounded sub-steps and rail checks, transactional steps and deterministic snapshot/restore; `arcade` and `sim-lite` presets. Headless tests with ECS (character-kit walls), terrain and rollback consumers only; no template consumer or browser/device acceptance is claimed.

These are optional mechanisms with documented limits, not finished game content. See the [implementation and acceptance evidence](../../templates/expedition/UPGRADE-STATUS.md), each kit's README and its consuming template. Local transaction guarantees do not imply distributed authority.


The separately optional [authority](../guides/durable-authority.md) and
[prediction](../guides/prediction.md) exports are integrated through PR #123.
Clean native acceptance passed at `8317c69`; Node 22.13 storage/host checks passed (17 tests). See the [acceptance ledger](../guides/upgrade-acceptance-ledger.md) for exact revisions, scope and limits. DV-01 physical-device acceptance remains open.
