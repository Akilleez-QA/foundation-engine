# Composition frameworks and remaining work

Foundation provides optional mechanisms that creators can configure, extend, replace
or omit. Character creation, classes, staged objectives and combat are possible consumers;
they are not a required game design. This record separates concrete contracts from
larger capabilities that those contracts do not yet provide.

Revision references: PR numbers and merge/commit hashes before the public
repository's first commit `c0e73c9` refer to the private development history,
which is not published. `c0e73c9` has the same source tree as private `main`
`b983e1a`. Later public PRs are on
[github.com/Akilleez-QA/foundation-engine](https://github.com/Akilleez-QA/foundation-engine/pulls).

## Current status (2026-10-03)

All public PRs merged through #116 are integrated on `main`. That includes the
post-0.2.0 merge-train batches #62 (TB-02, SC-02, RNG-01, INPUT-01, touch hold,
SIM-02), #64 (MV-02, AU-02, W1-2, MP-01) and #65 (W1-4/W1-5/W1-6, FX-01, AUD-02), and
GEN-02 (#56). None of these is in a release yet. Sections below that were written as
candidates now begin with a dated current-status line; their original evidence and
limits are kept unchanged.

The creator-readiness milestone ([issue #66](https://github.com/Akilleez-QA/foundation-engine/issues/66))
added receipts in `docs/verification/`:
[onboarding](../verification/creator-onboarding-20261003.md) (#68),
[session host CLI](../verification/session-host-cli-20261003.md) (#70),
[creator journey](../verification/creator-journey-20261003.md) (#72) and its
[failure paths](../verification/creator-journey-recovery-20261003.md) (#98),
[first use](../verification/first-use-20261003/README.md) (#73, #104),
[bench active restart](../verification/active-restart-20261003/README.md) (#75),
[Blender export](../verification/blender-export-20261003.md) (#74),
[save recovery](../verification/save-recovery-20261003.md) (#76),
[model retirement](../verification/model-retirement-20261003.md) (#78),
[decode cancellation](../verification/decode-cancellation-20261003.md) (#116),
[contributor rehearsal](../verification/contributor-rehearsal-20261003.md) (#80),
[DPR redraw](../verification/dpr-redraw-20261003.md) (#83) and
[session recovery](../verification/session-recovery-20261003.md) (#97).
The [acceptance ledger](upgrade-acceptance-ledger.md#creator-readiness-milestone-2026-10-03)
gives each receipt's PR, merge commit, checked revision and evidence class, the main
CI runs, and the scorecard status. That evidence is focused, CI or simulated. No
human-newcomer, physical-device, LAN-between-machines or WAN evidence exists.

## Implemented composition extensions

| Extension | Existing seam and behavior | Evidence boundary |
|---|---|---|
| Equipment custody | `createEquipment` acquires/releases unique instances under its existing revision and capacity checks. Equipped release requires explicit unequipping. `equipped()` includes cosmetics; `active()` remains functional-only. | Production exchange and custody consumers validate coherent inventory/equipment/receipt envelopes with real SaveStore retry and reload. The optional custody browser also projects world/bag/equipped locations. These are finite single-writer compositions, not network transactions. |
| Action runs | Optional `createActionRuns` in capabilities accepts creator-fed time, retains bounded identities, reports readiness and supports explicit acknowledgment/cancellation. | Headless consequence retry and scene-system timing/teardown consumers. The optional action workbench adds session consequence composition, integrated in PR #117 at `2aabe49` after native desktop browser and all seven template gates. No automatic effect, scheduler, save owner or replicated action. |
| Staged objectives | Optional `createStagedObjectives` composes existing counters using pinned definitions, explicit authored choices and run/stage identities. The initial helper supports finite acyclic graphs. | The staged journal and objective workbench cover coherent rewards, explicit adoption, historical branch outcomes, shared-work cancellation and save/reload. The staged helper itself does not own UI or delivery. |
| Production acceptance | Existing frame adapter accepts only synchronous literal `true`; all other results retain the pending envelope and prevent further production until retry succeeds. | Regression exercises Promise/object and other rejected results, detached retry payload and resumed work. Acceptance remains the publisher's claim, not storage durability. |

The implementation guides describe inputs, ownership, configured bounds, overload,
cancellation and recovery: [equipment](../../src/kits/equipment/README.md),
[action runs](action-runs.md), and [staged objectives](staged-objectives.md).
The [creator contract](../CREATOR-CONTRACT.md) remains the governing boundary.

The optional workbenches do not change the ordinary player template layout. Existing
template gates are regression evidence, not a demonstration of a new character
editor, physical-device interaction or networked game. New helpers remain optional
imports; no global manager or background loop is installed.

## Appearance, effects and progression extensions

- [Appearance documents](appearance-documents.md) add bounded versioned parts and
  numeric parameters to the existing authored-document owner. Creators supply the
  compatibility validator. Existing edit sessions provide preview, cancellation,
  commit and history.
- The [optional desktop preview](appearance-preview.md) exercises that contract
  with primitive rendering and local saves, including failed projection recovery,
  corrupt-save quarantine, storage retry and scene reentry. Browser evidence covers
  desktop keyboard/pointer at 1440×960; it does not prove skeletal behavior. Separate
  [rigid attachment](model-attachments.md) and [weighted pose-link](model-pose-links.md)
  consumers are integrated, including compatible rig mappings and asset-failure
  recovery. Arbitrary retargeting and physical-device performance remain unverified.
  The normal player build does not import the tool.
- [Timed effects](timed-effects.md) reuse the modifier evaluator with bounded live
  contributions, creator-fed time, explicit stack/replace/reject policy and exact
  cancellation handles. Failed arithmetic leaves the previous state intact.
- [Capability revocation](capability-revocation.md) extends the prerequisite graph
  with revisioned previews, explicit cascade/reject and privileged-grant policies.
  Evidence survives removal. Legacy snapshots remain readable; local revisions do
  not establish network authority.

These are optional framework extensions. They add no mandatory class taxonomy,
body structure, effect clock, progression curve or game mode.

## Lessons shaping the contracts

Separate definition data, instance identity, accepted state and presentation. An
equipment selection can drive an attachment or a modifier without making either
side effect part of custody. A progress counter consumes accepted facts rather than
deciding which player input ought to count. Explicit completion and cancellation
make delayed work reviewable; forgetting terminal cleanup can leave an operation
permanently active. Epic's [ability lifecycle documentation](https://dev.epicgames.com/documentation/en-us/unreal-engine/using-gameplay-abilities-in-unreal-engine)
provides an independent example of that lifecycle concern, not a requirement to
adopt its ability architecture.

Definition editing and runtime execution have different ownership. Godot's
[resource documentation](https://docs.godotengine.org/en/stable/tutorials/scripting/resources.html)
illustrates reusable authored data separate from scene behavior. Foundation already
has bounded documents, edit sessions and asset leases; future authoring tools should
compose those before adding another catalog or persistence owner.

Local revisions and immutable snapshots do not establish network authority.
Transport, sender identity, authority, ordering and reconciliation need separate
contracts. Godot's [multiplayer documentation](https://docs.godotengine.org/en/stable/tutorials/networking/high_level_multiplayer.html)
shows that even a high-level API must distinguish these concerns and platform
capabilities. These public references were inspected on 2026-09-30; their examples
are contextual evidence, not verification of Foundation.

## Remaining capability map

| Area | Current building blocks | Next distinct work and acceptance |
|---|---|---|
| Character creation | Appearance documents, primitive preview, requested/adopted model readiness, rigid attachments and compatible weighted pose links | Integrated finite GLB consumers cover replacement, failure and preview/save/reload. Arbitrary retargeting, skeleton fusion and creator-specific character editors are not supplied. |
| Inventory and equipped gear | Material ledger/reservations, unique custody, production exchange and optional world/bag/equipped consumer | Integrated coherent SaveStore consumers cover capacity failure, exact retry, reload and permanent issuance facts. Arbitrary container policies, concurrent writers and remote authority remain separate. |
| Stats and effects | Source-owned modifiers, bounded timed effects, explanation traces and pure resource candidates | Integrated traces preserve source provenance; creators select rounding, overflow, capacity adjustment and time. No automatic regeneration or mandatory stat taxonomy. |
| Classes and progression | Capability graph, provenance, revocation/respec inspection and optional progression workbench | Integrated authored allocation, rejection, stale previews and coherent save/reload. No mandatory classes, level curve or choice policy. |
| Objectives and quests | Counters, staged graphs, journal, shared-work leases and optional objective graph editor | Integrated explicit adoption preserves historical outcomes; cancellation and coherent consequence retry/reload are covered. The sample editor is not a universal quest designer or distributed workflow engine. |
| Combat and interactions | Sweeps, policy callbacks, action timing and implemented optional action workbench | AC-01 integrated in PR #117 after final native browser and all seven gates. Native target facts and independent presentation compose session-only consequences. Creators choose rules and whether combat exists. |
| Crafting and resources | Survey fields, reserves, exact slot selection, weighted facts, authored experiment steps, locked manifests, production and materialization | PR #118 integrates selection/reservation/experimentation, historical recipe/batch facts, explicit spawn changes and native recipe/effect inspection. Final desktop browser, independent recovery probes and all seven gates passed at `790aaea`; combined main tests/build passed. No automatic spawn rotation or minigame prescribed. |
| Multiplayer | NW-01 integrated in PR #120. NW-02 complete scoped views, application credit and optional scene lifecycle hooks are integrated on main at `ea48539` (PR #122 in the private development history). | Rebased clean browser passed at `508edd9`; final `47a7e6d` passed all seven gates (1,965 tests, 129 performance checks, zero enforced breaches/regressions/inconclusive, four heap advisories). Combined main tests/build passed; measured load and earlier failure remain documented below. Git ancestry establishes integration, not the PR API state. NW-03 is integrated as recorded below; DV-01 remains unresolved. No multiplayer-completion claim. |
| Multiplayer: queue age and deadlines (NW-06) | Optional intake `maxQueuedAgeMs` with `stale` notice; optional authority `clock` and `submit(command, {deadlineMs})` returning `expired` before storage invocation only | Integrated in v0.2.0 (PR #12, merged to main at `53d549d`). Focused unit tests only; defaults unchanged; no load, browser-composition or device claim. Follow-up (integrated in v0.2.0 (PR #33; batch PR #42)): age shedding is no longer charged to the pump budget (optional `maxStaleDropsPerPump` cap), fixing the NW-07 goodput collapse; 300 ms final/peak 0.23-0.25 before, 0.92-0.96 after with PR #27's probe (loopback). |
| KTX2 model textures | `KHR_texture_basisu` in the model library: lazy `KTX2Loader` and Basis transcoder, formats from the pooled renderer, RGBA8 fallback, transcoded bytes in residency and the `models` probe | Implemented and checked in PR #146 (unit tests, `test:ktx2-browser` in SwiftShader Chromium). No phone GPU, driver memory or transcode-time evidence; the transcoder's own worker pool is an explicit STD-RUN-35 exception. See [KTX2 model textures](compressed-textures.md). |
| Asset residency (RES-01) | Optional per-preset texture/model byte budgets, pinned asset ids and a pressure hook over the existing lease caches | Integrated in v0.2.0 (PR #22, merged to main at `9913019`). Unit tests and a native software-renderer fixture only; defaults unchanged; no template configures it. See [asset residency](asset-residency.md). |
| Multiplayer: peer rollback (RB-01) | Optional `@kits/rollback` session (prediction window, input delay, rollback/resimulation, confirmed-state checksums) and local sync test, driven from the fixed lane | Integrated in v0.2.0 (PR #25; batch PR #42). Focused headless tests and a `testScene` consumer only; requires a reliable, ordered link; no WAN, time-sync, spectator or device claim. See the [kit README](../../src/kits/rollback/README.md). |
| Determinism: saveable random state (RNG-01) | `createSaveableRng` in `@engine`: `createRng` draws plus `state()`/`restore(word)` | **Integrated 2026-10-02** (PR #52 merge `2d5f50e`, batch PR #62, `main` `6485572`). Before integration: implemented, candidate (PR #52). Focused tests and a rollback sync-test consumer. `ctx.random()` is unchanged. |
| Input: frame-exact history (INPUT-01) | Optional `@kits/input-history`: per-tick edges, taps, opposite cleaning, buffers with consumption, bounded sequence matching, validated snapshots | **Integrated 2026-10-02** (PR #52 merge `2d5f50e`, batch PR #62, `main` `6485572`). Before integration: implemented, candidate (PR #52). Headless tests, including an exhaustive oracle and a fixed-lane consumer. No per-game windows, controller or feel claim. |
| Multiplayer: seeded fault schedules (NW-09) | Tool-only `npm run faults:network` harness replaying seeded combined faults against the authority workbench host with per-step invariants and exact seed/step repro | Integrated in v0.2.0 (PR #26; batch PR #42). Process-scope loopback evidence only; no WAN, power-loss, scale or device claim. See [guide](network-fault-schedule.md) |
| Multiplayer: planned drain and lifetime (NW-08) | Optional host `createConnectionDrain` (bounded notice, operator drain/resume, dithered lifetime cap) and client `createDrainFollower` (hold until announced return, then the existing retry schedule) | Integrated in v0.2.0 (PR #21; batch PR #42). Unit, host socket and loopback browser tests; defaults unchanged; no process-restart, WAN or device claim. See the [drain guide](network-drain.md). |
| Movement feel: jump (MV-01) | Pure `createJumpFeel` (exact piecewise gravity, coyote, buffer, variable height, apex gravity, terminal fall) and the optional `jumpSystem` adapter in the locomotion kit; opt-in `hold: true` author buttons | Integrated in v0.2.0 (PR #34; batch PR #46). Focused unit tests at 30–240 Hz only; no template consumer, browser or device evidence. A held touch button (`touchButton`, `@kits/ui`) was a candidate in PR #57 and is integrated since 2026-10-02 (PR merge `e58010a`, batch PR #62, `main` `6485572`); its evidence remains fake-DOM tests and Chromium touch emulation only. Moving-platform carry, slopes, swept lateral collision and vehicles remain separate slices. |
| Movement feel: moving platforms (MV-02) | Pure `createPlatforms` registry (time-function paths, exact per-tick displacement, speed check, cut, one-way catch in the platform frame), `platformSystem`, and `jumpSystem` ride/leave/catch with `onLeave` policies; launch `boost` on the jump controller | **Integrated 2026-10-03** (PR #53 merge `b6dd99d`, batch PR #64, `main` `3b449fa`). Before integration: implemented, candidate (PR #53). Focused unit tests at 30–240 Hz only; no template consumer, browser or device evidence. Render interpolation between ticks is the next slice. |
| Determinism: deterministic scalar maths (W1-2) | Optional `dmath` from `@engine` (sin, cos, atan, atan2, exp, log, pow, sqrt, hypot; the same bits in every engine), and `math: 'deterministic'` on the character, locomotion and root-motion kits | **Integrated 2026-10-03** (PR #60 merge `ca972b3`, batch PR #64, `main` `3b449fa`). Before integration: implemented, candidate (PR #60). Focused tests and the Chromium-against-Node golden and workload check only. No Firefox/WebKit, device or full scene-replay claim. See the [guide](deterministic-math.md). |
| Multiplayer: command integrity (SEC-01) | Optional host-side `createIntegrity`: pure validity `assess` for authority reducers, `admit`/`record` policy with decaying scores, tick budget, throttle, windowed close, observe mode and bounded local audit; `assertDisclosure` test helper; network workbench opt-in example | Slice A integrated in v0.2.0 (PR #20; batch PR #47). Unit and loopback host tests only; verified runs (slice B) planned, not built. See the [integrity guide](integrity.md). |
| Multiplayer: newcomer shared session (MP-01) | Game-facing `@kits/network` `defineSessionRules`, `createSession` and transport-neutral `createSessionHost` over the existing intake, views, prediction, retry, close policy, rate admission and integrity (observe by default); `npm run host` development host; `shared-world` template and [recipe](../recipes/two-players-one-world.md) | **Integrated 2026-10-03** (PR #61 merge `41d0261`, batch PR #64, `main` `3b449fa`). Before integration: implemented, candidate (PR #61). Unit, loopback socket and one desktop headless Chromium two-context check; LAN/loopback only, no WAN, accounts, matchmaking or device claim. See the [shared session guide](multiplayer-session.md). |
| Manual tools | Bounded documents, sessions and optional appearance, progression, custody and objective desktop consumers | Integrated tools cover their finite schemas. Action tooling is integrated; recipe/effect inspectors are integrated in PR #118 with focused tests and final desktop workflow acceptance. Device support is selected per tool; desktop tooling does not impose a phone UI. |

Priority is composition correctness before additional feature catalogs. A creator's
networked requirement may move authority and persistence ahead of the local adapters;
a single-player or offline build can omit that work entirely. The listed work is a
capability roadmap, not a claim that every independent game needs every row.

Current integration and outstanding acceptance are tracked in the [continuing ledger](upgrade-acceptance-ledger.md). Consumer guides: [model readiness](model-readiness.md), [production exchange](production-exchange.md), and [staged journal](staged-journal-consumer.md).

Integrated continuation includes TR-01, AP-01/AP-02, CU-01, ST-01/PG-01 and
OB-01/OB-02, AC-01 and CR-01–CR-03 through PR #118 (`1c177d5`). The ledger retains exact candidate test
counts and evidence rather than transferring old passing results to newer code.
Further guides: [regional terrain](regional-terrain.md), [resource values](resource-values.md),
[stat explanations](stat-explanations.md), [progression workbench](progression-workbench.md),
[custody composition](custody-composition.md), [objective workbench](objective-workbench.md)
[action workbench](action-workbench.md), [recipe workbench](recipe-workbench.md)
and [crafting sessions](crafting-session.md). No whole-program completion is claimed.

### Startup routing correction

PR #119 (`a3d1516`) repairs stock startup so creator-declared `firstScene`
controls empty/unknown addresses while valid links retain precedence. Focused Node
regressions, both native consumer browsers and all seven gates passed at `7673d74`. This uses the existing router
and handover owners. [Configuration and evidence](scene-startup.md).

### Networking admission — integrated

The new optional [connection intake](../../src/kits/network/README.md) (`bd65713`)
separates connection identity, authentication completion and current command
permission. It captures bounded data, drains peer queues fairly, and retires late
callbacks and reservations on timeout, close, revoke or disposal. The
[browser text transport](network-transport.md) (`540bece`) owns socket listeners,
raw-text queues and explicit buffered-send refusal without adding a simulation loop.
The [reference host](../../tools/network-workbench/README.md) (`63730cc`) composes
these contracts with maintained WebSocket framing and two ephemeral diagnostic
counters. Creator policies and transport selection remain replaceable.

Combined focused evidence: 44 tests (16 intake, 13 injected-socket adapter,
10 real TCP/WebSocket host and 5 exact response-schema checks). Candidate `4e51a04`
passed the native two-browser diagnostic with a separate host, independent counter
observations, visible scene projections and retirement checks; screenshots were
inspected. Integrated in PR #120 at `3a97ca6`; final `5f871b3` passed all seven template gates and combined main passed 1,917 tests/build. NW-02 now has separately measured local load, described below; it does not extend the NW-01 evidence. See the [runnable guide](network-admission.md).
NW-01 itself supplies no replica owner, prediction,
durable authority or exact-retry guarantee in this slice; command IDs only
correlate replies. Application queue bounds do not bound browser/network buffers
or trusted callback execution time. Prior integrated PR #119 remains the separate
startup correction, not evidence for networking.

## Input resize retirement — integrated at `894fc52` (2026-10-01)

On base `3a97ca6d`, independent adapter tests reproduced retained touch action,
pinch and scene press after window resize. The candidate reuses each existing
ownership/cancellation seam, releases capture and requires a fresh gesture.
All 26 focused tests pass. Exact candidate `8b1aa34` passed all seven template
gates (1,922 tests per gate, 129 software checks, four advisory heap warnings),
plus inspected desktop/mobile smoke. Native held-resize and physical-device
acceptance are not established by these Node tests or blank-scene snapshots. No budget, device policy or
input bounds change. [Evidence and limits](../verification/input-resize-20261001/README.md).

### Scoped view continuation — integrated on main

NW-02 adds optional [complete scoped views](network-views.md), not a mandatory
replication scheme. `685a25f` provides bounded complete-view capture/replacement and
one outstanding application credit per authenticated session; `272a759` and
`0dbed00` supply the reference host and separate operator/entity identities.
Scene lifecycle notifications (`0070b6e`, repaired in `eaaaf2f`) forward existing
coverage/visibility transitions without another loop. Overload retires the actual
activity; the render hook reports successful native render return, not GPU display.

Runner `534c11a` passed native two-context/separate-host checks on clean revision
`f98eb2c`: raw recipient-specific disclosure, independent
ECS projection, same-world-revision field removal, replacement incarnations,
projection/size failure recovery, synchronous scrim/opaque clearing and fresh
sessions. Screenshots were inspected; no page/console errors occurred. The earlier dirty
`eaaaf2f` exploratory pass remains historical evidence. The [reference host evidence](../../tools/replication-workbench/README.md)
records four local load cases (2/8 peers × 8/64 entities, 100 updates); worst
observed publisher p95 was 0.321 ms, with declared retained bounds and healthy
service rounds passing. Application-credit withholding is not physical TCP
backpressure. The first all-template gate failed in Arcade: 1,960/1,961 tests,
with a file-level `entity-inspection.test.ts` failure despite its inner test passing.
The standalone test and full source-suite TAP retry passed (1,960 tests, zero
failures/cancellations); the cause is not established. The completed 18 performance
checks passed, but the gate did not. The subsequent exact-head gate passed on `8121257`: all seven templates,
1,960 tests and 129 performance checks, with zero enforced breaches, regressions
or inconclusive results. Four software-GL heap advisories remain (two Mechanics,
two Terrain). NW-02 is now integrated on `main` by merge `ea48539` (work tracked in PR #122 in the private development history).
The rebased clean browser run passed at `508edd9`; final `47a7e6d` passed all seven
template gates with 1,965 tests and 129 performance checks, zero enforced breaches,
regressions or inconclusive results, and four advisory heap warnings. Combined
main tests (1,965) and build passed. Integration here is verified Git ancestry;
the GitHub PR API still reported OPEN immediately after push, so no PR-state
transition is asserted.

NW-03 is integrated as recorded below; DV-01 remains unresolved.

## Durable authority and prediction continuation — integrated

NW-03 now has implemented, separately optional [durable authority](durable-authority.md)
and [bounded prediction](prediction.md) owners integrated through PR #123, plus an
[optional SQLite tooling adapter](../../tools/authority-workbench/README.md).
Canonical capture has 4 focused tests, prediction 13, authority 19, the SQLite
adapter 12 and the host 5. All 53 pass; storage/host also pass on Node 22.13.0.
The exploratory native two-client correction/restart workflow passed within its
desktop loopback scope. See the [versioned evidence ledger](upgrade-acceptance-ledger.md#durable-authority-and-prediction--integrated)
for historical candidate commits and current integration evidence.

Clean-revision native acceptance passed at `8317c69`; see the
[saved evidence](../verification/authority-20261001/README.md). NW-03 is integrated on private `main` by merge `b6fb4a3` (PR #123 in the private development history) and included in public `main` since `c0e73c9`. Exact head `883f4ad` passed all seven template gates: 2,018 tests, 129 performance checks, zero enforced breaches/regressions/inconclusive results and four advisory heap warnings. Combined main tests (2,018) and build passed.
DV-01 physical-device acceptance remains open; minimum phone, tablet and laptop/desktop profiles are pending creator selection. Creators may configure,
replace or omit these contracts and retain ownership of all game rules.

## Device acceptance continuation — layout repair integrated in v0.2.0 (PR #9)

The [stock device matrix](../kits/stock-device-acceptance-matrix.md) records all seven
current template declarations and remaining task-specific acceptance. The
[2026-10-01 exploratory receipt](../verification/stock-device-20261001/README.md)
separates 16 passing touch-emulated target/tap cases from an observed compact lesson
content overlap. The [2026-10-02 layout receipt](../verification/stock-device-20261002/README.md)
records the repair in the learn kit's layout seam (desktop geometry unchanged), a
fake-DOM regression and emulated separation checks across board, sim and quiz at
four profiles on a clean commit. The matrix and repair are integrated in v0.2.0 (PR #9, merged to main at `97288f8`). This is emulated evidence, not a completed mobile
experience: full workflows, text scaling and actual minimum-device performance remain
open, and minimum phone, tablet and laptop/desktop profiles are pending creator
selection. DV-01 and the overall upgrade goal remain active. See the
[continuing ledger](upgrade-acceptance-ledger.md) for the authoritative work state.

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

The optional [retry schedule](network-retry.md) paces reconnects with capped
exponential backoff, full jitter and a retry budget. It owns no timer, socket or
credential; the network workbench client uses it only when its checkbox is ticked.
Integrated in v0.2.0 (PR #14, merged to main at `82862d6`). No WAN
or physical-device acceptance; see the [ledger](upgrade-acceptance-ledger.md).

## Rate and concurrency admission — NW-05 integrated in v0.2.0 (PR #13)

NW-05 adds an optional, single-process [rate and concurrency admission](rate-admission.md)
helper (`createRateAdmission`, network kit): a per-key token bucket with an optional
concurrency gate, bounded keys, explicit refusal results, caller-supplied time and
idempotent disposal. The three reference hosts replace their hand-rolled fixed
windows with it, keeping limits, close reasons and check order; the change from a
fixed window to a bucket is an intended semantic change recorded in the guide.
Status: integrated in v0.2.0 (PR #13, merged to main at `cc2ef79`). Evidence is unit and loopback
host tests only; distributed limits, measured load and physical devices are outside
this slice.

## Terminal close classification (NW-04 follow-up) — integrated in v0.2.0

The browser transport exposes a validated remote close `{code, reason}`; the optional
network kit `createClosePolicy` classifies it as terminal or transient so the workbench
stops reconnecting on `auth-rejected`. Integrated in v0.2.0 (PR #16, merged to main at `b93690d`), building on NW-04 (PR #14). See the [retry guide](network-retry.md#terminal-refusals-and-transient-loss).

## Replay log and divergence detector (SIM-01) — integrated in v0.2.0

| ID | Contract | State |
|---|---|---|
| SIM-01 | Optional `@kits/replay`: bounded tick-input log and player (explicit truncation; version, identity and corruption refusal), creator-digest traces with first-divergence comparison, and a prediction-versus-authority agreement check over the existing owners. Dev/test-only `engine.replay` uses the stock scene fixed lane and `?seed=`. [Contract](replay-divergence.md) | Integrated in v0.2.0 (PR #17, merged to main at `49047ae`). Focused tests and the arcade `?seed=` browser replay passed on the PR head. No cross-device or cross-browser floating-point determinism, physical-device or multiplayer claim. |
| SIM-02 | Creator-chosen replay digest and divergence detail (backlog W1-1; demo finding F1). Optional `defineScene({replay: {digest}})`, `@kits/replay` `replayDigest`/`selectWorldState` (selected components, excluded tags, chosen resources) and `explainDivergence`; dev/test-only `engine.replay.start({digest, detail})` and a bounded `divergence` report naming the first differing entity, component and field. Default digest and identities unchanged. [Contract](replay-divergence.md#choose-what-a-replay-must-reproduce-sim-02), [recipe](../recipes/replay-with-your-own-digest.md) | **Integrated 2026-10-02** (PR #58 merge `4943174`, batch PR #62, `main` `6485572`). Before integration: implemented, candidate (PR #58). Focused tests (including the demo's frame-phase orb case: default diverges and names the orb, a digest excluding the cosmetic tag replays exactly) and `npm run test:replay-browser` (arcade, desktop Chromium software GL) passed on the branch. No cross-browser floating-point, physical-device, production-build or multiplayer claim. |

## Sustained-session recorder — PERF-01 integrated in v0.2.0

PERF-01 adds an optional dev/test-build [sustained-session recorder](session-performance.md). It is integrated in v0.2.0 (PR #15, merged to main at `ae69a38`). It reads the one frame loop through a single observational sampler slot.
It keeps bounded windows and fixed histograms, and produces a local `foundation.session-perf` evidence file. Nothing is
transmitted. Its only browser evidence is emulated. It gives DV-01 a collectable format, but it does not close DV-01:
physical-device runs on creator-selected profiles remain open.

## Deterministic turn log (turns kit, TB-01) — integrated in v0.2.0

The optional `turns` kit composes existing owners: authored-document/network JSON capture for bounds, the replay kit `hashText` for snapshot checksums, core `createRng`/`hashSeed` for per-position random streams, save sections for snapshots (a `{json}` section, restored with explicit `invalid`/`foreign`/`diverged` outcomes) and `createDurableAuthority` through `turnAuthorityPolicies` for server-authoritative play. It adds no service, scheduler, storage or frame work. Integrated in v0.2.0 (PR #24; batch PR #42); 18 headless unit tests; no consumer template, browser or device evidence. See the [kit README](../../src/kits/turns/README.md).

## Bounded spatial index for large populations (SC-01) — integrated in v0.2.0

The optional `spatial` kit adds [`createSpatialGrid`](spatial-index.md), a preallocated
uniform-grid index for neighbour, range and per-observer interest queries with explicit
cell, result and capacity bounds. It is a reusable proximity mechanism for large
populations, not a visibility, steering or replication policy. Status: integrated in v0.2.0 (PR #23, merged to main at `2c87e3b`). Evidence is focused unit tests
and a headless 1,000/10,000-entry CPU micro-benchmark; no template consumer, browser,
worker or physical-device evidence, and no budget change.

## Seeded generation (GEN-01) — integrated in v0.2.0

GEN-01 adds integer-only hierarchical seed derivation (`deriveSeed`, beside the single
mulberry32 generator in `src/core/rng.ts`) and an optional `procgen` kit. The kit runs
creator-registered slice generators over bounded `Uint16Array` cell grids on the
existing WorkerHost, ships one example row (`job.kits.procgen.cellular`) and provides
a strict root-seed save section. It adds no scheduler, registry or publication owner;
results never publish themselves. Status: integrated in v0.2.0 (PR #38; batch PR #45). Evidence is focused unit tests plus one
desktop Chromium worker check. Chunk residency, runtime edit deltas, meshing and
edited-world persistence remain separate work. See the
[kit](../../src/kits/procgen/README.md) and the [ledger](upgrade-acceptance-ledger.md).

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

## Overload and goodput probe — NW-07 integrated in v0.2.0

`npm run probe:network` ([guide](network-overload.md)) measures the loopback network
and replication reference hosts past saturation: goodput against offered load,
rejections by reason, admitted-work latency, high-water marks, a physical non-reading
peer and a host-restart reconnect storm. Tools only; integrated in v0.2.0 (PR #27; batch PR #46). FIFO goodput plateaued and adversaries were limited without closing
healthy peers. The replication host's buffered cap retired a paused peer in 2 of 3
runs. Its finding that a queue age shorter than the real queued wait collapsed goodput
is resolved by the NW-06 follow-up (PR #33), and queue-age plateaus are now asserted. Loopback/process scope only; WAN, browsers and physical devices remain
unverified. See the [evidence](../verification/network-overload-20261002/README.md)
and the [ledger](upgrade-acceptance-ledger.md).

## Sub-path asset base (DX P1-8) — integrated in v0.2.0

Asset files from `defineAsset({ url })` are fetched under the build's public base
(`npm run build -- --base ./` or `--base /my-game/`), so a production build works from a
GitHub Pages project site or an itch.io folder. Owner: `platform/assets/public-base.ts`,
used by the texture and model libraries; a relative base is resolved against the page so
workers fetch the same file. See the [recipe](../recipes/host-under-a-sub-path.md).
Status: integrated in v0.2.0 (PR #35; batch PR #46). Evidence
is unit tests and `npm run test:subpath-browser` (every template built with `--base ./`,
mechanics also with an absolute sub-path, served by a local static server in desktop
headless Chromium). Real Pages/itch.io uploads and physical devices are unverified.

## Authored materials (DX P1-10) — integrated in v0.2.0

`Material` / `defineMaterial` (author API) give a `Shape` a texture asset with repeat and
wrap, roughness, metalness, emission and transparency, drawn as a `MeshStandardMaterial`;
shapes without it keep the original matte material. Owner: the scene visit
(`author/scene-materials.ts`); textures are leases from the shared texture library, and anisotropy follows the
`textures.anisotropy` quality knob capped by the context. Wrap is part of the library key
(counted by residency); one view per (texture, wrap, repeat) is shared per visit, and plain
fields change in place. See the
[recipe](../recipes/give-a-shape-a-material.md). Status: integrated in v0.2.0 (PR #36; batch PR #46). Evidence: unit
tests and `npm run test:material-browser` (desktop headless Chromium, software GL); the
mechanics template demonstrates it with draws and triangles unchanged. No physical-device
or visual-quality acceptance; texture maps beyond the colour map are out of scope (`Mesh`
and `Model` materials: see material options below).

## Post-processing (VIS-07) — implemented, candidate

**Current status (2026-10-04): implemented, candidate (PR `feat/post-processing`); not integrated.** `view.post` on
`defineScene` (bloom, vignette, grade; `ctx.view.post` live) drawn at the player's `post.mode` tier, the registered
knob now wired: `off` (low) draws direct, `basic` (medium) adds one combined pass (tone map from `view.output`, grade
and vignette in display values, sRGB), `full` (reference, high) adds a half-resolution 5-mip bloom chain (10 post
draws). Owner `platform.render.post`: backend-neutral settings and plan (`src/platform/render/post/settings.ts`), GLSL
implementation in the WebGL2 backend (`backends/webgl/post.ts`, a lazy chunk, 6.1 kB min / 2.6 kB gzip). Bounds: every
field validated, naming it. Overload: none (no queue). Render on change: post runs only inside a drawn frame; a still
scene draws nothing. Targets allocated on the first composed frame, reallocated only on size, sample or bloom change,
disposed with the visit. Failure: an invalid runtime value keeps the last valid settings; a chunk, context or pipeline
failure is reported once and the visit draws direct; a WebGPU visit reports no implementation. A kit render override
(`@kits/three`) takes precedence. **Budget contract change, stated:** post passes are counted apart as `postDraws`
(probe bracket, bench, gate, derive, play:snap); `draws` keeps measuring scene draws. Evidence: unit tests and
`npm run test:post-browser` (courtyard fixture, reference, medium and low; exact 10/1/0 post draws, equal scene draws,
bloom beside an emissive box at full only, a still scene draws no frame, release audit at the author-API baseline);
`quality:guard` identical for the blank and explorer templates. No reference-GPU cost, physical-device or
visual-quality acceptance; the stock shell does not install the Graphics screen, so the live knob is unit-tested only.
See the [guide](post-processing.md).

## Three.js escape hatch (VIS-09) — implemented, candidate

**Current status (2026-10-03): implemented, candidate (PR `feat/kit-three`); not integrated.** Optional kit
`@kits/three` for a game that lists `three()` in `defineGame({ kits })`: `three`, `three/addons/*` and
`three/examples/jsm/*` imports in that game's files only (`lint:layers`), and per scene, with
`defineScene({ extensions: [sceneThree()] })`, the handle `useThree(ctx)` (scene, kit-owned `root`, camera, renderer,
canvas, `requestRender`, `onFrame`, `onBeforeRender`, `onResize`, `setRenderOverride`, `own`) plus
`customObject({ create, update, dispose })` with `ThreeObject`. Engine seam: the genre-neutral render extension
(`author/scene-extension.ts`, opaque `SceneExtension` in `@engine`). Owner: the scene visit; the kit owns its `root`,
owned resources and custom objects and disposes them before the scene's tree. Bounds: `sceneThree({ max })` custom
objects per scene (default 16, cap 256) and per-object triangle and texture `limits`; refusals reported once. Overload:
refusal, never a late draw. Cancellation and recovery: visit exit disposes everything; a throwing session, hook or
override is reported and closed or dropped for the visit, and the engine-owned render target, size and pixel ratio are
restored after game code. Evidence: unit tests (handle lifecycle, disposal registry, custom objects, lint allowance)
and `npm run test:three-kit-browser` on the courtyard fixture (desktop and phone-sized headless Chromium, software
GL): point-lit lanterns, shadows and UnrealBloom through an EffectComposer, counted draws within the fixture's rows, a
still scene drawing no frame, and nothing left in the renderer pool's release audit. **Unstable across three.js
upgrades by contract.** Not yet: WebGPU refusal of WebGL-only materials, a dev warning for unreported changes, an
upgrade-time changelog of breaking three.js changes beyond the fixture compile. No template uses it; no
physical-device, GPU timing or visual-quality acceptance. See the [recipe](../recipes/use-three-directly.md).

## Particle emitters (FX-01) — integrated

**Current status (2026-10-03): integrated.** PR #63 (PR merge `b7b5550`) reached `main` through merge-train batch PR #65, merged to `main` at `1f9d10d` on 2026-10-03. Main CI run 37086722080 on `1f9d10d` failed: the arcade template's active bench window drew no frame (perf inconclusive), the ended-visit defect later fixed by PR #75. The next main CI, run 37088378582 on `2fb6e69` (which contains batch 7), passed. Not in any release: v0.2.0 (`071e3c2`) predates it. "Integrated" is source delivery; the evidence scope below is unchanged and the candidate-era status is kept as history.

`Emitter` / `defineEmitter` / `burst` (author API) give an entity with a `Transform` burst or
continuous particles with lifetime, speed, spread, gravity, drag, size/colour/opacity curves,
an optional texture and additive or normal blending, in scenes that opt in with
`sceneParticles()`. Owner: the scene visit
(`author/particle-sim.ts` on the fixed step, `author/scene-particles.ts` for drawing); one
instanced draw per emitter with live particles, none while idle. Bounded per emitter and per
scene with counted drops and reported refusals; the `effects.particles` knob thins
non-essential emitters on lighter presets. See the
[recipe](../recipes/hit-sparks-and-pickups.md) and [guide](particles.md). Status before
integration: implemented, candidate. Evidence: unit tests and
`npm run test:particle-browser` (desktop headless Chromium, software GL). No template uses it,
so template budgets are unchanged. No physical-device, GPU timing or visual-quality
acceptance.

Flipbooks (FX-01a, integrated in PR #141, merge `4c4f156`): `frames` on an emitter plays a sprite sheet
per particle (`over-life`, `loop`, `random-start`), still one draw per emitter, grid capped at 16 × 16; `npm run
fx:pack` packs a PNG sequence into a sheet and JSON sidecar. See the [guide](particles.md#flipbooks-sprite-sheets).

Calm follow-up (FX-01b, PR #171): under Calm (reduced motion) non-essential emitters add no particle and live
particles hold still and fade out; essential ones still show, held at the spawn point. Spawn attempts, the particles'
stream and despawn ticks are unchanged (presentation only). Evidence: unit tests and `play:snap -- --calm` on the
explorer and showcase templates (desktop headless Chromium); see the [guide](particles.md#calm-reduced-motion).

## Material options (VIS-04) — implemented, checked in PR #127

`Material` gains `shading` ('standard', 'matte', 'flat', 'toon' with `toonSteps`), `side`, `alphaCutoff` and
`vertexColors`, and now applies to `Mesh` (`defineMesh`; no textures, which need texture coordinates) and to `Model`
(per-entity overrides of the model's own materials; fields at their defaults keep the model's values). Owner: the
scene visit (`author/scene-materials.ts`, `author/model-looks.ts`). Bounded program set (three material classes,
two-valued options), shared toon gradients and model overrides released with their last user; no shader hooks, so
batching eligibility and the ADR 0078 seam hold. See the [guide](material-options.md) and
[recipe](../recipes/give-a-shape-a-material.md). Evidence: unit tests, the recipe's code as a test and
`npm run test:material-options-browser` (desktop headless Chromium, software GL); templates draw identically. No
physical-device, GPU timing or visual-quality acceptance.

## Instanced scatter (VIS-06) — implemented, checked in PR #144

`Scatter` / `defineScatter` / `sceneScatter` (author API) draw many copies of a primitive `Shape` or a `Mesh` as one
instanced draw per scatter, placed by exact points or a rect, ring or edge area, with scale, yaw, tilt and colour
jitter, and shaded by the entity's `Material`. Owner: the scene visit (`author/scene-scatter.ts`, a lazy chunk;
placement and admission in `author/scatter-field.ts`; instances from `platform/render/batching/instance.ts`).
Placement uses a stream derived from the scene id, `seed` and `?seed=`, never `ctx.random()` (regression-tested).
Bounded per scatter (65,536) and per scene (`max` 32, `instances` 65,536 by default) with counted, reported refusals;
the `effects.scatter-density` knob thins non-essential scatters to a nested deterministic subset. One draw per scatter;
triangles counted per copy. See the [guide](scatter.md) and [recipe](../recipes/scatter-grass-and-rocks.md). Evidence:
unit tests, recipe test and `npm run test:scatter-browser` (desktop headless Chromium, software GL). No template uses
it, so template budgets are unchanged. glTF `Model` scatter is a follow-up. No physical-device or GPU timing
acceptance.

## Game sound files (DX P1-10) — integrated in v0.2.0

`defineAsset({ type: 'audio' })` files play through `ctx.play(id, { volume, pitch,
position })` and `ctx.playVoice`, with a scene's `sounds` fetched while it loads. Owner:
the one audio output (`platform.audio`) with `platform/audio/sound-files.ts` keeping and
decoding files; mute, effects volume, autoplay unlock, hidden tabs and automation silence
apply unchanged. See the [recipe](../recipes/play-your-own-sounds.md). Status: integrated in v0.2.0 (PR #37; batch PR #46). Evidence: unit tests with an injected AudioContext and
`npm run test:sound-browser` (loading, reporting and silence only: automated browsers never
decode or play). Audible playback, latency and loudness on physical devices are unverified;
streaming and looping are out of scope. Sound files share AUD-01's voice chain (HRTF limit,
distance models, cutoff, filter) through `ctx.playVoice`. Integrated with PR #57 (2026-10-02, batch PR #62,
`main` `6485572`; earlier a candidate):
`testScene` validates `playVoice` options as the output does and records them in `t.voices`,
so game tests can assert spatial choices; this checks options only, never audible output.
`testScene` also refuses a `ctx.play` / `ctx.playVoice` id that is neither a built-in cue
(`BUILT_IN_CUES`) nor one of the scene's `sounds` (or its `sounds` option), where a browser
only warns; integrated with PR #57. Unit-tested only; `ctx.playMusic` ids are not checked.

## Audio-clock timeline (AU-01) — integrated in v0.2.0

Caller-owned `createAudioTimeline` composes with the existing audio output and scene
voices: it adds no context, timer or loop, and is pumped from a scene's frame system.
Integrated in v0.2.0 (PR #31; batch PR #47). See the [guide](audio-timeline.md) and the
[recipe](../recipes/sync-gameplay-to-music.md).

## Strings select/ordinals/locale chain and dialogue variables (TB-02) — integrated

**Current status (2026-10-03): integrated.** PR #50 (PR merge `d622111`) reached `main` through merge-train batch PR #62, merged to `main` at `6485572` on 2026-10-02 (main CI run 37069963774 passed on that merge). Not in any release: v0.2.0 (`071e3c2`) predates it. "Integrated" is source delivery; the evidence scope below is unchanged and the candidate-era status is kept as history.

Status before integration: implemented, candidate on branch `feat/tb02-strings-dialogue` (PR #50); not integrated. Recipes: [plurals, ordinals and variants](../recipes/write-plurals-ordinals-and-variants.md), [branching dialogue](../recipes/add-branching-dialogue.md); [dialogue kit README](../../src/kits/dialogue/README.md).

- Runtime-enforced: message parsing bounds (16,384 UTF-16 units, argument depth 8, 1,024 parts); CLDR plural categories only; `other` required for `plural`, `selectordinal` and `select`; prototype names never match select cases; locale tags Intl does not support (well-formed or malformed) resolve to `en` rules and digits through `supportedLocalesOf`, never the host default; select and plural form tables have null prototypes; locale chain explicit fallbacks, then truncation, then base, at most 8 entries. Dialogue: declared typed variables (≤256), bounded condition trees (≤64 nodes, depth 8), ≤32 assignments per option, type-checked at construction; atomic assignment with the move; `overflow` without change; visit counts saturating; snapshot validation of variables and visits (the current node must have at least one visit; prototype-named node ids keep their counts); first-version snapshots restore.
- Checked: focused unit tests (`src/core/i18n/select-ordinal.test.ts`, `src/kits/dialogue/variables.test.ts`, including a real SaveStore round trip across a fresh store); existing i18n, string-generation, dialogue and expedition tests unchanged and passing.
- Not established: a run-time locale selection author API (the running game stays `en`), translated catalogues for any template, RTL/bidi or CJK line-breaking policy, text speed or typewriter reveal, any browser or device evidence, a template using dialogue variables.

## Per-observer interest sets (SC-02) — integrated

**Current status (2026-10-03): integrated.** PR #51 (PR merge `f0f020e`) reached `main` through merge-train batch PR #62, merged to `main` at `6485572` on 2026-10-02 (main CI run 37069963774 passed on that merge). Not in any release: v0.2.0 (`071e3c2`) predates it. "Integrated" is source delivery; the evidence scope below is unchanged and the candidate-era status is kept as history.

The optional `spatial` kit adds [`createInterestSets`](interest-sets.md): per-observer,
ranked and budgeted relevancy sets over the SC-01 grid, with enter/exit hysteresis, a
hold, entered/left changes and fail-closed partial scans. A tools-only reference host
feeds NW-02 complete scoped views from them; with complete scans, no frame or revision
reveals activity outside a connection's set (an `incomplete` scan can). Status before integration: implemented, candidate (PR #51); not
integrated. Evidence is unit, reference-host and headless benchmark tests only; no socket,
browser, device or template evidence and no budget change.

## Saveable random state and input history (RNG-01, INPUT-01) — integrated

**Current status (2026-10-03): integrated.** PR #52 (PR merge `2d5f50e`) reached `main` through merge-train batch PR #62, merged to `main` at `6485572` on 2026-10-02 (main CI run 37069963774 passed on that merge). Not in any release: v0.2.0 (`071e3c2`) predates it. "Integrated" is source delivery; the evidence scope below is unchanged and the candidate-era status is kept as history.

`createSaveableRng` lets a simulation save and restore its random generator as one
word. The optional [input-history kit](../../src/kits/input-history/README.md) adds
frame-exact edges, buffers, release edges, opposite-direction cleaning and
sequences that survive rollback. Status before integration: implemented, candidate (PR #52); not
integrated. See the [ledger](upgrade-acceptance-ledger.md).

## Music on the audio clock (AU-02) — integrated

**Current status (2026-10-03): integrated.** PR #54 (PR merge `0aa5caf`) reached `main` through merge-train batch PR #64, merged to `main` at `3b449fa` on 2026-10-03 (main CI run 37082507567 passed on that merge). Not in any release: v0.2.0 (`071e3c2`) predates it. "Integrated" is source delivery; the evidence scope below is unchanged and the candidate-era status is kept as history.

`playMusic` composes with the one audio output (its own music store and bus, no second
context) and the AU-01 timeline (start at `timeline.contextTime(0)`); scenes own their
music voices. Before integration: candidate (PR #54). See the [guide](music-on-clock.md).

## Bench dead-window guard and per-game static files (W1-4, W1-5) — integrated

**Current status (2026-10-03): integrated.** PR #59 (PR merge `4931e24`) reached `main` through merge-train batch PR #65, merged to `main` at `1f9d10d` on 2026-10-03. Main CI run 37086722080 on `1f9d10d` failed: the arcade template's active bench window drew no frame (perf inconclusive), the ended-visit defect later fixed by PR #75. The next main CI, run 37088378582 on `2fb6e69` (which contains batch 7), passed. Not in any release: v0.2.0 (`071e3c2`) predates it. "Integrated" is source delivery; the evidence scope below is unchanged and the candidate-era status is kept as history.

Perf gate behaviour change: an active bench window that renders no frame is `inconclusive`
(and fails the gate as "perf inconclusive") only when its held keys drive the scene, that
is, the scene's `budgets.json` row names them as `activeKeys`, or they press one of the
game's own input actions; otherwise it is a still window (classification version 3). If
the game's bindings cannot be read in Node, the keys are assumed to drive the scene.
Owner: `scripts/perf/bench.mjs` (`heldKeyPlan`) and `platform/perf/window-class.ts`.
Static files: Vite's `publicDir` is the game's own `public/` (root `public/` only for a game
without one); the dev server and the build stop on reserved names, symbolic links and
stranded root files (`scripts/lib/game-public.mjs`). Evidence: unit tests and a local
`npm run gate -- --game templates/expedition/game` on the PR branch, before integration.
Limits: bindings are read from default bindings, not a player's rebinding; a scene that
moves only by pointer gets no driving key, so its dead windows are not detected.

## Spatial audio sources and occlusion (AUD-02) — integrated

**Current status (2026-10-03): integrated.** PR #55 (PR merge `87c1a20`) reached `main` through merge-train batch PR #65, merged to `main` at `1f9d10d` on 2026-10-03. Main CI run 37086722080 on `1f9d10d` failed: the arcade template's active bench window drew no frame (perf inconclusive), the ended-visit defect later fixed by PR #75. The next main CI, run 37088378582 on `2fb6e69` (which contains batch 7), passed. Not in any release: v0.2.0 (`071e3c2`) predates it. "Integrated" is source delivery; the evidence scope below is unchanged and the candidate-era status is kept as history.

| ID | Contract | State |
|---|---|---|
| AUD-02 | Optional `@kits/spatial-audio` over the integrated AUD-01 voices: bounded logical sources tracked without voices (virtual) until they rank, importance ranking (class × creator `importance()`) with fade-out stealing under hysteresis, fair rotation of equal scores (starvation credit across dropped emissions) and lateness drops, a voice cap that counts fading voices, HRTF claims for `localise` classes within a kit limit (with hysteresis), per-class distance curves with a hard cutoff and air low-pass, and occlusion through a creator `(from, to) => distance \| null` query (the camera kit's `obstruction` shape) under `raysPerPump`, stalest first, with aged results, driving the output's smoothed filter. [Kit README](../../src/kits/spatial-audio/README.md) | **Integrated 2026-10-03** (PR #55 merge `87c1a20`, batch PR #65, `main` `1f9d10d`). Before integration: implemented, candidate (public PR #55). Node unit tests and `npm run test:audio-browser` (kit over the real output in `OfflineAudioContext`, muted browser: occlusion ~24 dB at 3 kHz without steps, steal fades without a cut) pass on the branch. Re-verification fixes (fair rotation, cap including fades, `stats.rotated`, rays for new emissions at a budget of 1, honest `stale`/`unqueried`, HRTF hysteresis) have Node regressions that fail on the previous head `a95497e`. Round-3 fixes (a cut voice's replacement always starts, rotation opt-in and off by default, least-recently-served fairness, priority for free slots, HRTF cap counting fading voices, no voice leak on re-entrant cancel; seeded fuzz of the caps and leaks) have Node regressions that fail on `9eb9612`. Round-4 fixes (nothing plays late by default, opt-in `carryLate` bounded to one interval, honest `dropped`/`late`/`skipped` stats, HRTF cap never delays a repeat, reservation timeout after admission, rotation inside the 1% band) have Node regressions that fail on `158ff29`. Round-5 fixes (late `carryLate` emissions may rotate in again within their one-interval bound, a 64-setup fairness table test, lateness epsilon, docs on late starts after hitches) have Node regressions that fail on `be71bc7`. No template consumer. No listening trials, real level geometry or query cost, propagation, device cost or networking claim. |

## Large edited worlds (GEN-02) — integrated

**Current status (2026-10-03): integrated.** PR #56 merged directly to `main` at `2fb6e69` on 2026-10-03; main CI run 37088378582 passed on that merge. The recipe's data-loss pattern (acknowledging a revision read after the await) was corrected by PR #95 (`0a09710`, main CI run 37150583760 passed) with the regression `GEN-02 acknowledging a pending save retains edits made after submission`. Not in any release: v0.2.0 (`071e3c2`) predates it. "Integrated" is source delivery; the evidence scope below is unchanged and the candidate-era status is kept as history.

GEN-02 adds a bounded binary record store for edited worlds beside the save store.
`src/core/save/chunk-port.ts` is the only IndexedDB user (lint rule `indexed-db`).
`chunk-store.ts` owns:
- atomic multi-record writes with in-transaction revision checks;
- the creator's schema number;
- CRC-32 quarantine before any overwrite;
- bounded limits and opt-in least-recently-used eviction;
- a `session` memory fallback when IndexedDB is unavailable.

`createCellEdits` in the procgen kit stores only the cells that differ from content
regenerated by GEN-01. Status before integration: implemented, candidate (PR, `feat/gen02-chunk-store`);
not integrated. Evidence is focused tests over an in-repo IndexedDB fake and one desktop
Chromium real-IndexedDB check. See the [recipe](../recipes/store-large-world-records.md)
and the [ledger](upgrade-acceptance-ledger.md).

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

## Scene look (VIS) — in progress

Opt-in visual data for a scene, owned by the scene visit (the [scene look guide](scene-look.md)). Output (VIS-01):
`view.output` sets tone mapping and exposure through the renderer lease; the defaults keep every existing picture
byte-identical (picture guard on blank and explorer). Status: integrated (PR #124, merge `522815f`). Evidence:
unit tests and `npm run test:output-browser` (desktop headless Chromium, software GL). No physical-device acceptance.
Local lights (VIS-02): `PointLight`/`SpotLight` components claim fixed per-visit slots from `sceneLights()`, capped by
the `lights.local-max` knob; overflow is refused and reported once per cause. Status: integrated (PR #138, merge
`ef0d1bb`). Evidence: unit tests and `npm run test:lights-browser`. No physical-device fill-rate acceptance. A non-essential light refused only by
the quality tier is reported once at info level (cause `tier`, PR #172); an essential one refused is an error.
Shadows (VIS-03): `sceneShadows()` per scene, `directional.shadow` for the sun, `shadow: true` on local lights and a
per-entity `Shadow`; shadowed local slots fixed per visit and bounded by `lights.shadowed-max`; maps redraw only on
change. Status: integrated (PR #148, merge `e84afcf`). Evidence: unit tests and `npm run test:shadows-browser`.
Sky and haze (VIS-05): `defineEnvironment({ sky })` draws a gradient sky with optional discs and stars from
one texture on an unlit sphere; `haze` gains `exp2` and `color: 'sky'`. Status: implemented and checked as a candidate PR #150. Evidence: unit tests and `npm run test:sky-browser`.

## Asset provenance and AI disclosure (DX-03) — implemented, candidate

Tooling, not runtime: per-file provenance records, a `npm run check` step and a disclosure draft (the
[asset provenance guide](asset-provenance.md)). Status: implemented and checked on its PR branch; not integrated until merged.

| ID | Contract | State |
|---|---|---|
| DX-03 | Asset provenance and AI disclosure: one record per shipped model, texture and sound (beside the file as `<name>.provenance.json`, or in `<game>/assets.provenance.json`) with origin (`hand`, `agent-blender`, `ai-generator`, `library`), author, licence, source, SHA-256 and, for AI origins, tool, model, prompt or reference, human edits and (generators) weights and output licences; `tooling` and `liveGenerated` for what is not a file. `lint:provenance` in `npm run check` warns by default and fails when the brief sets `assets: { provenance: 'required' }`; `npm run disclosure` drafts Steam (pre-generated, live-generated, tooling apart) and itch.io (Graphics, Sound, Text & Dialog, Code) text. Owner: the creator writes records; `scripts/lib/provenance.ts` only reads. [Guide](asset-provenance.md) | **Implemented and checked (candidate PR, 2026-10-03).** Evidence: focused tests (`scripts/lib/provenance.test.ts`, `src/author/build.test.ts`) and `npm run check`. Tooling only: no runtime, browser or store-acceptance claim; licence claims are not verified; `defineAsset` fields are not cross-checked; no stock template has records yet (the mechanics template's nine files and the showcase template's two textures warn). |


## Service assignment experiment — isolated candidate, 2026-10-09

`tools/service-assignment-lab/` contains an unexported bounded ownership prototype with service-request and weighted-worksite fixtures. It demonstrates exclusive actor claims, generation-scoped token refusal, capacity admission, atomic failed-transfer preservation, bounded explicit retry withdrawals and disposal. It adds no installed kit, scheduler, thread, persistence adapter or product API. [Contract and limitations](service-assignment-lab.md).

Evidence: 15 focused Node tests passed, including a 600-command independent allocation model and 1000 admission/removal cycles; both Node fixtures ran, and `npm run check` passed with the one prototype test file selected (15/15). Integration gates, browser behavior and physical-device performance are not accepted by this evidence. This entry records a branch candidate, not integration or production readiness.


## Optional assignment kit candidate — ASG-01, 2026-10-09

The independently implemented `@kits/assignments` helper graduates the service/worksite ownership mechanism into a typed optional public surface. It retains bounded actors, targets, weighted claims and retry counts, preserves existing claims on failed transfer, rejects retired tokens, and supports explicit disposal. Existing navigation/command/save/inventory owners keep their responsibilities; no matching policy, global scheduler or persistence format is added. The original lab now imports the kit through two consumer modules. [Contract](assignments.md).

Evidence: 23 focused tests passed (8 typed kit/consumer tests plus 15 retained lab regressions), including real route-owner cancellation, stale result rejection, an independent allocation model and bounded churn. `npm run check` passed with 27/27 tests across four selected files, and the migrated demo ran successfully. This is a local candidate; hosted/full integration gates, playable consumers and browser/physical-device acceptance remain pending.

## Editable itinerary lab — candidate, 2026-10-09

Optional headless prototype in tools/itinerary-lab; no engine export. Nineteen
focused controller/consumer tests and scoped strict typechecking passed. Patrol
and delivery/service fixtures exercise edits and retired completions. Synthetic
custody is not SaveStore/resource transaction evidence. No browser, full gate or
physical-device acceptance. See [contract and limitations](itinerary-lab.md).

## Public itinerary helper — graduation candidate, 2026-10-09

ITINERARY-01 exposes createItinerary from @kits/itinerary with caller-owned lifetime
and no registration or execution owner. The lab now consumes this implementation.
Base: reviewed prototype e7aa2e55; branch feat/itinerary-kit. Twenty-four focused
tests and scoped strict typechecking passed, including a real SaveStore/fresh-store
round trip. This supersedes the prototype's unexported status, not its evidence
limits. No full gate, browser, durable custody transaction or physical-device claim;
not integrated. See the [contract](../../src/kits/itinerary/README.md).

### Interaction alignment prototype — 2026-10-09

Unexported planar alignment candidate: [contract and limits](interaction-alignment-lab.md). Creator-owned poses, clock and clearance assertions; bounded approach proposals and identity-checked prepare/acknowledge tickets. Observed drift revokes prepared tickets even during paused or zero-duration calls. Ten focused tests pass; independent review completed. Hosted integration CI is pending. No collision oracle, movement owner, public kit export, performance claim or physical-device acceptance.

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


## Optional shared-session liveness — candidate (2026-10-09)

The existing session client accepts paired connection/host deadlines and the host
can refresh its existing one-credit view on ping. Defaults remain unchanged; no
new timer or protocol owner. See [the contract](multiplayer-session.md#optional-host-liveness).
Focused unit and real loopback acceptance is recorded in the upgrade ledger;
independent review and full hosted integration CI remain required.


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
check passed 18 tests. Full hosted CI remains required. See ADR 0087.
