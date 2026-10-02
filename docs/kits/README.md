# Kits

Optional genre kits, chosen per game in `defineGame({ kits })` and imported as `@kits/<name>`. The engine runs with none. How to add one: [../recipes/add-a-kit.md](../recipes/add-a-kit.md). Candidates: [../ROADMAP.md](../ROADMAP.md).

| Kit | What | Used by |
|---|---|---|
| [ui](../../src/kits/ui/README.md) | HUD lines, a banner and a prompt over a scene | arcade, explorer |
| [camera](../../src/kits/camera/README.md) | Camera poses: follow, orbit, first-person, top-down, side-scroll, fixed | explorer |
| [character](../../src/kits/character/README.md) | Kinematic character controller with walls and solids | explorer |
| [explore](explore.md) | Move-and-interact: interactable things, doors between scenes, remembered progress | explorer |
| [learn](../guides/learn-mode.md) | Lessons as data: objectives, cast, outline, timelines, the director, progress | learn |
| [chalkboard](../../src/kits/chalkboard/README.md) | A chalkboard drawn in SVG: strokes that draw on, text, arrows, axes, number lines | learn |
| [concept-explorer](../../src/kits/concept-explorer/README.md) | Orbit a model, tap parts, toggle layers, a parameter slider, a mini quiz | learn |
| [terrain](../../src/kits/terrain/README.md) | Canonical surface, exact contact queries, bounded chunks and coherent revisions | terrain, expedition |
| [navigation](../../src/kits/navigation/README.md) | Incremental bounded route search with cancellation | expedition |
| [dialogue](../../src/kits/dialogue/README.md) | Stable choices, revision guards and validated graph exits | expedition |
| [objectives](../../src/kits/objectives/README.md) | Counted event runs, explicit stage composition and retry-safe completion claims | expedition |
| [inventory](../../src/kits/inventory/README.md) | Conserved local transactions, reservations and epoch checkpoints | expedition, mechanics |
| [resources](../../src/kits/resources/README.md) | Deterministic fields and bounded production | expedition |
| [capabilities](../../src/kits/capabilities/README.md) | Evidence, prerequisite graphs, source-owned modifiers and optional action lifetimes | expedition, mechanics |
| [equipment](../../src/kits/equipment/README.md) | Unique-instance acquisition/release, arrangements and atomic multi-slot changes | expedition, mechanics |
| [frames](../../src/kits/frames/README.md) | Versioned coordinate frames and bounded delayed updates | mechanics |
| [vehicles](../../src/kits/vehicles/README.md) | Local seat ownership and validated exits | mechanics |
| [control](../../src/kits/control/README.md) | Explicit actor ownership and discontinuity resets | mechanics |
| [animation](../../src/kits/animation/README.md) | Bounded marker crossings, pose sampling and named sockets | mechanics |
| [audio-mixer](../../src/kits/audio-mixer/README.md) | Owned cue scheduling, real voice limits and ducking | expedition |
| [space](../../src/kits/space/README.md) | Stable directional populations and coordinated environments | expedition |
| [combat](../../src/kits/combat/README.md) | Relative sweeps and simulation-owned action results | mechanics |
| [market](../../src/kits/market/README.md) | Local settlement and durable delivery claims | mechanics |
| [network](../../src/kits/network/README.md) | Bounded connection/authentication intake, complete scoped views, durable authority and prediction; creator-supplied transport, disclosure and game policy | Admission integrated in PR #120; scoped views integrated on main at `ea48539` (PR #122 in the private development history), after clean rebased browser and all seven gates (1,965 tests, 129 performance checks); see [view guide](../guides/network-views.md). Authority/prediction integrated in PR #123 at `b6fb4a3` after all seven gates (2,018 tests, 129 checks) |
| [housing](../../src/kits/housing/README.md) | Permission-separated placement and recoverable manifests | mechanics |
| [turns](../../src/kits/turns/README.md) | Deterministic command logs: seeded per-position random, undo/redo, exact previews, replay, save snapshots with drift detection, durable-authority policies | None yet. Implemented, candidate (PR pending); headless unit tests only. [Recipe](../recipes/add-a-turn-log.md) |

These are optional mechanisms with documented limits, not finished game content. See the [implementation and acceptance evidence](../../templates/expedition/UPGRADE-STATUS.md), each kit's README and its consuming template. Local transaction guarantees do not imply distributed authority.


The separately optional [authority](../guides/durable-authority.md) and
[prediction](../guides/prediction.md) exports are integrated through PR #123.
Clean native acceptance passed at `8317c69`; Node 22.13 storage/host checks passed (17 tests). See the [acceptance ledger](../guides/upgrade-acceptance-ledger.md) for exact revisions, scope and limits. DV-01 physical-device acceptance remains open.
