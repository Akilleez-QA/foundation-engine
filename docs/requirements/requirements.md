# Foundation Engine software requirements specification

| Field | Value |
|---|---|
| Document ID | FENGINE-SRS |
| Version | 2.2 |
| Status | Baselined |
| Owner | Akilleez-QA |
| Date | 2026-11-10 |
| Baseline commit | `a9e8cc6f175b5055b18abf26579ecc432a6ac53b` |
| Applies to | foundation-engine main at baseline commit |
| Classification | Self-assessed Class E analog; not safety-critical (see [SMP §1](../plan/software-management-plan.md#1-software-classification-self-assessed)) |

> Organized after [NPR 7150.2D](https://nodis3.gsfc.nasa.gov/displayAll.cfm?Internal_ID=N_PR_7150_002D_&page_name=all), [NASA-STD-8739.8B](https://standards.nasa.gov/standard/nasa/nasa-std-87398) and the [NASA Software Engineering Handbook](https://swehb.nasa.gov/display/SWEHBVD/7.18+-+Documentation+Guidance) documentation guidance. This is not a NASA compliance determination or certification. The software classification is a self-assessed analog (Class E, not safety-critical); no NASA authority, independent verification and validation, or hazard analysis is asserted. The document describes the implementation inspected at the baseline commit.

## 1. Introduction

Foundation Engine is a TypeScript and three.js engine for browser games. It ships a
typed kernel, browser platform services, an author API, optional kits, starting
templates and repository tooling. This register states what the engine and its
tooling shall do. Each requirement describes behavior that exists at the baseline
commit and that a named test, analysis or inspection checks. It does not impose
mechanics on independently authored games.

The detailed contracts stay in the [architecture standard](../STANDARD.md), the
[creator contract](../CREATOR-CONTRACT.md) and the generated
[capability inventory](../capabilities.md). This register selects the obligations that
are traced end to end. It is not a renumbering of every standard clause or kit
contract. Kit-specific behavior is listed in the capability inventory and verified
by each kit's own tests; it is not restated here.

### 1.1 Fields

Each requirement row has:

- **ID**: stable identifier. Existing IDs are kept; a removed requirement keeps its row with status Deleted. IDs are never reused.
- **Requirement**: one "shall" statement.
- **Rationale**: why the obligation exists.
- **Derivation**: the source path or paths that implement it.
- **Allocated to**: the [design description](../architecture/architecture.md) section that owns it.
- **Method**: T test, A automated analysis, I inspection, D demonstration.
- **Status**: Baselined (checked at the baseline commit), Proposed or Deleted.

The [verification matrix](../verification/verification-matrix.md) names the test or
check for each ID and its last result. `npm run lint:trace` fails when a requirement
lacks a row in the matrix's current trace (§2), a matrix row cites a file that does not exist, or a requirement is
not allocated to a design section.

### 1.2 Not applicable requirement categories

- Safety requirements (SWE-184): N/A. The software is not safety-critical and no hazard analysis assigns it a hazard cause, control or mitigation.
- Hardware interface, board support package, partitioning and operating-system requirements: N/A. The engine runs in a browser or Node.js on general-purpose computers and commands no hardware.
- Control-system requirements: N/A. The engine controls no physical process.

TBD count at this baseline: 0.

## 2. Kernel requirements

| ID | Requirement | Rationale | Derivation | Allocated to | Method | Status |
|---|---|---|---|---|---|---|
| REQ-BOOT-001 | Modules shall follow the declared boot phases and the kernel shall reject invalid dependency graphs. | Validation precedes installation, so a bad graph never half-installs. STANDARD, module system. | `src/core/module.ts`, `src/core/app.ts` | SDD §2.1 | T | Baselined |
| REQ-BOOT-002 | Boot shall run discover, register, patch, freeze, validate, install and start in that order, disabling every member of a `requires` cycle and isolating a module that throws. | One failing module must not take down unrelated modules. ADR 0003. | `src/core/app.ts` | SDD §2.1 | T | Baselined |
| REQ-BOOT-003 | The kernel shall reject a second owner of a service key, event area or registry before install. | Duplicate owners create two sources of truth. STANDARD, services. | `src/core/app.ts`, `src/core/services.ts` | SDD §2.1 | T | Baselined |
| REQ-DATA-001 | Open content sets shall use validated registries that freeze before consumption. | Consumers need stable registered definitions. ADR 0005. | `src/core/registry.ts` | SDD §2.1 | T | Baselined |
| REQ-PATCH-001 | Content patches shall run in module pass order, before registries freeze. | Content packs edit content they do not own in a predictable order. ADR 0006. | `src/core/patch.ts` | SDD §2.1 | T | Baselined |
| REQ-APP-001 | A development boot with a broken registry row shall fail with a readable `BootValidationError`. | Authors see the bad row instead of a silent drop. | `src/app/modules.ts`, `src/app/boot-failure.ts` | SDD §2.1 | T | Baselined |
| REQ-EVT-001 | Typed events shall be delivered synchronously, in subscription order, over a snapshot of listeners, and one throwing listener shall not starve the others. | Event delivery must be predictable and fault-isolated. ADR 0004. | `src/core/events.ts` | SDD §2.2 | T | Baselined |
| REQ-LOOP-001 | Activities shall share the engine loop and request rendering only when invalidated. | One scheduler owns activity timing; idle scenes do not render. ADR 0015. | `src/core/activity/loop.ts` | SDD §2.3 | T | Baselined |
| REQ-ACT-001 | An activity shall release what it owns in reverse order on leave, including when its enter throws. | Resources must not leak across scene changes. | `src/core/activity/activity.ts` | SDD §2.3 | T | Baselined |
| REQ-CLOCK-001 | Only the clock driver shall step game time, and offline catch-up shall be capped at 7 days. | Time has a single authority; a long absence cannot spiral. ADR 0033. | `src/core/clock.ts`, `src/core/player-clock.ts` | SDD §2.3 | T | Baselined |
| REQ-ROUTE-001 | The router shall never activate a superseded scene load; of overlapping loads A, B, C only the latest request activates, once. | Late loads must not overwrite the current scene. ADR 0022. | `src/core/router/handover.ts` | SDD §2.4 | T | Baselined |
| REQ-ROUTE-002 | Route resolution shall stop redirect cycles at a hop limit, and two scenes claiming one route shall fail validation. | Bad routing data must fail before it runs. | `src/core/router/resolve.ts`, `src/core/router/module.ts` | SDD §2.4 | T | Baselined |
| REQ-SAVE-001 | The save store shall preserve typed section ownership, migrations and invalid-data recovery. | Persisted state must not bypass section contracts. ADR 0007. | `src/core/save/store.ts` | SDD §2.5 | T | Baselined |
| REQ-SAVE-002 | Saves written by v0.2.0 shall load with current code and keep their exact bytes across flush and reload; a future-version envelope shall stay read-only. | Players keep their progress across upgrades. | `src/core/save/store.ts`, `src/core/save/fixtures/v0.2.0` | SDD §2.5 | T | Baselined |
| REQ-SAVE-003 | A multi-record chunk write shall be atomic, and revisions shall be compared inside the transaction. | A quota failure or a second tab must not leave partial or overwritten data. | `src/core/save/chunk-store.ts` | SDD §2.5 | T | Baselined |
| REQ-SET-001 | Feature flags shall resolve URL, then override, then detection, then default, and production shall refuse development-only flags from every source. | Debug features must not reach production builds. | `src/core/settings/features.ts` | SDD §2.6 | T | Baselined |
| REQ-I18N-001 | A key missing in a locale shall fall back per key to `en`, and the message parser shall reject malformed text. | Missing translations degrade to readable text, not to errors. ADR 0021. | `src/core/i18n/i18n.ts` | SDD §2.6 | T | Baselined |
| REQ-RNG-001 | Seeded random streams shall be pure functions of their seed and name, independent of call order. | Replays and procedural generation need reproducible randomness. | `src/core/rng.ts` | SDD §2.7 | T | Baselined |
| REQ-DMATH-001 | The optional deterministic maths module shall reproduce the committed golden vectors bit for bit. | Lockstep and replay need identical numbers on every run. | `src/core/dmath.ts`, `src/core/dmath.golden.json` | SDD §2.7 | T | Baselined |
| REQ-ECS-001 | The ECS runner shall make fixed steps independent of frame rate, isolate a throwing system, and skip entities despawned during query iteration. | Simulation results must not depend on display timing or crash on one bad system. | `src/core/ecs/systems.ts`, `src/core/ecs/world.ts` | SDD §2.7 | T | Baselined |
| REQ-SIM-001 | The simulation host shall produce bit-identical state after N steps whatever the frame timing. | Deterministic simulation under 30, 60 or 144 Hz displays. | `src/domain/sim/host.ts` | SDD §2.7 | T | Baselined |

## 3. Platform and author requirements

| ID | Requirement | Rationale | Derivation | Allocated to | Method | Status |
|---|---|---|---|---|---|---|
| REQ-INPUT-001 | Keyboard movement shall be bound by physical key code, and key release shall release by code. | Movement works on any keyboard layout, and Shift or Caps Lock cannot strand a key. | `src/platform/input/keyboard.ts` | SDD §2.8 | T | Baselined |
| REQ-INPUT-002 | Blur, page hide, a hidden page and opening a UI layer shall cancel held input. | Keys must not stay pressed after focus leaves the game. | `src/platform/input/index.ts`, `src/platform/input/held.ts` | SDD §2.8 | T | Baselined |
| REQ-ASSET-001 | The asset lease cache shall share one fetch per key among concurrent requesters, bound its warm cache in bytes, and never evict a live lease. | Assets load once and memory stays bounded. ADR 0023. | `src/platform/assets/lease-cache.ts` | SDD §2.9 | T | Baselined |
| REQ-ASSET-002 | The asset manifest gate shall reject missing licences, bad ids, shared or absolute paths, and format or SHA-256 mistakes. | Shipped assets keep provenance and stable identity. | `src/platform/assets/manifest.ts` | SDD §2.9 | T | Baselined |
| REQ-ASSET-003 | A model that arrives after its owner left shall be disposed on arrival, never handed out. | Prevents GPU memory leaks on fast scene changes. | `src/platform/assets/models.ts` | SDD §2.9 | T | Baselined |
| REQ-GAME-001 | Game systems shall use registered actions, keyed text and seeded engine randomness. | Input portability, localization and replay need explicit APIs. STANDARD, authoring contracts. | `scripts/lint/game-rules.mjs` | SDD §2.10 | A, T | Baselined |
| REQ-TPL-001 | Every template shall be complete, consistent with its brief and boot. | Templates are the first thing a creator runs. | `templates/blank/game/game.ts`, `scripts/lint/brief.ts` | SDD §2.10 | T | Baselined |
| REQ-COMPAT-001 | The retained v0.2.0 arcade template shall compile and pass its released tests against the current author API. | Games built on a released version keep working. | `scripts/fixtures/compatibility`, `src/author/index.ts` | SDD §2.10 | T | Baselined |
| REQ-ARCH-001 | Engine dependencies shall respect the declared layer boundaries. | Downward dependencies keep owners replaceable. ADR 0031. | `scripts/lint/layers.mjs`, `scripts/lint/architecture.mjs` | SDD §2.11 | A, T | Baselined |
| REQ-PURE-001 | A pure kit package shall run without the Foundation runtime or three.js and shall reject renderer or runtime imports, including type-only and dynamic ones. | A pure kit can be reused outside the engine. | `scripts/package-pure.mjs` | SDD §2.11 | T | Baselined |
| REQ-DEV-001 | Development replay shall reproduce a recorded seeded visit exactly under another frame grouping and refuse corrupted or oversized logs. | Divergence debugging needs exact replays and safe input handling. | `src/dev/replay.ts` | SDD §2.12 | T | Baselined |
| REQ-HOST-001 | The local session host shall close a client with a wrong join code with WebSocket code 1008 and refuse weak codes. | Local multiplayer sessions are not open to anyone on the network. | `scripts/host.mjs`, `src/kits/network/session-host.ts` | SDD §2.12 | T | Baselined |

## 4. Browser-verified requirements

These are verified by the muted browser harness. A Node-only run does not verify them.

| ID | Requirement | Rationale | Derivation | Allocated to | Method | Status |
|---|---|---|---|---|---|---|
| REQ-DMATH-002 | Deterministic maths results in Chromium shall equal the committed golden vectors and the Node results. | Cross-engine lockstep needs identical bits in browser and host. | `src/core/dmath.ts`, `scripts/play/dmath-check.mjs` | SDD §2.13 | T | Baselined |
| REQ-SUBPATH-001 | A production build served from a sub-path shall load every declared template file from that sub-path with no 4xx or 5xx response. | Static hosts serve games under a folder, not the site root. | `scripts/play/subpath-check.mjs` | SDD §2.13 | T | Baselined |
| REQ-SESSION-001 | Two browser clients of the shared-world template shall join one local host, see each other's actions, and ride out a host restart with bounded reconnects. | The local multiplayer building blocks work end to end. | `scripts/play/session-check.mjs`, `scripts/host.mjs` | SDD §2.13 | T | Baselined |

## 5. Repository tooling requirements

| ID | Requirement | Rationale | Derivation | Allocated to | Method | Status |
|---|---|---|---|---|---|---|
| REQ-PERF-001 | A scene budget increase shall carry an explicit reviewed budget-change trailer. | Quality limits must not change silently. ADR 0025. | `scripts/perf/budget-ratchet.mjs` | SDD §3.1 | A, T | Baselined |
| REQ-TOOL-001 | `npm run check` shall select the tests a change can affect, including committed branch changes, dirty and untracked files, and shall report a zero selection explicitly. | Fast local feedback without a silent "nothing ran" pass. | `scripts/check.mjs` | SDD §3.1 | T | Baselined |
| REQ-CI-001 | The CI result job shall require every expected work job to succeed, accepting only the skips its event type allows. | A skipped or missing job must not read as green. | `scripts/ci-results.mjs` | SDD §3.2 | T | Baselined |
| REQ-CI-002 | The CI path filter shall treat only `docs/` and Markdown files as non-code and shall fail open when a commit SHA is missing. | Code changes always run the full suites. | `scripts/ci-changes.mjs` | SDD §3.2 | T | Baselined |
| REQ-CI-003 | `npm run gate:ci` shall run every run step of `ci.yml` locally except the documented setup-only steps, and shall fail on workflow features it cannot mirror. | Local reproduction of CI must not silently skip work. | `scripts/gate-ci.mjs` | SDD §3.2 | T | Baselined |
| REQ-CI-004 | Template gate shards shall together cover each discovered template exactly once. | No template escapes the gate when templates are added. | `scripts/gate-templates.mjs` | SDD §3.2 | T | Baselined |
| REQ-REL-001 | `npm run deploy:production` shall release only from a clean `main` equal to `origin/main`. | Production builds come from reviewed source only. | `scripts/deploy-production.mjs` | SDD §3.3 | T | Baselined |
| REQ-CHG-001 | Changelog fragments shall each be one bold-titled bullet with a kebab-case name, a final newline and at most 24 lines. | Parallel PRs add release notes without conflicts. | `scripts/changelog.mjs` | SDD §3.3 | T | Baselined |
| REQ-SEC-001 | Every dependency install script shall have a reviewed `allowScripts` entry. | Unreviewed install scripts are a supply-chain risk. | `scripts/install-scripts.test.mjs`, `package.json` | SDD §3.3 | T | Baselined |
| REQ-SCAF-001 | `npm run new-game` shall refuse a bad template or id before touching any file. | A typo must not damage an existing game. | `scripts/new-game.mjs` | SDD §3.3 | T | Baselined |
| REQ-CAP-001 | `docs/capabilities.json` and `docs/capabilities.md` shall match what `npm run capabilities` generates from the code. | The capability list is the source of truth for what ships. | `scripts/capabilities.mjs` | SDD §3.4 | T | Baselined |
| REQ-DOC-001 | The docs-claims lint shall fail when a scanned page calls a shipped feature missing. | Readers and agents must not be told a shipped feature is impossible. | `scripts/lint/docs-claims.mjs` | SDD §3.4 | T | Baselined |
| REQ-DOC-002 | The trace check shall fail on a requirement with no row in the current verification trace (matrix §2; historical rows do not count), a matrix row citing a missing file, an unallocated requirement, a control document without its metadata header, or a dead relative Markdown link. | Control documents stay traceable and their links stay live. | `scripts/docs/check-trace.mjs` | SDD §3.4 | T | Baselined |
| REQ-EVID-001 | Acceptance records shall distinguish runtime enforcement, automated checks and manual device evidence. | A software gate cannot certify a physical device. Creator contract, What enforcement proves. | `docs/guides/upgrade-acceptance-ledger.md`, `docs/policy/DEVICE-EXPERIENCE.md` | SDD §3.4 | I | Baselined |

## 6. Foundation contract requirements

| ID | Requirement | Rationale | Derivation | Allocated to | Method | Status |
|---|---|---|---|---|---|---|
| REQ-FND-001 | The source manifest shall pin SHA-256 bytes for every Git-tracked file except itself and local `PR_BODY.md`. | Reproducible source identity, including schemas and tooling. | `tools/build_manifest.py`, `SOURCE-MANIFEST.json` | SDD §4 | A, T | Baselined |
| REQ-FND-002 | Versioned JSON tool schemas shall describe only existing read-only TypeScript capabilities. | No new runtime authority or mutating operations. | `schemas/read-only-tools.json`, `src/author/render-mask.ts`, `src/author/scene-output.ts` | SDD §4 | T, I | Baselined |
| REQ-FND-003 | The stdio bridge shall mirror sibling framing, initialize before tools, validate pinned inputs and reject unknown tools. | Read-only interoperability without runtime authority. See [ICD §4](../icd/icd-dependencies.md#4-read-only-tool-contract-version-020). | `tools/foundation_engine_bridge.py` | SDD §4 | T | Baselined |
| REQ-FND-004 | When dispatch raises an unexpected exception, a pinned schema uses an unsupported type, or a result cannot be represented as JSON, the bridge shall answer error -32603 with the request's id and no result, without the exception text, and the session shall continue. | A defect must not leak internal detail or pass as evidence. See [ICD §4.3](../icd/icd-dependencies.md#43-errors). | `tools/foundation_engine_bridge.py` (`Bridge.dispatch`, `encode_response`) | SDD §4 | T | Baselined |
| REQ-FND-005 | The bridge shall send a response frame of up to 1,048,576 bytes (newline excluded) and replace a larger one with error -32002 and the same id, withholding the result; the session shall continue. | Bounded output for the host. See [ICD §4.4](../icd/icd-dependencies.md#44-limits). | `tools/foundation_engine_bridge.py` (`encode_response`) | SDD §4 | T | Baselined |

## 7. Untested behavior (requirement gaps)

These behaviors exist in the code but no test checks them at the baseline commit.
They are not requirements until a test exists. Each is a candidate for a follow-up
test.

| ID | Behavior | Source | Why it is a gap |
|---|---|---|---|
| GAP-003 | `npm run deploy:production` builds and publishes after the clean-main guard passes. | `scripts/deploy-production.mjs` | `scripts/deploy-production.test.mjs` checks only the guard; the publication step is not exercised. |
| GAP-004 | Physical-device behavior (phone, tablet, laptop and desktop) of templates. | `docs/policy/DEVICE-EXPERIENCE.md` | CI uses emulated phone smoke only; physical-device acceptance is a manual, per-game activity. |

Closed gaps (findings sweep, commit `4644f3c`). Their IDs are not reused:

- GAP-001 (bridge -32603 on an unexpected exception) is now REQ-FND-004, tested in `scripts/foundation-bridge.test.mjs` by "bridge answers -32603 when dispatch raises an unexpected exception, keeps the id and recovers", "bridge answers -32603 for an unsupported pinned schema type instead of a result" and "bridge answers -32603 and withholds evidence when a result cannot be represented as JSON".
- GAP-002 (output frames over 1,048,576 bytes withheld with -32002) is now REQ-FND-005, tested in `scripts/foundation-bridge.test.mjs` by "bridge withholds an output frame over 1048576 bytes with -32002 (not -32603) and keeps the session" and "bridge output bound is exact at 1048576 bytes per frame, newline excluded".

## 8. Change control

Changes to these obligations follow [contribution review](../../CONTRIBUTING.md) and
[governance](../../GOVERNANCE.md). A pull request that changes behavior updates this
register and the [verification matrix](../verification/verification-matrix.md) in the
same pull request. Keep identifiers when wording is clarified; mark a removed
obligation Deleted instead of reusing its ID. An unperformed verification stays
unverified; requirement wording does not supply a passing result.

## Change history

| Version | Date | Commit | Change | Reviewed in |
|---|---|---|---|---|
| 1.0 | 2026-10-30 | `d91aa7d` | Initial register of eight stock obligations | PR #326 |
| 1.1 | 2026-11-01 | `d9c7039` | Added REQ-FND-001 to REQ-FND-003 | PR #333 |
| 2.0 | 2026-11-08 | `a9e8cc6` | Family documentation standard: metadata, seven-field rows, 42 new requirements (53 in total), N/A categories, untested gaps; REQ-BOOT-001 now also cites `src/core/app.test.ts`, which holds the boot-order test | PR #346 |
| 2.1 | 2026-11-09 | `95a883c` | REQ-DOC-002: only a row in the matrix's current trace (§2) verifies a requirement | PR fixing the 2026-11-09 backfill-review findings |
| 2.2 | 2026-11-10 | `4644f3c` | GAP-001 and GAP-002 closed: the bridge's -32603 and output-bound behavior now have tests and are stated as REQ-FND-004 and REQ-FND-005 (55 requirements) | findings-sweep PR |
