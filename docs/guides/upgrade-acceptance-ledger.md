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
| NW-03 | Prediction/reconciliation, reconnect and server persistence | NW-03 is integrated on private `main` by merge `b6fb4a3` (PR #123 in the private development history). Exact head `883f4ad` passed all seven template gates: 2,018 tests, 129 performance checks, zero enforced breaches/regressions/inconclusive results and four advisory heap warnings. Combined main tests (2,018) and build passed. Clean native two-client acceptance passed at `8317c69` (seven observations); all 53 focused tests and 17 actual Node 22.13 storage/host checks passed. Historical component repairs and limits are recorded below. DV-01 remains open; no physical-device, public-release or unrestricted multiplayer claim. |
| NW-06 | Maximum queued age and pre-invocation submit deadlines (study N3) | Implemented, candidate (PR #12); not integrated. Optional `maxQueuedAgeMs` sheds aged intake commands before `authorize`/`dispatch` (counted as `stale`, one pump attempt each); optional injected `clock` plus `submit(command, {deadlineMs})` returns `expired` only before storage invocation, consuming no sequence. In-flight writes keep committed/rejected/unknown semantics. Defaults unchanged. 6 intake and 9 authority focused tests; no load, WAN, browser-composition or device acceptance claimed. See [network kit](../../src/kits/network/README.md) and [durable authority](durable-authority.md). |
| NW-04 | Reconnect/retry pacing: full-jitter backoff and retry budget | Implemented, candidate (PR #14, `feat/nw04-reconnect-schedule`); not integrated. Optional pure `createRetrySchedule` in the network kit, with the network workbench client as an opt-in consumer. Evidence and remaining limits are in the NW-04 section below. No WAN, reconnect-storm-against-a-real-host or physical-device claim. |
| NW-05 | Shared rate and concurrency admission | Implemented, candidate (PR #13); not integrated. Optional single-process `createRateAdmission` ([guide](rate-admission.md)): per-key token bucket, optional concurrency leases, `maxKeys` with lossless idle reclamation only, explicit `limited`/`refused` results, clock-regression safe, idempotent dispose. Three reference hosts migrated from 1000 ms fixed windows to buckets of equal burst and refill (intended semantic change: no 2x boundary burst; same long-run rate). Focused unit and loopback host tests; no distributed, measured-load or physical-device claim. |
| TR-01 | Regional terrain worker and ordinary-surface integration | Integrated in PR #109 at 99e6255. Canonical regional Surface and halo patches, bounded WorkerHost generation/patch adapters, independent geometric oracles and finite coherent render/query consumer passed at 891eb7; all seven template gates passed (1,648 tests, 129 performance checks, zero breaches/regressions, four advisory heap warnings). Combined main tests/build passed. Physical-device performance and unbounded/global streaming are not established. |
| DV-01 | Supported-device experience and sustained performance evidence | In progress, not integrated: ported to the public `feat/device-acceptance` PR. [Stock matrix](../kits/stock-device-acceptance-matrix.md) covers all seven declarations. The [first receipt](../verification/stock-device-20261001/README.md) records 16 passing emulated target/tap checks and a compact lesson content overlap; lesson visit cleanup and a measured learn layout seam repair it, with a fake-DOM regression and emulated separation checks across board, sim and quiz at four profiles ([layout receipt](../verification/stock-device-20261002/README.md)). Full consumer workflows, in-panel touch scrolling, 200% text, named minimum devices and sustained physical evidence remain open; minimum phone, tablet and laptop/desktop profiles are pending creator selection. No physical-device or accessibility certification. |

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
NW-03 is integrated on private `main` by merge `b6fb4a3` (PR #123 in the private development history). Exact head `883f4ad` passed all seven template gates: 2,018 tests, 129 performance checks, zero enforced breaches/regressions/inconclusive results and four advisory heap warnings. Combined main tests (2,018) and build passed.
The workflow is configured in CI; no remote CI result is claimed. DV-01 remains open, with minimum phone, tablet and laptop/desktop profiles pending creator selection. Process-crash tests do not establish power loss, arbitrary
filesystems, trustworthy old backups, WAN scale or supported physical devices.

## Program preparation candidate (2026-10-01) — public PR #10, not integrated

Program preparation candidate: context-owned link validation, bounded submitted
program readiness and author recovery passed public checkpoint `2cdd442` across
all seven template gates and inspected desktop/mobile snapshots. Integration is pending. See [contract](program-preparation.md). No performance,
quality-budget or engine-wide residency completion claim is made.

The same candidate now includes optional owned submitted-frame completion after
initial draw. Native correctness and exact-head template gates are recorded in the
[checkpoint receipt](../verification/program-preparation/README.md). Completion is not display presentation or a smoothness guarantee.

## Cooperative dependency preparation candidate (2026-10-01)

M2 adds real task boundaries and reserves one acquisition slot for the required
closure while optional work uses remaining capacity. Explicit pumping remains
caller-owned. See the [contract](../../src/platform/assets/dependency-lease.md) and
[prospective oracle and CPU evidence](../verification/dependency-preparation-20261001/README.md).
Native task oracle, all seven template gates and the CI browser suites passed (see the
evidence README and public PR #11);
integration, frame-time and downstream acceptance remain pending; no resource budget changes.

## Reconnect/retry pacing (NW-04) — implemented, candidate

Status: implemented, candidate on branch `feat/nw04-reconnect-schedule` (PR #14); not integrated. See the [retry pacing guide](network-retry.md).

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

### NW-04 follow-up: terminal close classification — candidate

Status: candidate (PR #16), building on integrated NW-04 (PR #14); not integrated.

- Runtime-enforced: remote close code 1000–4999 or `null`; reason a token of at most
  64 characters or `null`, length-checked before matching; first close wins; local
  causes report `null`. Close policy lists are validated, bounded (32) and captured.
- Checked: transport and close-policy unit tests; the network workbench browser
  workflow shows a revoked credential stopping after exactly one transport under the
  default policy (Chromium received 1008 `auth-rejected`), and the previous bounded
  exhaustion when refusals are treated as transient.
- Not established: close-frame delivery over slow or lossy links (a lost frame is
  1006, classified transient), other hosts' reason vocabularies, physical devices.

## Replay log and divergence detector (SIM-01) — candidate, not integrated

| ID | Contract | State |
|---|---|---|
| SIM-01 | Optional `@kits/replay`: bounded tick-input log and player (explicit truncation; version, identity and corruption refusal), creator-digest traces with first-divergence comparison, and a prediction-versus-authority agreement check over the existing owners. Dev/test-only `engine.replay` uses the stock scene fixed lane and `?seed=`. [Contract](replay-divergence.md) | Implemented, candidate (PR pending). Focused tests and the arcade `?seed=` browser replay pass on the branch. Not integrated. No cross-device or cross-browser floating-point determinism, physical-device or multiplayer claim. |
