# Kits

Optional genre kits, chosen per game in `defineGame({ kits })` and imported as `@kits/<name>`. The engine runs with none. How to add one: [../recipes/add-a-kit.md](../recipes/add-a-kit.md). Candidates: [../ROADMAP.md](../ROADMAP.md).

| Kit | What | Used by |
|---|---|---|
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
| [contact](../../src/kits/contact/README.md) | Layered contact volumes (cylinder, sphere, box): exact overlap, deterministic enter/stay/exit events, bounded admission, intangibility, snapshots | None yet; headless tests only |
| [spatial-audio](../../src/kits/spatial-audio/README.md) | Logical sound sources: virtual tracking, importance ranking with HRTF for the sounds that matter, class distance curves with a hard cutoff, budgeted occlusion driving the smoothed filter | None yet; implemented, candidate (AUD-02, PR #55, [recipe](../recipes/3d-sound-for-shooters.md)) |

The optional [assignments](../../src/kits/assignments/README.md) candidate supplies exclusive actor claims, weighted target capacity and atomic transfer refusal. Two headless service/worksite fixtures and route-owner composition tests exercise it; no playable template consumer or browser/device acceptance is claimed. [Guide](../guides/assignments.md).

These are optional mechanisms with documented limits, not finished game content. See the [implementation and acceptance evidence](../../templates/expedition/UPGRADE-STATUS.md), each kit's README and its consuming template. Local transaction guarantees do not imply distributed authority.


The separately optional [authority](../guides/durable-authority.md) and
[prediction](../guides/prediction.md) exports are integrated through PR #123.
Clean native acceptance passed at `8317c69`; Node 22.13 storage/host checks passed (17 tests). See the [acceptance ledger](../guides/upgrade-acceptance-ledger.md) for exact revisions, scope and limits. DV-01 physical-device acceptance remains open.
