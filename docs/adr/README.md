# Architecture decision records

Each file records one decision: its context, the decision and its consequences (ADR 0001). The [standard](../STANDARD.md) cites these by number. Numbers are never reused. A number that is missing from this list is reserved.

| ADR | Decision | Area | Status |
|---|---|---|---|
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions as ADRs | Process | Accepted |
| [0003](0003-module-system-boot-phases.md) | Features are modules loaded through fixed boot phases | Kernel | Accepted |
| [0004](0004-typed-event-bus.md) | One typed event bus | Kernel | Accepted |
| [0005](0005-registries-and-typed-content.md) | All open sets live in validated registries; content is typed TypeScript | Kernel | Accepted |
| [0006](0006-patch-layer-content-packs.md) | Content packs change content through ordered patches | Kernel | Accepted |
| [0007](0007-save-store-sections.md) | One save store with typed sections, scopes and migrations | Persistence | Accepted |
| [0010](0010-pure-maths-library.md) | Pure maths imports nothing | Domain | Accepted |
| [0015](0015-activity-loop-render-on-demand.md) | One frame loop; activities render on demand; covered activities pause | Runtime | Accepted |
| [0016](0016-renderer-pool-resource-ownership.md) | Renderer pool and reference-counted resource ownership | Render | Accepted |
| [0017](0017-quality-presets.md) | Quality presets are the single performance governor | Render | Accepted |
| [0020](0020-ui-shell-layers-keymap.md) | A UI shell owns buttons, layers, focus, Back and input priority | UI | Accepted |
| [0021](0021-strings-and-locales.md) | All user-facing text is keyed strings | Strings | Accepted |
| [0022](0022-scene-router-lazy-loading.md) | A scene registry drives routing and per-scene code splitting | Router | Accepted |
| [0023](0023-asset-manifest-and-cache.md) | One asset manifest with size variants, provenance and a shared cache | Assets | Accepted |
| [0025](0025-performance-budgets-as-contracts.md) | Per-scene performance budgets are contracts enforced before integration | Performance | Accepted |
| [0026](0026-test-api-over-dom-scraping.md) | Verifiers use a typed test API, not DOM scraping | Testing | Accepted |
| [0029](0029-graphics-screen-reference-preset.md) | A Graphics screen of registered knobs; the reference preset is the design bar and the gated tier | Render | Accepted |
| [0030](0030-budget-gating-two-harnesses.md) | Budgets gate structure in software GL at every integration; time and pixels on the reference GPU | Performance | Accepted |
| [0031](0031-layers-kits-packs-ports.md) | Layers with a presentation-kit layer, content packs and ports for upward needs | Structure | Accepted |
| [0032](0032-activity-runs-coverage-preview.md) | Activities return a run; one loop renders on demand; coverage pauses; preview layers keep the scene live | Runtime | Accepted |
| [0033](0033-game-clock-driver.md) | One game clock, driven only by the loop | Time | Accepted |
| [0034](0034-one-webgl2-path.md) | One WebGL2 render path | Render | Superseded by 0078 |
| [0035](0035-two-layer-shadow-maps.md) | Two-layer shadow maps: static casters cached, moving casters redrawn | Render | Accepted |
| [0036](0036-feature-anatomy.md) | Feature anatomy: an eager manifest, a lazy body, discovered by folder; shared baselines are sharded | Structure | Accepted |
| [0037](0037-shadow-cache-validity.md) | Static shadow depth is a versioned cache, never a full-pass copy | Render | Accepted |
| [0039](0039-simulation-time-and-input.md) | Tick-addressed input and explicit world/local time | Simulation | Accepted |
| [0040](0040-scene-instance-ownership.md) | Share immutable set resources; keep activity scenes private | Render | Accepted |
| [0041](0041-scene-handover.md) | Scene handover presentation | Router | Accepted |
| [0043](0043-extension-model.md) | The extension model made true: one folder, folder-local strings, open registries, behaviour bound lazily by id | Structure | Accepted |
| [0044](0044-one-action-map.md) | One action map: keys, pad and pointer resolve to registered actions | Input | Accepted |
| [0045](0045-handover-activation.md) | Prepare a scene, then activate only the current request | Router | Accepted |
| [0046](0046-bench-cache-evidence.md) | Cache measurements only when the complete experiment matches | Performance | Accepted |
| [0047](0047-input-reach-and-ownership.md) | Reachability is a path; an input press has one owner | Input | Accepted |
| [0049](0049-world-time-dilation-budget.md) | World-host capacity is derived, and dilation is budgeted | Simulation | Accepted |
| [0051](0051-submission-counters.md) | Submission counters are report-only until two benches agree | Performance | Accepted |
| [0052](0052-save-atomicity-boundary.md) | Coherent saves before physical section splits | Persistence | Accepted |
| [0053](0053-workload-valid-performance-windows.md) | Measure normal work, including recurring uploads | Performance | Accepted |
| [0055](0055-batching-primitive.md) | Batching is a small set of primitives chosen by what the art must still do | Render | Accepted |
| [0056](0056-trackers-observe.md) | Change trackers observe batches and skeletons | Render | Accepted |
| [0057](0057-render-dependency-observation.md) | Render dependencies are observed, never guessed | Render | Accepted |
| [0059](0059-one-worker-host.md) | One worker host; pure, keyed, cancellable jobs; the frame never waits on a worker | Workers | Accepted |
| [0061](0061-ownership-outside-the-architecture.md) | Ownership and authorship are outside the architecture | Process | Accepted |
| [0062](0062-bounded-worker-admission.md) | Bounded worker admission, physical cancellation and current-owner delivery | Workers | Accepted |
| [0063](0063-boot-availability-without-data-loss.md) | Successful installation controls executable availability, not stored identity | Kernel | Accepted |
| [0067](0067-shared-dependency-admission.md) | Shared dependency admission covers overlapping owners and late cleanup | Assets | Accepted |

| [0068](0068-device-specific-experience-contracts.md) | Separate device layout, input and graphics acceptance | UI / Quality | Accepted |

| [0069](0069-author-selected-device-scope.md) | Device targets and edition tradeoffs are author-selected | Scope / Quality | Accepted |
| [0070](0070-device-runtime-diagnostics.md) | Graphics selection is input-independent; pending UI data and diagnostics are bounded | UI / Quality | Accepted |
| [0071](0071-owned-reading-sheets.md) | Optional HUD disclosure reuses child activity and layer ownership | UI / Lifecycle | Accepted |
| [0072](0072-transactional-resource-retirement.md) | Resource publication and retirement preserve ownership across callbacks | Assets | Accepted |
| [0073](0073-binding-derived-action-descriptions.md) | Author hints read current bindings and explicit dispatch context | Input / Author API | Accepted |
| [0074](0074-application-input-polling.md) | Application input polls on the shared loop independently of scene coverage | Input / Runtime | Accepted |

| [0075](0075-opt-in-lazy-scene-bodies.md) | Optional scene bodies stay outside eager definition discovery | Author tooling / Loading | Accepted |
| [0076](0076-engine-creator-agent-contract.md) | Bounded framework guarantees, creator authority and implementation-agent obligations | Author contract / Governance | Accepted |

| [0077](0077-candidate-verification-evidence.md) | Public contributor setup, candidate gate evidence and recorded sole-maintainer review exceptions | Process / Governance | Proposed |
| [0078](0078-creator-selectable-render-backend.md) | Creator-selectable render backend: WebGL2 by default, WebGPU opt-in and lazily loaded | Render | Accepted |
| [0079](0079-device-class-start-limit.md) | A constrained mobile GPU starts on a lighter preset unless the brief declares a tier | Quality | Accepted |

| [0080](0080-optional-interaction-ownership.md) | Optional assignment, itinerary and alignment ownership | Kits / Verification | Accepted for implementation |

| [0081](0081-visibility-contributions.md) | Source-owned visibility contributions | Optional kits | Accepted for candidate |

| [0082](0082-bounded-weighted-choice-history.md) | Bounded weighted choice and separately committed history | Procgen | Proposed |

| [0083](0083-portable-timed-contribution-checkpoints.md) | Portable timed contribution checkpoints through the existing owner | Capabilities / Persistence | Proposed |

| [0084](0084-persisted-recurring-phase.md) | Persisted recurring phase with explicit bounded catch-up | Optional composition / Time / Persistence | Proposed |

| [0096](0096-optional-update-cadence.md) | Optional per-member update cadence | Optional kits / Simulation scale | Proposed |

| [0085](0085-atomic-cell-batches-and-occupancy.md) | Atomic cell batches and immutable occupancy | Procgen / Spatial | Proposed |

| [0151](0151-contact-layer.md) | Optional contact layer and touch events | Optional kits | Proposed |

| [0086](0086-bounded-work-roster.md) | Bounded optional work roster | Optional composition | Proposed |

| [0087](0087-rewind-history.md) | Optional bounded rewind history | Optional kits / Network authority | Proposed |

| [0088](0088-view-deltas.md) | Optional acknowledged-baseline view deltas | Network | Proposed |

| [0089](0089-model-clip-transitions.md) | Model clip transitions through the existing model owner | Author API / Animation presentation | Proposed |

| [0090](0090-camera-support-framing.md) | Support-anchored vertical camera framing | Camera kit | Proposed |

| [0097](0097-action-phase-windows.md) | Optional action phase windows, once-only marks and per-range claims | Optional kits / Capabilities | Proposed |

| [0098](0098-bounded-volume-queries.md) | Bounded optional volume queries | Optional composition / Spatial queries | Proposed |

| [0091](0091-bounded-cue-sequences.md) | Bounded cue sequences as an optional kit | Optional kits / Scripting | Proposed |

| [0111](0111-sequence-cast-branches-arbitration.md) | Cast binding, branching and event arbitration for sequences | Optional kits / Scripting | Proposed |

| [0092](0092-population-placements-and-tiers.md) | Placements with persistent depletion and update tiers | Optional kits / Simulation scale | Proposed |

| [0095](0095-optional-region-activation.md) | Optional region activation from observer positions | Optional kits / Simulation scale | Proposed |

| [0093](0093-remote-playout.md) | Optional remote playout and clock offset | Optional kits / Network presentation | Proposed |

| [0100](0100-optional-entity-pool-eviction-classes.md) | Optional entity pool with eviction classes | Optional kits / Simulation scale | Proposed |

| [0094](0094-replication-schedule.md) | Optional per-recipient replication schedule | Optional kits / Network | Proposed |

| [0110](0110-look-at-constraint.md) | Bounded look-at constraint in the animation kit | Optional kits / Animation | Proposed |

| [0112](0112-camera-director.md) | Optional camera director helpers | Camera kit | Proposed |

| [0124](0124-data-defined-formulas.md) | Data-defined stat and damage formulas | Optional kits / Rules | Proposed |

| [0135](0135-formula-data-import.md) | Spreadsheet import for formula sheets and lookup tables | Optional kits / Rules / Tooling | Proposed |

| [0125](0125-status-effects.md) | Status effects with transforms on the fixed clock | Optional kits / Rules | Proposed |

| [0122](0122-behaviour-trees.md) | Deterministic resumable behaviour trees | Optional kits / Rules | Proposed |

| [0123](0123-flow-economy-and-production.md) | Flow economy, production queues and reclaim | Optional kits / Rules | Proposed |

| [0126](0126-inventory-rule-presets.md) | Slot, stack and key-item rules over the inventory ledger | Optional kits / Inventory | Proposed |

| [0102](0102-ballistic-trajectories.md) | Optional ballistic trajectory solves | Optional kits | Proposed |

| [0103](0103-breadcrumb-trails.md) | Optional breadcrumb trails for followers | Optional kits | Proposed |

| [0130](0130-optional-streaming-queue.md) | Optional on-demand streaming queue | Optional kits / Assets | Proposed |

| [0131](0131-defer-worker-render-pipelining.md) | Defer worker render pipelining until a measured need | Render / Frame loop / Workers | Accepted (not built) |

| [0132](0132-optional-retro-look.md) | Optional retro software-raster look | Optional kits / Rendering | Proposed |

| [0133](0133-offline-format-converters.md) | Offline format converters with provenance receipts | Tooling / Assets | Proposed |

| [0134](0134-duplicate-detector.md) | Duplicate and near-duplicate detection as a read-only repo tool | Tooling / Assets | Proposed |

| [0140](0140-optional-car-handling.md) | Optional car handling on ray-cast wheels | Optional kits / Simulation | Proposed |

| [0141](0141-optional-board-traversal.md) | Optional board traversal with authored rails | Optional kits / Simulation | Proposed |

| [0104](0104-grid-step-movement.md) | Optional grid-step actor movement | Optional kits | Proposed |

| [0120](0120-optional-sandboxed-script-runtime.md) | Optional sandboxed script runtime (amends 0005 for creators who opt in) | Optional kits / Content | Proposed |

| [0121](0121-optional-physics-adapter-kit.md) | Optional physics adapter kit over a lazily loaded WebAssembly library; amends the no-physics stance only for creators who opt in | Optional kits / Simulation / Dependencies | Proposed |

| [0130](0130-offline-format-converters.md) | Offline format converters with provenance receipts | Tooling / Assets | Proposed |

| [0133](0133-legacy-format-decoders.md) | Legacy game and multimedia format decoders in the converter toolchain | Tooling / Assets | Proposed |

| [0113](0113-perception-kit.md) | Optional perception kit feeding a blackboard | Optional kits / AI | Proposed |
