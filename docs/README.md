# Foundation Engine documentation

```text
      [##]          FOUNDATION ENGINE
    [======]        =================
  [==][==][==]      DOCS: SELECT A ROUTE
 [############]
```

Foundation Engine is a TypeScript engine for 3D browser games on three.js. Pick the line that matches what you want
to do now. New here? Read the [project README](../README.md), then [getting started](guides/getting-started.md).

## Learn: your first game

- [Getting started](guides/getting-started.md): from a clone to a game you can share, step by step, by hand or with a
  coding agent.
- [Working with your agent](guides/working-with-your-agent.md): how to direct a coding agent that builds your game.
- [Labs](guides/labs.md): prove one system (a mechanic, a kit, a technique) in a small separate game before you build a
  world on it, then move it into the engine.

## Do: recipes for one task

- [Cookbook](recipes/README.md): one recipe per task: models, HUD and buttons, collision and picking, camera, saves,
  budgets, playtest scripts and sharing a build.
- [Make it look good](recipes/art-direction.md): palette, light presets, sky and haze, low-poly forms, baked light.
- [Scene look](guides/scene-look.md): tone mapping, exposure, point and spot lights, shadows and a gradient sky, as
  plain data.
- [Blob shadows](guides/blob-shadows.md): soft ground shadows under entities where no shadow map reaches, in one draw.
- [Game brief template](guides/GAME.template.md): the `GAME.md` brief that `npm run lint:brief` checks.

## Look up: reference

- [Capabilities](capabilities.md): every shipped feature, kit, setting, template and script, generated from the code
  ([JSON](capabilities.json)). When another page disagrees with this list, the list is right.
- [Kit catalog](kits/README.md): the optional building blocks a game can pick, configure or leave out.
- [Data dictionary](data/data-dictionary.md): tool fields, environment variables, options, data files and limits.
- [Changelog](../CHANGELOG.md): what changed in each release.

## Understand: how and why it is built this way

- [Design description](architecture/architecture.md): components, data flow, the frame loop and timing.
- [Architecture standard](STANDARD.md) and [creator contract](CREATOR-CONTRACT.md): the rules, and what the game author
  decides versus what the engine decides.
- [Decisions](adr/README.md): one record per design choice, with its reasoning.
- [Character pipeline lessons](guides/character-pipeline-lessons.md) and
  [crowd and night rendering lessons](guides/crowd-and-night-rendering-lessons.md): what a character-crowd lab taught
  (retargeting, weights, LOD, clip checks, crowd cost, wet looks), and what the engine does and does not provide.
- [Provenance](PROVENANCE.md): where this engine came from.

## Status and limits

- [Limitations](guides/limitations.md): what the engine does not do.
- [Goals](GOALS.md) and [roadmap](ROADMAP.md): what the project aims for and what may come next.
- [Device experience policy](policy/DEVICE-EXPERIENCE.md): phone, tablet, laptop and desktop are accepted separately.
- [Capability map](guides/composition-framework-status.md), [framework record](guides/framework-upgrade-status.md) and
  [acceptance ledger](guides/upgrade-acceptance-ledger.md): what is implemented, checked and integrated, and what is
  not yet verified.
- [Release candidate `7c26db7`](releases/candidate-7c26db7/README.md): proposed 0.3.0 notes, upgrade guide, support
  matrix and evidence; prepared, not released. [Release notes draft for 0.2.0](guides/release-notes-0.2.0.md).

## Contribute to the engine

- [CONTRIBUTING.md](../CONTRIBUTING.md): set up, propose, check and submit a focused change.
- [Brand](brand.md): logo, palette, ASCII banners and asset licence.

## Specialist guides

- [Predeclared acceptance evidence](guides/acceptance-evidence.md), [dimensional inventory candidates](guides/dimensional-inventory.md), [industrial state candidates](guides/industrial-candidates.md), [ordered industrial transfer batches](guides/industry-transfer-batches.md) and [progression inspection](guides/progression-inspection.md).
- [Optional pure kit package](guides/pure-package.md): kits shipped without the engine runtime or three.js.
- Evidence records: [cellular WASM](verification/cellular-wasm/README.md), [indexed geometry](verification/indexed-geometry/README.md) and [lazy scene bodies](verification/lazy-scene-bodies-2026-09-30.md).

## Engineering records

Organized after the NASA software documentation guidance (NPR 7150.2D, NASA-STD-8739.8B,
SWEHB 7.18). Software classification: a self-assessed analog of NPR 7150.2D Class E
(general-purpose research software), not safety-critical. This is not a NASA compliance
determination. Each document carries a metadata header with its baseline commit;
`npm run lint:trace` checks the headers, the requirement trace and every relative link.

| Document | ID | Purpose |
|---|---|---|
| [Software management plan](plan/software-management-plan.md) | FENGINE-SMP | Classification, life cycle, assurance, security, maintenance, risks |
| [Requirements mapping matrix](plan/compliance-matrix.md) | FENGINE-RMM | How each NPR requirement applies, is tailored or is not applicable |
| [Requirements specification](requirements/requirements.md) | FENGINE-SRS | What the engine and its tooling shall do, plus untested gaps |
| [Design description](architecture/architecture.md) | FENGINE-SDD | Components, data flow, concurrency, decisions, quality attributes |
| [Interface control](icd/icd-dependencies.md) | FENGINE-ICD-dependencies | Dependencies, consumers and the read-only stdio bridge |
| [Data dictionary](data/data-dictionary.md) | FENGINE-DD | Tool fields, environment variables, options, data files, limits |
| [Test plan and procedures](verification/test-plan.md) | FENGINE-STP | Test levels, environment, CI commands, pass criteria, procedures |
| [Verification matrix](verification/verification-matrix.md) | FENGINE-VM | Requirement to test to result |
| [Test reports](verification/reports/README.md) | FENGINE-STR-* | Generated results per baseline or tag |
| [Configuration management](configuration/configuration-management.md) | FENGINE-SCMP | Configuration items, baselines, digests, generated outputs, releases |
| [Releases and version descriptions](releases/README.md) | FENGINE-VDD-* | What each tag contains and how to rebuild it |
| [Assurance record](assurance/assurance-record.md) | FENGINE-SAR | Analyses, audits, scans and review summaries per baseline |
| [User manual map](guides/SUM-MAP.md) | FENGINE-SUM-MAP | Where each user-manual element lives |
| [Limitations and safety-relevant use](guides/limitations.md) | none | What the engine does not do |

Dated verification records stay under [verification/](verification/verification-matrix.md#4-earlier-evidence-historical)
and are not rewritten.

## Complete document catalog

Every Markdown document under `docs/` is linked below or through the linked
catalogs. Historical evidence keeps the revision and scope recorded on its page.
A document's presence in this index does not establish a passed requirement.

### Guides

Browse [guide routes](guides/) by learning task.

- [<Title>](guides/GAME.template.md)
- [Predeclared acceptance evidence](guides/acceptance-evidence.md)
- [Binding-derived action hints](guides/action-hints.md)
- [Optional action phases](guides/action-phases.md)
- [Optional action runs](guides/action-runs.md)
- [Action composition workbench](guides/action-workbench.md)
- [Creator-defined appearance documents](guides/appearance-documents.md)
- [Optional appearance preview tool](guides/appearance-preview.md)
- [Asset provenance and AI disclosure](guides/asset-provenance.md)
- [Bounded asset residency (RES-01)](guides/asset-residency.md)
- [Service and worksite assignments](guides/assignments.md)
- [Audio-clock timeline](guides/audio-timeline.md)
- [Blob shadows](guides/blob-shadows.md)
- [Capability removal and respec](guides/capability-revocation.md)
- [Optional creator-defined capture matrix](guides/capture-matrix.md)
- [Cell and portal culling](guides/cell-culling.md)
- [Atomic cell edits and immutable occupancy](guides/cell-occupancy.md)
- [Optional cellular WASM workers](guides/cellular-wasm.md)
- [Character pipeline lessons: retargeting, weights, LOD, resampling and clip QA](guides/character-pipeline-lessons.md)
- [Optional compact shell menu](guides/compact-shell.md)
- [Composition frameworks and remaining work](guides/composition-framework-status.md)
- [KTX2 model textures (Basis Universal)](guides/compressed-textures.md)
- [Optional saved controls](guides/controls-settings.md)
- [Finite crafting sessions](guides/crafting-session.md)
- [Creator readiness milestone](guides/creator-readiness-goal.md)
- [Crowd and night rendering lessons: cost, cadence, transitions, wet looks and measuring](guides/crowd-and-night-rendering-lessons.md)
- [Coherent custody composition sample](guides/custody-composition.md)
- [Bounded dependency preparation](guides/dependency-resources.md)
- [Optional deterministic scalar maths (`dmath`)](guides/deterministic-math.md)
- [Device acceptance: current enforcement gaps](guides/device-acceptance-gaps.md)
- [Optional diagnostic subject associations](guides/diagnostic-subjects.md)
- [Dimensional inventory candidates](guides/dimensional-inventory.md)
- [Optional durable command authority](guides/durable-authority.md)
- [Optional entity metadata inspection](guides/entity-inspection.md)
- [Entity pool with eviction classes](guides/entity-pool.md)
- [Bounded causal event diagnostics](guides/event-trace.md)
- [Framework upgrade status and acceptance boundaries](guides/framework-upgrade-status.md)
- [Getting started: your first game](guides/getting-started.md)
- [Industrial state candidates](guides/industrial-candidates.md)
- [Optional ordered industrial transfer batches](guides/industry-transfer-batches.md)
- [Optional command integrity (anti-cheat)](guides/integrity.md)
- [Planar interaction alignment consumers](guides/interaction-alignment-lab.md)
- [Interest sets for scoped views (SC-02)](guides/interest-sets.md)
- [Editable itinerary helper and lab](guides/itinerary-lab.md)
- [Labs: prove one system before building a world](guides/labs.md)
- [Learn mode](guides/learn-mode.md)
- [Optional desktop manual authoring](guides/manual-authoring.md)
- [Material options: shading, sides, cut-outs and vertex colours on shapes, meshes and models](guides/material-options.md)
- [Optional delayed materialization](guides/materialization.md)
- [Native model presentation attachments](guides/model-attachments.md)
- [Model contracts](guides/model-contracts.md)
- [Optional model diagnostics](guides/model-inspection.md)
- [Compatible weighted model parts](guides/model-pose-links.md)
- [Observed model readiness](guides/model-readiness.md)
- [Optional shared session for game code (MP-01)](guides/multiplayer-session.md)
- [Music on the audio clock](guides/music-on-clock.md)
- [Optional network admission](guides/network-admission.md)
- [Optional planned drain and capped connection lifetime](guides/network-drain.md)
- [Seeded fault schedules for the composed authority path (NW-09)](guides/network-fault-schedule.md)
- [Network overload and goodput probe (NW-07)](guides/network-overload.md)
- [Optional reconnect and retry pacing](guides/network-retry.md)
- [Optional browser text transport](guides/network-transport.md)
- [Complete scoped network views](guides/network-views.md)
- [Optional objective workbench](guides/objective-workbench.md)
- [Optional owned pointer controls](guides/owned-pointer-controls.md)
- [Particle emitters (FX-01)](guides/particles.md)
- [Perception: senses, awareness and tactical choices](guides/perception.md)
- [Physics adapter (optional kit)](guides/physics-adapter.md)
- [Population: placements that remember and update tiers](guides/population.md)
- [Post-processing: bloom, vignette, grade, lookup tables and an HDR ceiling](guides/post-processing.md)
- [Optional prediction presentation: correction smoothing and predicted-event deduplication](guides/prediction-presentation.md)
- [Optional bounded prediction and reconciliation](guides/prediction.md)
- [Production output exchange and unique custody](guides/production-exchange.md)
- [Owned program preparation](guides/program-preparation.md)
- [Inspect authored progression choices](guides/progression-inspection.md)
- [Allocation workbench: one coherent authored envelope](guides/progression-workbench.md)
- [Public API compatibility and upgrades](guides/public-compatibility.md)
- [Discord announcement draft](guides/publication-announcement.md)
- [Optional pure kit package](guides/pure-package.md)
- [Optional rate and concurrency admission](guides/rate-admission.md)
- [Recipe workbench](guides/recipe-workbench.md)
- [Region activation](guides/region-activation.md)
- [Regional terrain with canonical surfaces](guides/regional-terrain.md)
- [Release readiness](guides/release-checklist.md)
- [Release notes draft: Foundation Engine 0.2.0](guides/release-notes-0.2.0.md)
- [Source release preparation — 2026-10-01](guides/release-preparation-status.md)
- [Remote playout: smooth presentation of authoritative views](guides/remote-playout.md)
- [Render backend](guides/render-backend.md)
- [Render interpolation of fixed-step Transforms](guides/render-interpolation.md)
- [Author scene resize lifecycle](guides/render-resize-lifecycle.md)
- [Optional replay log and divergence detector (SIM-01)](guides/replay-divergence.md)
- [Replication schedule: per-recipient deltas under a byte budget](guides/replication-schedule.md)
- [Explicit current resource values](guides/resource-values.md)
- [Retro look](guides/retro-look.md)
- [Rewind history: judging remote commands against what the sender saw](guides/rewind-history.md)
- [Intended-use route dependency diagnostic](guides/route-dependencies.md)
- [Instanced scatter](guides/scatter.md)
- [Scene activity notifications](guides/scene-activity.md)
- [Scene look: output, lights, shadows, sky and reflections](guides/scene-look.md)
- [Scene startup and fallback routing](guides/scene-startup.md)
- [Sandboxed scripts (optional)](guides/scripting.md)
- [Sequences: scripted cue tracks with barriers, skip and saves](guides/sequences.md)
- [Service assignment prototype](guides/service-assignment-lab.md)
- [Optional sustained-session performance recorder (PERF-01)](guides/session-performance.md)
- [Persistent skill allocation](guides/skill-allocation.md)
- [Spatial audio: panning, distance, cutoff, HRTF limit, filter and smoothing](guides/spatial-audio.md)
- [Bounded spatial index (SC-01)](guides/spatial-index.md)
- [Optional staged journal consumer](guides/staged-journal-consumer.md)
- [Explicit staged objectives](guides/staged-objectives.md)
- [Explain accepted derived values](guides/stat-explanations.md)
- [Streaming queue](guides/streaming-queue.md)
- [Optional authored-system timing](guides/system-timing.md)
- [Optional timed contributions](guides/timed-effects.md)
- [Optional UI browser regressions](guides/ui-browser-regressions.md)
- [Measuring UI visibility](guides/ui-visibility-diagnostics.md)
- [Update cadence](guides/update-cadence.md)
- [Continuing framework upgrade acceptance ledger](guides/upgrade-acceptance-ledger.md)
- [Eligible weighted choice and recent history](guides/weighted-choice.md)
- [Working with your agent](guides/working-with-your-agent.md)

### Recipes

- [Recipe: 3D sound for shooters](recipes/3d-sound-for-shooters.md)
- [Recipes](recipes/README.md)
- [Recipe: add a budget](recipes/add-a-budget.md)
- [Recipe: add a kit](recipes/add-a-kit.md)
- [Recipe: add a save section, with a migration](recipes/add-a-save-section.md)
- [Recipe: add a scene](recipes/add-a-scene.md)
- [Recipe: add a system](recipes/add-a-system.md)
- [Recipe: add a template](recipes/add-a-template.md)
- [Recipe: add a deterministic turn log (undo, redo, preview, replay)](recipes/add-a-turn-log.md)
- [Recipe: add an entity and a component](recipes/add-an-entity-and-component.md)
- [Recipe: add an input action](recipes/add-an-input-action.md)
- [Recipe: add branching dialogue with variables and visit counts](recipes/add-branching-dialogue.md)
- [Recipe: add anti-cheat to your game in 5 minutes](recipes/add-command-integrity.md)
- [Recipe: add input history (buffers, release edges, sequences)](recipes/add-input-history.md)
- [Recipe: add moving platforms](recipes/add-moving-platforms.md)
- [Recipe: add rollback sessions](recipes/add-rollback-sessions.md)
- [Recipe: animate a model pose to pose](recipes/animate-pose-to-pose.md)
- [Recipe: make it look good (art direction)](recipes/art-direction.md)
- [Recipe: camera and lighting](recipes/camera-and-lighting.md)
- [Recipe: collision and picking](recipes/collision-and-picking.md)
- [Recipe: generate seeded content off the frame](recipes/generate-seeded-content.md)
- [Recipe: give a shape a texture and a material](recipes/give-a-shape-a-material.md)
- [Recipe: hit sparks, pickups, trails and smoke](recipes/hit-sparks-and-pickups.md)
- [Host a build under a sub-path (GitHub Pages, itch.io)](recipes/host-under-a-sub-path.md)
- [Recipe: HUD text and buttons](recipes/hud-and-buttons.md)
- [Recipe: load a model and play its animation](recipes/load-a-model.md)
- [Recipe: make assets with Blender through MCP](recipes/make-assets-with-blender-mcp.md)
- [Recipe: play your own sound files](recipes/play-your-own-sounds.md)
- [Publish an immutable content bundle](recipes/publish-content.md)
- [Recipe: replay a scene with your own digest](recipes/replay-with-your-own-digest.md)
- [Recipe: scatter grass, rocks and repeated props in one draw each](recipes/scatter-grass-and-rocks.md)
- [Recipe: share your build](recipes/share-your-build.md)
- [Recipe: store large edited worlds as bounded binary records](recipes/store-large-world-records.md)
- [Recipe: sync gameplay to music](recipes/sync-gameplay-to-music.md)
- [Recipe: test a scene](recipes/test-a-scene.md)
- [Recipe: test your effects' lifecycles](recipes/test-effect-lifecycles.md)
- [Recipe: add and tune a jump](recipes/tune-a-jump.md)
- [Recipe: two players in one world in ten minutes](recipes/two-players-one-world.md)
- [Recipe: use a spatial index for neighbours, range and interest](recipes/use-a-spatial-index.md)
- [Recipe: per-observer interest sets and scoped views](recipes/use-interest-sets.md)
- [Use three.js directly](recipes/use-three-directly.md)
- [Recipe: write a playtest script](recipes/write-a-playtest-script.md)
- [Recipe: write plurals, ordinals and variants in strings](recipes/write-plurals-ordinals-and-variants.md)
- [Recipe: where your game's files go](recipes/your-game-files.md)

### Adr

- [ADR 0001: Record architecture decisions as ADRs](adr/0001-record-architecture-decisions.md)
- [ADR 0003: Features are modules loaded through fixed boot phases](adr/0003-module-system-boot-phases.md)
- [ADR 0004: One typed event bus](adr/0004-typed-event-bus.md)
- [ADR 0005: All open sets live in validated registries; content is typed TypeScript](adr/0005-registries-and-typed-content.md)
- [ADR 0006: Content packs change content through ordered patches](adr/0006-patch-layer-content-packs.md)
- [ADR 0007: One save store with typed sections, scopes and migrations](adr/0007-save-store-sections.md)
- [ADR 0010: Pure maths imports nothing](adr/0010-pure-maths-library.md)
- [ADR 0015: One frame loop; activities render on demand; covered activities pause](adr/0015-activity-loop-render-on-demand.md)
- [ADR 0016: Renderer pool and reference-counted resource ownership](adr/0016-renderer-pool-resource-ownership.md)
- [ADR 0017: Quality presets are the single performance governor](adr/0017-quality-presets.md)
- [ADR 0020: A UI shell owns buttons, layers, focus, Back and input priority](adr/0020-ui-shell-layers-keymap.md)
- [ADR 0021: All user-facing text is keyed strings](adr/0021-strings-and-locales.md)
- [ADR 0022: A scene registry drives routing and per-scene code splitting](adr/0022-scene-router-lazy-loading.md)
- [ADR 0023: One asset manifest with size variants, provenance and a shared cache](adr/0023-asset-manifest-and-cache.md)
- [ADR 0025: Per-scene performance budgets are contracts enforced before integration](adr/0025-performance-budgets-as-contracts.md)
- [ADR 0026: Verifiers use a typed test API, not DOM scraping](adr/0026-test-api-over-dom-scraping.md)
- [ADR 0029: A Graphics screen of registered knobs; the reference preset is the design bar and the gated tier](adr/0029-graphics-screen-reference-preset.md)
- [ADR 0030: Budgets gate structure in software GL at every integration; time and pixels on the reference GPU](adr/0030-budget-gating-two-harnesses.md)
- [ADR 0031: Layers with a presentation-kit layer, content packs and ports for upward needs](adr/0031-layers-kits-packs-ports.md)
- [ADR 0032: Activities return a run; one loop renders on demand; coverage pauses; preview layers keep the scene live](adr/0032-activity-runs-coverage-preview.md)
- [ADR 0033: One game clock, driven only by the loop](adr/0033-game-clock-driver.md)
- [ADR 0034: One WebGL2 render path](adr/0034-one-webgl2-path.md)
- [ADR 0035: Two-layer shadow maps: static casters cached, moving casters redrawn](adr/0035-two-layer-shadow-maps.md)
- [ADR 0036: Feature anatomy: an eager manifest, a lazy body, discovered by folder; shared baselines are sharded](adr/0036-feature-anatomy.md)
- [ADR 0037: Static shadow depth is a versioned cache, never a full-pass copy](adr/0037-shadow-cache-validity.md)
- [ADR 0039: Tick-addressed input and explicit world/local time](adr/0039-simulation-time-and-input.md)
- [ADR 0040: Share immutable set resources; keep activity scenes private](adr/0040-scene-instance-ownership.md)
- [ADR 0041: Scene handover presentation](adr/0041-scene-handover.md)
- [ADR 0043: The extension model made true: one folder, folder-local strings, open registries, behaviour bound lazily by id](adr/0043-extension-model.md)
- [ADR 0044: One action map: keys, pad and pointer resolve to registered actions](adr/0044-one-action-map.md)
- [ADR 0045: Prepare a scene, then activate only the current request](adr/0045-handover-activation.md)
- [ADR 0046: Cache measurements only when the complete experiment matches](adr/0046-bench-cache-evidence.md)
- [ADR 0047: Reachability is a path; an input press has one owner](adr/0047-input-reach-and-ownership.md)
- [ADR 0049: World-host capacity is derived, and dilation is budgeted](adr/0049-world-time-dilation-budget.md)
- [ADR 0051: Submission counters are report-only until two benches agree](adr/0051-submission-counters.md)
- [ADR 0052: Coherent saves before physical section splits](adr/0052-save-atomicity-boundary.md)
- [ADR 0053: Measure normal work, including recurring uploads](adr/0053-workload-valid-performance-windows.md)
- [ADR 0055: Batching is a small set of primitives chosen by what the art must still do](adr/0055-batching-primitive.md)
- [ADR 0056: Change trackers observe batches and skeletons](adr/0056-trackers-observe.md)
- [ADR 0057: Render dependencies are observed, never guessed](adr/0057-render-dependency-observation.md)
- [ADR 0059: One worker host; pure, keyed, cancellable jobs; the frame never waits on a worker](adr/0059-one-worker-host.md)
- [ADR 0061: Ownership and authorship are outside the architecture](adr/0061-ownership-outside-the-architecture.md)
- [ADR 0062: Bounded worker admission, physical cancellation and current-owner delivery](adr/0062-bounded-worker-admission.md)
- [ADR 0063: Successful installation controls executable availability, not stored identity](adr/0063-boot-availability-without-data-loss.md)
- [ADR 0064: Canonical fixed-resolution terrain surfaces](adr/0064-canonical-terrain-surface.md)
- [0065 — Owned optional systems](adr/0065-owned-optional-systems.md)
- [ADR 0066: preparation and render resource ownership](adr/0066-preparation-and-render-resource-ownership.md)
- [ADR 0067: shared dependency admission](adr/0067-shared-dependency-admission.md)
- [ADR 0068: device-specific experience contracts](adr/0068-device-specific-experience-contracts.md)
- [ADR 0069: author-selected device and edition scope](adr/0069-author-selected-device-scope.md)
- [ADR 0070: independent graphics selection and bounded UI diagnostics](adr/0070-device-runtime-diagnostics.md)
- [ADR 0071: optional HUD disclosure through owned reading sheets](adr/0071-owned-reading-sheets.md)
- [ADR 0072: transactional resource publication and retirement](adr/0072-transactional-resource-retirement.md)
- [ADR 0073: binding-derived action descriptions](adr/0073-binding-derived-action-descriptions.md)
- [ADR 0074: application-owned controller polling](adr/0074-application-input-polling.md)
- [ADR 0075: opt-in lazy scene bodies](adr/0075-opt-in-lazy-scene-bodies.md)
- [ADR 0076: engine, creator and agent contract](adr/0076-engine-creator-agent-contract.md)
- [0077 Candidate verification evidence](adr/0077-candidate-verification-evidence.md)
- [ADR 0078: Creator-selectable render backend](adr/0078-creator-selectable-render-backend.md)
- [ADR 0079: a constrained mobile GPU starts on a lighter preset](adr/0079-device-class-start-limit.md)
- [ADR 0080: optional assignment, itinerary and alignment ownership](adr/0080-optional-interaction-ownership.md)
- [ADR 0081: source-owned visibility contributions](adr/0081-visibility-contributions.md)
- [ADR 0082: bounded weighted choice and separately committed history](adr/0082-bounded-weighted-choice-history.md)
- [ADR 0083: portable timed contribution checkpoints](adr/0083-portable-timed-contribution-checkpoints.md)
- [ADR 0084: persisted recurring phase experiment](adr/0084-persisted-recurring-phase.md)
- [ADR 0085: atomic cell batches and immutable raster occupancy](adr/0085-atomic-cell-batches-and-occupancy.md)
- [ADR 0086: Bounded optional work roster](adr/0086-bounded-work-roster.md)
- [ADR 0087: optional bounded rewind history](adr/0087-rewind-history.md)
- [ADR 0088: optional acknowledged-baseline view deltas](adr/0088-view-deltas.md)
- [ADR 0089: model clip transitions through the existing model owner](adr/0089-model-clip-transitions.md)
- [ADR 0090: support-anchored vertical camera framing](adr/0090-camera-support-framing.md)
- [ADR 0091: bounded cue sequences as an optional kit](adr/0091-bounded-cue-sequences.md)
- [ADR 0092: placements with persistent depletion and update tiers](adr/0092-population-placements-and-tiers.md)
- [ADR 0093: optional remote playout and clock offset](adr/0093-remote-playout.md)
- [ADR 0094: optional per-recipient replication schedule](adr/0094-replication-schedule.md)
- [ADR 0095: optional region activation from observer positions](adr/0095-optional-region-activation.md)
- [ADR 0096: optional per-member update cadence](adr/0096-optional-update-cadence.md)
- [ADR 0097: optional action phase windows](adr/0097-action-phase-windows.md)
- [ADR 0098: Bounded optional volume queries](adr/0098-bounded-volume-queries.md)
- [ADR 0099: optional strict numeric modes](adr/0099-strict-numeric-modes.md)
- [ADR 0100: optional entity pool with eviction classes](adr/0100-optional-entity-pool-eviction-classes.md)
- [ADR 0101: Optional cellular WASM worker kernel](adr/0101-optional-cellular-wasm.md)
- [ADR 0102: optional ballistic trajectory solves](adr/0102-ballistic-trajectories.md)
- [ADR 0103: optional breadcrumb trails for followers](adr/0103-breadcrumb-trails.md)
- [ADR 0104: optional grid-step actor movement](adr/0104-grid-step-movement.md)
- [ADR 0110: bounded look-at constraint in the animation kit](adr/0110-look-at-constraint.md)
- [ADR 0111: cast binding, branching and event arbitration for sequences](adr/0111-sequence-cast-branches-arbitration.md)
- [ADR 0112: optional camera director helpers](adr/0112-camera-director.md)
- [ADR 0113: optional perception kit feeding a blackboard](adr/0113-perception-kit.md)
- [ADR 0114: navigation mesh queries, funnel paths and local avoidance](adr/0114-navmesh-funnel-avoidance.md)
- [ADR 0115: ledge, ladder and pushable traversal helpers](adr/0115-traversal-helpers.md)
- [ADR 0120: optional sandboxed script runtime](adr/0120-optional-sandboxed-script-runtime.md)
- [ADR 0121: optional physics adapter kit over a lazily loaded WebAssembly library](adr/0121-optional-physics-adapter-kit.md)
- [ADR 0122: deterministic resumable behaviour trees](adr/0122-behaviour-trees.md)
- [ADR 0123: flow economy, production queues and reclaim](adr/0123-flow-economy-and-production.md)
- [ADR 0124: data-defined stat and damage formulas](adr/0124-data-defined-formulas.md)
- [ADR 0125: status effects with transforms on the fixed clock](adr/0125-status-effects.md)
- [ADR 0126: slot, stack and key-item rules over the inventory ledger](adr/0126-inventory-rule-presets.md)
- [ADR 0130: optional on-demand streaming queue](adr/0130-optional-streaming-queue.md)
- [ADR 0131: defer worker render pipelining until a measured need](adr/0131-defer-worker-render-pipelining.md)
- [ADR 0132: optional retro software-raster look](adr/0132-optional-retro-look.md)
- [ADR 0133: offline format converters with provenance receipts](adr/0133-offline-format-converters.md)
- [ADR 0134: duplicate and near-duplicate detection as a read-only repo tool](adr/0134-duplicate-detector.md)
- [ADR 0135: spreadsheet import for formula sheets and lookup tables](adr/0135-formula-data-import.md)
- [ADR 0136: legacy game and multimedia format decoders in the converter toolchain](adr/0136-legacy-format-decoders.md)
- [ADR 0140: optional car handling on ray-cast wheels](adr/0140-optional-car-handling.md)
- [ADR 0141: optional board traversal with authored rails](adr/0141-optional-board-traversal.md)
- [ADR 0142: Optional prediction correction smoothing and predicted-event deduplication](adr/0142-prediction-presentation.md)
- [ADR 0145: optional cell and portal render culling](adr/0145-cell-portal-culling.md)
- [ADR 0151: optional contact layer and touch events](adr/0151-contact-layer.md)
- [ADR 0152: optional medium volumes](adr/0152-medium-volumes.md)
- [ADR 0153: listener placement, voice rate and adaptive music](adr/0153-audio-listener-and-adaptive-music.md)
- [ADR 0154: optional presentation kit](adr/0154-presentation-kit.md)
- [ADR 0155: companion recovery on breadcrumb trails](adr/0155-companion-recovery.md)
- [ADR 0156: Source identity and read-only tool schema baseline](adr/0156-foundation-contract-baseline.md)
- [Architecture decision records](adr/README.md)

### Verification

- [Active-window lifecycle correction — 2026-10-03](verification/active-restart-20261003/README.md)
- [Model contracts and `asset:verify` — 2026-10-03](verification/asset-contracts-20261003.md)
- [Asset residency (RES-01) evidence](verification/asset-residency-20261002/README.md)
- [Durable authority native acceptance](verification/authority-20261001/README.md)
- [Blender export consumer — 2026-10-03](verification/blender-export-20261003.md)
- [Brand rendering check, 2026-10-03](verification/brand-20261003.md)
- [Cellular WASM candidate evidence — 2026-10-08](verification/cellular-wasm/README.md)
- [Public contributor-path rehearsal — 2026-10-03](verification/contributor-rehearsal-20261003.md)
- [Stock explorer creator journey — 2026-10-03](verification/creator-journey-20261003.md)
- [Stock explorer creator journey: failure paths, 2026-10-03](verification/creator-journey-recovery-20261003.md)
- [Creator onboarding rehearsal — 2026-10-03](verification/creator-onboarding-20261003.md)
- [Model cancellation after decode — 2026-10-03](verification/decode-cancellation-20261003.md)
- [Dependency preparation M2](verification/dependency-preparation-20261001/README.md)
- [DPR-only author scene redraw — 2026-10-03](verification/dpr-redraw-20261003.md)
- [First-use observation baseline — 2026-10-03](verification/first-use-20261003/README.md)
- [Indexed geometry ownership transactions](verification/indexed-geometry/README.md)
- [Window resize contact retirement](verification/input-resize-20261001/README.md)
- [KTX2 model textures — 2026-10-03](verification/ktx2-model-textures-20261003.md)
- [Lazy scene body evidence](verification/lazy-scene-bodies-2026-09-30.md)
- [Model retirement after transport cancellation — 2026-10-03](verification/model-retirement-20261003.md)
- [Network overload and goodput probe evidence (NW-07), 2026-10-02](verification/network-overload-20261002/README.md)
- [Shell-independent renderer startup](verification/optional-renderer-startup/README.md)
- [Pose-to-pose pipeline: recorded evidence (2026-10-03)](verification/pose-to-pose-20261003.md)
- [Program preparation correctness checkpoint](verification/program-preparation/README.md)
- [Worker render pipelining: feasibility and measurement (2026-10-10)](verification/render-pipelining-20261010/README.md)
- [Retro look on the showcase courtyard (2026-10-10)](verification/retro-look-20261010/README.md)
- [Review follow-ups, 2026-09-30](verification/review-followups-2026-09-30.md)
- [Refused save and durable retry consumer evidence — 2026-10-03](verification/save-recovery-20261003.md)
- [Session host CLI startup regression — 2026-10-03](verification/session-host-cli-20261003.md)
- [PERF-01 emulated session sample (2026-10-02)](verification/session-perf-20261002/README.md)
- [Shared-session recovery in the browser — 2026-10-03](verification/session-recovery-20261003.md)
- [Stock touch controls: exploratory evidence](verification/stock-device-20261001/README.md)
- [Lesson layout repair: emulated evidence](verification/stock-device-20261002/README.md)
- [Verification matrix](verification/verification-matrix.md)

### Research

- [Callback ownership and bounded diagnostics](research/CALLBACK-OWNERSHIP.md)
- [Game UI/UX research and implementation priorities](research/GAME-UI-UX.md)
- [JUCE audio and lifetime architecture study](research/JUCE-AUDIO-LIFETIME.md)
- [JUCE editor architecture: source study and engine proposals](research/JUCE-EDITOR-ARCHITECTURE.md)
- [Foundation Engine: open-source tooling study](research/OPEN-SOURCE-TOOLING.md)
- [Implementation studies](research/README.md)
- [Foundation Engine tooling landscape: source-led expansion of the research lane](research/TOOLING-LANDSCAPE.md)
- [Physics middleware options for an optional adapter kit](research/physics-middleware.md)
- [Runtime pose chains: design note](research/runtime-pose-chains.md)
- [Script runtime options (2026-10-09)](research/script-runtime-options.md)

### Releases

- [Release candidate `7c26db7`](releases/candidate-7c26db7/README.md)
- [Reproducible build for candidate `7c26db7`](releases/candidate-7c26db7/build.md)
- [Asset and licence notices check for candidate `7c26db7`](releases/candidate-7c26db7/notices.md)
- [Release notes draft: Foundation Engine 0.3.0 (proposed)](releases/candidate-7c26db7/release-notes.md)
- [Support matrix for candidate `7c26db7`](releases/candidate-7c26db7/support-matrix.md)
- [Upgrading a game from 0.2.0 to candidate `7c26db7`](releases/candidate-7c26db7/upgrade.md)

### Kits

- [Kits](kits/README.md)
- [Recipe: use the explore kit](kits/explore.md)
- [Stock template device acceptance](kits/stock-device-acceptance-matrix.md)
- [Optional HUD detail disclosure](kits/ui/disclosure.md)

### Policy

- [Device experience policy](policy/DEVICE-EXPERIENCE.md)
- [Policy profile: kid-safe (opt-in)](policy/KID-SAFE.md)

### Root documents and engineering registers

- [Applying the Standard: <Game name>](APPLICATION.md)
- [Creator choices and framework contracts](CREATOR-CONTRACT.md)
- [Foundation Engine goals](GOALS.md)
- [Provenance](PROVENANCE.md)
- [Foundation Engine documentation](README.md)
- [Roadmap: bounded framework contracts](ROADMAP.md)
- [Engine Architecture Standard](STANDARD.md)
- [Architecture](architecture/architecture.md)
- [Foundation Engine brand](brand.md)
- [Capabilities](capabilities.md)
- [Configuration management](configuration/configuration-management.md)
- [Interface control: external dependencies and consumers](icd/icd-dependencies.md)
- [Requirements](requirements/requirements.md)

- [Reports](reports/README.md): location for new dated reports.
- [Secret scanning](guides/reference/secret-scanning.md): manifest hash exception and publishing checks.
