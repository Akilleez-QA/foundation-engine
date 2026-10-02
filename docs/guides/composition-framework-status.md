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
| Asset residency (RES-01) | Optional per-preset texture/model byte budgets, pinned asset ids and a pressure hook over the existing lease caches | Integrated in v0.2.0 (PR #22, merged to main at `9913019`). Unit tests and a native software-renderer fixture only; defaults unchanged; no template configures it. See [asset residency](asset-residency.md). |
| Multiplayer: peer rollback (RB-01) | Optional `@kits/rollback` session (prediction window, input delay, rollback/resimulation, confirmed-state checksums) and local sync test, driven from the fixed lane | Integrated in v0.2.0 (PR #25; batch PR #42). Focused headless tests and a `testScene` consumer only; requires a reliable, ordered link; no WAN, time-sync, spectator or device claim. See the [kit README](../../src/kits/rollback/README.md). |
| Multiplayer: seeded fault schedules (NW-09) | Tool-only `npm run faults:network` harness replaying seeded combined faults against the authority workbench host with per-step invariants and exact seed/step repro | Integrated in v0.2.0 (PR #26; batch PR #42). Process-scope loopback evidence only; no WAN, power-loss, scale or device claim. See [guide](network-fault-schedule.md) |
| Multiplayer: planned drain and lifetime (NW-08) | Optional host `createConnectionDrain` (bounded notice, operator drain/resume, dithered lifetime cap) and client `createDrainFollower` (hold until announced return, then the existing retry schedule) | Integrated in v0.2.0 (PR #21; batch PR #42). Unit, host socket and loopback browser tests; defaults unchanged; no process-restart, WAN or device claim. See the [drain guide](network-drain.md). |
| Movement feel: jump (MV-01) | Pure `createJumpFeel` (exact piecewise gravity, coyote, buffer, variable height, apex gravity, terminal fall) and the optional `jumpSystem` adapter in the locomotion kit; opt-in `hold: true` author buttons | Integrated in v0.2.0 (PR #34; batch PR #46). Focused unit tests at 30–240 Hz only; no template consumer, browser or device evidence. Moving-platform carry, slopes, swept lateral collision and vehicles remain separate slices. |
| Multiplayer: command integrity (SEC-01) | Optional host-side `createIntegrity`: pure validity `assess` for authority reducers, `admit`/`record` policy with decaying scores, tick budget, throttle, windowed close, observe mode and bounded local audit; `assertDisclosure` test helper; network workbench opt-in example | Slice A integrated in v0.2.0 (PR #20; batch PR #47). Unit and loopback host tests only; verified runs (slice B) planned, not built. See the [integrity guide](integrity.md). |
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
or visual-quality acceptance; `Mesh`/`Model` and texture maps beyond the colour map are out
of scope.

## Game sound files (DX P1-10) — integrated in v0.2.0

`defineAsset({ type: 'audio' })` files play through `ctx.play(id, { volume, pitch,
position })` and `ctx.playVoice`, with a scene's `sounds` fetched while it loads. Owner:
the one audio output (`platform.audio`) with `platform/audio/sound-files.ts` keeping and
decoding files; mute, effects volume, autoplay unlock, hidden tabs and automation silence
apply unchanged. See the [recipe](../recipes/play-your-own-sounds.md). Status: integrated in v0.2.0 (PR #37; batch PR #46). Evidence: unit tests with an injected AudioContext and
`npm run test:sound-browser` (loading, reporting and silence only: automated browsers never
decode or play). Audible playback, latency and loudness on physical devices are unverified;
streaming and looping are out of scope. Sound files share AUD-01's voice chain (HRTF limit,
distance models, cutoff, filter) through `ctx.playVoice`.

## Audio-clock timeline (AU-01) — integrated in v0.2.0

Caller-owned `createAudioTimeline` composes with the existing audio output and scene
voices: it adds no context, timer or loop, and is pumped from a scene's frame system.
Integrated in v0.2.0 (PR #31; batch PR #47). See the [guide](audio-timeline.md) and the
[recipe](../recipes/sync-gameplay-to-music.md).

## Per-observer interest sets (SC-02) — implemented, candidate

The optional `spatial` kit adds [`createInterestSets`](interest-sets.md): per-observer,
ranked and budgeted relevancy sets over the SC-01 grid, with enter/exit hysteresis, a
hold, entered/left changes and fail-closed partial scans. A tools-only reference host
feeds NW-02 complete scoped views from them without frames or revisions that reveal
hidden activity. Status: implemented, candidate (PR #51); not
integrated. Evidence is unit, reference-host and headless benchmark tests only; no socket,
browser, device or template evidence and no budget change.
