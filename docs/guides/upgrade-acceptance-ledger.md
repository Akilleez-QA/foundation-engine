# Continuing framework upgrade acceptance ledger

Foundation is an optional, replaceable framework skeleton. This ledger tracks the
remaining accepted upgrade work without treating completion of one implementation
batch as completion of the whole program. A roadmap item is not a mandatory game
feature. Device support, gameplay rules, aesthetics and quality choices belong to
the creator. No row certifies arbitrary applications or physical devices.

Baseline: `e8dac16`, following PRs #101–#104. Prior source evidence is recorded in
[framework upgrade status](framework-upgrade-status.md) and
[composition framework status](composition-framework-status.md). The previous
terrain/document/diagnostic/route/materialization program is integrated within its
stated boundaries. Those boundaries remain real; unimplemented capabilities are
not made complete by relabelling them as optional.

Current status (2026-10-03): every public PR merged through #116 is integrated on
`main`, including merge-train batches #62, #64 and #65 and GEN-02 (#56). See
[post-0.2.0 integration](#post-020-integration-2026-10-02-to-2026-10-03) and the
[creator-readiness milestone](#creator-readiness-milestone-2026-10-03), which cites each
milestone receipt in `docs/verification/`. Earlier candidate wording below is kept as
history beside a dated current-status line.

Revision references: PR numbers and merge/commit hashes before the public
repository's first commit `c0e73c9` refer to the private development history,
which is not published. `c0e73c9` has the same source tree as private `main`
`b983e1a`. Later public PRs are on
[github.com/Akilleez-QA/foundation-engine](https://github.com/Akilleez-QA/foundation-engine/pulls).

## Completion rules

Each item requires an implementation or explicit creator deferral, documented
ownership/bounds/failure/recovery, appropriate regressions, a representative
consumer and acceptance on its declared surface. Source inspection, headless tests,
browser emulation and physical-device evidence are separate. New code must pass
its rebased exact-head gate before serial integration and combined tests/build.
A green gate does not establish missing workflow, authority or device acceptance.

The overall upgrade goal remains active while required work is unresolved. A
sequence decision is not a user-approved deferral. No percentage is inferred from
row counts, because the effort and acceptance scope differ substantially.

## Current batch

| ID | Contract and required observation | State |
|---|---|---|
| CAP-01 | Objective/modifier capture rejects forged lengths, overridden array hooks and reentrant mutations without changing accepted state. Preserve established limits and ordinary semantics. | Integrated in PR #105; focused adversarial cases and exact-head gate passed. Flat requirement definitions retain their existing uncapped count API. |
| MODEL-01 | Existing scene model owner exposes factual requested/adopted readiness without loading or redrawing from queries. | Integrated in PR #108 (`be3eaf2`). Final candidate `b36b773` passed 1629 tests and 28 expedition gate checks; combined main tests/build passed. |
| MODEL-02 | Real GLB candidate retains accepted model through delay, failure, cancel and supersession; only ready candidate can publish; save/restore and scene cleanup exercised. | Integrated in PR #108 after real GLB desktop browser acceptance, bounded-capacity and cleanup-reentry repairs, and truthful Reload recovery for cached incompatible assets. Physical devices and arbitrary skeletal composition remain unverified. |
| TRANSFER-01 | Bounded production exchange shares epoch/history/checkpoint validation and preserves clocks/reserves; imported stock participates in capacity. | Integrated in PR #107; 1575 combined tests and expedition gate passed. |
| TRANSFER-02 | One production/equipment/receipt envelope conserves authored quantity and unique identity through capacity failure, dirty save, exact retry and reload; incoherent receipt/withdrawal rejects. | Integrated in PR #107 after restore-coherence repair, seven exchange tests and rebased gate `9d13267`. |
| JOURNAL-01 | Render staged progress with explicit ready versus terminal, delayed accepted action and cancellation; old work cannot complete a replacement. | Integrated in PR #106 after desktop browser and rebased gate d2f7392. |
| JOURNAL-02 | Reward inventory, capability and receipt restore coherently; rejected capacity stays pending; failed save/retry/reload cannot duplicate delivery or claim durability. | Integrated in PR #106; real SaveStore and desktop browser acceptance passed. |

## Accepted capability work and remaining acceptance

This table retains both integrated work and unresolved requirements. Integrated
rows preserve their evidence boundaries; unresolved rows remain in the continuing
objective. Refine their observable scope against actual source before implementation;
reuse existing owners unless concrete evidence demonstrates an incompatible seam.

| ID | Required capability/consumer surface | Current boundary and next evidence |
|---|---|---|
| AP-01 | Model/attachment adapter with cleanup on parent loss, replacement and missing sockets | Integrated in PR #110 at ef7c2e1. Optional post-pose affine attachment, chains, explicit hide/hold and visibility policy, replacement and retirement passed at 8677e03 with real-GLB desktop workflow and all seven gates (1,662 tests; no enforced breaches/regressions, four advisory heap warnings). Combined main tests/build passed. Cached rigid bounds are not pixel/skinned geometry proof; hardware performance remains unverified. |
| AP-02 | Modular appearance compatibility and asset-failure handling beyond primitive forms | Integrated in PR #114 at f704321. Optional explicit compatible rig mappings, bounded immutable rest intake, independently owned skeletons and combined rigid/weighted dependency handling passed at edf2744 with actual cached deformation oracles, failed/replaced assets, coherent preview/save/reload, all seven gates and 1,754 tests. Combined main tests/build passed. No arbitrary retargeting, skeleton fusion, physical-device or GPU timing certification. |
| CU-01 | World/container and unique-item transfer composition | Integrated in PR #115 at 88f37f6. One creator-owned envelope composes equipment, material reservations, unique identity and explicit durable publication. Exact 23dedb6 passed 14 real SaveStore regressions, independent ECS/render browser checks and all seven template gates (1,768 tests). Combined main tests/build passed. Failed writes retain the exact candidate; observed conflicting, newer or incoherent saves refuse acceptance. Finite desktop single-writer example; no cross-process CAS or physical-device certification. |
| ST-01 | Optional resource values and explanation traces | Integrated in PR #112 at 482b7a3: source-preserving modifier/timed traces and explicit pure resource candidates with overflow, rounding and range-adjustment choices. Exact af9d9e3 passed all seven gates (1,712 tests; 129 performance checks; zero enforced breaches/regressions and four advisory heap warnings), independent integer-ratio cases and desktop workflow. Combined main tests/build passed. No resource lifetime or automatic regeneration imposed. |
| PG-01 | Authored progression and respec presentation | Integrated in PR #112 at 482b7a3: optional inspection/provenance and authored allocation workbench exercise rejected, stale and cancelled choices; coherent inventory/resource/grant/receipt publication; save failure, retry and reload. Desktop keyboard/pointer workflow passed at af9d9e3. Physical-device and cross-process atomic persistence acceptance are not established; no required classes or experience curve. |
| OB-01 | Objective-related work cancellation and reward publication | Integrated in PR #116 at 358643a. Two consumers share exact work leases; cancelled/replaced callbacks cannot publish. Captured adoptions retain historical branch consequences and receipts through failed writes, retry and restore. Candidate b0718b1 passed native browser, 39 focused regressions and all seven gates (1,807 tests; 129 performance checks; no enforced breaches/regressions, four advisory heap warnings). Combined main tests/build passed. Finite single-writer desktop example, not distributed authority. |
| OB-02 | Visual objective definition tools | Integrated in PR #116 at 358643a. Optional native graph editor composes bounded document/history, shared semantic validation and isolated staged previews with undo, save/reload and explicit runtime adoption. Browser evidence at b0718b1 passed; graph edits never silently change adopted runs. Focused editor exposes the sample schema, not every possible authoring workflow; no mandatory editor or physical-device certification. |
| AC-01 | Targeting, effect and animation adapters with coherent consequences | Integrated in PR #117 at 2aabe49. Candidate c245896 passed native desktop browser, 23 focused regressions and all seven template gates (1,830 tests; 129 performance checks; zero enforced breaches/regressions/inconclusive and four advisory software-GL heap warnings). Combined main tests/build passed. Exact target facts, callback revalidation, session receipts and independently owned marker cues; no durable save, network authority or physical-device claim. |
| CR-01 | Ingredient selection under creator policy | Integrated in PR #118 at `1c177d5`. Candidate `790aaea` passed 41 focused tests, independent real-SaveStore recovery probes, native desktop browser and all seven template gates (1,871 tests; 129 performance checks; zero enforced breaches/regressions/inconclusive, four advisory software-GL heap warnings). Combined main tests/build passed. Exact ingredient custody and executable cancellation recovery remain finite single-writer composition, not distributed authority. |
| CR-02 | Authored experimentation and resource spawn lifecycle | Integrated in PR #118 at `1c177d5`. Pinned full recipe/batch facts, explicit spawn replacement/expiry, paid repeat manufacture, protected factory work and durable retry/reload passed at `790aaea`. Failed-write scene reentry preserves pending work and prior accepted custody until acknowledgment. No automatic rotation, universal economy or physical-device certification. |
| CR-03 | Recipe/effect visual inspectors | Integrated in PR #118 at `1c177d5`. Native bounded inspector, isolated validation/preview, undo and independent recipe persistence passed the `790aaea` desktop workflow. Empty attribute recipes and oversized raw storage are covered. Creator policy remains replaceable; the tool does not impose a player UI. |
| NW-01 | Transport/session and authenticated authority boundary | Integrated in PR #120 at `3a97ca6`: pure intake `bd65713`, browser text adapter `540bece`, and ephemeral WebSocket reference host `63730cc`. Reported focused checks pass: 16 intake, 13 injected-socket adapter, 10 real TCP/WebSocket host and 5 reference response-schema tests. Native two-browser/separate-host acceptance passed at `4e51a04`, with inspected rendering and independent host counters. Final `5f871b3` passed all seven template gates (1,917 tests; 129 performance checks; zero enforced breaches/regressions/inconclusive, four advisory software-GL heap warnings); combined main tests/build passed. Measured load remains NW-02 work. No durable or complete multiplayer authority claim. |
| NW-02 | Interest management and bounded snapshots | Integrated on main by merge `ea48539`, preserving input-resize integration `894fc52`; work tracked in PR #122 in the private development history. Clean rebased browser passed at `508edd9`; final `47a7e6d` passed all seven gates (1,965 tests, 129 performance checks, zero enforced breaches/regressions/inconclusive, four advisory heap warnings). Combined main 1,965 tests/build passed. Four local load cases passed (worst publisher p95 0.321 ms). Historical failure/retry and earlier candidate revisions remain below. Git ancestry proves integration; GitHub PR state was still OPEN immediately after push. Creator scope is explicit; no general spatial policy or delta replication claim. |
| NW-03 | Prediction/reconciliation, reconnect and server persistence | NW-03 is integrated on private `main` by merge `b6fb4a3` (PR #123 in the private development history) and included in public `main` since `c0e73c9`. Exact head `883f4ad` passed all seven template gates: 2,018 tests, 129 performance checks, zero enforced breaches/regressions/inconclusive results and four advisory heap warnings. Combined main tests (2,018) and build passed. Clean native two-client acceptance passed at `8317c69` (seven observations); all 53 focused tests and 17 actual Node 22.13 storage/host checks passed. Historical component repairs and limits are recorded below. DV-01 remains open; no physical-device, public-release or unrestricted multiplayer claim. |
| NW-06 | Maximum queued age and pre-invocation submit deadlines (study N3) | Integrated in v0.2.0 (PR #12, merged to main at `53d549d`). Optional `maxQueuedAgeMs` sheds aged intake commands before `authorize`/`dispatch` (counted as `stale`; originally one pump attempt each, superseded by the follow-up below); optional injected `clock` plus `submit(command, {deadlineMs})` returns `expired` only before storage invocation, consuming no sequence. In-flight writes keep committed/rejected/unknown semantics. Defaults unchanged. 6 intake and 9 authority focused tests in PR #12 (9 intake after the follow-up); no load, WAN, browser-composition or device acceptance claimed. See [network kit](../../src/kits/network/README.md) and [durable authority](durable-authority.md). Follow-up (integrated in v0.2.0 (PR #33; batch PR #42)): age shedding is no longer charged to the pump budget (optional `maxStaleDropsPerPump` cap), fixing the NW-07 goodput collapse; 300 ms final/peak 0.23-0.25 before, 0.92-0.96 after with PR #27's probe (loopback). |
| NW-04 | Reconnect/retry pacing: full-jitter backoff and retry budget | Integrated in v0.2.0 (PR #14, merged to main at `82862d6`). Optional pure `createRetrySchedule` in the network kit, with the network workbench client as an opt-in consumer. Evidence and remaining limits are in the NW-04 section below. No WAN, reconnect-storm-against-a-real-host or physical-device claim. |
| NW-05 | Shared rate and concurrency admission | Integrated in v0.2.0 (PR #13, merged to main at `cc2ef79`). Optional single-process `createRateAdmission` ([guide](rate-admission.md)): per-key token bucket, optional concurrency leases, `maxKeys` with lossless idle reclamation only, explicit `limited`/`refused` results, clock-regression safe, idempotent dispose. Three reference hosts migrated from 1000 ms fixed windows to buckets of equal burst and refill (intended semantic change: no 2x boundary burst; same long-run rate). Focused unit and loopback host tests; no distributed, measured-load or physical-device claim. |
| RES-01 | Bounded asset residency (texture/model budgets, pins, LRU eviction) | Integrated in v0.2.0 (PR #22, merged to main at `9913019`). Optional `defineGame({ residency })` applies per-preset `warmBytes`/`residentBytes` and pinned asset ids to the existing `LeaseCache` of the texture and model libraries; live and pinned assets are never evicted, over-ceiling pressure is reported once per transition with a creator hook, retained three.js resources are parked through public `dispose` events. Default unchanged (dispose at release). Evidence: focused unit tests, an opt-in native SwiftShader fixture (estimate vs uploaded mip chain, `renderer.info` counts, actual context loss) and a temporary composed probe; see [guide](asset-residency.md). No program-count budget, cross-library ceiling, physical-device memory or traversal-performance claim. |
| KTX2-01 | KTX2 (Basis Universal) model textures | Implemented and checked in PR #146 (branch `feat/ktx2-textures`). `KHR_texture_basisu` GLBs load through the model library; the KTX2 chunk and the Basis transcoder load only for a model with a KTX2 image (asserted: no request otherwise); detectSupport on the pooled renderer chose BC7 in SwiftShader (5,488 B for the 64×64 fixture vs 21,844 B in the forced RGBA8 fallback); transcoded bytes count in `residentMiB` and `compressedTextureMiB`; three cancel-after-transcode cycles dropped late results and disposed every resource; app disposal terminated every transcoder worker; `--base /sub/ktx2/` and `--base ./` builds fetched the transcoder inside the sub-path. Hand-packed UASTC fixture (no encoder available), decoded texel-exact by the vendored transcoder. Not established: phone GPUs (ASTC/ETC2), driver memory, transcode time, ETC1S or Zstandard input; transcoder workers are an explicit STD-RUN-35 exception. [Guide](compressed-textures.md), [evidence](../verification/ktx2-model-textures-20261003.md). |
| RB-01 | Optional peer rollback sessions and local sync test (genre study 2026-10-02, slice 1) | Integrated in v0.2.0 (PR #25; batch PR #42). Optional `@kits/rollback`: `createRollbackSession` (2–8 peers, `maxPredictionFrames` 0–60, `inputDelay` 0–30, byte-bounded inputs/states, rollback to the earliest contradicted frame, stall at the window, confirmed-state checksums with bounded history/pending reports, fail-closed protocol faults, `AbortSignal` disposal) and `createRollbackSyncTest`. 25 focused tests, including seeded multi-peer convergence against a no-network reference, a sync test that compares every replay with the live step (fixed after review), late-peer pacing on the exposed `frameAdvantage`, and a `testScene` fixed-lane consumer. Requires a reliable, ordered link; there is no built-in time sync. No WAN, unreliable-channel, spectator, cross-browser floating-point or physical-device claim. See the section below and the [kit README](../../src/kits/rollback/README.md). |
| NW-09 | Seeded fault-schedule harness for the composed authority path (study N6, tools/test only) | Integrated in v0.2.0 (PR #26; batch PR #42). `npm run faults:network` and `tools/authority-workbench/fault-harness.test.mjs` replay seeded combined faults (link delay/reorder/duplicate/drop, connection loss mid-command, controller replacement, held/crashed commits, host restart, SQLite before/after-commit failure with recovery, clock skew, slow consumer, revocation) against the reference host and two scripted clients, checking durable-history, result-semantics, prediction, disclosure, bound and leak invariants after every step against independent SQLite readback; failing seeds print seed + step index and can be shrunk and replayed. Process-scope loopback evidence only: no WAN, power-loss, filesystem, scale or device claim. See the [guide](network-fault-schedule.md). |
| NW-08 | Planned drain and capped connection lifetime (study N8) | Integrated in v0.2.0 (PR #21; batch PR #42). Optional pure `createConnectionDrain` (host: bounded notice, operator drain/resume, dithered lifetime cap, per-poll instruction cap) and `createDrainFollower` (client: bounded notice, cooperative close, hold until announced return, then the existing retry schedule) in the network kit; the network workbench host (`--drain`) and client (checkbox) opt in. Drain closes are 1012 and transient. Admitted work is never cancelled. Evidence and limits are in the NW-08 section below. No process-restart, WAN or physical-device claim. |
| NW-07 | Overload and goodput acceptance probe (study N4), tools only | Integrated in v0.2.0 (PR #27; batch PR #46). `npm run probe:network` forks the network and replication reference hosts and drives them over real loopback WebSockets: offered-load ramp past saturation (FIFO and queue-age variants), flooder/wrong-credential/over-bound adversaries, a physical paused-socket non-reader, and a host-restart reconnect storm paced by `createRetrySchedule`. Three default runs at `0744509` (load average 94 to 113, niceness 15): FIFO goodput plateaued at the host's achieved capacity (67.9 to 84.1/s at 89 to 119/s offered); all 27 flooders retired `rate-capacity`; no healthy peer closed; the non-reader was retired `send-refused` by the replication host's buffered cap in 2 of 3 runs (host buffered at most 127,213 of 131,072 bytes) and stayed bounded in the third; jitter cut the peak accepted reconnects per 100 ms bin from 6 to 8 to 2. Finding (then): a queue age shorter than the real queued wait collapsed goodput (300 ms: final/peak 0.09 to 0.31). It is resolved by the NW-06 follow-up (PR #33), and the probe now asserts queue-age plateaus. Loopback/process scope only: no WAN, browser, multi-machine or physical-device claim. [Guide](network-overload.md), [evidence](../verification/network-overload-20261002/README.md). |
| SEC-01 | Command integrity (anti-cheat) at the authoritative host | Slice A integrated in v0.2.0 (PR #20; batch PR #47). Optional `createIntegrity` in the network kit ([guide](integrity.md), [recipe](../recipes/add-command-integrity.md)): pure `assess` validity usable inside the authority reducer (invalid sequenced commands consumed as domain rejections, so no `gap` and prediction reconciles), separate `admit`/`record` policy (decaying per-key scores, tick-rate budget on rate admission, throttle, windowed close with terminal `integrity-violation`, per-rule ceilings, owner/rule observe mode), key table that never refuses new keys, bounded local audit with export, tick-addressed generic helpers and an `assertDisclosure` test helper. Network workbench opt-in example (`--integrity`). Focused unit tests (including an in-memory authority/prediction composition) and loopback host tests only; no browser composition, load, WAN, physical-device, detection-quality or real-world cheat-resistance claim. Slice B (verified runs via the SIM-01 replay kit) is designed in the guide and not built; its SIM-01 dependency (PR #17) is merged. |
| SIM-02 | Creator-chosen replay digest and divergence detail (backlog W1-1) | **Integrated 2026-10-02** (PR #58 merge `4943174`, batch PR #62, `main` `6485572`). Before integration: implemented, candidate (PR #58). See the SIM-01 section below and the [replay guide](replay-divergence.md#choose-what-a-replay-must-reproduce-sim-02). Focused tests and the arcade browser replay passed on the branch; no physical-device, cross-browser or multiplayer claim. |
| MP-01 | Newcomer shared session: game-facing `@kits/network` session helpers, `npm run host`, `shared-world` template | **Integrated 2026-10-03** (PR #61 merge `41d0261`, batch PR #64, `main` `3b449fa`). Before integration: implemented, candidate (PR #61). `defineSessionRules`, `createSession` and transport-neutral `createSessionHost` compose existing owners (intake, NW-02 views, prediction, NW-04 retry, close policy, NW-05 rate admission, SEC-01 integrity in observe mode). Unit, loopback socket and one desktop headless Chromium two-context check; template gate passed. Evidence and limits are in the MP-01 section below. LAN/loopback only: no accounts, matchmaking, NAT traversal, WAN, TLS, physical-device or scalability claim. |
| AU-01 | Audio-clock timeline: audio↔frame time mapping with drift correction, bounded lookahead scheduling, input timestamps in audio time, stored latency calibration | Integrated in v0.2.0 (PR #31; batch PR #47). Optional `createAudioTimeline` ([guide](audio-timeline.md), [recipe](../recipes/sync-gameplay-to-music.md)) reads the one audio output through new `AudioOutput.clock()`; adds `CueVoiceOptions.at`, `ctx.audioClock()`, `ctx.time.now`, `ctx.input.pressedAt()` and audio unlock on scene action presses. Focused unit tests with a simulated drifting, quantised device; author-API scene tests with an injected clock and on the silent fallback. No real-browser output timing, Bluetooth, physical-device or audible verification (test browsers are muted). Streamed music remains off the context clock. |
| AU-02 | Music on the audio clock: decoded songs started, sought, looped and stopped at exact context times | **Integrated 2026-10-03** (PR #54 merge `0aa5caf`, batch PR #64, `main` `3b449fa`). Before integration: implemented, candidate (PR #54). `ctx.playMusic` / `AudioOutput.playMusic` ([guide](music-on-clock.md), [recipe](../recipes/sync-gameplay-to-music.md#1b-play-the-song-on-the-same-clock)) on a music bus that follows the music volume and mute, with its own sound-file store under `musicBudgets(minimum device)` (file budget = decoded budget ÷ 24, timeout scaled to the file budget); late decodes skip ahead (or drop) to keep sync; hand-offs re-time on repeated seeks and respect a scheduled stop; scene-owned voices. Focused fake-context tests, including a chart on the AU-01 timeline equal to song seconds. No real-browser timing, device decode-cost, memory-pressure or audible verification. The `music(url)` element path is unchanged. |
| TR-01 | Regional terrain worker and ordinary-surface integration | Integrated in PR #109 at 99e6255. Canonical regional Surface and halo patches, bounded WorkerHost generation/patch adapters, independent geometric oracles and finite coherent render/query consumer passed at 891eb7; all seven template gates passed (1,648 tests, 129 performance checks, zero breaches/regressions, four advisory heap warnings). Combined main tests/build passed. Physical-device performance and unbounded/global streaming are not established. |
| GEN-01 | Deterministic seed derivation and bounded seeded generation jobs | Integrated in v0.2.0 (PR #38; batch PR #45). Pure integer-only `deriveSeed` in `src/core/rng.ts` and the optional `procgen` kit: `createGridGenerationJob` on the existing WorkerHost, the example `job.kits.procgen.cellular` row, and a strict root-seed save section. Evidence and limits are in the GEN-01 section below. No chunk residency, edit deltas, meshing, physical-device or generation-quality claim. |
| FX-01 | Optional particle emitters (hit sparks, pickups, trails, smoke) | **Integrated 2026-10-03** (PR #63 merge `b7b5550`, batch PR #65, `main` `1f9d10d`). Before integration: implemented, candidate (PR #63). `Emitter`/`defineEmitter`/`burst` in the author API, opt-in per scene with `defineScene({ particles: sceneParticles({ max, emitters }) })` (games without it carry no particle simulation or drawing code; the drawing code is a lazy chunk); fixed-step simulation on its own seeded stream (never the gameplay `ctx.random`; regression-tested), drawn at the latest step like `Shape` meshes, one instanced draw per emitter with live particles (2 triangles per particle) and none while idle; pools allocated once; per-emitter, per-step and per-scene bounds with counted drops; refused bursts dropped (never fired late) and refused one-shots removed, refusals counted and reported once per cause per visit (bounded under sustained hits); textures leased from the shared library; `effects.particles` knob (registered, unwired) thins non-essential emitters deterministically. Reviews of `8cf76ae` (stream isolation, refusal growth, re-fire on rebuild, preload, draw state) and `0d3afb3` (any-number `testScene` seeds, idle-window browser flake, per-cause refusals, step-gated writes, late bind failures) addressed in follow-up commits. Evidence: focused unit tests (including the recipe's code and its sync check) and `npm run test:particle-browser` on reference and low, including an on-demand scene (desktop headless Chromium, software GL). No template consumer, physical-device, GPU timing, fill-rate or visual-quality acceptance; see the [guide](particles.md). Calm follow-up (FX-01b, PR #171): non-essential emitters add nothing and nothing drifts under Calm, essential ones show held still, stream and despawn unchanged; unit tests and `play:snap -- --calm` on explorer and showcase (desktop headless Chromium); no physical-device or person-judged Calm acceptance. |
| FX-01a | Flipbook (sprite-sheet) particles and `npm run fx:pack` | **Integrated 2026-10-03** (PR #141, merge `4c4f156`). Before integration: implemented and checked. `frames: { cols, rows, count?, fps?, mode }` on an emitter's texture: one draw per emitter, one compact per-particle `frame` attribute, UVs in the shader, 16×16 grid cap refused with a message, frame choice from the particles' own stream. Evidence: `particle-flipbook.test.ts`, `fx-pack.test.mjs`, the recipe's code, and `npm run test:particle-browser` (flipbook one draw, frames 0→3 on screen) on reference and low (desktop headless Chromium, software GL). Lazy chunk 3,401 → 3,850 bytes. No physical-device, GPU timing or visual-quality acceptance; cell-border bleed documented in the [guide](particles.md). |
| FX-01b | Effect lifecycle test pattern | **Documented and checked (PR #143); not yet integrated.** [Recipe](../recipes/test-effect-lifecycles.md) with five named tests (cancelled windup produces nothing, impact fires exactly once, stacking refreshes, owner despawn stops emission, pooled trails do not bridge), effects spawned on the animation kit's marker clips; small test helper `testScene(...).particles.sample(entity)` (live count, spawn attempts, bounds). Evidence: `src/kits/animation/effect-lifecycle-recipe.test.ts` runs the recipe's code headless, including a counter-example showing the trail check fails without a restart. No browser, device or visual-quality evidence; event counts prove wiring, not looks. |
| VIS-04 | Material options: shading (standard, matte, flat, toon), double side, alpha cut-out, vertex colours; `Material` on `Mesh` and `Model` | **Implemented and checked in PR #127** (not integrated until it merges). Defaults reproduce the previous materials: templates draw identically under the quality guard's `identical` mode against the base revision (views that change between captures cannot be compared and are listed in the PR). Bounded program set (three classes, two-valued options); toon bands are shared data textures (no shader hooks: batching eligibility and the ADR 0078 seam hold); model overrides are per entity, shared per (material, look) and never touch library resources. Evidence: unit tests, recipe test and `npm run test:material-options-browser` on reference and low (desktop headless Chromium, software GL). No physical-device, GPU timing or visual-quality acceptance; see the [guide](material-options.md). |
| VIS-06 | Instanced scatter of a `Shape` or `Mesh` (glTF `Model` scatter is a follow-up) | **Implemented and checked in PR #144** (not integrated until it merges). One instanced draw per scatter through the batching layer (`instanceStatic`); placement from a stream derived from the scene id, scatter seed and `?seed=`, never `ctx.random()` (a unit test compares a gameplay sequence with and without scatters); `effects.scatter-density` thins non-essential scatters to a nested deterministic subset; bounded per scatter and per scene with counted, reported refusals; static instance buffers rebuilt only on data change; disposal on exit; the drawing is a lazy chunk. Evidence: unit tests, recipe test and `npm run test:scatter-browser` on reference and low (draw and triangle counts matched against the renderer, idle 0 frames, same layout on re-entry, disposal counted; desktop headless Chromium, software GL). The fix-budget skill and add-a-budget recipe now name `Scatter` as the instancing recovery. No template consumer, physical-device, GPU timing or fill-rate acceptance; see the [guide](scatter.md). |
| VIS-07 | Post-processing tiers for `post.mode` (`view.post`: bloom, vignette, grade) with `postDraws` counted apart | **Implemented, candidate** (PR `feat/post-processing`); not integrated. Unit tests (settings and exact tier mapping, the GLSL pipeline against a recording renderer, the scene seam and fallbacks, preparation and drawing through post, the budget metric) and `npm run test:post-browser` (courtyard fixture at reference, medium and low: 10, 1 and 0 post draws, equal scene draws, bloom at full only, a still scene draws no frame, release audit at the author-API baseline; desktop and phone-sized headless Chromium, software GL). `quality:guard` identical for blank and explorer. No reference-GPU cost, physical-device or visual-quality acceptance. |
| POST-02 | Post grade lookup tables (`view.post.grade.lut`, `.cube`) and an HDR ceiling before bloom (`view.post.ceiling`) | **Integrated** (PR #179 via combined integration PR #253). Unit tests (the `.cube` reader and writer, settings bounds, pipeline variants and 3D texture lifetime, the seam's fetch, page cache, cancellation and failure) and `npm run test:post-browser` (`grade-post` at full and basic: a generated 33³ table loads, adds no post draw and changes the picture; a ceiling dims the glow beside an over-range box at full; software GL). The ceiling's NaN and infinity paths are unit-level only; the table texture is not in the probe's `textureMiB`. No reference-GPU cost, physical-device or visual-quality acceptance. |
| VIS-09 | Opt-in full three.js: `@kits/three` (imports in an opted-in game only, `useThree(ctx)` handle, render override, `customObject`) | **Implemented, candidate** (PR `feat/kit-three`); not integrated. Unit tests (handle lifecycle, disposal registry and leak report, custom-object caps and limits, lint allowance for opted-in games only) and `npm run test:three-kit-browser` (courtyard fixture: point lights, shadows, UnrealBloom via EffectComposer; frames drawn, draws and triangles counted within the fixture rows, still scene draws nothing, release audit leaves no texture or geometry; desktop and phone-sized headless Chromium, software GL). Unstable across three.js upgrades by contract; WebGPU material refusal and an unreported-change warning are follow-ups. No template consumer, physical-device, GPU timing or visual-quality acceptance. |
| VIS-10 | Blob (contact) shadows: `sceneBlobShadows({ max, ground, crossfade, distance })` per scene and `BlobShadow({ width, depth, opacity, ground, visible })` per entity; soft ground ellipses where an entity has no real sun shadow (beyond the sun box with a crossfade, no `sceneShadows()`, player `shadows.quality: off`, `Model` or non-caster), all in one instanced draw | **Integrated** (PR #184 via combined integration PR #253). Owner: the scene visit (lazy chunk `author/scene-blob-shadows.ts`; pure policy `author/blob-shadow.ts`; GPU layer `platform/render/blob-shadows.ts`). Bounds: `max` 64 by default, cap 1024, allocated once; overload keeps the nearest to the camera, counts `dropped`, reports once at info level. Same policy and cost on every preset (`shadows.quality` floor is `low`): +1 draw, +2 triangles per blob, 0 shadow passes, no texture. Evidence: unit tests (`blob-shadow.test.ts`, `platform/render/blob-shadows.test.ts`: validation, policy, preset gating, capacity and overload, change-only uploads, disposal, one draw that never casts) and `npm run check`. Browser acceptance `npm run test:blob-shadows-browser` passed 2026-10-05 in local software GL on the reference and low presets (7 candidates, 4 drawn in 1 draw, +8 triangles, 1 dropped; shadows off 4 drawn, 3 dropped; idle 0 frames; a move uploads once; disposed on exit). No template consumer (template budgets unchanged), physical-device, GPU timing, fill-rate or visual-quality acceptance; see the [guide](blob-shadows.md). |
| GEN-02 | Bounded IndexedDB store for large edited worlds and sparse cell edits | **Integrated 2026-10-03** (PR #56, merged to `main` at `2fb6e69`). Before integration: implemented, candidate (`feat/gen02-chunk-store`). `src/core/save/chunk-port.ts` (sole IndexedDB user, lint rule `indexed-db`) and `chunk-store.ts`: atomic multi-record writes, in-transaction revision checks, creator schema, CRC-32 quarantine before overwrite, bounded keys/bytes/records/batch/pending/quarantine, opt-in LRU eviction, session fallback. `createCellEdits` in the procgen kit. Evidence and limits are in the GEN-02 section below. No physical-device, private-mode, quota-exhaustion or multi-browser claim. |
| DV-01 | Supported-device experience and sustained performance evidence | In progress. The stock matrix, lesson visit cleanup and compact layout repair are integrated in v0.2.0 (PR #9, merged to main at `97288f8`); DV-01 itself remains open. [Stock matrix](../kits/stock-device-acceptance-matrix.md) covers all seven declarations. The [first receipt](../verification/stock-device-20261001/README.md) records 16 passing emulated target/tap checks and a compact lesson content overlap; lesson visit cleanup and a measured learn layout seam repair it, with a fake-DOM regression and emulated separation checks across board, sim and quiz at four profiles ([layout receipt](../verification/stock-device-20261002/README.md)). Full consumer workflows, in-panel touch scrolling, 200% text, named minimum devices and sustained physical evidence remain open; minimum phone, tablet and laptop/desktop profiles are pending creator selection. No physical-device or accessibility certification. |
| SC-01 | Bounded spatial index for neighbour, range and interest queries at scale | Integrated in v0.2.0 (PR #23, merged to main at `2c87e3b`). Optional `spatial` kit `createSpatialGrid`: preallocated uniform grid, admission before write, `too-wide` refusal before scanning, explicitly `truncated` results, terminal disposal. Checked: 12 focused unit tests (seeded brute-force oracle, refusals without mutation, narrow-buffer rejection, ECS interest consumer handling despawn and out-of-bounds and failing closed) and a work-count test of the 1,000/10,000-entry micro-benchmark. Headless Node medians recorded in the [guide](spatial-index.md#measured-cost). No template consumer, browser, worker or physical-device evidence; no budget change. |
| SC-02 | Per-observer interest sets feeding scoped views | **Integrated 2026-10-02** (PR #51 merge `f0f020e`, batch PR #62, `main` `6485572`). Before integration: implemented, candidate (PR #51). Optional `spatial` kit `createInterestSets` over the SC-01 grid: ranked (tier, distance, id), budgeted, enter/exit hysteresis with hold, entered/left events, fail-closed partial scans; reference host composes NW-02 view publishers so that, while scans are complete, no frame or revision reveals activity outside a connection's set (an `incomplete` scan can; size `maxCandidates` above the densest exit circle). Checked: 9 unit tests (incl. a 3,000-step reference-model comparison), 6 reference-host tests with real view receivers, a 1,000/10,000-entity bench work-count test. No socket, browser, device or template evidence; no budget change. |
| DEP-01 | three.js 0.183 → 0.186 deliberate migration (Dependabot keeps ignoring three minors) | Integrated in v0.2.0 (PR #29; batch PR #45). Private-state adapters re-verified against r186 source and pinned: batch state (`readBatchState`, contract test), the static shadow GPU cache (exported revision predicate; other revisions render the stock full path). Trackers force on camera-fitted `SunLight` cascades and observe `LightProbeGridWebGL`; `Texture.normalized` is classified as upload state. Engine ancestor-dependent world-matrix reads keep r183 results under r185's `updateWorldMatrix` change (regression test with a moved container). Exact head `bde17ad`: `npm run gate:ci` passed all 21 steps (19 browser suites, all seven template gates with 2,130 tests and 129 performance checks, zero enforced breaches/regressions/inconclusive, the four known advisory software-GL heap warnings; phone smoke for every template). Quality guard against the 0.183 build: 5 still views pixel-identical; the 3 animated start views compared under a held clock were identical (arcade, explorer) or within the scene's own run-to-run variance (mechanics). JS grows ~27 KiB raw / ~6 KiB gzip per template, inside every first-load budget. Software-GL frame times were measured under heavy host load and are inconclusive, not device evidence; no physical-device or GPU timing claim. |
| RNG-01 | Saveable seeded random state for rollback, reload and replay (genre study 2026-10-02, slice 3) | **Integrated 2026-10-02** (PR #52 merge `2d5f50e`, batch PR #62, `main` `6485572`). Before integration: implemented, candidate (PR #52, `feat/rng-state-input-history`). `createSaveableRng(seed)` in `core/rng.ts`, exported from `@engine`: draws exactly equal `createRng`, `state()` returns the whole generator as one unsigned 32-bit word, and `restore(word)` refuses anything else without changing state. 3 focused tests and a rollback sync-test consumer with an unsaved-word negative control. `ctx.random()` itself is unchanged and still cannot be rolled back. |
| INPUT-01 | Frame-exact input history: per-tick edges, buffers, release edges, opposite cleaning and sequences (genre study 2026-10-02, slice 4) | **Integrated 2026-10-02** (PR #52 merge `2d5f50e`, batch PR #62, `main` `6485572`). Before integration: implemented, candidate (PR #52). Optional `@kits/input-history`: up to 32 actions in typed-array rings (capacity 1–3600), contiguous `record` with `stale`/`gap`/`invalid` refusals, taps, five opposite policies, `lastEdge` buffers with consumption, bounded `match` (1–16 steps, steps × within work), and a validated snapshot. 17 tests, including an exhaustive-oracle comparison, tamper refusal, rollback sync-test integration and a `testScene` consumer. No per-game window values, physical controller or feel claim. |

## v0.2.0 integration (2026-10-03)

Release 0.2.0 integrates the public PRs below. PRs #9–#18, #22 and #23 merged to
`main` individually. The rest arrive through four stacked batch PRs, merged in order:
#42 (#19 #21 #24 #25 #26 #32 #33 #41), #45 (#28 #29 #30 #38 #39 #40), #46 (#27 #34
#35 #36 #37 #43) and #47 (#20 #31 #44). The release-preparation PR merges after #47.
"Integrated in v0.2.0" in these records means source delivery through that sequence;
it transfers no acceptance beyond each row's stated scope.

Evidence scope: each PR's own checks are recorded on the PR (GitHub CI `check` on its
head, plus local `check`, `lint`, `npm test` and, where the machine allowed,
`gate:ci`). Local browser gates were suspended for part of 2026-10-02 because host
load made unmodified `main` fail them; GitHub CI on the PR and batch heads is the
authoritative gate for those PRs. The release-preparation commit itself was checked
with `npm run check`, `npm run lint`, `npm test` and a blank-template build only.

| ID or change | PR | Evidence boundary |
|---|---|---|
| STD-SIM-12 press retention | #19 (batch #42) | Focused runtime/runner tests; physical high-refresh displays unverified. See [framework upgrade status](framework-upgrade-status.md). |
| DX P1-8 sub-path asset base | #35 (batch #46) | Unit tests and `test:subpath-browser` with a local static server in desktop headless Chromium; real Pages/itch.io uploads unverified. |
| DX P1-10 authored materials | #36 (batch #46) | Unit tests and `test:material-browser` (software GL); no visual-quality or physical-device acceptance. |
| DX P1-10 game sound files | #37 (batch #46) | Unit tests with an injected AudioContext and `test:sound-browser` (loading, reporting, silence); audible playback, latency and loudness unverified. |
| Onboarding, generators, template polish | #30, #39, #40 (batch #45) | Unit/lint regressions and emulated snaps; native Windows not run on Windows hardware. |
| Toolchain: TypeScript 6, Vite 8 | #43 (batch #46), #44 (batch #47) | Check, tests and builds; bundle sizes recorded on the PRs. |
| Build-day docs, load-sensitive test waits | #32, #41 (batch #42) | Docs only; condition waits without changing assertions or tolerances. |

Still open after 0.2.0: DV-01 physical-device acceptance and minimum device
profiles; multiplayer beyond loopback/LAN; human listening and device cost for
AUD-01, AU-01 and sound files; SEC-01 slice B; cross-browser floating-point
determinism for replay, rollback and turn logs. The arithmetic part has a candidate,
[W1-2](#deterministic-scalar-maths-w1-2--integrated), integrated since 2026-10-03 through batch
PR #64. Consumers and other browsers
remain open.

## Post-0.2.0 integration (2026-10-02 to 2026-10-03)

These public PRs reached `main` after the v0.2.0 tag (`071e3c2`) and are in no
release. Each component PR passed the required `check` on its own head. Batch PRs
were merged `--no-ff`; their PR descriptions record conflict resolutions and local
`check`, `lint` and `npm test` results. The batches did not run local `gate:ci` or
browser suites; GitHub CI on the batch heads and on `main` is the gate.

| Batch | Component PRs (PR merge) | Reached `main` | Main CI on that merge |
|---|---|---|---|
| #62 (batch 5) | #50 TB-02 (`d622111`), #51 SC-02 (`f0f020e`), #52 RNG-01/INPUT-01 (`2d5f50e`), #57 touch hold and `testScene` voices (`e58010a`), #58 SIM-02 (`4943174`) | `6485572`, 2026-10-02 | Run 37069963774 passed |
| #64 (batch 6) | #53 MV-02 (`b6dd99d`), #54 AU-02 (`0aa5caf`), #60 W1-2 (`ca972b3`), #61 MP-01 (`41d0261`) | `3b449fa`, 2026-10-03 | Run 37082507567 passed |
| #65 (batch 7) | #59 W1-4/W1-5/W1-6 (`4931e24`), #63 FX-01 (`b7b5550`), #55 AUD-02 (`87c1a20`) | `1f9d10d`, 2026-10-03 | Run 37086722080 **failed**: the arcade active bench window drew no frame (perf inconclusive). PR #75 later fixed that ended-visit bench defect. |
| (direct) | #56 GEN-02 | `2fb6e69`, 2026-10-03 | Run 37088378582 passed; it is the first green main CI containing batch 7 |

The per-row evidence boundaries in this ledger are unchanged by integration. No
row above gained template, browser, device or audible evidence by being merged.

## Creator-readiness milestone (2026-10-03)

Tracking: [issue #66](https://github.com/Akilleez-QA/foundation-engine/issues/66) and the
[creator-readiness goal](creator-readiness-goal.md). Evidence classes stay separate:

- **CI** means hosted GitHub Actions on an exact head.
- **Focused** means named local runs at a recorded source revision.
- **Simulated** means agent-operated trials.
- **Human and physical-device** evidence does not exist for this milestone.

Every PR below is **integrated** (merged to public `main`, required `check` passed on
its head). "Implemented" and "checked" are not inferred from integration: each
receipt states the revision its checks ran on, which is often a branch head before
the merge.

### Receipts

| Receipt | PR (merge) | Checked scope | Not established |
|---|---|---|---|
| [creator-onboarding-20261003.md](../verification/creator-onboarding-20261003.md) | #68 (`5a68f06`) | Simulated: one agent rehearsal at engine candidate `1be7ba7` (new game, edit, `check`, tests, build, sub-path preview), plus a committed sub-path probe rerun on public `2fb6e69`. | No stopwatch, no human newcomer, warm caches. |
| [session-host-cli-20261003.md](../verification/session-host-cli-20261003.md) | #70 (`1d5c6c7`) | Focused: 6/6 `scripts/host.test.mjs` on Node 22.23.3, two real subprocess cases that fail on the old CLI. CI: main run 37144692200 passed on `1d5c6c7`. | No LAN between machines. |
| [creator-journey-20261003.md](../verification/creator-journey-20261003.md) | #72 (`35011a3`) | Focused: `test:creator-journey-browser` at clean `c0a7776` (base `2fb6e69`), Chromium 152, software GL. The command runs in CI. | Blur and focus are synthetic events; no physical device. |
| [creator-journey-recovery-20261003.md](../verification/creator-journey-recovery-20261003.md) | #98 (`8e8cbbb`), card B3 | Focused: two passing runs at clean `854d26a` (base `40b9c70`): refused save then retry and reload, interrupted scene changes, and application disposal through the dev-only `engine.dispose()` in `src/dev/test-api.ts`. CI: main run 37152653292 passed on `52e3d7e`, which contains it. | Storage refusal is emulated, not real quota exhaustion; no physical device. |
| [first-use-20261003/](../verification/first-use-20261003/README.md) | #73 (`c915599`), then #104 (`8dd899a`), card B4 | Focused, advisory: development-server samples (#73); a production build served under `/first-use/` plus a warm second visit (#104), recorded at branch head `06fedec` on a heavily shared machine. No thresholds or budgets. | Fetch, decode, upload, compile and present stages are null; no CDN or real hosting; no physical device or thermal evidence. |
| [active-restart-20261003/](../verification/active-restart-20261003/README.md) | #75 (`2ca1ea0`) | Focused: bench restarts an ended visit before active samples; reproduces hosted run 37141691681. | Pointer-only scenes. |
| [blender-export-20261003.md](../verification/blender-export-20261003.md) | #74 (`40b9c70`) | Focused: two repeatable Blender 5.2.1 exports, validator tests, last local browser pass at source `4ff2058`. CI: main run 37149365823 passed on `40b9c70`, including `test:blender-export-browser`. | Other Blender versions, textured or animated art, physical devices. |
| [asset-contracts-20261003.md](../verification/asset-contracts-20261003.md) | #126 | Focused: per-model contracts checked by `npm run asset:verify` and `npm run check`; 69 mutation tests, the sample's 15 unchanged tests, and a byte-identical Blender 5.2.1 re-export of the sample. | Texture dimensions and colour space, animation contents, licence truth, untrusted-file safety, other Blender versions. |
| [ktx2-model-textures-20261003.md](../verification/ktx2-model-textures-20261003.md) | #146 | Focused: 9 KTX2 library tests, 2 fixture tests (real Basis transcoder in Node), 79 asset-verify tests, and `test:ktx2-browser` (dev, RGBA8 fallback, two sub-path builds, three cancel-after-transcode cycles, disposal) in SwiftShader Chromium 152. | Phone GPUs and ASTC/ETC2 uploads, driver memory, transcode time, ETC1S or supercompressed input. |
| [pose-to-pose-20261003.md](../verification/pose-to-pose-20261003.md) | pending | Focused: the `tools/pose-to-pose` Blender 5.2.1 pipeline (rig, rig test poses, capture, generator, verify-after-export, contact sheets, review gate) on its original robot example; offline clip validator and its tests; the `skin` model-contract key with 7 mutation tests; byte-identical repeat export. | Any person posing or approving (the example's poses are agent-authored, its review gate off); engine or browser playback; other Blender versions; motion quality. |
| [save-recovery-20261003.md](../verification/save-recovery-20261003.md) | #76 (`1a32601`) | Focused: `test:weighted-appearance-browser` at clean `6a22639` (base `2fb6e69`): visible refusal, durable retry, reload. | Injected refusal, not real quota or power loss. |
| [model-retirement-20261003.md](../verification/model-retirement-20261003.md) | #78 (`b5fbe8d`) | Focused: three transport cancellations and reentry cycles at clean `c750dd0` (base `5a68f06`), plus disposal with a pending request. | Heap and listener audit (counters only). |
| [decode-cancellation-20261003.md](../verification/decode-cancellation-20261003.md) | #116 (`6dc111a`), card B5 | Focused: three browser cycles cancelling after a fully delivered response and a decoded image, with ownership back at baseline. Main CI run 37157174423 on `6dc111a` **failed** this check (request ended `failed`, not `finished`); PR #119 (`6da7951`) then asserted delivery from the fixture server and the page instead of the racing network event. | Counters only, no whole-heap or listener audit; no physical device. |
| [contributor-rehearsal-20261003.md](../verification/contributor-rehearsal-20261003.md) | #80 (`7f4dee4`) | Simulated: public clone at `5a68f06`, local bare repository as the fork, test-only change, `check`, tests and `lint`. | Ran before #67 and #80 changed the instructions; no real GitHub fork or fork-PR CI. |
| [dpr-redraw-20261003.md](../verification/dpr-redraw-20261003.md) | #83 (`5b12552`) | Focused: eight resize and cleanup tests and a browser run at clean `422975c`. CI: main run 37148687488 passed on `5b12552`. | Physical high-DPR displays. |
| [session-recovery-20261003.md](../verification/session-recovery-20261003.md) | #97 (`e1bdc31`), card B2 | Focused and CI: `test:session-browser` asserts a fresh world after host restart before any action, a client-only drop that resumes the same player, and bounded attempts on both pages. Main run 37151563604 passed on `e1bdc31`. D3 follow-up: the client-drop deadline is now derived from the host idle timeout, and the host's `idle-timeout` close is asserted. Before the fix it was the plain 15 s poll window, which raced that timeout in 3 of 142 CI runs. With the fix, 15/15 runs passed under load. | Loopback only: no LAN between machines, no WAN. |
| [brand-20261003.md](../verification/brand-20261003.md) | #93 (`15f9c20`) | Documentation art only; GitHub markdown API render shown in a local approximation. | github.com rendering, screen readers. |

### Evidence without a separate receipt

| Change | PR (merge) | Evidence boundary |
|---|---|---|
| Acknowledge only the submitted world-edit revision (card B1) | #95 (`0a09710`) | Recipe fix and the regression `GEN-02 acknowledging a pending save retains edits made after submission`. Main CI run 37150583760 passed. |
| Retained v0.2.0 consumer and released save envelopes, upgrade notes (card B6) | #96 (`144a43e`) | Arcade source from tag `v0.2.0` compiled and tested against current `@engine`; envelopes written by the v0.2.0 store; corrupted and future-version negatives. Node with in-memory storage only; one template. See [public compatibility](public-compatibility.md). |
| Versioned save migration and recovery fixtures | #79 (`9909898`) | Synthetic example envelopes, not past-release data. |
| Public source consumer compatibility (`c0e73c9`) | #81 (`41eb97c`) | Hash-manifest consumer compiled against current source. |
| Orphan import receipts | #77 (`24d7512`) | See the orphan import section below. |
| Committed-change check selection, `--base`, `--all` | #67 (`b4f8579`) | Unit tests; not rehearsed from public docs yet. |
| Sharded template gates with a strict aggregate `check` | #82 (`d028d2a`) | CI configuration; the aggregate rejects missing, failed, skipped or cancelled jobs. |
| Game-code lint for `Math.random()` and literal UI text | #90 (`f922a78`) | Lint tests; can fail an existing game's `check` (upgrade note in #96). |
| Enter before systems on scene re-entry | #92 (`b55d0f3`) | Unit regression. |
| `createTestSaves` and the `reload` playtest step | #94 (`d4d92ac`) | Unit and playtest-script tests. |
| Documentation and contributor entry points | #69, #71, #88, #89, #91, #109 | Documentation only. |
| Strict types: remove `any` | #99 (`52e3d7e`) | Typecheck and tests. Main CI run 37152653292 passed. |
| `noUncheckedIndexedAccess` slices 1 to 4 | #103 (`7238410`), #105 (`00e4a31`), #106 (`2a48e35`), #107 (`2cec0d0`) | Typecheck and tests per slice. Slice 5 (scripts, templates, enabling `noUncheckedIndexedAccess`, `noImplicitOverride` and `noImplicitReturns`) was open when this section was drafted; it was integrated afterwards in PR #114 (`6af76a4`). |
| Prettier formatting | #101 (`305dc6a`) | `format:check` in `npm run lint`; Markdown is excluded. Main CI run 37155979128 passed on `305dc6a`. |
| Runtime bundle: GLSL without comments, test-only classes out of the scene runtime | #100 (`f1c2057`), #102 (`0b2af56`) | `perf:bundle`. Main CI run 37155164464 passed on `0b2af56`. |
| Port-busy hint, npm 12 `allowScripts`, no file watcher for non-interactive servers | #110 (`99edd16`), #111 (`758f8d6`), #112 (`5c1ba4a`) | Unit tests and CI. |
| ADR 0078 render backend decision | #113 (`7fbd77a`) | Decision and lint only; no WebGPU backend exists. |
| Arcade bench heap warning (Playwright selector engine) | #115 (`c470644`) | Bench tooling only. |

Main CI on 2026-10-03: runs on intermediate merges were often cancelled by the next
push, so those merges have no full-CI result of their own. Completed green main runs:
`1d5c6c7` (37144692200), `5b12552` (37148687488), `40b9c70` (37149365823), `0a09710`
(37150583760), `e1bdc31` (37151563604), `52e3d7e` (37152653292), `0b2af56`
(37155164464) and `305dc6a` (37155979128). Main CI on `6dc111a` (run 37157174423,
containing #112, #113, #115 and #116) **failed**: both template jobs passed, but the
browser job's `test:model-preview-browser` failed the new decode-cancellation
assertion "decoded model response delivered in full" (the request ended `failed`, not
`finished`), so the aggregate `check` failed. PR #119 (`6da7951`) found the cause:
under load, Chromium can report a fully consumed body as `requestfailed`
(`net::ERR_ABORTED`) before any cancellation. It now asserts delivery from the fixture
server and a page-side read instead. Afterwards PR #114 (`6af76a4`) integrated slice 5
of the strict-type series. The B5 browser evidence counts as passing on `main` only
once a main CI run that includes #119 passes.

### Scorecard status (2026-10-03, after the audit)

| # | Row | Status | Evidence | Still open |
|---|---|---|---|---|
| 1 | Discovery | Met | README routes, prerequisites and limits; game-agent path (#89); recipe index completed for #87. | No hosted demo (deliberate). Issues #84 to #86. |
| 2 | First success | Partial | One simulated persona trial with a first-playable time; onboarding receipt (#68); stale claims fixed (#109). | Two timed trials on a named candidate with CPU, RAM and network recorded (card C1). Human newcomer trial (author). |
| 3 | First edit and share | Met, at earlier revisions | Persona trial and onboarding receipt. | Re-confirm on the named candidate (card C1). |
| 4 | Reliable session | Evidence added | Composed explorer journey with refusal, retry, interruption and disposal (#98); data-loss recipe fix (#95); re-entry ordering (#92). | Real storage quota and OS tab suspension on devices. |
| 5 | Optional network path | Evidence added, loopback scope | Fresh baseline after restart and client-only drop (#97); host CLI fix (#70). | LAN with two physical machines (author or devices). |
| 6 | Assets | Met | #74, receipt, and main CI run 37149365823 passed on `40b9c70`. | Other Blender versions, textured or animated art. |
| 7 | Performance | Evidence added, advisory | Production and warm first use (#104); decode cancellation (#116; main CI run 37157174423 failed it, and #119 fixed the racing assertion); bench lifecycle (#75); budgets enforced by CI gates. Retention is declared as counters only. | Physical-device, thermal and sustained performance. |
| 8 | Compatibility | Evidence added | Retained v0.2.0 consumer and released saves, upgrade notes (#96); synthetic migrations (#79); `c0e73c9` consumer (#81). | A complete changelog for the candidate (card E2). |
| 9 | Contribution | Partial | Contributor rehearsal (#80) and entry points (#88). | Re-rehearse the current `check -- --base` and `--all` path (card C2). Real GitHub fork, fork PR and fork CI need a second account (author). |
| 10 | Release | Not met | Ledgers reconciled (this section). | Named candidate with full green CI, support matrix for eight templates, archive build rehearsal, release notes (card E2). Version, tag and release (author). |

"Evidence added" means the audit's listed gap has a merged check and receipt; the
row is not called met until the evidence is repeated on a named release candidate.

## Deterministic scalar maths (W1-2) — integrated

**Current status (2026-10-03): integrated.** PR #60 (PR merge `ca972b3`) reached `main` through merge-train batch PR #64, merged to `main` at `3b449fa` on 2026-10-03 (main CI run 37082507567 passed on that merge). Not in any release: v0.2.0 (`071e3c2`) predates it. "Integrated" is source delivery; the evidence scope below is unchanged and the candidate-era status is kept as history.

| ID | Contract | State |
|---|---|---|
| W1-2 | Optional `dmath` from `@engine` (`src/core/dmath.ts`): `sin`, `cos`, `atan`, `atan2`, `exp`, `log`, `pow`, `sqrt`, `hypot`, built only from correctly rounded operations, so the bits are the same in every engine. `platformMath`/`scalarMath` select it. The character, locomotion and root-motion kits take `math: 'deterministic'` (default `'platform'`, unchanged). Golden vectors are committed as hex (`src/core/dmath.golden.json`). [Guide](deterministic-math.md) | **Integrated 2026-10-03** (PR #60 merge `ca972b3`, batch PR #64, `main` `3b449fa`). Before integration: implemented, candidate (PR #60). Checked: focused tests (golden bits, correctly rounded `Math.sqrt` and `hypot` proved in integers, special values, at most 1 ulp to V8 `Math` over 16 ranges, kit options within 10⁻⁹ of `Math` and repeating exactly) and `npm run test:dmath-browser`: 1,075 vectors (including huge `sin`/`cos` arguments up to about 10³⁰⁸) and a 3,000-tick character-kit workload bit-identical in Chromium 152 and Node 22, where `Math` differed. Cost is about 1–2.5× `Math` per call (`pow` up to 4× in Chromium). Not established: Firefox/WebKit, physical devices, a browser-recorded character-scene replay in Node (camera-relative yaw and default pointer picking stay on `Math`), and the RB-01/SEC-01 slice B consumers. |

## Goal continuity

The native goal owns the continuing objective. This ledger owns acceptance scope;
commit/PR evidence owns implementation history. Neither a passing schema, an
available kit, nor a completed PR decides an independent creator's game design.
Keep delivered, checked, integrated and observed states distinct when updating rows.

## Startup routing correction

Integrated in PR #119 at `a3d1516`: stock routing now honors creator-declared
`firstScene` for empty and unknown addresses while preserving deep links, redirects
and omitted-option low-level behavior. Forced startup routes were removed from
action and crafting diagnostics. Candidate `7673d74` passed both native browser
workflows and all seven gates: 1,873 tests,129 performance checks,zero enforced
breaches/regressions/inconclusive,four advisory software-GL heap warnings. Combined
main tests/build passed. The earlier build-subprocess failure is retained in
[scene startup](scene-startup.md); its cause was not established.

## Networking admission — integrated

NW-01 now has an optional [pure connection intake](../../src/kits/network/README.md),
[explicit browser transport](network-transport.md) and
[ephemeral reference host](../../tools/network-workbench/README.md). Commits
`bd65713`, `540bece` and `63730cc` implement exact connection/authentication
lifetimes, current dispatch authorization, bounded fair intake and transport
cleanup. The host uses maintained `ws` framing and operator-issued diagnostic
credentials. These are local fixture credentials, not a production identity service.

The 44 combined focused checks comprise 16 pure intake, 13 injected-socket
adapter, 10 real TCP/WebSocket host and 5 exact reference response-schema tests.
Separately, candidate `4e51a04` passed the native two-browser/separate-host
diagnostic. Independent host counters matched accepted scene results; wrong
credentials and cross-principal commands were rejected, revocation cleared the
actor, scene reentry used a fresh connection, and final queues/connections were
empty. Canvas dimensions, render advancement and inspected screenshots establish
visible projections for this desktop diagnostic. There were no page/console errors.
PR #120 integrated this at `3a97ca6` after final `5f871b3` passed all seven
template gates (1,917 tests; 129 performance checks; zero enforced breaches,
regressions or inconclusive results; four advisory software-GL heap warnings).
Combined main tests/build passed. NW-02 load observations below are separate evidence. Prior PR #119 evidence is not transferred to these commits.

At the NW-01 checkpoint, NW-03 remained unresolved; its later integration is recorded below. NW-01 itself supplies no scoped replica/snapshot
owner, prediction, deduplication or server persistence. Reference command IDs only
correlate replies; repeating an ID can apply twice, and host restart resets its
counters. Send admission does not prove delivery or durability. DV-01 remains
unverified on actual supported hardware.

The NW-01 consumer review rejected unchecked response fields and ID-only result
matching. The reference now validates exact response schemas and original request
targets, and clears retained response facts on retirement. The 44 focused checks
pass together. Initial browser protocol/counter checks passed after excluding the
unrelated development-server socket from wire observations, but screenshot review
found a zero-height scene host. Full-height layout and explicit canvas/render
assertions were added. The subsequent `4e51a04` run passed those checks and its
screenshots were inspected. The initial runs remain insufficient for rendered-scene
acceptance. The corrected runner is configured in CI through
`npm run test:network-workbench-browser`; a configured check is not a remote CI result.

## Input resize retirement — integrated at `894fc52` (2026-10-01)

On base `3a97ca6d`, independent adapter tests reproduced retained touch action,
pinch and scene press after window resize. The candidate reuses each existing
ownership/cancellation seam, releases capture and requires a fresh gesture.
All 26 focused tests pass. Exact candidate `8b1aa34` passed all seven template
gates (1,922 tests per gate, 129 software checks, four advisory heap warnings),
plus inspected desktop/mobile smoke. Native held-resize and physical-device
acceptance are not established by these Node tests or blank-scene snapshots. No budget, device policy or
input bounds change. [Evidence and limits](../verification/input-resize-20261001/README.md).

## Complete scoped views — integrated on main

[Network views](network-views.md) describes optional session-bound complete views,
monotonic disclosure sequences independent of world revision, bounded capture,
replacement rather than field merge, and one outstanding application credit.
Implementation: `685a25f` pure ownership; `272a759` host; `0dbed00` operator IPC;
`0070b6e` lifecycle hooks and `eaaaf2f` actual retirement on callback saturation plus
native render-return notification; `534c11a` browser runner. The callback-saturation
finding was a real correctness defect: prior delivery could remain top while the
actual scene was opaque and paused. The repair retires the owner rather than
claiming all adversarial transitions can be delivered indefinitely.

Committed browser report `playtest/replication-workbench/report.json` records
clean `f98eb2c` with `workingTreeDirty: false`, passing with no page/console errors.
The earlier `eaaaf2f` dirty-tree exploratory report remains historical evidence.
Two isolated native contexts and a separate child host exercised recipient-specific
raw fields, host-derived independent ECS checks, same-revision disclosure removal,
incarnation replacement and stale decoration refusal, unavailable/partial-projection
recovery, and actual scrim/opaque layers clearing ECS and concealing canvas during
the click itself without another scene update. Reentry/resume used fresh sessions;
withheld application credit did not prevent privacy retirement. Inspected baseline
and covered screenshots establish this finite desktop workflow only.

The separately scheduled load probe passed all four declared cases: 2/8 peers ×
8/64 entities, 100 updates. Worst observed publisher-pump p95 was 0.321 ms;
all healthy service rounds and retained bounds passed. See the
[host README](../../tools/replication-workbench/README.md) for measurement scope.
The publisher timing includes capture and local send; it is not GPU time. A peer
withholding application credit is not a physical TCP non-reader.

The subsequent all-template gate attempt failed during Arcade: npm test reported
1,960/1,961 with a file-level failure for `entity-inspection.test.ts`, even though
its inner test passed. The standalone test and full source-suite TAP retry passed afterward (1,960 tests,
zero failures/cancellations); the extra initial failure count was the file wrapper,
not an additional passing inner test. The cause remains unconfirmed; no code or
test weakening was used for the retry.
The initial attempt completed 18 passing performance checks but failed overall.
The subsequent exact-head gate passed on `8121257`: all seven templates,
1,960 tests and 129 performance checks, with zero enforced breaches, regressions
or inconclusive results. Four software-GL heap advisories remain (two Mechanics,
two Terrain). NW-02 is now integrated on `main` by merge `ea48539` (work tracked in PR #122 in the private development history).
The rebased clean browser run passed at `508edd9`; final `47a7e6d` passed all seven
template gates with 1,965 tests and 129 performance checks, zero enforced breaches,
regressions or inconclusive results, and four advisory heap warnings. Combined
main tests (1,965) and build passed. Integration here is verified Git ancestry;
the GitHub PR API still reported OPEN immediately after push, so no PR-state
transition is asserted. Do not transfer NW-01's seven-template
results to this slice. At this NW-02 checkpoint, NW-03 persistence, replay-safe
commands and prediction remained unresolved; their later integration is recorded
below. DV-01 actual hardware remains unverified.

Rebase checkpoint: current input-resize integration `894fc52` is preserved. The
rebased candidate `508edd9` passed the native two-client/separate-host browser
workflow on a clean tree with no page or console errors. The rebased final
`47a7e6d` then passed all seven gates (1,965 tests, 129 performance checks, four
advisory heap warnings) before merge `ea48539`; combined main tests/build passed.
Earlier gate results remain tied to their original revisions. PR #122 in the private development history tracks the
integrated work; PR #121 was superseded without rewriting its published branch.

## Durable authority and prediction — integrated

The [authority guide](durable-authority.md), [prediction guide](prediction.md) and
[SQLite/host guide](../../tools/authority-workbench/README.md) document the actual
contracts. Creators select state, reducers, authorization, storage and transport.
No mandatory simulation, game protocol or database is installed.

| Component | Historical candidate revision | Evidence and boundary |
|---|---|---|
| Canonical bounded JSON capture | `e8323d6`, `3745f48` | 4 tests; canonical wire values, structure/byte limits, iterative deep serialization |
| Prediction owner | `6da2fcb` | 13 tests; coherent baselines, finite suffix replay, reentry and retirement |
| Serialized authority | `6422ab9`, `5dde0ea` | 19 tests; exact retry, settlement, authorization, immutable overlapping receipts and feasible retained chronology. Exhaustive tiny interleaving oracle checks metadata feasibility, not historical payload authenticity. |
| Optional SQLite adapter | `d159634`, `b6f4d34` | 12 tests; real process races/SIGKILL and independent SQL readback, corrupted records and async test-hook refusal |
| Durable diagnostic host | `7e5e7df` | 5 tests; actual sockets, persisted streams, requester loss/revocation, busy refusal and process death after commit before reply followed by exact retry |

The combined focused suite passes all 53 tests, zero skips/failures, on Node 26.8.1.
The optional storage tests also pass on Node 22.23.3 / SQLite 3.51.3; all 17
storage/host tests pass on the declared minimum Node 22.13.0 / SQLite 3.47.2.
TypeScript and repository lints pass. Documentation examples execute with the
stated results. These are named-scope checks, not unrestricted multiplayer or
physical power-loss certification.

The exploratory native browser run used two isolated desktop Chromium contexts
and a separate host. Independent SQL readback, DOM values and ECS marker positions
matched deliberate correction with one replayed input, duplicate/reordered
baselines, exact retry, restart after commit-before-reply loss, covered/retired
control and values beyond the initial marker scale. No page/console errors were
observed. The first run failed because its scene-exit predicate queried nonexistent
`scene.id`; the actual test API exposes `scene.scene`. Correcting that sensor produced
the passing run. This does not erase the failed run or imply a runtime defect.

Clean-revision native acceptance, including malformed first-baseline recovery,
passed at `8317c69` with seven observations and no page/console errors. See the
[saved report and inspected screenshots](../verification/authority-20261001/README.md).
NW-03 is integrated on private `main` by merge `b6fb4a3` (PR #123 in the private development history) and included in public `main` since `c0e73c9`. Exact head `883f4ad` passed all seven template gates: 2,018 tests, 129 performance checks, zero enforced breaches/regressions/inconclusive results and four advisory heap warnings. Combined main tests (2,018) and build passed.
The workflow is configured in CI; no remote CI result is claimed. DV-01 remains open, with minimum phone, tablet and laptop/desktop profiles pending creator selection. Process-crash tests do not establish power loss, arbitrary
filesystems, trustworthy old backups, WAN scale or supported physical devices.

## Program preparation (2026-10-01) — integrated in v0.2.0 (PR #10)

Program preparation: context-owned link validation, bounded submitted
program readiness and author recovery passed public checkpoint `2cdd442` across
all seven template gates and inspected desktop/mobile snapshots. Integrated in v0.2.0 (PR #10, merged to main at `4f666a2`). See [contract](program-preparation.md). No performance,
quality-budget or engine-wide residency completion claim is made.

The same change includes optional owned submitted-frame completion after
initial draw. Native correctness and exact-head template gates are recorded in the
[checkpoint receipt](../verification/program-preparation/README.md). Completion is not display presentation or a smoothness guarantee.

## Cooperative dependency preparation (2026-10-01) — integrated in v0.2.0 (PR #11)

M2 adds real task boundaries and reserves one acquisition slot for the required
closure while optional work uses remaining capacity. Explicit pumping remains
caller-owned. See the [contract](../../src/platform/assets/dependency-lease.md) and
[prospective oracle and CPU evidence](../verification/dependency-preparation-20261001/README.md).
Native task oracle, all seven template gates and the CI browser suites passed (see the
evidence README and public PR #11);
integrated in v0.2.0 (PR #11, merged to main at `ae8a61f`); frame-time and downstream acceptance remain pending; no resource budget changes.

## Reconnect/retry pacing (NW-04) — integrated in v0.2.0

Status: integrated in v0.2.0 (PR #14, merged to main at `82862d6`). See the [retry pacing guide](network-retry.md).

- Runtime-enforced: limit validation (positive safe integers, `baseMs <= capMs`, exact
  keys), monotonic time, at most `maxAttempts` per episode, budget of
  `capacity + floor(T / refillEveryMs)` retries in any window `T`, random-port
  validation and terminal disposal.
- Checked: 11 focused unit tests, including a seeded 1,000-client restart
  simulation; the network workbench native browser workflow covers paced recovery,
  bounded exhaustion, exit during an episode, and the Disconnect, untick,
  hidden-page and pagehide stop paths (the last two as synthetic in-page events). Exact-head gate results are in the PR.
- Not established: WAN loss, a measured reconnect storm against a real host,
  physical devices and suitability of the example limits for any game. The browser
  transport still never retries by itself.

### NW-04 follow-up: terminal close classification — integrated in v0.2.0

Status: integrated in v0.2.0 (PR #16, merged to main at `b93690d`), building on NW-04 (PR #14).

- Runtime-enforced: remote close code 1000–4999 or `null`; reason a token of at most
  64 characters or `null`, length-checked before matching; first close wins; local
  causes report `null`. Close policy lists are validated, bounded (32) and captured.
- Checked: transport and close-policy unit tests; the network workbench browser
  workflow shows a revoked credential stopping after exactly one transport under the
  default policy (Chromium received 1008 `auth-rejected`), and the previous bounded
  exhaustion when refusals are treated as transient.
- Not established: close-frame delivery over slow or lossy links (a lost frame is
  1006, classified transient), other hosts' reason vocabularies, physical devices.

## Replay log and divergence detector (SIM-01) — integrated in v0.2.0

| ID | Contract | State |
|---|---|---|
| SIM-01 | Optional `@kits/replay`: bounded tick-input log and player (explicit truncation; version, identity and corruption refusal), creator-digest traces with first-divergence comparison, and a prediction-versus-authority agreement check over the existing owners. Dev/test-only `engine.replay` uses the stock scene fixed lane and `?seed=`. [Contract](replay-divergence.md) | Integrated in v0.2.0 (PR #17, merged to main at `49047ae`). Focused tests and the arcade `?seed=` browser replay passed on the PR head. No cross-device or cross-browser floating-point determinism, physical-device or multiplayer claim. |
| SIM-02 | Creator-chosen replay digest and divergence detail (backlog W1-1; demo finding F1). Optional `defineScene({replay: {digest}})`, `@kits/replay` `replayDigest`/`selectWorldState` (selected components, excluded tags, chosen resources) and `explainDivergence`; dev/test-only `engine.replay.start({digest, detail})` and a bounded `divergence` report naming the first differing entity, component and field. Default digest and identities unchanged. [Contract](replay-divergence.md#choose-what-a-replay-must-reproduce-sim-02), [recipe](../recipes/replay-with-your-own-digest.md) | **Integrated 2026-10-02** (PR #58 merge `4943174`, batch PR #62, `main` `6485572`). Before integration: implemented, candidate (PR #58). Focused tests (including the demo's frame-phase orb case: default diverges and names the orb, a digest excluding the cosmetic tag replays exactly) and `npm run test:replay-browser` (arcade, desktop Chromium software GL) passed on the branch. No cross-browser floating-point, physical-device, production-build or multiplayer claim. |

## Sustained-session recorder — PERF-01 integrated in v0.2.0

| ID | Contract and required observation | State |
|---|---|---|
| PERF-01 | Optional, local-only [sustained-session recorder](session-performance.md) on the one frame loop. It records bounded rolling windows of frame/work p50/p95/p99, long and severe frames, rendered/idle counts, scene/epoch/preset segments and drift, plus a versioned evidence file. It has a zero-cost path when absent and is dev/test-only. | Integrated in v0.2.0 (PR #15, merged to main at `ae69a38`). Focused adversarial tests and an emulated browser run (a 30-second CI check plus a saved 10-minute sample) are recorded in the guide and in [verification](../verification/session-perf-20261002/README.md). This is supporting tooling for DV-01: it supplies the evidence format, not device evidence. DV-01 remains open. |

## Rollback sessions (RB-01) — integrated in v0.2.0

Status: integrated in v0.2.0 (PR #25; batch PR #42).
See the [kit README](../../src/kits/rollback/README.md) and the
[recipe](../recipes/add-rollback-sessions.md).

- Runtime-enforced: exact-key limit validation and ranges; UTF-8 byte bounds on
  every input and saved state; contiguous per-player remote frames; a remote lead of
  at most `maxPredictionFrames + 2 × inputDelay + 2`; no step past the prediction
  window; at most one `load` and `maxPredictionFrames + 1` steps per `advance`;
  bounded checksum history and pending reports; `busy` on reentry; immediate
  disposal, including from a callback or an aborted signal.
- Checked: 25 focused tests in `src/kits/rollback/`.
  - Seeded two- and three-peer runs over delayed in-memory links match a
    no-network replay (delay 0/2/3, windows 0/2/8, links slower than the window).
  - Injected divergence is reported at the first checksum frame.
  - The sync test compares every resimulated state with the **live** step's
    checksum. Review of PR #25 found the first candidate compared replay with
    replay, which missed every fault at distance 1 and missed one-shot live reads
    at every distance; this has been fixed. Its tests cover distances 1, 3 and 8:
    hidden state, unseeded randomness, an incomplete load, a one-shot live value,
    `-0` lost by JSON, and an outside mutation. The three new regressions fail
    without the fix.
  - A 20-tick late start leaves the early peer a full window ahead unless it paces
    on `frameAdvantage`.
  - A `testScene` consumer drives two sessions from the fixed lane.
  - A deliberately disabled rollback trigger fails 7 session tests.
  - Exact-head check, test, lint and `gate:ci` results are in the PR.
- Manual measurement, not a budget: a worst-case 8-frame rollback on every tick
  with a JSON codec took p95 0.19 ms for a state of about 2.5 KB (Node 22,
  desktop CPU, shared machine).
- Not established:
  - resend or redundancy over lossy links (a reliable, ordered transport is required);
  - WebRTC;
  - built-in time synchronization (only `frameAdvantage` is exposed; pacing is the host's job);
  - input during a stall: `local()` returns `full` and keeps nothing, so edges must be carried by the host;
  - disconnect policy;
  - spectators;
  - a saveable engine random generator (addressed afterwards by RNG-01, PR #52, integrated through batch PR #62);
  - an ECS-world snapshot adapter;
  - floating-point determinism across browsers;
  - physical devices;
  - real multiplayer acceptance.

## Deterministic turn log (turns kit, TB-01) — integrated in v0.2.0

Status: integrated in v0.2.0 (PR #24; batch PR #42). See the [kit README](../../src/kits/turns/README.md) and [recipe](../recipes/add-a-turn-log.md).

- Runtime-enforced: rules id, validator literal-`true` acceptance, JSON capture limits for commands and states, `maxCommands` retention (`full` overload, `checkpoint` recovery), revision-checked mutations (`stale`), reentrancy (`busy`), disposal (`retired`), frozen states, mutations require an exact safe-integer revision, restore never throws for stored data (`invalid`/`foreign`/`diverged`, including throwing creator validators/reducers) with a 64-bit replay kit `hashText` checksum over the whole retained log (redo entries included), authority random keyed by seed, lineage, stream and sequence.
- Checked: 18 focused headless unit tests (determinism, preview equals submit, undo/redo/replay, real SaveStore round trip across a fresh store, adversarial reducers and inputs, durable-authority composition with an in-memory adapter).
- Not established: any template or game consumer, browser or device evidence, reducer CPU deadlines, hidden-information safety of a local log (it is not), AI worker budgets, play-by-turn timeouts.

## Seeded fault-schedule harness (NW-09) — integrated in v0.2.0

Status: integrated in v0.2.0 (PR #26; batch PR #42).
Tools/tests only; no engine runtime behaviour changed. See the
[fault-schedule guide](network-fault-schedule.md).

- Runtime-enforced (harness): per-step invariants on independent SQLite readback
  (prefix sum equals revision, no rollback, contiguous bounded receipts, one
  stream/sequence per revision, immutable receipts, state equals committed inputs,
  committed inputs equal issued inputs), result semantics, storage-fault outcomes,
  baseline coherence, prediction replay, disclosure only to the current
  non-revoked controller, host/client bounds, post-heal convergence and release of
  every socket, server and timer. A loopback wait over 4 s fails as `stuck`.
- Tool seams: optional `clock`, `storageHooks`, `observe`, `openStorage` options, operator
  `recoverAuthority()` and `read().connections/intake` on the authority workbench
  host; defaults keep the reference behaviour. The existing storage/host tests are
  unchanged and pass; one new host test covers the seams.
- Checked: 7 tests in `fault-harness.test.mjs` (fixed seeds 1-12 x 300 steps with
  every fault family exercised, identical replay fingerprint, injected durable
  corruption failing at its exact step, reproducing and shrinking, and a defective
  adapter that commits and then reports `rejected` failing `storage-outcome`).
  Local sweeps on Node 22.23.3: 500 seeds x 300 steps passed; review sweeps of
  1,000 x 300 and 60 x 2,000 also passed. Six temporary mutations of the host,
  storage adapter, authority and prediction were caught (see the guide); two more
  were unreachable through this host. No engine defect was found.
- Not established: WAN behaviour, real process death inside the harness (the
  existing SIGKILL storage/host tests remain that evidence), power loss, disk-full
  or filesystem faults, TCP/OS backpressure, scoped-view publisher faults, scale,
  browsers and physical devices.

## Planned drain and capped lifetime (NW-08) — integrated in v0.2.0

Status: integrated in v0.2.0 (PR #21; batch PR #42). See the [drain guide](network-drain.md).

- Runtime-enforced: limit validation (exact keys, safe integers of at most one day,
  `noticeMs + jitterMs < maxLifetimeMs`, `maxKeys` at most 65,536); drain requests
  bounded by `maxNoticeMs`/`maxReconnectAfterMs`; lifetime close *scheduled* no
  later than `maxLifetimeMs` (emission waits for the next poll and the per-poll cap,
  so it may lag by a bounded, documented amount); at most `maxActionsPerPoll`
  instructions per poll, notify before close, a late notice never postpones its
  close; an operator drain reaches already-notified connections (close only earlier,
  return only longer, one superseding notice when changed); nondecreasing time;
  random-port validation; terminal disposal. The client follower refuses notices
  beyond its own bounds and merges later notices monotonically.
- Checked: 20 focused unit tests (including an operator drain reaching a
  lifetime-notified connection, emission lag under the per-poll cap, seeded jitter distribution over 2,000
  connections, 1,000-connection expiry under a per-poll cap, and reconnect after
  host return through a real retry schedule with budget and exhaustion honoured);
  4 host socket tests and 1 client protocol test; the network workbench browser
  workflow shows a following client holding without opening a transport, an
  ignoring client closed at the deadline with 1012 `drain` (transient), and both
  reconnecting with fresh authentication after the operator resumes, with no
  command resent. Exact-head gate results are in the PR.
- Not established: a real process restart (reference "host return" is an operator
  `resume` of the same process), close-frame delivery over lossy links, measured
  reconnect storms, multi-host or rolling deploys, durable-authority host wiring,
  physical devices and suitability of the example values for any game.

## Bounded spatial index (SC-01) — integrated in v0.2.0

Status: integrated in v0.2.0 (PR #23, merged to main at `2c87e3b`). See the
[spatial index guide](spatial-index.md) and [recipe](../recipes/use-a-spatial-index.md).

- Runtime-enforced: limit validation and ceilings (1,048,576 entries, 4,194,304 cells);
  all typed arrays (including nearest-query scratch) allocated at construction; only
  `Float64Array`/`number[]` id buffers accepted; `saturated`/`out-of-bounds`/`duplicate` refusals
  change nothing; queries wider than `maxCellsPerQuery` return `too-wide` with zero work;
  results never exceed the caller buffer and report `truncated` when incomplete;
  `dispose()` is terminal.
- Checked: `src/kits/spatial/spatial.test.ts` (12 tests) and
  `tools/spatial-bench/bench.test.mjs` (per-query work flat from 1,000 to 10,000 entries).
- Not established: browser frame cost, physical devices, worker offload, a running
  network-view or fog-of-war consumer, and template integration.

## Seeded generation (GEN-01) — integrated in v0.2.0

Status: integrated in v0.2.0 (PR #38; batch PR #45).
See the [procgen kit](../../src/kits/procgen/README.md) and the
[recipe](../recipes/generate-seeded-content.md).

- **Runtime-enforced:**
  - `deriveSeed`: an unsigned 32-bit root; at most 32 components, each a safe integer or a string of at most 256 code units; floats and other types are rejected.
  - Grid recipes: format and generator versions; id 1–256 code units; a nonnegative revision; an unsigned 32-bit seed; at most `maxCells` cells (default 262,144, hard ceiling 4,194,304); parameter bytes before parsing, then nodes and depth.
  - Execution: a literal-`true` validator; at most `maxSlices` slices (default 65,536); checked `set`; a whole-grid `maxValue` scan.
  - Adoption: descriptor, length, element type and slice count are checked.
  - Byte reservation is made before materialization. The existing host owns admission, cancellation, supersession and fallback.
- **Checked:**
  - Focused tests: 4 GEN-01 seed tests in `src/core/rng.test.ts` (pinned values, order independence, 200,002 collision-free int32 siblings, avalanche/lag, rejection) and 11 kit tests.
  - The kit tests cover an independent cellular oracle and identical output across runs, fallback, transfer and the real in-process worker runtime. They also cover request-order independence, refusal before admission, runaway and out-of-range generators, cancellation mid-job in all three paths, supersession, owner loss, captured queued input, nine corrupt worker outputs, and a real SaveStore round trip with quarantine of twelve corrupt or unversioned seed records.
  - Desktop Chromium module-worker check (`scripts/play/procgen-worker-check.mjs`, in `test:framework-browser`): worker, fallback and direct drain are bit-identical; cancellation and staleness are named; reservations retire after acknowledgement.
  - Exact-head gate results are in the PR.
- **Review fixes (PR #38):**
  - Generators may declare their slice count, which is checked before admission. The cellular example declares an exact count and yields every 4,096 visits.
  - `prepare` options accept `key` (including `false`), and the 4,096-keys-per-owner limit is documented.
  - The seed section stores `contentVersion`.
  - Adoption requires an exact, unshared, zero-offset backing buffer.
  - Errors are typed as `GridJobError` with a stage.
  - Locally produced output is not scanned twice. Cancellation wording now covers deadline termination.
  - Evidence: 3 added kit tests (11 in total), with the seed-section tests updated.
- **Not established:** physical-device timing, generation quality or aesthetics, determinism of arbitrary creator generators, chunk residency/streaming, runtime edit deltas, meshing, or persistence of large edited worlds. Research and the ranked follow-up slices are outside this repository.

## Spatial audio voices (AUD-01) — integrated in v0.2.0

| ID | Contract | State |
|---|---|---|
| AUD-01 | Platform audio output, per voice: `panning` (`'equalpower'` default \| `'HRTF'`), `distanceModel` (`'inverse'` default \| `'linear'` \| `'exponential'`) with bounded `refDistance`/`maxDistance`/`rolloffFactor`, a model-independent `cutoffDistance` (refused start, faded silence beyond), a separate HRTF voice limit with equal-power fallback and diagnostics, an optional smoothed low-pass/gain filter stage, and smoothed position/listener ramps. Creator control through `defineGame({ audio })` (HRTF limit per quality preset, smoothing, optional `sound.headphone-3d` setting). The mechanics template's ineffective `maxDistance: 60` became `cutoffDistance: 60`. [Guide](spatial-audio.md) | Integrated in v0.2.0 (PR #28; batch PR #45). Node unit and boot tests plus `npm run test:audio-browser` (real output rendering into `OfflineAudioContext` in the muted Chromium test browser) passed on the PR head. Proves configuration and rendered signal behaviour only: no human localisation trials, no Firefox/WebKit rendering, no device CPU/battery/latency measurement, no iOS evidence. No occlusion queries, propagation or networking; game sound files arrived separately (PR #37) and share this voice chain. |

## Developer-experience checks (DX-01) — integrated in v0.2.0

| ID | Contract | State |
|---|---|---|
| DX-01 | Boot input check and generator: [`src/author/input-registry.ts`](../../src/author/input-registry.ts) rebuilds the boot's `inputActions` table (engine rows, then game and kit inputs) with the registry's own options. `npm run check` (lint:brief) reports every problem; `npm run new -- input` picks bindings that table leaves free. Dev/test `engine.redraw()` ([`SceneHandle.redraw`](../../src/author/play.ts)) asks the running stock scene for one real draw, so `play:snap` judges budgets on rendered frames and reports `not measured` instead of a vacuous pass. [Recipe](../recipes/add-an-input-action.md) | Integrated in v0.2.0 (PR #39; batch PR #45). Unit and lint regressions plus emulated `play:snap` runs on the PR head. A dev/test boot throws on a clash; production drops the row with a warning. `engine.redraw()` covers the stock scene runtime only; the bench's idle windows are unchanged. Forced redraws can make a gate fail where it used to pass vacuously, and `not measured` exits 0. No device claim. Follow-up (PR #180): play:snap measures from the open until the per-frame counts settle (three agreeing 600 ms windows within 5 %, at most 8 s), judges the budget after that, and reports the first window as `warmUp`; shadow and texture metrics keep their since-open peaks. Unit tests (agreement, settle detection, a warming page stand-in, the summary line) and `play:snap` on blank (desktop and phone), showcase, terrain and expedition, plus a scratch scene that sheds 40 boxes over 4.5 s (old snap judged 6 draws mid-warm-up; new: warm-up 31, settled 2). |

## Template polish semantics (DX-02) — integrated in v0.2.0

| ID | Contract | State |
|---|---|---|
| DX-02 | Learn timeline objectives semantics: [`TimelinePlayer.state().objectives`](../../src/kits/learn/timeline.ts) is true from an `objectives` action until the learner passes the next gate after it, then stays false (it used to stay true for the whole scene, so the card returned over later drawings). The learn runtime shows the card from that flag on the first scene, outside interrupts. ui kit HUD lines and the prompt gain a readability plate ([README](../../src/kits/ui/README.md)). `play:script` gains `holdUntil`. | Integrated in v0.2.0 (PR #40; batch PR #45). Timeline unit test, learn `play:script` 9/9 and emulated snaps on the PR head. Lessons that relied on the card returning at later gates would see it once; no stock lesson did. No device claim. |

## Overload and goodput probe (NW-07) — integrated in v0.2.0

Status: integrated in v0.2.0 (PR #27; batch PR #46). Tools only; no engine runtime
change. Two optional reference-host additions keep their defaults: the network workbench's
`maxQueuedAgeMs` option, and `read().closeReasons` in the network and replication hosts.

Addressed statements: "measured network load unverified" and "non-reading peer
untested". They are now measured on loopback for the network and replication reference hosts.
The authority workbench was not driven. Runtime-enforced limits asserted as probe
invariants are the intake global queue bound and buffered-send caps (sampled), the
per-peer token buckets (host retirement reasons), the connection bound, one
application credit per peer, and retry attempts per episode and budget per client.
The saved runs predate several of these assertions (see the evidence README). The measured numbers are observations under heavy
contention, listed in the [guide](network-overload.md#measured-results-three-runs-loopback-2026-10-02).
Manual and physical-device evidence: none. Regression: `tools/network-probe/probe.regression.mjs`
(`npm run test:network-probe`, one CI step, `NW07:`). It includes the non-reader's
`send-refused` retirement at the cap. There are also fast `probe.test.mjs` checks
and an `NW07:` host test for the stale refusal.

The queue-age goodput finding is resolved by the NW-06 follow-up (PR #33). Aged sheds no
longer charge the pump budget, and the CI regression asserts a 300 ms age variant
plateaus. The saved runs predate it. Open items: client-visible close
reasons can be lost when a host terminates right after closing. On the network host, a small-reply
non-reader does not reach the buffered cap within a run. WAN, browsers, multiple machines and
devices remain unverified.

## MV-01: tunable jump feel — integrated in v0.2.0

Status: integrated in v0.2.0 (PR #34; batch PR #46).

- Runtime-enforced: configuration bounds (`RangeError`), step length within `[0, maxDt]`
  (at most 0.25 s), boolean facts, finite external velocity within ±1000 m/s, and a
  ground answer that is finite and not above its query. Rejected steps change no state.
  At most five integration pieces per step; constant state per actor. The adapter
  uses presses as the input layer reports them (exactly once per press with the PR #19
  press latch); its earlier consecutive-tick filter was removed on rebase. Grace
  windows admit exactly floor(window × rate) ticks; descending landings query from the
  tick's peak; adapter state is pruned to the current target.
- Checked: unit tests for exact apex height and identical arcs at 30, 60, 120, 144 and
  240 Hz ticks (165 Hz within one tick), release cut, coyote and buffer windows at six
  rates, no re-jump while held, terminal speed, zero-length steps, cancellation and
  reset; adapter tests for full-height jump and landing, one-way surfaces, a fall of
  about 1.5 m per tick landing exactly, step-up, snap-down, coyote off a ledge, and
  identical fixed-step samples at display rates 30–240 Hz with one jump per press through
  the real press latch (including zero-tick frames at 120–240 Hz); adjacent-tick presses
  count as two; the
  hold button through the real action layer (press, no repeat press, release, cancel).
  Review fixes add a landing test where the apex falls inside a tick above a one-way
  surface, exact tick counts for coyote and buffer windows at six rates and six window
  lengths, and despawn pruning. Mutation checks: replacing the exact integration, widening the coyote window,
  dropping the window tolerance, ignoring the tick peak, not pruning,
  re-adding a press filter or the swept landing each fails at least one test.
- Touch hold controls: integrated 2026-10-02 (PR #57 merge `e58010a`, batch PR #62, `main` `6485572`);
  before that a candidate in PR #57. `touchButton` in `@kits/ui`
  presses and holds an author input from an on-screen touch button through the real
  dispatcher and press latch; checked by fake-DOM tests and the Chromium touch-emulation
  `touch-sources-check.mjs` (one press, held across fixed ticks, slide-off release). No
  physical-device or jump-feel evidence.
- Not established: feel on any device, a template or browser jump consumer, moving platforms, slopes and lateral swept collision. Verified only on
  `origin/integration/batch-2`, where the PR #19 press latch is present; the kit relies
  on it for exactly-once presses.

## Strings select/ordinals/locale chain and dialogue variables (TB-02) — integrated

**Current status (2026-10-03): integrated.** PR #50 (PR merge `d622111`) reached `main` through merge-train batch PR #62, merged to `main` at `6485572` on 2026-10-02 (main CI run 37069963774 passed on that merge). Not in any release: v0.2.0 (`071e3c2`) predates it. "Integrated" is source delivery; the evidence scope below is unchanged and the candidate-era status is kept as history.

Status before integration: implemented, candidate on branch `feat/tb02-strings-dialogue` (PR #50); not integrated. Recipes: [plurals, ordinals and variants](../recipes/write-plurals-ordinals-and-variants.md), [branching dialogue](../recipes/add-branching-dialogue.md); [dialogue kit README](../../src/kits/dialogue/README.md).

- Runtime-enforced: message parsing bounds (16,384 UTF-16 units, argument depth 8, 1,024 parts); CLDR plural categories only; `other` required for `plural`, `selectordinal` and `select`; prototype names never match select cases; locale tags Intl does not support (well-formed or malformed) resolve to `en` rules and digits through `supportedLocalesOf`, never the host default; select and plural form tables have null prototypes; locale chain explicit fallbacks, then truncation, then base, at most 8 entries. Dialogue: declared typed variables (≤256), bounded condition trees (≤64 nodes, depth 8), ≤32 assignments per option, type-checked at construction; atomic assignment with the move; `overflow` without change; visit counts saturating; snapshot validation of variables and visits (the current node must have at least one visit; prototype-named node ids keep their counts); first-version snapshots restore.
- Checked: focused unit tests (`src/core/i18n/select-ordinal.test.ts`, `src/kits/dialogue/variables.test.ts`, including a real SaveStore round trip across a fresh store); existing i18n, string-generation, dialogue and expedition tests unchanged and passing.
- Not established: a run-time locale selection author API (the running game stays `en`), translated catalogues for any template, RTL/bidi or CJK line-breaking policy, text speed or typewriter reveal, any browser or device evidence, a template using dialogue variables.

## Interest sets for scoped views (SC-02) — integrated

**Current status (2026-10-03): integrated.** PR #51 (PR merge `f0f020e`) reached `main` through merge-train batch PR #62, merged to `main` at `6485572` on 2026-10-02 (main CI run 37069963774 passed on that merge). Not in any release: v0.2.0 (`071e3c2`) predates it. "Integrated" is source delivery; the evidence scope below is unchanged and the candidate-era status is kept as history.

Status before integration: implemented, candidate (PR #51); not integrated. See the
[interest sets guide](interest-sets.md) and [recipe](../recipes/use-interest-sets.md).

- Runtime-enforced: limit validation and ceilings; exit-radius scan checked against the
  grid's per-query cell bound at construction; bounded member, candidate and priority
  tables allocated at construction; `over-budget`, fail-closed `incomplete`, `unavailable`
  and `saturated` outcomes; terminal disposal.
- Checked: `src/kits/spatial/interest.test.ts` (9 tests), `tools/interest-host/host.test.mjs`
  (6 tests with real NW-02 receivers), `tools/spatial-bench/bench.test.mjs`.
- Not established: socket or browser hosts, WAN, priority accumulation for dropped ids,
  occlusion or shared vision, physical devices, template integration.

## Saveable random state (RNG-01) and input history (INPUT-01) — integrated

**Current status (2026-10-03): integrated.** PR #52 (PR merge `2d5f50e`) reached `main` through merge-train batch PR #62, merged to `main` at `6485572` on 2026-10-02 (main CI run 37069963774 passed on that merge). Not in any release: v0.2.0 (`071e3c2`) predates it. "Integrated" is source delivery; the evidence scope below is unchanged and the candidate-era status is kept as history.

Status before integration: implemented, candidate (PR #52, `feat/rng-state-input-history`); not
integrated. These are slices 3 and 4 of the fighting-game genre study. See the
[input-history README](../../src/kits/input-history/README.md), the
[input-history recipe](../recipes/add-input-history.md) and the
[rollback recipe](../recipes/add-rollback-sessions.md).

- **RNG-01, runtime-enforced:** `restore` accepts only a safe integer in 0..2^32-1, with no coercion; a refusal leaves the state unchanged. Streams share no state, and the returned object is frozen.
- **RNG-01, checked:**
  - draws are identical to `createRng` for number and named seeds (500 draws each);
  - a word saved through JSON replays 200 later draws exactly, in the same or another stream;
  - a refused restore leaves the state unchanged;
  - a rollback sync test passes only while the word is in the saved state.
- **INPUT-01, runtime-enforced:**
  - option bounds (actions 1–32, capacity 1–3600, at most 16 disjoint opposite pairs, steps 1–16);
  - contiguous frames only;
  - masks limited to declared bits;
  - `within` at most capacity and `maxGap` at most `within`;
  - a window reaching evicted frames throws rather than answering partially;
  - a snapshot loads only with an identical configuration, consistent edges and consumption, and it is applied all at once.
- **INPUT-01, checked:** 17 tests. Review fixes on PR #52: the `reset` baseline is cleaned with the opposite policies (previously a held opposite pair reported false releases), and an explicit frame on an empty history throws instead of returning false. Both regressions fail on the earlier head.
  - `match` agrees with exhaustive search on 300 seeded random histories.
  - Mutations each fail the suite: a greedy predecessor, a gap off by one, sequences ignoring consumption, and `last` behaving as `first`.
  - 13 tampered snapshots are refused.
  - A buffered motion with a saveable damage roll passes `createRollbackSyncTest`. Leaving the history or the random word out of the saved state fails it (`step-failed`, `checksum-mismatch`).
  - A `testScene` consumer records a one-tick tap exactly once.
- **Not established:**
  - per-game window values (creator data);
  - charge-input helpers;
  - ordering of several actions inside one tick (`ctx.input.pressedAt` timestamps are not consumed by this kit);
  - physical controllers, arcade sticks and feel.

## MV-02: moving platforms — integrated

**Current status (2026-10-03): integrated.** PR #53 (PR merge `b6dd99d`) reached `main` through merge-train batch PR #64, merged to `main` at `3b449fa` on 2026-10-03 (main CI run 37082507567 passed on that merge). Not in any release: v0.2.0 (`071e3c2`) predates it. "Integrated" is source delivery; the evidence scope below is unchanged and the candidate-era status is kept as history.

Status before integration: implemented, candidate (`feat/mv02-moving-platforms`, PR #53); not integrated.

- Runtime-enforced:
  - Registry bounds: `maxPlatforms` [1, 1024]; footprints (0, 1000] m; `maxSpeed`
    (0, 1000] m/s; path poses finite within ±1e7; `advance` steps (0, 0.25] s.
  - `advance` samples every path before committing and refuses a non-finite pose or an
    over-speed move without moving any platform. `cut` admits one declared discontinuity
    with zero delta.
  - Riding requires the platform's pose to be unchanged since the actor last rode, or
    advanced by exactly its reported delta. Anything else detaches the actor with no
    velocity.
  - Boosts are clamped to ±1000 m/s. Carried planar motion slides in sub-steps of at most
    half the radius, and is refused above 1,024 sub-steps per tick.
  - Each adapter tick is a transaction: if any query or limit throws, the jump controller
    and adapter state are restored and the Transform is not written, so the tick has the
    effect of a skipped tick (regression: a ground query that throws once mid-fall at
    30 and 60 Hz, before and after the controller steps, mid-fall and on flat and diagonal
    lifts, matches the skipped-tick run exactly; removing either half of the rollback fails it).
  - Default `Walls` stop at ±1e6 m while platform poses are accepted to ±1e7; beyond
    ±1e6 riders are not carried unless the scene has wider `Walls` (documented, not
    changed).
- Checked:
  - The regression tests run at 30, 60, 120, 165 and 240 Hz ticks: exact riding including a
    20 m/s descent; jump apex from vertical, diagonal and descending lifts within g·dt²/8 of
    (v0 + v)²/2g; leave policies and removal; one-way pick-up and pass-through.
  - Also at those five rates, for the review fixes: frozen, missing and late platform
    systems; detaching on cut, restart, re-add and an external lift; `when` pauses;
    riding-tick sweeps (floor, step, overtaking platform); coyote after moving off; a thin
    solid, walls, and an atomic failed tick.
  - Narrower runs: identical arcs at aligned times at 30, 60, 120 and 240 Hz; the boost
    policy at 120 Hz; the 1000 m/s clamp and the sub-step refusal at 60 Hz.
  - Mutation checks: reverting each review fix fails its regression test. The fixes are the
    jump-tick base, the frozen delta, the continuity and attachment checks, riding while
    paused, the riding sweep, coyote grace, the boost clamp and the sub-step refusal.
- Not established: feel on any device, any template or browser consumer, rotating or
  sloped platforms, side pushing, and render interpolation between ticks (the next slice).

## Newcomer shared session (MP-01) — integrated

**Current status (2026-10-03): integrated.** PR #61 (PR merge `41d0261`) reached `main` through merge-train batch PR #64, merged to `main` at `3b449fa` on 2026-10-03 (main CI run 37082507567 passed on that merge). Not in any release: v0.2.0 (`071e3c2`) predates it. "Integrated" is source delivery; the evidence scope below is unchanged and the candidate-era status is kept as history.

Status before integration: implemented, candidate (PR #61); not integrated. Guide:
[shared session](multiplayer-session.md); recipe:
[two players in one world](../recipes/two-players-one-world.md).

- Runtime-enforced: rules validated and frozen at definition (token id, positive
  version, 1-16 players, functions present, a valid initial world); every world a
  creator function returns is checked against id syntax, `maxEntities` and JSON bounds
  before it is adopted or published; join code (16-128 URL-safe characters, compared
  without early exit; `--join` also needs 10 distinct characters), rules id/version
  match, player slots, joining-connection pool with a per-address cap (2) and a
  resume-only reserve with a 500 ms deadline, 1.5 s join deadline and pre-join frame
  count, per-connection frame token bucket (credit-releasing acks free), client action
  pacing (30/s) and pending bound equal to the host queue (16), raw frame size,
  per-connection and global queued actions, exact action sequence, one view credit per
  connection under view limits, idle and away timeouts; client pending-action bound,
  view-sized inbound queue, retry schedule and budget, terminal close classification,
  and page endpoints limited to loopback and private LAN hosts. `npm run host` binds
  127.0.0.1 unless `--lan`, accepts only loopback browser origins in loopback mode (LAN
  origins too with `--lan`) and prints a development-only warning.
- Checked: `src/kits/network/session.test.ts` (15 tests, in-memory sockets, including an
  idle-socket flood probe, a 60 Hz `act` regression and a queue-size burst),
  `scripts/host.test.mjs` (4 tests, real loopback WebSockets),
  `templates/shared-world/game/world.test.ts` (S1: local play and host core give the
  same world), `npm run test:session-browser` (two isolated headless Chromium contexts,
  SwiftShader, one loopback host: join, move and paint seen by the other page, host
  restart on the same port with the same join code ridden out by paced, bounded
  reconnects on both pages, each page then showing the restarted host's fresh empty
  world (host world revision restarted, no action applied) before any new action, a
  drop of page B alone with A still playing and B resuming its slot and converging,
  wrong join code terminal with one attempt, integrity observe-only, no page errors;
  [recovery receipt](../verification/session-recovery-20261003.md)). All browser
  evidence is loopback only. The template gate
  (`npm run gate -- --game templates/shared-world/game`) passed with 2,518 tests and 11
  performance checks at the first candidate. After review the board became one mesh:
  the measured worst case (four joined players, all 49 cells painted, SwiftShader) is
  6 draws and 1,764 triangles, within the derived `world` budget of 10 draws (lowered
  from the first candidate's 60).
  Exact revisions are recorded in the PR description.
- Not established: LAN between separate devices, WAN, TLS, NAT traversal, accounts,
  matchmaking, persistence across host restarts, drain (NW-08) on this path, host
  liveness detection by clients, physical-device input or performance, touch, more than
  four players, load or scalability, a joining-socket flood from many LAN addresses at
  once, and integrity enforcement quality (only observe mode is exercised in a browser).

## Bench dead-window guard (W1-4) — integrated

**Current status (2026-10-03): integrated.** PR #59 (PR merge `4931e24`) reached `main` through merge-train batch PR #65, merged to `main` at `1f9d10d` on 2026-10-03. Main CI run 37086722080 on `1f9d10d` failed: the arcade template's active bench window drew no frame (perf inconclusive), the ended-visit defect later fixed by PR #75. The next main CI, run 37088378582 on `2fb6e69` (which contains batch 7), passed. Not in any release: v0.2.0 (`071e3c2`) predates it. "Integrated" is source delivery; the evidence scope below is unchanged and the candidate-era status is kept as history.

- Implemented: per-scene `activeKeys` in `budgets.json`; the bench reads the game's input
  rows in Node and records `heldKeys`, `heldKeysDrive` and `heldKeysSource` per active
  sample; `classifyWindow` takes `heldKeysDrive` (classification version 3).
- Checked: an active window with driving keys and no frame is inconclusive; with keys that
  press nothing it is steady and comparable; an epoch break or incomplete window stays
  invalid; unknown bindings never excuse a dead window; the expedition template's arrows
  press nothing and the explorer template's press the character kit's move actions; a
  malformed `activeKeys` is refused. Local `npm run gate -- --game templates/expedition/game`.
- Not established: pointer-only scenes (no driving key, so a dead window there is not
  detected), player rebinding, physical devices. GitHub CI `check` passed on PR #59 before batch integration.

## Spatial audio sources and occlusion (AUD-02) — integrated

**Current status (2026-10-03): integrated.** PR #55 (PR merge `87c1a20`) reached `main` through merge-train batch PR #65, merged to `main` at `1f9d10d` on 2026-10-03. Main CI run 37086722080 on `1f9d10d` failed: the arcade template's active bench window drew no frame (perf inconclusive), the ended-visit defect later fixed by PR #75. The next main CI, run 37088378582 on `2fb6e69` (which contains batch 7), passed. Not in any release: v0.2.0 (`071e3c2`) predates it. "Integrated" is source delivery; the evidence scope below is unchanged and the candidate-era status is kept as history.

| ID | Contract | State |
|---|---|---|
| AUD-02 | Optional `@kits/spatial-audio` over the integrated AUD-01 voices: bounded logical sources tracked without voices (virtual) until they rank, importance ranking (class × creator `importance()`) with fade-out stealing under hysteresis, fair rotation of equal scores (starvation credit across dropped emissions) and lateness drops, a voice cap that counts fading voices, HRTF claims for `localise` classes within a kit limit (with hysteresis), per-class distance curves with a hard cutoff and air low-pass, and occlusion through a creator `(from, to) => distance \| null` query (the camera kit's `obstruction` shape) under `raysPerPump`, stalest first, with aged results, driving the output's smoothed filter. [Kit README](../../src/kits/spatial-audio/README.md) | **Integrated 2026-10-03** (PR #55 merge `87c1a20`, batch PR #65, `main` `1f9d10d`). Before integration: implemented, candidate (public PR #55). Node unit tests and `npm run test:audio-browser` (kit over the real output in `OfflineAudioContext`, muted browser: occlusion ~24 dB at 3 kHz without steps, steal fades without a cut) pass on the branch. Re-verification fixes (fair rotation, cap including fades, `stats.rotated`, rays for new emissions at a budget of 1, honest `stale`/`unqueried`, HRTF hysteresis) have Node regressions that fail on the previous head `a95497e`. Round-3 fixes (a cut voice's replacement always starts, rotation opt-in and off by default, least-recently-served fairness, priority for free slots, HRTF cap counting fading voices, no voice leak on re-entrant cancel; seeded fuzz of the caps and leaks) have Node regressions that fail on `9eb9612`. Round-4 fixes (nothing plays late by default, opt-in `carryLate` bounded to one interval, honest `dropped`/`late`/`skipped` stats, HRTF cap never delays a repeat, reservation timeout after admission, rotation inside the 1% band) have Node regressions that fail on `158ff29`. Round-5 fixes (late `carryLate` emissions may rotate in again within their one-interval bound, a 64-setup fairness table test, lateness epsilon, docs on late starts after hitches) have Node regressions that fail on `be71bc7`. No template consumer. No listening trials, real level geometry or query cost, propagation, device cost or networking claim. |

## Large edited worlds (GEN-02) — integrated

**Current status (2026-10-03): integrated.** PR #56 merged directly to `main` at `2fb6e69` on 2026-10-03; main CI run 37088378582 passed on that merge. The recipe's data-loss pattern (acknowledging a revision read after the await) was corrected by PR #95 (`0a09710`, main CI run 37150583760 passed) with the regression `GEN-02 acknowledging a pending save retains edits made after submission`. Not in any release: v0.2.0 (`071e3c2`) predates it. "Integrated" is source delivery; the evidence scope below is unchanged and the candidate-era status is kept as history.

Status before integration: implemented, candidate on `feat/gen02-chunk-store` (PR); not integrated. See the
[recipe](../recipes/store-large-world-records.md) and the [procgen kit](../../src/kits/procgen/README.md).

- **Runtime-enforced:**
  - Limits: keys of 1–256 code units; records of at most 1 MiB (configurable to 64 MiB); 65,536 records; 256 MiB total; 64 records per write; 64 queued operations; 32 quarantine rows. Configured limits are validated.
  - Revisions must be strictly newer, compared inside the transaction. The schema number is stored, and newer records are read-only.
  - CRC-32 and envelope validation run on every read and before every overwrite. Unreadable bytes are copied to the quarantine in the same transaction, or the write is refused.
  - Each write call commits all or nothing; browser quota failure leaves stored data unchanged.
  - Eviction happens only for records the creator marks, least recently used first.
  - The store falls back to `session` memory when IndexedDB is unavailable. A version change from another tab closes the connection.
  - Cell edits: at most 65,536 per grid by default, with values bounded, canonical encoding and strict decoding.
- **Checked:**
  - 16 core tests over an in-repo IndexedDB fake and the memory port.
  - 6 cell-edit tests, including a GEN-01 regenerate-and-apply round trip and a refused cross-seed load.
  - A desktop Chromium real-IndexedDB check (`scripts/play/chunk-store-check.mjs`, in `test:framework-browser`): round trip after reopen, a cross-tab stale refusal, checksum quarantine and overwrite, version-change closure and session fallback.
- **Review fixes (PR #56):**
  - **Queue:** a throwing `evictable` now resolves `failed` for that operation only, and the queue keeps running. `close` releases queued work before it reaches storage.
  - **Victims and newer data:** eviction victims are validated inside the transaction (unreadable ones quarantined or refused, newer ones kept). `remove` returns `newer`.
  - **Newer builds:** a newer database version rejects with `newer-format` instead of falling back to a session store, and a newer envelope format reads as `newer`.
  - **Reset:** `clear`, `destroy`, `deleteChunkDatabase` and `listChunkDatabases` are added, and databases are prefixed `fe-chunks:`.
  - **Cell edits:** they carry a baseline CRC-32 and are refused over different content. The encoder buffer is fixed for five-byte varints, and overlong varints are rejected.
  - **Test fake:** transactions are serialized, so concurrent tabs no longer lose updates there.
  - **Evidence:** 16 core tests, 6 cell-edit tests, and the browser check passing 3/3 with concurrent, newer-format and destroy cases.
  - **Reset gap:** the save store's reset and export still do not include chunk databases (documented in the recipe).
- **Second review (PR #56):**
  - Cell edits bind `cellsX/Y/Z` in a 24-byte header, so uniform content of another shape is refused.
  - A blocked deletion stays tracked: opens in this tab reject `deleting`, and opens queued by the browser reject `blocked` after `openTimeoutMs`. The deferred deletion completes when the last connection closes.
  - The IndexedDB fake fires `versionchange` before deleting and completes blocked deletes later, matching Chromium.
  - Per-instance record and byte accounting across tabs is documented.
  - Evidence: 17 core and 7 cell-edit tests; the Chromium check adds destroy with a sibling store open, and a blocked then deferred delete (3/3).
- **Not established:**
  - real quota exhaustion and browser-initiated storage eviction;
  - private-mode behaviour per browser, Safari and Firefox;
  - physical devices;
  - multi-tab totals (in-memory accounting refreshes on reopen);
  - compression, whole-world export and crash consistency beyond IndexedDB's transaction atomicity.

### Orphan import receipt correction — integrated

**Current status (2026-10-03): integrated.** PR #77 merged to `main` at `24d7512`; the required `check` passed on the PR head, and the first completed main CI containing it, run 37148687488 on `5b12552`, passed. The evidence below remains MemoryBackend scope; no browser or physical durability acceptance is added by integration.

The existing SaveStore now distinguishes exact retention, conflicting destination
bytes and storage failure, with known writes completed before orphan receipts.
No snapshot API or format migration is included. Six focused regressions cover
both payload locations, duplicate/conflicting bytes, denied reads/writes and retry,
canonical-id known/orphan overlap, pending writes and notification-time owner
registration. Four of these fail against the unchanged public implementation.
A review follow-up keeps renamed sections round-tripping: export no longer writes a
registered section's stale alias key as an orphan, and an alias orphan beside its
section in one file reports `orphan-superseded` instead of rejecting the file. Four
more regressions (rename/export/fresh import, newer alias-only payload, alias orphan
beside the section, genuine conflict and retry beside a rename) fail on the first
candidate; all 57 store tests pass under Node 22.23.3. This is MemoryBackend evidence, not browser or
physical durability acceptance; hosted integration checks were then still required (see current status above). See
[the import recipe](../recipes/add-a-save-section.md#6-report-orphan-import-outcomes)
for the expanded result union and recovery boundaries.

### Author scene DPR-only redraw — integrated (PR #83), 2026-10-03

**Current status (2026-10-03): integrated.** PR #83 merged to `main` at `5b12552`; the required `check` passed on the PR head and main CI run 37148687488 passed on `5b12552` (all jobs and the aggregate `check`). The browser evidence below stays scoped to source `422975c`; no physical-device acceptance.

The focused `fix/author-dpr-redraw` candidate connects the existing quality owner's
resize notification to the visit-owned author resize callback. It guards retired
visits and removes the listener on cleanup. Existing quality defaults, creator
profiles and on-demand rendering semantics are preserved.

Evidence: eight focused resize/cleanup tests and a clean-source browser run at
`422975c43904037e7895a5ebe96a4a9913f45b4c` passed. A quality DPR change with unchanged
CSS produced one redraw and then idle rendering; the unchanged public runtime
reproduced the missing redraw. See the [contract](render-resize-lifecycle.md) and
[source-scoped receipt](../verification/dpr-redraw-20261003.md). The receipt is candidate-source
evidence; it is not a full local gate or physical-device acceptance.

## Scene look: output, local lights, shadows and sky (VIS) — in progress

Creator requirement: a creator's agent can make a lit, atmospheric scene through `@engine` data without importing
three.js. Each row is opt-in per scene, and a scene that does not opt in keeps its picture, draws and budgets. See the
[scene look guide](scene-look.md).

| ID | Contract | State |
|---|---|---|
| VIS-11 | Optional procedural interior reflection in `defineEnvironment`: `reflection: { kind: 'interior', size, eyeHeight, wall, floor, ceiling, lights }` (surfaces as packed sRGB times intensity in [0, 16]; at most 8 spheres with radius (0, 10] m and intensity [0, 1000], inside the interior and not containing the probe). One 512 x 256 half-float equirectangular `DataTexture` (1 MiB) from a lazy chunk, set as the scene environment and prefiltered once by the renderer. Owner: the visit's reflection binding (`author/scene-cubes.ts`), keyed by the interior's data; cube reflections unchanged. | **Integrated** (PR #183 via combined integration PR #253). Evidence: unit tests (`interior-reflection.test.ts`: validation, deterministic pixels, key, texture, built once per data, replace and dispose, exit, malformed run-time data). Browser acceptance `npm run test:interior-reflection-browser` passed 2026-10-05 in local software GL on the reference and low presets (mirror sphere centre 255,255,255, rim 8,8,8; relit after one change; draws 1/1; idle 0). No physical-device, GPU prefilter time or visual-quality acceptance; no parallax (one probe point). |
| VIS-05 | Optional gradient sky and exp2 haze in `defineEnvironment`: `sky: { kind: 'gradient', top, horizon, bottom, exponent, discs, stars }` (one RGBA `DataTexture`, 1 KiB plain or 512 KiB with a disc, on an inverted sphere with `MeshBasicMaterial`, no custom shader; stars as one additive points draw), `haze: { kind: 'exp2', color, density }`, `color: 'sky'` for either haze. Owner: the environment binding of the visit; the texture regenerates only on a sky change; sky and cube are exclusive. | **Implemented and checked (candidate PR #150).** Evidence: unit tests (`sky.test.ts`), `npm run test:sky-browser` (reference and low; desktop headless Chromium, software GL: horizon and top within 10/255 of the gradient, far crate in exp2 haze takes the horizon colour, +2 draws for sky and stars, idle 0 frames, texture replaced and disposed once, disposed on exit), `quality:guard` *identical* on blank and explorer. No physical-device or display-banding evidence; discs are soft (texture-based). |
| VIS-03 | Optional shadows: `sceneShadows({ cast, receive })` per scene (shadow map enabled through the lease profile only then, PCF), environment `directional.shadow: { extent, softness }`, `PointLight`/`SpotLight` `shadow: true`, per-entity `Shadow`. Owner: the scene visit; sun and local shadows from the lazy `scene-light-rig` chunk through `liveShadowMap` and the shadow scheduler (maps redraw only on change). Shadowed local slots fixed per visit (essential, then entity order), bounded by `lights.shadowed-max` (4/2/1/0, registered, unwired); unmet requests drawn without a shadow and reported once per cause (`shadow`, `no-shadows`). | **Integrated (PR #148, merge `e84afcf`, 2026-10-04).** Evidence: unit tests (`shadow-casting.test.ts`), `npm run test:shadows-browser` (reference and low; desktop headless Chromium, software GL: contact luminance 86 with shadows vs 163 without, 0 shadow-map draws on a still redraw, moved caster redraws, no off-screen pass without shadows, reports once), courtyard bench (`shadowCasters` 215, idle off-screen 0, 56.9 MiB textures), `quality:guard` *identical* on blank and explorer. No `shadowMapMiB` row (shadow maps count in `textureMiB`), no physical-device GPU time or memory evidence. Follow-up (D4 shadow cost accounting): a gated `shadowPasses` row (bench probe checked by `test:shadows-browser`: sun 1, sun plus one point light 7; templates measured 0, budget 1), `refused` counts lights not reports, and the per-light and per-shadow cost table in the scene-look guide (software GL). |
| VIS-02 | Optional point and spot lights: `PointLight`/`SpotLight` components and `defineScene({ lights: sceneLights({ point ≤ 16, spot ≤ 4 }) })`. Owner: the scene visit (`author/light-slots.ts` admission, also in `testScene`; `author/scene-light-rig.ts` built on `platform/render/light-rig.ts`). Slots are created once per visit (STD-REN-11): claim and release never change the light count; overflow refused essential-first then spawn order, admitted when a slot frees, each cause (`full`, `invalid`, `no-slots`) reported once per visit; `lights.local-max` knob (16/8/4/2, registered, unwired) caps slots per kind once per visit. | **Integrated (PR #138, merge `ef0d1bb`, 2026-10-04).** Evidence: unit tests (`lights.test.ts`, `scene-light-rig.test.ts`), `npm run test:lights-browser` (reference and low; desktop headless Chromium, software GL: lit floor near a lantern vs 10 m away, no program link on spawn/despawn, one redraw per change, idle 0 frames, refusal reported once at low and admitted when a slot frees, lights removed on exit), `quality:guard` *identical* on blank and explorer. No `localLights` budget row (the bench does not measure slots), no physical-device fill-rate evidence. Follow-up (PR #172): a non-essential light refused only because the quality tier created fewer slots than the scene asked for is cause `tier`, reported once at info level (never a page error); an essential light refused stays `full` (error). The showcase marks its two front posts essential; `play:snap --mobile` passes on every template and the CI phone smoke runs at the default phone tier (medium) instead of `--quality reference`. |
| VIS-01 | Opt-in tone mapping and exposure per scene: `defineScene({ view: { output: { toneMapping, exposure } } })`, `'none'`/1 by default (a fresh renderer's own values). Owner: the scene visit through the renderer lease profile; `ctx.view.output` changes draw exactly one frame; an invalid run-time value is reported once and the last valid output stays. WebGL mapping in `platform/render/backends/webgl/output.ts`. | **Integrated (PR #124, merge `522815f`, 2026-10-04).** Evidence: unit tests (`scene-output.test.ts`, `backends/webgl/output.test.ts`), `npm run test:output-browser` (reference and low; desktop headless Chromium, software GL: an emissive-6 lantern clips under `'none'` and stays below clipping under `'aces'`; idle 0 frames; one frame per change), `quality:guard` *identical* on blank (`main`) and explorer (`garden`, `shed`). No physical-device or HDR-display acceptance. |

## Asset provenance and AI disclosure (DX-03) — implemented, candidate

Creator requirement: a creator can tell players and stores honestly how each shipped file was made, and which AI help
was tooling rather than content.

| ID | Contract | State |
|---|---|---|
| DX-03 | Asset provenance and AI disclosure: one record per shipped model, texture and sound (beside the file as `<name>.provenance.json`, or in `<game>/assets.provenance.json`) with origin (`hand`, `agent-blender`, `ai-generator`, `library`), author, licence, source, SHA-256 and, for AI origins, tool, model, prompt or reference, human edits and (generators) weights and output licences; `tooling` and `liveGenerated` for what is not a file. `lint:provenance` in `npm run check` warns by default and fails when the brief sets `assets: { provenance: 'required' }`; `npm run disclosure` drafts Steam (pre-generated, live-generated, tooling apart) and itch.io (Graphics, Sound, Text & Dialog, Code) text. Owner: the creator writes records; `scripts/lib/provenance.ts` only reads. [Guide](asset-provenance.md) | **Implemented and checked (candidate PR, 2026-10-03).** Evidence: focused tests (`scripts/lib/provenance.test.ts`, `src/author/build.test.ts`) and `npm run check`. Tooling only: no runtime, browser or store-acceptance claim; licence claims are not verified; `defineAsset` fields are not cross-checked; no stock template has records yet (the mechanics template's nine files and the showcase template's two textures warn). |


## Service assignment experiment — isolated candidate, 2026-10-09

`tools/service-assignment-lab/` contains an unexported bounded ownership prototype with service-request and weighted-worksite fixtures. It demonstrates exclusive actor claims, generation-scoped token refusal, capacity admission, atomic failed-transfer preservation, bounded explicit retry withdrawals and disposal. It adds no installed kit, scheduler, thread, persistence adapter or product API. [Contract and limitations](service-assignment-lab.md).

Evidence: 15 focused Node tests passed, including a 600-command independent allocation model and 1000 admission/removal cycles; both Node fixtures ran, and `npm run check` passed with the one prototype test file selected (15/15). Integration gates, browser behavior and physical-device performance are not accepted by this evidence. This entry records a branch candidate, not integration or production readiness.


## Optional assignment kit candidate — ASG-01, 2026-10-09

The independently implemented `@kits/assignments` helper graduates the service/worksite ownership mechanism into a typed optional public surface. It retains bounded actors, targets, weighted claims and retry counts, preserves existing claims on failed transfer, rejects retired tokens, and supports explicit disposal. Existing navigation/command/save/inventory owners keep their responsibilities; no matching policy, global scheduler or persistence format is added. The original lab now imports the kit through two consumer modules. [Contract](assignments.md).

Evidence: 23 focused tests passed (8 typed kit/consumer tests plus 15 retained lab regressions), including real route-owner cancellation, stale result rejection, an independent allocation model and bounded churn. `npm run check` passed with 27/27 tests across four selected files, and the migrated demo ran successfully. This is a local candidate; hosted/full integration gates, playable consumers and browser/physical-device acceptance remain pending.

## Editable itinerary prototype — 2026-10-09 candidate receipt

Base: origin/main e7e42706; branch feat/itinerary-lab. Nineteen focused tests passed
via node --import tsx --test tools/itinerary-lab/itinerary.test.mjs; strict controller
check passed via tsc --noEmit -p tools/itinerary-lab/tsconfig.json. Two headless
consumers; no exported API, full gate, browser, durable custody or physical-device
claim. See [detailed evidence and boundaries](itinerary-lab.md).

## Public itinerary helper — graduation candidate, 2026-10-09

ITINERARY-01 exposes createItinerary from @kits/itinerary with caller-owned lifetime
and no registration or execution owner. The lab now consumes this implementation.
Base: reviewed prototype e7aa2e55; branch feat/itinerary-kit. Twenty-four focused
tests and scoped strict typechecking passed, including a real SaveStore/fresh-store
round trip. This supersedes the prototype's unexported status, not its evidence
limits. No full gate, browser, durable custody transaction or physical-device claim;
not integrated. See the [contract](../../src/kits/itinerary/README.md).

## Experimental planar interaction alignment — 2026-10-09

Unexported `tools/interaction-alignment-lab` prototype: one bounded local-frame approach attempt with creator-owned pose application, eligibility and clearance, followed by an exact-ticket prepare/acknowledge boundary. Two distinct headless fixtures cover console activation and socket placement. Focused evidence: ten Node tests, isolated TypeScript check and changed-file formatting. Target replacement, stale acknowledgment, cancellation/disposal, pause, timeout and step-budget refusal are exercised. No runtime movement, physics, input, inventory, save integration, browser/device acceptance or full CI claim. Not an integrated engine capability. [Contract and limitations](interaction-alignment-lab.md).

## Planar alignment public kit candidate — 2026-10-09

The earlier unexported experiment is graduated in this candidate to optional `@kits/alignment` (ALN-01), reusing frames identity validation without installing a system or requiring kit registration. It provides bounded target-relative proposals and exact-ticket acknowledgment; creators retain movement, clearance, eligibility, clock and effect ownership. Lab consumers now use the kit; no duplicate tool implementation or new installed system remains. Public yaw matches author Y rotation, with focused frame-composition coverage. Evidence: 15 focused headless tests, isolated typecheck and formatting. Full CI, browser/runtime playability, physics, save composition and devices remain unverified; this does not establish integration. [Contract](../../src/kits/alignment/README.md) and [consumer guide](interaction-alignment-lab.md).

### Acceptance evidence prototype — 2026-10-09

Local unexported development candidate: [contract and limits](../../tools/acceptance-evidence/README.md). Required-case/minimum-sample admission with explicit failure statuses and bounded JSON CLI; real replay and historical-save consumer tests. Seven focused tests passed locally, including CLI negative cases. Existing test glob includes the regressions; complete hosted CI is pending. No engine runtime API, new scheduler, performance claim or physical-device acceptance.

### Combined optional-helper implementation — 2026-10-09

This combined implementation supersedes the earlier lab-only export status: assignments, itinerary and alignment are public optional pure helpers; the lab fixtures consume those helpers. Acceptance reporting remains a development-only tool. Historical candidate evidence above is retained as history, not a claim of current integration. [ADR 0080](../adr/0080-optional-interaction-ownership.md) records ownership and limitations. Full hosted CI on the combined candidate is the integration prerequisite; physical-device and concrete-game acceptance remain unverified.

## Visibility contributions — VISIBILITY-01 candidate, 2026-10-09

[Contract](../../src/kits/visibility/README.md), [decision](../adr/0081-visibility-contributions.md), [discussion #198](https://github.com/Akilleez-QA/foundation-engine/issues/198). Pure optional per-observer cell contributions with atomic replacement, stale calculation refusal, explored history and bounded coalesced draining. Creator geometry, relationships and disclosure remain external. Evidence: focused lifetime/refusal/drain tests, two distinct headless sensor/facility consumers and a 600-command set-union/history model. Validation: eight focused tests and scoped strict typechecking pass; `npm run check` passes all steps and 12 selected tests across three files. Candidate only; no integrated game, full CI, browser, save or physical-device acceptance claimed here.

## Weighted choice/history — candidate, 2026-10-09

Existing procgen helper extension; ADR0082 proposed. Ten focused tests pass, including
endpoint/no-draw/refusal/eviction and saved RNG/history continuation via real SaveStore.
Two headless consumers; no browser/full-gate/device claim. See [contract](weighted-choice.md).

## Timed contribution checkpoint candidate (2026-10-09)

The existing capabilities owner now exposes separate portable checkpoint/restore.
Configured base and bounds, saved time and ordered contributions validate before a
single modifier transaction; successful load retires old runtime handles. Seven
focused new tests exercise continuation, malformed/overflow atomicity, safe batch
aggregation and real SaveStore failed-write recovery. See
[timed contribution continuation](timed-effects.md#portable-continuation).
This is a local candidate pending independent review and complete integration CI;
no whole action-session persistence or device-performance acceptance is implied.

## Recurring phase lab candidate (2026-10-09)

The [unexported recurring phase lab](../../tools/recurring-lab/README.md) tests
explicit skip/coalesce/bounded-replay policies while reusing the existing clock
and SaveStore. Thirteen headless tests cover two consumer projections, pause,
mid-period reload, large jumps, stale callbacks, reentry and failed durability.
It is a composition experiment, not a public scheduler or whole-game persistence
claim. Callbacks stage state without storage writes; explicit host save boundaries flush.
Production integration still needs coordinated clock/consumer restore, full CI and creator acceptance.

### Integrated ownership helpers and continuation candidates — 2026-10-09

[PR #197](https://github.com/Akilleez-QA/foundation-engine/pull/197) integrated
assignments, itineraries, planar alignment and development acceptance reporting
at main commit `5b26285da7ba1f75fef5bf3c47df115331da8b69`.
[Full candidate CI](https://github.com/Akilleez-QA/foundation-engine/actions/runs/37886326403)
passed on reviewed head `e10f0ef54535a737455757c9366a78f76b4bf2db`.
This supersedes earlier entries' “not integrated” status for that batch only;
it does not add concrete-game or physical-device acceptance.

The follow-up condition and recurring-phase experiments remain unexported.
They compose existing equipment/modifier/save and clock/save owners respectively.
Separate agent reviews and thirteen focused tests per experiment passed.
The combined follow-up candidate also retains real-owner regressions for failed
scene preflight and queued action delivery. These exercise headless ownership
boundaries; production scene wiring and physical resource reclamation are not
certified. Full CI on the combined candidate remains required before integration.

### Integrated continuation and diagnostic boundary fixes — 2026-10-09

[PR #213](https://github.com/Akilleez-QA/foundation-engine/pull/213) integrated
the unexported condition and recurring-phase compositions, shared dependency
preflight ownership regression, and queued action-delivery regression at main
`0a873d2070fecf605c25e0f9b98dee0f4a5f26d7`.
[Candidate CI](https://github.com/Akilleez-QA/foundation-engine/actions/runs/37889789566)
completed successfully on `1961cc0638cf76385aa17f50b61700ff64c78517`.
This closes the earlier integration-pending status for that batch, not its
concrete-game or physical-device acceptance questions.

[PR #218](https://github.com/Akilleez-QA/foundation-engine/pull/218) integrated
frame identity and adapter caching, camera reset admission, decoder retirement
accounting, replay numeric validation and script observation matching at main
`0214411f89badbefabc16712039967b7799fc37a`.
[Candidate CI](https://github.com/Akilleez-QA/foundation-engine/actions/runs/37891867717)
completed successfully on `1cfece534241c563be5ebc6f2ffffcfc8dc16db8`.
The combined candidate preserved the independently reviewed component files and
passed 331 affected tests locally. Decoder admission and retained-byte accounting
do not establish a browser native-heap ceiling.

These receipts cover those merged batches only. Resource-observation failure
reporting is a subsequent candidate; further source coverage, application wiring,
device experience and physical reclamation evidence remain separate obligations.


## Fixed-step numeric admission candidate (2026-10-09)

The existing core runner now rejects nonfinite configuration/frame inputs and unsafe
step-count or frame/step/drop-counter arithmetic before frame work. Zero step budgets
remain valid; finite negative deltas retain their fixed-lane clamp and presentation
value. Step-relative tolerance replaces the absolute seconds tolerance, preventing
phantom ticks for tiny steps. See [the system recipe](../recipes/add-a-system.md#core-runner-numeric-boundary).
Targeted tests cover ordinary30/60/144Hz, tiny/subnormal steps, zero budgets, retained
phase after refusal and overflow. This is a numeric-boundary candidate, not full
engine, browser or physical-device acceptance; hosted integration remains required.

### Resource-observation failure reporting integrated — 2026-10-09

[PR #219](https://github.com/Akilleez-QA/foundation-engine/pull/219) integrated
resource capture rejection and script, snapshot, and batch failure evidence at main
`6dfbcf944098afe96daf79e468decda1516102eb`.
[Candidate CI](https://github.com/Akilleez-QA/foundation-engine/actions/runs/37893991051)
completed successfully on `82bb981bf927dc038025cb916da516ba3005415f`.
This closes the earlier resource-observation integration-pending statement.
Failed capture stops the affected script; incomplete snapshots retain partial
evidence; report-write failures retain prior causes and the in-memory report.
This receipt does not certify every diagnostic caller, physical-device behavior,
or completion of the wider engine work. The fixed-step numeric candidate above
still requires CI on its combined head after integration with this base.


## Optional shared-session liveness — reconciled candidate (2026-10-09)

Branch `feat/session-liveness-reconcile`, baseline `6dfbcf944098afe96daf79e468decda1516102eb`.
Existing session/retry/transport/view owners provide opt-in paired deadlines and
unchanged-world view refresh; default behavior remains unchanged. The contract
distinguishes processing-time progress from simulation advancement and action delivery.

Initial focused run: 33 unit and real loopback tests passed. After adding the
single-capture configuration regression and adapting historical tests to current
strict typing, `npm run check` passed: typecheck, applicable lints and all 198
affected tests in 13 files, including the real loopback and CLI tests. The loopback test
stops the existing host pump while the socket stays open, observes timeout and
confirmed-state rollback, then reconnects after old-peer retirement without
resending its uncertain action. Independent review and full hosted integration CI
are pending. No new browser,
WAN, physical-device, scalability or full-CI acceptance is claimed.


## Editable-focus keyboard retirement candidate (2026-10-09)

The existing document input bridge selectively retires prior non-inText keyboard
work when editable focus begins, including queued actions and reentrant press
completion. Explicit text actions and non-keyboard sources retain their policies;
no new owner or global cancellation is introduced. See the input README for
recovery and focus-event limitations. Dispatcher and bridge regressions cover
selectivity, stale repeats, fresh presses and listener retirement. This is a
candidate; full hosted integration and physical-device acceptance remain separate.


## Atomic cell batches and occupancy candidate (2026-10-09)

Optional procgen batch edits and immutable spatial point/rectangle/segment queries
reuse existing storage and lifetime owners. See [contract and evidence](cell-occupancy.md)
and ADR0085. Configured limits and exact contact ordering are runtime contracts;
focused geometric, persistence and consumer tests are candidate evidence. Hosted
full CI, browser/GPU and physical-device acceptance are not established here.
No new scheduler, material policy or whole-engine completion claim.


## Shared navigation distance-field candidate (2026-10-09)

The optional navigation helper prepares immutable multi-goal distances and acyclic
next hops over existing directed weighted graphs. Reverse adjacency, search and
output publication are incrementally budgeted; graph admission and storage setup
remain explicit synchronous preparation. It installs no scheduler or movement
policy. Independent integer-graph oracles and two activity-lifetime compositions
exercise cancellation and stale publication; floating accumulation order is
documented separately from forward route parity. See the navigation README.
Full hosted integration and physical-performance acceptance remain separate.


## Ordinary image mip accounting correction — candidate (2026-10-09)

Ordinary 2D image estimates now sum the full RGBA8 mip chain using integer
dimensions with independent axis clamping. Thin images no longer use the
undercharging four-thirds approximation. The existing model owner refuses an
over-budget thin image, retires its resources, and permits a valid retry.
Compressed accounting is unchanged; no-mip images retain conservative full-chain
charging. Cube, array, volume, authored mip and non-RGBA8 descriptor support remain
explicit accounting limitations. See [asset residency](asset-residency.md).
`npm run check -- --base origin/main` passed all applicable checks and 164 tests
in 18 asset test files. The independent dimension oracle covers 1517 shapes,
plus explicit thin/square/odd anchors and model refusal/retry. Independent review
and full hosted integration remain pending; no physical memory or device evidence
is implied.


## Common texture descriptor accounting — candidate (2026-10-09)

The existing byte estimator now forecasts full logical mip chains for common
R/RG/RGBA unsigned-byte, half-float and float descriptors, including valid cubes,
fixed array layers and shrinking volume depth. Existing model admission and
cleanup own refusal and retry; budgets are unchanged. Unsupported descriptors
retain compatibility fallback and remain an explicit accounting gap. See
[asset residency](asset-residency.md). Headless arithmetic and model lifecycle
regressions cover the corrected domain; physical allocation and device acceptance
are unverified. Independent review and hosted integration remain pending.

## Contact kit — candidate (2026-10-09)

- **Scope:** `src/kits/contact` (ADR 0100).
- **Evidence:** `contact.test.ts` covers the lifecycle, sensing, exact shapes, exits, bounded admission, ordering, snapshots and a pickup consumer that removes bodies during dispatch.
- **Not established:** template or browser consumers and hosted CI.

## Optional bounded work roster candidate

The [work roster](../../src/kits/work-roster/README.md) supplies finite admission, fair
visit batches and exact registration membership, with no scheduler or payload owner.
Two headless consumers use the existing fixed runner for World observations and
revision-checked inspections. An independent array model covers 10,000 churn operations.
These are candidate headless contracts; hosted combined CI and physical-device
timing/native-memory acceptance are not implied. Creator result revisions and
consumer cleanup remain explicit; runtime tickets are not saved. See ADR 0086.

## Shared-stage retirement recovery — candidate (2026-10-09)

The existing stage pool now retires logical view ownership despite cleanup errors
and rolls back failed setup. Cleanup preserves original causes and still attempts
independent retirement work. Surviving sibling leases are not swept or forced lost;
only a failed release cleanup makes a slot uncertain, and an uncertain slot refuses
new sharing until its last sibling leaves. A new lease makes the drawing view reset
its GL state cache. Borrowed canvas attachment rollback and once-only underlying
renderer disposal are exercised.
See [render backend](render-backend.md#stage-setup-and-retirement-failures).
Independent review fixed over-broad uncertainty after clean setup rollback and a
stale drawer state cache after new leases; both have discriminating tests that fail
before the fix. `npm run check -- --base cbaf8060` passed typecheck, applicable lints
and 241 tests in 30 render test files.
Full hosted integration remains pending. Logical cleanup is not proof
of successful GPU reclamation or physical-device acceptance.

## World query iteration under mutation — candidate (2026-10-09)

- **Scope:** owner repair of `World.query` in `src/core/ecs/world.ts`. Before: a single-component query yielded
  `[entity, undefined]` after an earlier row despawned the entity or removed its component; a multi-component query
  did the same when the removed component was in the smallest store; an entity gaining a component mid-pass was
  visited or not depending on store sizes; the untyped query visited entities spawned mid-pass.
- **Contract:** candidates are fixed when iteration begins; each is yielded only if it still has every listed
  component when reached, with its current values. Spawned or newly matching entities wait for the next query.
- **Evidence:** `src/core/ecs/query-iteration.test.ts` (8 cases: despawn and removal before, at and after the cursor
  for one and two components, re-add before reach, spawn and gain mid-pass, untyped query); 5 fail on the previous
  implementation, all pass on the candidate. Local Node microbenchmark, 10,000 entities: typed queries no slower,
  untyped query within run-to-run noise. Not a frame-budget or device claim.
- **Not established:** template or browser frame measurements; hosted CI.

## Finished one-shot model clip stillness — candidate (2026-10-09)

- **Scope:** owner repair in `src/author/scene-model.ts` clip sync. A `loop: false` clip clamped at its end was
  un-paused by every sync while `playing` was `true`, re-finished, and made `sync` report a change every frame.
- **Evidence:** `src/author/scene-model.test.ts` "a finished one-shot clip holds its last pose…" fails on the
  previous implementation (sync keeps returning `true`) and passes on the candidate; a looping-clip case confirms
  playing loops still report change and paused models do not. Headless Three mixer, not a browser frame trace.
- **Not established:** browser redraw counts in a template scene; hosted CI.

## Rewind history — REWIND-01 candidate, 2026-10-09

[Contract](../../src/kits/rewind/README.md), [guide](rewind-history.md), [decision](../adr/0087-rewind-history.md). Optional pure per-subject sample rings with time-addressed, never-extrapolating queries that respect creator-marked discontinuities, plus a pure time choice that clamps an untrusted claimed view time to a creator cap. Hosts record from their existing fixed step and query from existing command dispatch; nothing moves or restores live state. Evidence: 17 focused headless tests including a composition with `@kits/combat` `sweep`, and one local micro-measurement. Candidate only; latency estimation, protocol, multiplayer, browser and physical-device acceptance and full CI are not claimed here.

## View deltas — NW-DELTA candidate, 2026-10-09

[Contract](../../src/kits/network/README.md#optional-acknowledged-baseline-view-deltas), [guide](network-views.md#optional-acknowledged-baseline-deltas), [decision](../adr/0088-view-deltas.md). Optional encoder/decoder around the existing complete-view publisher and receiver: entity-level deltas against the last acknowledged adopted frame, each proven to rebuild the publisher's exact bytes before it is sent, with complete-frame fallback and `adopted: false` recovery. Evidence: 14 focused headless tests with a real publisher and receiver, hostile frames, and one local length measurement (9.1 % of complete length at 4 of 64 entities changing). Candidate only; WAN, browser, physical-device and full-CI acceptance are not claimed here.

## Model clip transitions — candidate (2026-10-09)

Branch `feat/model-clip-transition` from `db1f7a85`. `npm run check` passed: typecheck,
format, lints and 380 affected tests, including ten new
`scene-model-transition` tests (default cut unchanged, continuity on the switching
frame and smoothstep progress for position and scale, a node only the old clip drove
easing back and not left part-way after an interrupting switch, same-clip revision
restart, completion while playback is paused with redraws reported only while moving,
a cut in the middle of a transition, despawn mid-transition, pose overrides over a
blend, unknown-clip and validation refusal, node-budget cut with one report) and the
existing 21 scene model tests. An independent adversarial review found no blend,
restore or buffer defect; its findings (a paused model never reaching a new pose,
undocumented override and object-path limits, an unexported bound) were fixed before
publication.
Evidence is headless; no browser, visual-quality, physical-device or full-CI
acceptance is claimed. Morph-target and material tracks still cut.

## Camera support framing — candidate (2026-10-09)

Branch `feat/camera-support-anchor` from `db1f7a85`. Ten new `support.test.ts` scene
tests (unchanged poses without a query, jumps over level support leaving position
and target exactly still, no camera rewrite under a still non-zero support, weights and
limit including falls beyond the limit, null support and query arguments, orbit plus
smoothing convergence, fixed camera with and without tracking, a support change easing
instead of reading as a teleport, a failing query keeping a reset pending, construction
and per-frame refusal without publication) and the existing camera tests pass under
`npm run check`. An independent adversarial review found a fixed-camera look target
moved without tracking, support changes triggering teleport snaps and floating-point
redraw churn; all three were fixed before publication. Evidence is headless; no
browser, visual-quality, physical-device or full-CI acceptance is claimed.

## Optional action phases — candidate (2026-10-09)

- **Scope:** pure `createActionPhases` in `src/kits/capabilities/action-phases.ts`, exported through the
  capabilities barrel and feature `CAP-ACTION-PHASES`.
- **Evidence:** `src/kits/capabilities/action-phases.test.ts` (11 headless tests). They cover boundaries,
  jumps, claims, suppression, capture, the 32-bit bound, single-read state validation, definition
  fingerprints, unreachable-state rejection, per-request cancel windows and an input-history and
  `resolveAction` composition with restored-state replay. The focused `npm run check` passed.
- **Review:** an independent adversarial review found two major issues: positional bits were
  reinterpreted after a definition edit, and there was no way to read a range identity without
  claiming it. It also found minor issues: fields were read twice, error types were inconsistent,
  overlapping ranges were accepted and unreachable restores were allowed. All were fixed in the
  same candidate, and a re-review approved them. That re-review included a 2,000-sequence fuzz showing
  that reachable states always restore.
- **Not established:** browser, template, device, persistence-integration or multiplayer acceptance;
  hosted CI on the candidate head; integration into `main`.

## Optional bounded volume queries — candidate (2026-10-09)

The [volume query kit](../../src/kits/volume-query/README.md) answers overlap,
fixed-orientation sweep and capsule headroom for a sphere or capsule body against
an immutable snapshot of static spheres, capsules and oriented boxes. It installs
no physics world, controller, clock or dependency; results carry the creator's
snapshot revision and existing owners (portal crossing, alignment, camera
obstruction, creator systems) apply effects. Evaluation and iteration ceilings
report `over-budget` or `unresolved`, never clear. Evidence is headless: sampled
and closed-form oracles, ray/endpoint/centre-ray discriminators, a portal consumer
and a fixed-runner body-height consumer. Meshes, heightfields, moving colliders,
rotation during motion, depenetration and device timing are not covered. Independent
review found and fixed two defects (PR #237, head before this note `7c9680ab`); affected
check passed 18 tests. Full hosted CI remains required. See ADR 0098.

## Optional cue sequences — candidate (2026-10-09)

Branch `feat/sequence-kit` from `cbaf8060`. Twelve checked-in headless tests. An
independent adversarial review also fuzzed about 30,000 runs against its own reference
model in an external harness that is not checked in; its findings (effect-id
collisions across definitions, session handling at reload, a `settled` signal for
budget-stopped work, single-read array copies, documentation) were fixed and a
re-review of the fixed head was clean. The checked-in tests cover: parallel tracks,
cross-track barriers and held cues with exact ticks; one large advance equal to
many small ones and to a one-transition budget (identical event order, owed ticks
drained); skip landing each remaining gameplay effect once, dropping presentation
effects and producing no presentation events, refused when not skippable; cancel;
a budget-stopped snapshot restored through JSON to the same future; refusal of an
edited definition, another session and twelve forged or inconsistent states;
definition validation and isolation; a real save store round trip across a fresh
store composed with the dialogue kit; and a scene in which a fixed-step system
drives the sequence, the camera kit follows cue alpha and the audio-mixer plays a
cue once, with skip landing the effect and playing nothing; unambiguous effect ids,
the `settled` signal and -0 normalisation; and arrays copied without iteration. No
browser, device or template evidence.

## Sequence cast, branches and arbitration — candidate (2026-10-09)

Branch `feat/sequence-extensions` from the #249 head `b58a0f02`. Seven new headless tests:
cast binding, refusal, channel ownership, settle-aware freeze and release; an ECS
consumer whose bystander is frozen while the cast member is driven; branch offer,
choose and abandonment of later effects; graph snapshots mid-node and at a branch,
skip following defaults and landing only what choosing would have; graph validation
and step-bounded loops that end with `limited`; and arbiter priority, held refusals,
stale release and cooldown; plus settle-gated offers and single finish on a directly
released branch cue. An independent adversarial review (external 3,000-graph fuzz, not
checked in) found no duplicate effect but found wedging at the step bound, prototype
names accepted as defaults, an overstated skip claim, unsettled offers, re-reads and
documentation gaps; all were fixed, and a re-review with a 3,000-graph fuzz was clean.
The 12 #249 tests still pass. No browser or device evidence.

## Optional population kit — candidate (2026-10-09)

Branch `feat/population-kit` from `cbaf8060`. Eleven checked-in headless tests. An
independent adversarial review also fuzzed placements (300 seeds against a reference
model) and tiers in an external harness that is not checked in; its findings (time
dropped when `dt × slots` exceeded the catch-up cap, half-applied steps after a
throwing callback, default exit radius above the bound, sparse definitions, status
after dispose, undocumented cost and ordering) were fixed, and a re-review of the fixed head (placement
fuzz plus 300-seed tier fuzz with varying steps) was clean. Tests: spawn/despawn
with enter/exit hysteresis in definition order; `never`/`visit`/`leave` policies,
persistence of `never` only and revival; deterministic caps with deferred counts
and retry after `returned`; validation of definitions, limits, observers and
forged or edited snapshots; an ECS consumer spawning and removing entities from
intents with depletion surviving a real save store reload; update tiers for
always/near/background with conserved background time, hysteresis, owed-time
delivery and refusal of oversized steps, unchanged state after a throwing callback,
slot balance and limits; sparse definitions, bounded default exit and dispose; and a fixed-step runner consumer
integrating only due entities. No browser, device or performance acceptance.

## Optional region activation candidate — ACTIVATION-01, 2026-10-09

`@kits/region-activation` is an independently implemented pure helper that decides which uniform grid regions a game simulates from observer positions. It provides activate/release radius hysteresis, update-count linger with cancel-on-return, refcounted pins, per-update activation (nearest first) and deactivation budgets, a hard `maxActive` refusal, per-region epochs for refusing stale asynchronous loads and `dormantFor` for creator catch-up rules. ECS systems, the chunk store and worker host keep their responsibilities; no loader, scheduler, persistence or registration is added. [Guide](region-activation.md), [ADR 0095](../adr/0095-optional-region-activation.md).

Evidence: 13 focused headless tests (11 unit tests including a 3,000-step brute-force model comparison asserting statuses and counters and 2,000 non-dyadic boundary-geometry trials, plus an ECS fixed-step gating consumer and a chunk-store load/save consumer with epoch refusal). An independent adversarial review found an off-grid query crash, boundary rounding in the scan range, unasserted statuses and index-ordered deactivation starvation; all were fixed with regression tests before publication. A local headless micro-measurement is recorded in the kit README as an order-of-magnitude indication only. This is a branch candidate: hosted full CI, a playable template consumer, browser behaviour and physical-device acceptance remain pending.

## Optional update cadence candidate — CADENCE-01, 2026-10-09

`@kits/cadence` is an independently implemented pure helper that runs members at their own integer periods on the caller's tick. It spreads start phases by id (or explicit phase), returns at most `maxDuePerTake` due members earliest-due-first with elapsed and lateness ticks, defers the rest instead of dropping them, reschedules on each member's phase grid without burst catch-up, and offers JSON-safe snapshot/restore. The fixed-step runner, clock and interest sets keep their responsibilities; no clock, callback, persistence owner or registration is added. [Guide](update-cadence.md), [ADR 0096](../adr/0096-optional-update-cadence.md).

Evidence: 10 focused headless tests (8 unit tests including a 4,000-step comparison with an independent enumeration model with large gaps and mid-run snapshot round trips, plus an ECS fixed-step consumer with distance-banded periods and an interest-set refresh consumer). An independent adversarial review found that period changes discarded the phase spread, plus result-buffer aliasing, tick overflow near 2^53 and weak snapshot invariants; all were fixed with regression tests before publication. A local headless micro-measurement is recorded in the kit README as an order-of-magnitude indication only. This is a branch candidate: hosted full CI, a playable template consumer, browser behaviour and physical-device acceptance remain pending.

## Optional render interpolation — candidate (2026-10-09)

- **Scope:** `src/author/interpolation.ts` adds the `Interpolated` component, `presentTransform` and
  `presentedTransform`, and `ctx.time.alpha`. Runtime capture runs in the runner's `beforeStep`. Shape,
  Mesh and Model drawing and `cameraSystem` use the drawn pose for opted-in entities. This is the "next
  slice" named for MV-02.
- **Evidence:** `src/author/interpolation.test.ts` and `src/kits/camera/interpolation.test.ts`. They show
  uniform per-frame motion at 144 Hz against whole-step jumps without opt-in, a lag under one step,
  revision snapping, the ±π seam and the camera following the drawn pose. Entities that do not opt in
  are unchanged.
- **Browser smoke (local, not committed):** the arcade template's ball and blocks were temporarily opted in
  and run through `play:snap`. It reported no page errors, rendered while moving, and stayed within the
  budget (5 draws, 761 triangles). Headless Chromium runs at 60 Hz, so `alpha` stays near 0. This shows
  the runtime paths run; it does not show smoothness.
- **Review:** the independent review found one major issue (point and spot lights were drawn at the latest
  step) and several minor ones: the alpha contract in fixed systems, camera snapping guidance, negative
  revision aliasing, and the dev teleport tool. All are fixed or documented.
- **Not established:** physical high-refresh displays, template adoption and hosted CI.

## Remote playout — PLAYOUT-01 candidate, 2026-10-09

[Contract](../../src/kits/playout/README.md), [guide](remote-playout.md), [decision](../adr/0093-remote-playout.md). Optional pure clock-offset estimation (minimum round trip in a bounded window, bounded slew, snap threshold) and per-subject playout buffers that present authoritative views behind the estimated clock with an adaptive bounded delay, interpolation, capped extrapolation, discontinuity holds and non-decreasing render time. Evidence: eight focused headless tests including a 20-second jittered composition with the real view receiver (presented error below 1e-14, per-frame step deviation 1.1 ms of motion against 84 ms when presenting the newest view). Candidate only; protocol, WAN, browser, physical-device and full-CI acceptance are not claimed here.

## Optional entity pool candidate — POOL-01, 2026-10-09

`@kits/entity-pool` is an independently implemented pure helper that keeps pooled members under a creator member-count and cost cap. Creator classes carry a priority, cost, class cap and eviction order (oldest, newest, lowest score); only `evictable` classes lose members, and only to higher-priority requests, lowest priority first; `replaceOwn` lets a class recycle its own members. Admission is atomic with a bounded eviction plan and reported refusals (`class-full`, `capacity`, `eviction-limit`); pins protect members; `sweep` recovers members destroyed elsewhere. A `World` adapter spawns only on admission, despawns evicted entities and emits one world event per eviction. No system, clock, persistence owner or registration is added; placement memory across saves stays with its owner. [Guide](entity-pool.md), [ADR 0100](../adr/0100-optional-entity-pool-eviction-classes.md).

Evidence: 10 focused headless tests (8 unit tests including a 6,000-operation comparison with an independent one-victim-at-a-time model with give-back covering every refusal reason, plus a World fixed-step consumer under a triangle-cost cap with eviction events and an owner-recovery consumer). An independent adversarial review found re-entrant `sweep` corruption, unbounded sweep rescans, over-eviction of cheap classes, eager per-class heap memory and smaller validation gaps; all were fixed with regression tests before publication. A local headless micro-measurement is recorded in the kit README as an order-of-magnitude indication only. This is a branch candidate: hosted full CI, a playable template consumer, browser behaviour and physical-device acceptance remain pending.

## Replication schedule — REPL-01 candidate, 2026-10-09

[Contract](../../src/kits/replication/README.md), [guide](replication-schedule.md), [decision](../adr/0094-replication-schedule.md). Optional quantized field schema, per-recipient byte-budgeted packets (removals, creations, field-mask updates) ranked in one queue by accumulated weighted priority with per-entry minimum interval, per-recipient epochs, loss/acknowledgment recovery, and an order-safe replica with tombstones. Addresses the interest sets limits (starvation rotation, per-entity cadence, delta encoding). Evidence: thirteen focused headless tests including a lossy, duplicating, reordering composition with interest sets that converges exactly and a randomized 40-seed convergence test (52,771 vs 557,712 characters for complete views of the same sets). Candidate only; transport, WAN, browser, physical-device and full-CI acceptance are not claimed here.

## Look-at constraint — candidate (2026-10-09)

Branch `feat/look-at-constraint` from `a6211bd3`. Nine headless tests: exact aim of the
composed chain and share split; limits with overflow; a 500-chain random check that
joint parts add up to the clamped aim; no yaw flip behind or straight above; exact aim
of a three-joint hierarchy with rest-derived parent frames; front-cone, null and
zero-length relaxation with smoothing and the speed cap; parent-frame conjugation and
composition through `blendPoseLayers`; single-read limits and `apply` refusals; and
validation. An independent adversarial review found lost residual turn, a yaw flip
behind the root, double reads and loose `apply` input; all were fixed and a re-review
with an external 5,000-chain fuzz (not checked in) was clean. No visual, browser or device evidence.

## Camera director — candidate (2026-10-09)

Branch `feat/camera-director` from `a6211bd3`. Eight new headless tests: ladder order,
stickiness and yawed boxes; string rig band clamping and blending; rail, close-up and
orbit shot poses; transition sizing, deceleration and exact arrival on a moving goal;
support carry; letterbox easing; and a scene where the director system blends into a
volume's setting, stops rewriting at rest and returns from a scripted override to the
live gameplay pose; plus per-world stickiness, carry about the pre-move pivot,
validation and frozen poses. An independent adversarial review found shared sticky
state across worlds, a wrong default carry pivot, unvalidated heading, overstated
docs, mutable returned poses and rare ulp redraws; all were fixed and the re-review was
clean. No browser,
visual or device evidence.

## Audio extras — candidate (2026-10-09)

- **Scope:**
  - `ctx.view.listener` (author view and runtime listener sync);
  - `CueVoice.setRate` (platform output);
  - in `@kits/audio-mixer`: `blendListener`, `dopplerRate`, `createRetrigger`, `createInstanceLimits`,
    `createMusicClock` and `createMusicDirector` (ADR 0153).
- **Evidence:** `src/kits/audio-mixer/extras.test.ts` and the `setRate` test in `src/platform/audio/spatial.test.ts`.
- **Not established:** a browser listening test of the listener override and rate ramps, device evidence, and hosted CI.

## Data-defined formulas (FORMULA-01) — candidate, 2026-10-09

Optional `formulas` kit ([contract](../../src/kits/formulas/README.md), [ADR 0124](../adr/0124-data-defined-formulas.md)): validated JSON/text expressions, ordered sheets, stacking stages and a damage model; deterministic arithmetic and caller-supplied randomness. Evidence: eleven focused headless tests (parsing, refusal, ordering, seeded/restored streams, stacking, damage pipeline, 2,000-case named-preset transcription check, review-hardening cases); one independent adversarial review with its findings addressed. Candidate only; no game integration, browser, full CI or device acceptance claimed.


## Formula data import candidate — FORMULA-DATA-01, 2026-10-09

`npm run formulas:import` and the formulas kit's `parseDelimited`, `importFormulaSheet`, `importFormulaTable`, `defineFormulaTable`, `tableValue` and `tableRow` turn spreadsheet exports into committed formula sheets, keyed tables and matrices with attributable `meta`; loading runs the same checks, and refusals name the spreadsheet row. Stacked on the formulas kit candidate (ADR 0124). [Kit README](../../src/kits/formulas/README.md#importing-spreadsheet-data), [ADR 0135](../adr/0135-formula-data-import.md).

Evidence: focused headless tests (RFC 4180 parsing, sheet import equal to the hand-written sheet, row-named refusals, tables feeding sheet inputs, matrices, re-validation of committed JSON, the command's output loading in the kit). An independent adversarial review found nine issues (a silent no-op CLI under paths with spaces, row attribution errors, quadratic refusal search, unsnapshotted table arrays, unchecked limits and meta, quote/whitespace and cell-length handling, decoding and flag parsing); each is fixed with a regression test. Hosted full CI and a game consumer remain pending.

## Status effects (STATUS-01) — candidate, 2026-10-09

Optional `status` kit ([contract](../../src/kits/status/README.md), [ADR 0125](../adr/0125-status-effects.md)): stacks, fixed-clock durations, decay, periodic pulses, threshold transforms/triggers, exclusive groups, immunities, snapshot/restore. Evidence: twelve focused headless tests in `src/kits/status/status.test.ts`; an independent adversarial review (5 major, 9 minor, 3 nits) whose findings were addressed in the second commit (transform dry-run, bounds parity between live state and restore, sealed rules, partial-loss events, advance without copying, restore expiry bounds, reserved after-immunity keys). Candidate only; no game integration, browser, full CI or device acceptance claimed.

## Behaviour trees (BT-01) — candidate, 2026-10-09

Optional `behavior` kit ([contract](../../src/kits/behavior/README.md), [ADR 0122](../adr/0122-behaviour-trees.md)): data trees, bounded deterministic tick, blackboard, decorators, resume and abort, validated snapshots, trace. Evidence: eleven focused headless tests in `src/kits/behavior/behavior.test.ts`; an independent adversarial review (2 major, 6 minor, 5 nits) whose findings were addressed in the second commit (abort handlers after commit, restore accepts only reachable states, cooldown length, parallel early decision, live contexts, guarded reads). Candidate only; no game integration, browser, full CI or device acceptance claimed.

## Flow economy and production (ECON-01) — candidate, 2026-10-09

Optional `economy` kit ([contract](../../src/kits/economy/README.md), [ADR 0123](../adr/0123-flow-economy-and-production.md)): integer stock and storage, income/upkeep, upfront or streamed production queues with prerequisites, refunds, reclaim pools, validated snapshots. Evidence: nine focused headless tests in `src/kits/economy/economy.test.ts`; an independent adversarial review (1 blocker, 3 major, 4 minor, 3 nits) whose findings were addressed in the second commit (reclaimers released mid-tick, unlock bounds that cannot fail during a tick, reserved ids, cached capacities, refreshed queue states, exact slowdown comparison). Candidate only; no game integration, browser, full CI or device acceptance claimed.

## Inventory rule presets (INV-RULES-01) — candidate, 2026-10-09

Inventory kit extension ([contract](../../src/kits/inventory/README.md#optional-slot-stack-and-key-item-rules), [ADR 0126](../adr/0126-inventory-rule-presets.md)): slots, stack sizes with spill, key items, ownership caps and placement checked before the existing ledger applies an operation; ledger `contents(container)` read. Evidence: six focused headless tests in `src/kits/inventory/rules.test.ts`; an independent adversarial review (1 blocker, 4 major, 5 minor, 3 nits) whose findings were addressed in the second commit (idempotent retries, key items through reservations, commit projection, content-independent capacities, preset described as an approximation, reserved names). Candidate only; no game integration, browser, full CI or device acceptance claimed.

## Ballistics kit — candidate (2026-10-09)

- **Scope:** `src/kits/ballistics`, pure solves and evaluation (ADR 0102).
- **Evidence:** `ballistics.test.ts` covers exact landing for every solve, the constraint of each mode, the 45-degree range boundary, vertical shots, unreachable cases, lead convergence and validation.

## Breadcrumbs kit — candidate (2026-10-09)

- **Scope:** `src/kits/breadcrumbs` (ADR 0103).
- **Evidence:** `breadcrumbs.test.ts` covers lag exactness, ring bounds, the moved policy, corner retracing, cuts, snapshots, validation, the lag controller and a `testScene` polyline-retracing consumer.
- **Not established:** template or browser consumers and hosted CI.

## Optional streaming queue candidate — STREAM-01, 2026-10-09

`@kits/streaming` is an independently implemented pure queue for play-time loads. Requests carry a creator priority and byte estimate and are counted per key; `pump(now)` publishes completions in start order, requeues due retries (deterministic backoff in caller ticks) and starts the highest-priority keys within `maxConcurrent` and `maxBytes` (estimates while loading, actual bytes when ready), with head-of-line blocking and optional preemption of lower-priority loads. Cancellation releases values and aborts loads while holding their slot and charge until execution settles. Ports compose with existing owners: `leasePort` (lease caches and their residency measure), `promisePort` (worker jobs, fetches) and `modelPort` (the scene model owner through hidden `Model` entities and `modelState`). No system, loader, cache, worker or registration is added. [Guide](streaming-queue.md), [ADR 0130](../adr/0130-optional-streaming-queue.md).

Evidence: 15 focused headless tests (11 unit tests including a randomised run asserting budgets every tick, release-exactly-once and same-seed event replay; 4 consumers: a real `LeaseCache`, a fixed-step model-owner consumer with simulated owner state, promise cancellation, a throwing late release). An independent adversarial review found a slot held forever by a throwing late release, preemption that cancelled loads without freeing enough capacity, permanent failure of over-estimate values under temporary pressure, preemption exceeding the entry table, quadratic bulk cancellation (now bounded by a per-key request cap), unbounded requeues and adapter settlement wording; all were fixed with regression tests or documented. Port settlement means the owner rejected delivery; work an owner keeps running is bounded by that owner. A local micro-measurement is recorded in the kit README as an order-of-magnitude indication only. Animation clips stream only as the model assets that carry them. This is a branch candidate: hosted full CI, a playable template consumer, browser load timing and physical-device acceptance remain pending.

## Worker render pipelining finding — PIPELINE-01, 2026-10-10

Worker render pipelining is not built, by decision. A GPU bench of the showcase template at 3840×2160 (RTX 4080, ANGLE, Chromium 141, `a6211bd3`) measured a mean 0.35–0.64 ms of main-thread task time per drawn frame (including the bench's own instrumentation), with every window display-paced at a 16.7–16.8 ms p95; GPU work already runs in Chromium's GPU process. Pipelining through a worker renderer could hide at most that time while moving nearly every render owner. [Verification](../verification/render-pipelining-20261010/README.md), [ADR 0131](../adr/0131-defer-worker-render-pipelining.md). Unmeasured: phones, tablets, thermal behaviour, WebGPU. The revisit condition is physical-device main-thread work above about half the frame interval with GPU headroom, with a trace (the bench has no submission split today) showing submission or sync dominant.

## Optional retro look candidate — RETRO-01, 2026-10-10

`@kits/retro` is an independently implemented render override on `@kits/three`: the scene is drawn into a low-resolution viewport of the canvas (engine tone mapping, output encoding and main-pass accounting kept), copied into a texture, and one full-screen triangle applies an ordered Bayer dither and quantises to a creator palette (nearest 3D lookup table) or per-channel levels. Optional wide pixels give the column look. It replaces built-in post on its scene and is not a quality knob. [Guide](retro-look.md), [ADR 0132](../adr/0132-optional-retro-look.md), [verification](../verification/retro-look-20261010/README.md).

Evidence: 9 headless tests (CPU reference arithmetic, lookup table against brute force, the override's draw sequence, ownership and state restoration), software-GL `play:snap` of the showcase courtyard with the look at desktop and emulated phone viewports (within its budgets), a GPU bench at 4K (one extra draw, no post draws; display-paced, GPU time not measured) and an independent reviewer's uncommitted pixel-by-pixel shader-versus-reference comparison in software GL (nine configurations, zero mismatches). The review also found a table leak on palette changes, unrestored state after a throwing draw, an unused post target when a scene keeps `view.post`, and reversed `pixelAspect` wording; all fixed or documented. No quality-guard comparison. The scene change was measurement-only. WebGL2 only; no phone, tablet or physical-device acceptance; no template consumer.


## Offline format converters candidate — ASSET-CONVERT, 2026-10-09

`npm run convert` (`tools/convert/`) is an independently implemented offline toolchain: OBJ/MTL, PLY and BVH (bone-map retargeting that folds unmapped joints) to GLB, and PCX, BMP and raw palette images to indexed or RGBA PNG. Each conversion writes a provenance receipt (output and input hashes, tool, options) that `lint:provenance` accepts; failures write nothing. The runtime model loader is unchanged. [README](../../tools/convert/README.md), [ADR 0133](../adr/0133-offline-format-converters.md).

Evidence: focused headless tests compare OBJ, PLY and BVH results with three.js's own loaders as oracles, check folded joints keep world positions, check palette and index preservation for PCX/BMP/RLE8, validate every GLB with the glTF validator and GLTFLoader, and run a converted file's receipt through the provenance check. An independent adversarial review found ten defects (including silently invalid GLBs, file embedding through `../` texture paths and memory amplification from small headers), each fixed with a regression test. This is a branch candidate: hosted full CI and review of real creator assets in a game remain pending; rest-pose retargeting is not implemented.


## Duplicate detector candidate — DUPES-01, 2026-10-09

`npm run dupes` (`tools/dupes/`) is an independently implemented read-only scan: exact duplicates with git blob ids, GLBs with identical mesh data (values, any layout), similar PNGs (128-bit difference hash) and similar text (MinHash with banding), over a game's `public/` folder, any paths, or across two trees. Unreadable or uncomparable content is skipped with a reason. [README](../../tools/dupes/README.md), [ADR 0134](../adr/0134-duplicate-detector.md).

Evidence: focused headless tests (blob ids equal `git hash-object`; geometry, image and text matches and non-matches; the PNG decoder against a real renderer; a decompression bomb refused; large families and look-alike images grouped within bounds; CLI statuses). An independent adversarial review found thirteen defects, each fixed with a regression test. A local run over the templates found seven exact groups (including textures shared by two templates) and eight similar-image groups. Not part of `npm run check`; hosted full CI pending.

## Camera director rigs — candidate (2026-10-09)

Branch `feat/camera-director-rigs` from the camera director head `8749f5bb`. Four
headless tests: look-ahead lead, catch-up on stop and on reversal; area hold, pan
timing from the on-screen pose and keeping the last area outside every area; eased
bounds with fast rate, snap, clamping and edges that never cross; and the rigs
composed as a director setting in a scene. An independent adversarial review found
the look-ahead's world speed was twice the documented bound; that is fixed with a
world-space chase and a test of the world focus speed. It also found sparse area lists,
non-object options, dead crossing code and naming drift, all fixed. No browser,
visual or device evidence.

## Optional car handling candidate — CAR-01, 2026-10-09

`@kits/car-handling` is an independently implemented pure controller with an optional fixed-step adapter. One rigid body on 2–8 ray-cast suspension corners against a creator ground port (`planeGround`, `sampledGround` over the terrain kit's `Surface.sample`, or the creator's own ray or sweep), with corner-frequency springs, slip-curve tyres inside a friction ellipse, speed curves for drive and steering, axle-biased brakes, a handbrake with timed grip recovery, drag, downforce, air control and levelling, optional body-corner contacts and an upside-down watch that reports or resets. Steps split into at most `limits.maxSubsteps` sub-steps (at most `(wheels + 8) × maxSubsteps` ground queries), commit only when finite and inside `limits.extent`, and leave the car unchanged on any throw. `math: 'deterministic'` uses `dmath`; `snapshot`/`restore` is JSON-exact and refused across configurations. The vehicles, control, camera, terrain and rollback kits keep their responsibilities; no registration, clock or collision owner is added. [README](../../src/kits/car-handling/README.md), [ADR 0140](../adr/0140-optional-car-handling.md).

Evidence: 29 focused headless tests (25 unit tests over both presets, creep, tunnelling, overhead decks, slope hold, refusal, bounds and bit-identical replay and snapshot round trips in both math modes; 4 consumer tests: ECS fixed-step adapter, terrain-kit sampled ramp, rollback kit sync test over 600 frames). An independent adversarial review found creep at rest from an incomplete stop-cap prediction, wheel-ray tunnelling in fast falls, accepted suspension tunings too stiff for the sub-step, a foot-brake share lost on an empty axle, permissive restores, silently dropped unknown fields, port state leaking through the hit record, re-entry, and overstated -0 and allocation claims; all were fixed with regression tests. A verification pass found that the first tunnelling fix lifted fast cars onto overhead decks, that the stability bound ignored pitch and roll, and that a port could hide a re-entry refusal; those were fixed too, with regression tests. A car on its roof counting as airborne and the presets' brake-to-reverse are documented limits. This is a branch candidate: hosted full CI, a playable template consumer, browser behaviour, driving feel and physical-device acceptance remain pending.


## Optional board traversal candidate — BOARD-01, 2026-10-09

`@kits/board-traversal` is an independently implemented pure controller with an optional fixed-step adapter. One rider in rolling, air, grind, manual or bail mode: discrete pushes, slope acceleration, resistance, brake and carving along the ground tangent; a step-up/step-down ground window and a launch rule from the vertical speed change a contact can absorb; charged ollies; an exact ballistic arc with board spin and a creator trick timer; landings judged by board-to-travel angle (clean, sketchy, switched, bail by angle, impact or unfinished trick); grinds on creator-authored `defineRails` snapshots (revisioned, segment-bounded, id-ordered) with a catch window, alignment, one-scalar balance, pop, end and drop exits and a re-catch delay; manuals with balance; bails with recovery. Ports per step: a one-way ground query (`sampledBoardGround` over the terrain kit's samples), rails and an optional wall slide (`characterSlide` over the character kit's walls and solids). At most `maxSubsteps` ground queries and `maxSubsteps × segments` rail checks per step; steps commit only when finite and inside `limits.extent` and leave the rider unchanged on any throw. `math: 'deterministic'` uses `dmath`; `snapshot`/`restore` is JSON-exact and refused across configurations. No registration, trick catalogue, scoring or camera is added. [README](../../src/kits/board-traversal/README.md), [ADR 0141](../adr/0141-optional-board-traversal.md).

Evidence: 25 focused headless tests (22 unit tests over both presets, landing judgement, rails, balance, manuals, kicker, slopes, walls, refusals, the work bound and bit-identical replay and snapshot round trips in both math modes; 3 consumer tests: ECS adapter with character-kit walls, terrain-kit sampled hill, rollback kit sync test over 900 frames through pushes, grinds, tricks and bails). An independent adversarial review found a plain ollie while riding switched judged as a switch with lost speed, speed lost and boards wedged when rail data changed or did not match mid-grind, the re-catch delay outliving a landing, stale heading after landing bails, repeated trick starts within one step, an unpaired manual end on wall bails, sub-step-dependent wall grazing, platform arithmetic in adapter walls, a pop on lost control, normal overflow, -0, re-entry, permissive restores, silently dropped unknown fields and overstated allocation claims; all were fixed with regression tests, and a verification pass found and closed three more (the re-catch delay after a bail landing, normal underflow, re-entry hidden by a port). Unaligned board yaw on rails and the wall port's own allocation are documented limits. This is a branch candidate: hosted full CI, a playable template consumer, browser behaviour, riding feel and physical-device acceptance remain pending.

## Grid-step kit — candidate (2026-10-09)

- **Scope:** `src/kits/grid-step` (ADR 0104).
- **Evidence:** `grid-step.test.ts` covers timing, reservations, the refusal order, ledges, forced tiles, follower lines, snapshots, validation and reentrancy.
- **Not established:** template or browser consumers and hosted CI.

## Optional sandboxed script runtime candidate (2026-10-09)

`@kits/scripting` (SCRIPT-01, [guide](scripting.md), ADR 0120) adds opt-in Lua 5.4 scripts on the exact-pinned
`wasmoon` 1.16.0 dependency, loaded lazily by `loadScriptVm`. Runtime contracts: per-script Lua state with an
allocation cap, deterministic, uncatchable per-call instruction budgets, host-call limits, a wall-time stop, capability-scoped
host functions, plain-data marshalling bounds, fixed-tick timers, a seeded saveable random stream, atomic
save/restore/reload with a stated restart contract (only `state` survives), and per-script faulting. Checked
evidence: 23 focused headless tests (after an independent adversarial review whose findings are fixed: metered native
work, deferred dispose, metatable copies, strict UTF-8, pre-call argument checks), including a `@kits/rollback` sync-test consumer and a `testScene` consumer;
headless Chromium runs of a fixture game through the development server and a production-mode build (VM chunk and
binary fetched lazily, no page errors). Not established: hosted full CI on this branch, physical devices,
long-session memory behaviour, or any template consumer. Stock-game first-load JavaScript is unchanged.

## Optional physics adapter kit candidate (2026-10-09)

`@kits/physics` (ADR 0121, [guide](physics-adapter.md)) adapts one lazily loaded
WebAssembly library: `@dimforge/rapier3d-deterministic-compat` 0.21.0, Apache-2.0,
the one new runtime dependency, approved for this kit only. Core stays physics-free.

- **Bundle:** stock first-load JS is unchanged at 175.6 KiB. The library is a dynamic
  chunk of 4,366,824 bytes (1,658,896 bytes `gzip -9`) that a consuming game must list
  in its own `largeChunkAllow`. No budget changed.
- **Runtime contracts:** configured admission, event, query, snapshot and debug-vertex
  limits; refusals and drops are counted; disposal is exactly once per visit.
- **Candidate evidence:** 35 focused Node tests in `src/kits/physics` (plus one
  character-kit motion test): lifecycle, refusals, `Transform` bound validation,
  ordering, order-independent query truncation, snapshot determinism, forged-snapshot
  refusal, the rollback sync test and two-peer session, and the character adapter. Also
  one software-GL `play:snap` of an uncommitted fixture.
- **Not established:** hosted CI, cross-browser bit identity, GPU/physical-device
  performance and memory, and multiplayer acceptance.

## Legacy format decoders candidate — ASSET-LEGACY, 2026-10-09

Seven kinds added to `npm run convert` (stacked on the ASSET-CONVERT candidate): `archive`, `frames`, `planar`, `tim`, `vag`, `director`, `cinepak`. Independent implementations from documented format facts; PNG/WAV output with `.meta.json` sidecars and provenance receipts; decompressors bounded by declared sizes. [README](../../tools/convert/README.md#legacy-formats), [ADR 0136](../adr/0136-legacy-format-decoders.md).

Evidence: headless tests with fixtures built by test-side encoders (exact value checks for every kind), mutation fuzzing of every fixture and bomb tests; with ffmpeg installed, Cinepak frames match an independent decoder within one colour level and the truncated ADPCM prediction matches sample for sample. An independent adversarial review found two resource amplifications and several smaller deviations, each fixed with a regression test. No real game data was used or committed; hosted full CI pending.

## Perception kit — candidate (2026-10-09)

Branch `feat/perception-kit` from `a6211bd3`. Nine headless tests: sight range, cone,
peripheral falloff, near radius and occlusion queried only when needed; hearing
falloff, path distance, unreachable and attenuation; awareness growth, impulses, decay,
hysteretic levels and blackboard facts; forgetting and full-memory replacement; squad
sharing, older-report refusal, fading inform and expiry; cover band, reservations and
bounded checks; utility compensation, momentum and refusal of invalid considerations;
and the review fixes (no rumour loop through re-sharing, report gain independent of the
update rate, atomic updates, sight priority for last-known positions, forgetting with
no decay). An independent adversarial review found those squad and awareness defects
and several smaller issues; all were fixed. Its re-review found a gap-credit effect,
relayed report data shared as direct perception, report positions overriding direct
ones and uncounted evictions; these are fixed (a `maxStep` credit cap, direct-only
position and strength for sharing, report positions only when newer than direct perception,
eviction counting) and covered by a ninth test.
No game, browser or device evidence.

## Medium volumes kit — candidate (2026-10-09)

- **Scope:** `src/kits/media` (ADR 0152).
- **Evidence:** `media.test.ts` covers probe selection and seams, hysteresis, the under state, event order, the
  accelerations, snapshots and a `testScene` floating-body consumer.
- **Not established:** template or browser consumers and hosted CI.

## Navigation meshes, funnel and avoidance — candidate (2026-10-09)

Branch `feat/navmesh-funnel-avoidance` from `9345d07b`. Nine headless tests: point
location with height; a funnel tight around an inner corner, radius clearance,
too-narrow and broken corridors; a straight strip with no extra corners; moving
across edges, stopping and sliding; sloped heights; mesh validation; two agents
passing head-on without overlap; and eight agents swapping across a circle while
keeping apart and arriving; plus review fixes. An independent adversarial review
(external fuzz of about 5,600 meshes against a brute-force shortest path, not checked
in) found the funnel optimal, but found a polygon limit beyond the graph's node budget,
a neighbour hash that missed large agents, reversed winding wording, duplicate
corners, silent truncation and unchecked preconditions; all were fixed. A re-review
(the same fuzz plus 1.6M chained boundary moves) was clean apart from low items, now
fixed: a point a rounding error below the mesh minimum was unlocatable, the corridor
limit message was stale, and the inside tolerance was not uniform on tiny polygons.
No game, browser or device evidence.

## 2026-10-08 — Optional cellular WASM candidate (GEN-03)

Candidate branch: `feat/cellular-wasm`, based on `e7e42706`. Adds an explicit
`prepareCellularGridWasm` choice; JavaScript remains the default. The original
Rust kernel performs smoothing only, reusing seeded generation, WorkerHost,
validation and resource publication. Each active job owns fixed linear memory;
compiled modules alone are shared. A bounded fixed scratch charge is captured
by the generic generator adapter.

Focused checks cover exact JavaScript parity, ABI bounds, concurrency, cancellation
and recovery. The isolated desktop Chromium check exercised two actual module
workers, 40,960 compared cells, JS fallback, supersession, owner loss, refusal and
zero terminal reservations. A full hosted candidate gate and physical-device
timing/thermal acceptance are not established by those checks. This is candidate
implementation evidence, not a claim of integration or deployment.

Contract, reproduction and verification:
[cellular WASM](cellular-wasm.md), [ADR 0101](../adr/0101-optional-cellular-wasm.md).

## Traversal helpers — candidate (2026-10-09)

Branch `feat/traversal-helpers` from `9345d07b`. Seven headless tests over a sampled
box world and the real volume-query kit:
- ledges:
  - a ledge found with climb height, edge, top and wall normal; plus no-wall, too-high,
    too-low and no-headroom;
  - a low ceiling at any maxClimb; knee-high ledges; tops just above minClimb and low
    curbs met at their upper edge;
  - thin fences (no top) and tall walls (too high), with and without a ceiling;
  - a 45° approach landing on the face; a 70° approach reported as oblique; a
    straight-up normal refused; gentle ramps of 2–30° never read as ledges; a body
    pressed flush against a tall wall gets too-high;
  - the same ledge through a `defineVolumeSet` adapter;
- ladders: attach facing rules, vertical reach, zero-facing and NaN refusal, climbing
  to a top exit, bottom exit and top standing point;
- pushables:
  - acceleration, speed cap, blocking with sliding on the other axis;
  - friction that always resists (including under a tiny push), the static threshold,
    dt 0 with no change and no sweep;
  - grid pushes to the next line strictly ahead, the same for nearly equal positions,
    in both directions, and with a half-cell grid offset.

An independent adversarial review found that:
- a low ceiling made reachable ledges too high;
- oblique approaches gave the wrong edge;
- ladders attached from metres away vertically, or with a zero facing;
- any push disabled friction;
- grid pushes left blocks off the grid;
- the volume-query compatibility claim was overstated.

The re-review found that:
- low walls just above minClimb were refused, because their edge normal points up;
- grid pushes jumped 0.5 or 1.5 cells depending on rounding;
- a ceiling could change the failure reason;
- narrow tops were missed;
- a straight-up normal produced NaN queries;
- dt 0 still capped the speed.

A third round confirmed those fixes, then found that the edge-contact rule took gentle
ramps for ledges, that a body flush against a tall wall got no-top, and that `origin`
was validated only in snap mode. These are fixed too: an edge contact now needs a level
top and a drop in front of it, the deciding cast starts slightly back from the wall, and
`origin` is validated in every mode. A narrow re-review confirmed these fixes and found
one low issue: the backed-off start could land in a wall just behind the body, giving
no-top instead of too-high. That is fixed: the start backs off only as far as the body
is flush. No game, browser or device evidence.

## Optional strict numeric modes candidate — NUM-01, 2026-10-09

`@kits/numeric` is an independently implemented pure kit: fixed-point words (2–32 bits in a number, up to 128 bits in a bigint) with creator-chosen rounding and overflow, binary-angle sin/cos/atan2 tables built from `dmath`, and strict reduced-precision float (`f32` = `Math.fround`; `pc24` = 24-bit significands with the double exponent range). It composes with `dmath`, `@kits/rollback` and `@kits/replay` and installs no clock, persistence owner or registration. [Kit README](../../src/kits/numeric/README.md), [ADR 0099](../adr/0099-strict-numeric-modes.md).

Evidence: 16 focused headless tests (exhaustive Q4.4 and seeded 32/48/64/128-bit comparisons with an independent BigInt oracle under every rounding/overflow pair; exact ties-to-even oracle for 2–25-bit significands including subnormal-range results; trig error bounds; 704 committed golden vectors; a fixed-point simulation through the rollback sync test and replay digests). An independent adversarial review found five defects (a fracBits-0 wrap rounding error in mulAdd/lerp, pc24 products below 2^-1021, and three edge cases), each fixed with a regression test. The golden vectors and three lockstep workload digests were identical in Chromium 141 and Node 26.8.1 through the extended `npm run test:dmath-browser` (local run). This is a branch candidate: hosted full CI, other browsers, a playable template consumer and physical-device acceptance remain pending.

## Cell and portal culling — candidate (2026-10-09)

Branch `feat/cell-culling` from `9345d07b`. Twenty-four new headless tests: graph
refusals; corridor narrowing; a cell reached through a narrow then a wider portal;
closed portals and revisions; portals behind or crossing the eye plane; a camera on
or within tolerance of a portal plane; outside fallbacks; a four-cell cycle; depth
horizon and overflow fallbacks; the PVS alone; unchanged-camera reuse; determinism;
render-on-change application, restore, reentrancy and throwing-sink recovery; a
composition with the real `World`/`Shape` and three.js meshes, with the view-projection
helper matched against the three.js camera. A seeded comparison of 960 cameras on 24
generated multi-level grids against an independent ray-marching reference found no
hidden visible cell; deliberately weakened variants (near-plane clipping, a shrunk
rectangle, first-visit-only traversal) each failed it. Local headless probe, not a
device budget: 95 % of 768 objects culled on average on an 8 x 8 fixture. No browser,
GPU, draw-call, frame-time or device evidence.
An independent review of `7a59f93b` found culler restore gaps (targets left unknown by
`resync` or a throwing sink stayed hidden after remove/dispose; a sink throwing during
dispose ended disposal early) and a three.js snippet using the local camera position;
both were fixed with a seeded culler model fuzz, a reference test with wide, asymmetric
and parented three.js cameras on portal planes and corners, and documented orthographic
and near-plane limits.

## Optional prediction presentation — candidate (2026-10-09)

[Prediction presentation](prediction-presentation.md) adds two optional helpers to
`@kits/network`: `createPredictionSmoothing` (a bounded, decaying presentation offset
with a snap threshold and a one-shot discontinuity flag) and `createPredictedEvents`
(an exactly-once emit and cancel ledger keyed by creator event key and tick). They
compose with `createPrediction` through `read()` snapshots and leave its defaults
unchanged. Evidence is headless: 23 unit tests on the real reconciliation path,
including seeded randomized bound and exactly-once runs. These are implemented and
checked on branch `feat/prediction-presentation`, not integrated. Independent review,
hosted CI, device or browser review of smoothing and multiplayer acceptance remain
outstanding. See ADR 0142.
