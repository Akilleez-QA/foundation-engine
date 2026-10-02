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
| RB-01 | Optional peer rollback sessions and local sync test (genre study 2026-10-02, slice 1) | Integrated in v0.2.0 (PR #25; batch PR #42). Optional `@kits/rollback`: `createRollbackSession` (2–8 peers, `maxPredictionFrames` 0–60, `inputDelay` 0–30, byte-bounded inputs/states, rollback to the earliest contradicted frame, stall at the window, confirmed-state checksums with bounded history/pending reports, fail-closed protocol faults, `AbortSignal` disposal) and `createRollbackSyncTest`. 25 focused tests, including seeded multi-peer convergence against a no-network reference, a sync test that compares every replay with the live step (fixed after review), late-peer pacing on the exposed `frameAdvantage`, and a `testScene` fixed-lane consumer. Requires a reliable, ordered link; there is no built-in time sync. No WAN, unreliable-channel, spectator, cross-browser floating-point or physical-device claim. See the section below and the [kit README](../../src/kits/rollback/README.md). |
| NW-09 | Seeded fault-schedule harness for the composed authority path (study N6, tools/test only) | Integrated in v0.2.0 (PR #26; batch PR #42). `npm run faults:network` and `tools/authority-workbench/fault-harness.test.mjs` replay seeded combined faults (link delay/reorder/duplicate/drop, connection loss mid-command, controller replacement, held/crashed commits, host restart, SQLite before/after-commit failure with recovery, clock skew, slow consumer, revocation) against the reference host and two scripted clients, checking durable-history, result-semantics, prediction, disclosure, bound and leak invariants after every step against independent SQLite readback; failing seeds print seed + step index and can be shrunk and replayed. Process-scope loopback evidence only: no WAN, power-loss, filesystem, scale or device claim. See the [guide](network-fault-schedule.md). |
| NW-08 | Planned drain and capped connection lifetime (study N8) | Integrated in v0.2.0 (PR #21; batch PR #42). Optional pure `createConnectionDrain` (host: bounded notice, operator drain/resume, dithered lifetime cap, per-poll instruction cap) and `createDrainFollower` (client: bounded notice, cooperative close, hold until announced return, then the existing retry schedule) in the network kit; the network workbench host (`--drain`) and client (checkbox) opt in. Drain closes are 1012 and transient. Admitted work is never cancelled. Evidence and limits are in the NW-08 section below. No process-restart, WAN or physical-device claim. |
| NW-07 | Overload and goodput acceptance probe (study N4), tools only | Integrated in v0.2.0 (PR #27; batch PR #46). `npm run probe:network` forks the network and replication reference hosts and drives them over real loopback WebSockets: offered-load ramp past saturation (FIFO and queue-age variants), flooder/wrong-credential/over-bound adversaries, a physical paused-socket non-reader, and a host-restart reconnect storm paced by `createRetrySchedule`. Three default runs at `0744509` (load average 94 to 113, niceness 15): FIFO goodput plateaued at the host's achieved capacity (67.9 to 84.1/s at 89 to 119/s offered); all 27 flooders retired `rate-capacity`; no healthy peer closed; the non-reader was retired `send-refused` by the replication host's buffered cap in 2 of 3 runs (host buffered at most 127,213 of 131,072 bytes) and stayed bounded in the third; jitter cut the peak accepted reconnects per 100 ms bin from 6 to 8 to 2. Finding (then): a queue age shorter than the real queued wait collapsed goodput (300 ms: final/peak 0.09 to 0.31). It is resolved by the NW-06 follow-up (PR #33), and the probe now asserts queue-age plateaus. Loopback/process scope only: no WAN, browser, multi-machine or physical-device claim. [Guide](network-overload.md), [evidence](../verification/network-overload-20261002/README.md). |
| SEC-01 | Command integrity (anti-cheat) at the authoritative host | Slice A integrated in v0.2.0 (PR #20; batch PR #47). Optional `createIntegrity` in the network kit ([guide](integrity.md), [recipe](../recipes/add-command-integrity.md)): pure `assess` validity usable inside the authority reducer (invalid sequenced commands consumed as domain rejections, so no `gap` and prediction reconciles), separate `admit`/`record` policy (decaying per-key scores, tick-rate budget on rate admission, throttle, windowed close with terminal `integrity-violation`, per-rule ceilings, owner/rule observe mode), key table that never refuses new keys, bounded local audit with export, tick-addressed generic helpers and an `assertDisclosure` test helper. Network workbench opt-in example (`--integrity`). Focused unit tests (including an in-memory authority/prediction composition) and loopback host tests only; no browser composition, load, WAN, physical-device, detection-quality or real-world cheat-resistance claim. Slice B (verified runs via the SIM-01 replay kit) is designed in the guide and not built; its SIM-01 dependency (PR #17) is merged. |
| AU-01 | Audio-clock timeline: audio↔frame time mapping with drift correction, bounded lookahead scheduling, input timestamps in audio time, stored latency calibration | Integrated in v0.2.0 (PR #31; batch PR #47). Optional `createAudioTimeline` ([guide](audio-timeline.md), [recipe](../recipes/sync-gameplay-to-music.md)) reads the one audio output through new `AudioOutput.clock()`; adds `CueVoiceOptions.at`, `ctx.audioClock()`, `ctx.time.now`, `ctx.input.pressedAt()` and audio unlock on scene action presses. Focused unit tests with a simulated drifting, quantised device; author-API scene tests with an injected clock and on the silent fallback. No real-browser output timing, Bluetooth, physical-device or audible verification (test browsers are muted). Streamed music remains off the context clock. |
| TR-01 | Regional terrain worker and ordinary-surface integration | Integrated in PR #109 at 99e6255. Canonical regional Surface and halo patches, bounded WorkerHost generation/patch adapters, independent geometric oracles and finite coherent render/query consumer passed at 891eb7; all seven template gates passed (1,648 tests, 129 performance checks, zero breaches/regressions, four advisory heap warnings). Combined main tests/build passed. Physical-device performance and unbounded/global streaming are not established. |
| GEN-01 | Deterministic seed derivation and bounded seeded generation jobs | Integrated in v0.2.0 (PR #38; batch PR #45). Pure integer-only `deriveSeed` in `src/core/rng.ts` and the optional `procgen` kit: `createGridGenerationJob` on the existing WorkerHost, the example `job.kits.procgen.cellular` row, and a strict root-seed save section. Evidence and limits are in the GEN-01 section below. No chunk residency, edit deltas, meshing, physical-device or generation-quality claim. |
| DV-01 | Supported-device experience and sustained performance evidence | In progress. The stock matrix, lesson visit cleanup and compact layout repair are integrated in v0.2.0 (PR #9, merged to main at `97288f8`); DV-01 itself remains open. [Stock matrix](../kits/stock-device-acceptance-matrix.md) covers all seven declarations. The [first receipt](../verification/stock-device-20261001/README.md) records 16 passing emulated target/tap checks and a compact lesson content overlap; lesson visit cleanup and a measured learn layout seam repair it, with a fake-DOM regression and emulated separation checks across board, sim and quiz at four profiles ([layout receipt](../verification/stock-device-20261002/README.md)). Full consumer workflows, in-panel touch scrolling, 200% text, named minimum devices and sustained physical evidence remain open; minimum phone, tablet and laptop/desktop profiles are pending creator selection. No physical-device or accessibility certification. |
| SC-01 | Bounded spatial index for neighbour, range and interest queries at scale | Integrated in v0.2.0 (PR #23, merged to main at `2c87e3b`). Optional `spatial` kit `createSpatialGrid`: preallocated uniform grid, admission before write, `too-wide` refusal before scanning, explicitly `truncated` results, terminal disposal. Checked: 12 focused unit tests (seeded brute-force oracle, refusals without mutation, narrow-buffer rejection, ECS interest consumer handling despawn and out-of-bounds and failing closed) and a work-count test of the 1,000/10,000-entry micro-benchmark. Headless Node medians recorded in the [guide](spatial-index.md#measured-cost). No template consumer, browser, worker or physical-device evidence; no budget change. |
| DEP-01 | three.js 0.183 → 0.186 deliberate migration (Dependabot keeps ignoring three minors) | Integrated in v0.2.0 (PR #29; batch PR #45). Private-state adapters re-verified against r186 source and pinned: batch state (`readBatchState`, contract test), the static shadow GPU cache (exported revision predicate; other revisions render the stock full path). Trackers force on camera-fitted `SunLight` cascades and observe `LightProbeGridWebGL`; `Texture.normalized` is classified as upload state. Engine ancestor-dependent world-matrix reads keep r183 results under r185's `updateWorldMatrix` change (regression test with a moved container). Exact head `bde17ad`: `npm run gate:ci` passed all 21 steps (19 browser suites, all seven template gates with 2,130 tests and 129 performance checks, zero enforced breaches/regressions/inconclusive, the four known advisory software-GL heap warnings; phone smoke for every template). Quality guard against the 0.183 build: 5 still views pixel-identical; the 3 animated start views compared under a held clock were identical (arcade, explorer) or within the scene's own run-to-run variance (mechanics). JS grows ~27 KiB raw / ~6 KiB gzip per template, inside every first-load budget. Software-GL frame times were measured under heavy host load and are inconclusive, not device evidence; no physical-device or GPU timing claim. |

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
determinism for replay, rollback and turn logs.

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
  - a saveable engine random generator;
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
| DX-01 | Boot input check and generator: [`src/author/input-registry.ts`](../../src/author/input-registry.ts) rebuilds the boot's `inputActions` table (engine rows, then game and kit inputs) with the registry's own options. `npm run check` (lint:brief) reports every problem; `npm run new -- input` picks bindings that table leaves free. Dev/test `engine.redraw()` ([`SceneHandle.redraw`](../../src/author/play.ts)) asks the running stock scene for one real draw, so `play:snap` judges budgets on rendered frames and reports `not measured` instead of a vacuous pass. [Recipe](../recipes/add-an-input-action.md) | Integrated in v0.2.0 (PR #39; batch PR #45). Unit and lint regressions plus emulated `play:snap` runs on the PR head. A dev/test boot throws on a clash; production drops the row with a warning. `engine.redraw()` covers the stock scene runtime only; the bench's idle windows are unchanged. Forced redraws can make a gate fail where it used to pass vacuously, and `not measured` exits 0. No device claim. |

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
- Touch hold controls: candidate in PR #57 (not integrated). `touchButton` in `@kits/ui`
  presses and holds an author input from an on-screen touch button through the real
  dispatcher and press latch; checked by fake-DOM tests and the Chromium touch-emulation
  `touch-sources-check.mjs` (one press, held across fixed ticks, slide-off release). No
  physical-device or jump-feel evidence.
- Not established: feel on any device, a template or browser jump consumer, moving platforms, slopes and lateral swept collision. Verified only on
  `origin/integration/batch-2`, where the PR #19 press latch is present; the kit relies
  on it for exactly-once presses.
