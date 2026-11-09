# Foundation Engine verification matrix

| Field | Value |
|---|---|
| Document ID | FENGINE-VM |
| Version | 2.0 |
| Status | Baselined |
| Owner | Akilleez-QA |
| Date | 2026-11-08 |
| Baseline commit | `a9e8cc6f175b5055b18abf26579ecc432a6ac53b` |
| Applies to | foundation-engine main at baseline commit |
| Classification | Self-assessed Class E analog; not safety-critical (see [SMP §1](../plan/software-management-plan.md#1-software-classification-self-assessed)) |

> Organized after [NPR 7150.2D](https://nodis3.gsfc.nasa.gov/displayAll.cfm?Internal_ID=N_PR_7150_002D_&page_name=all), [NASA-STD-8739.8B](https://standards.nasa.gov/standard/nasa/nasa-std-87398) and the [NASA Software Engineering Handbook](https://swehb.nasa.gov/display/SWEHBVD/7.18+-+Documentation+Guidance) documentation guidance. This is not a NASA compliance determination or certification. The software classification is a self-assessed analog (Class E, not safety-critical); no NASA authority, independent verification and validation, or hazard analysis is asserted. The document describes the implementation inspected at the baseline commit.

## 1. Purpose

This matrix traces every requirement in the [SRS](../requirements/requirements.md) to
the test, analysis or inspection that verifies it, and to the last recorded result.
T = executable test, A = automated analysis, I = inspection, D = demonstration.
Commands run from the repository root.

"Last result" names the [test report](reports/README.md) that recorded the run. A
command listed here is the method; it is not a claim that it passed on every revision.
`npm run lint:trace` checks that every requirement has a row and every cited file exists.

## 2. Requirement to verification trace

| Requirement | Method | Verification | Last result |
|---|---|---|---|
| REQ-BOOT-001 | T | `src/core/app.test.ts`, `src/core/module.test.ts` | Pass, [STR-main-a9e8cc6](reports/STR-main-a9e8cc6.md) |
| REQ-BOOT-002 | T | `src/core/app.test.ts` (boot order, cycles, throwing module) | Pass, [STR-main-a9e8cc6](reports/STR-main-a9e8cc6.md) |
| REQ-BOOT-003 | T | `src/core/app.test.ts` (duplicate owners, services) | Pass, [STR-main-a9e8cc6](reports/STR-main-a9e8cc6.md) |
| REQ-DATA-001 | T | `src/core/registry.test.ts` | Pass, [STR-main-a9e8cc6](reports/STR-main-a9e8cc6.md) |
| REQ-PATCH-001 | T | `src/core/patch.test.ts` | Pass, [STR-main-a9e8cc6](reports/STR-main-a9e8cc6.md) |
| REQ-APP-001 | T | `src/app/registries.test.ts` | Pass, [STR-main-a9e8cc6](reports/STR-main-a9e8cc6.md) |
| REQ-EVT-001 | T | `src/core/events.test.ts` | Pass, [STR-main-a9e8cc6](reports/STR-main-a9e8cc6.md) |
| REQ-LOOP-001 | T | `src/core/activity/loop.test.ts` | Pass, [STR-main-a9e8cc6](reports/STR-main-a9e8cc6.md) |
| REQ-ACT-001 | T | `src/core/activity/activity.test.ts` | Pass, [STR-main-a9e8cc6](reports/STR-main-a9e8cc6.md) |
| REQ-CLOCK-001 | T | `src/core/clock.test.ts`, `src/core/player-clock.test.ts` | Pass, [STR-main-a9e8cc6](reports/STR-main-a9e8cc6.md) |
| REQ-ROUTE-001 | T | `src/core/router/handover.test.ts` | Pass, [STR-main-a9e8cc6](reports/STR-main-a9e8cc6.md) |
| REQ-ROUTE-002 | T | `src/core/router/resolve.test.ts`, `src/core/router/module.test.ts` | Pass, [STR-main-a9e8cc6](reports/STR-main-a9e8cc6.md) |
| REQ-SAVE-001 | T | `src/core/save/store.test.ts`, `src/core/save/module.test.ts` | Pass, [STR-main-a9e8cc6](reports/STR-main-a9e8cc6.md) |
| REQ-SAVE-002 | T | `src/core/save/released-v0.2.0.test.ts`, `src/core/save/migration-fixtures.test.ts` | Pass, [STR-main-a9e8cc6](reports/STR-main-a9e8cc6.md) |
| REQ-SAVE-003 | T | `src/core/save/chunk-store.test.ts` | Pass, [STR-main-a9e8cc6](reports/STR-main-a9e8cc6.md) |
| REQ-SET-001 | T | `src/core/settings/features.test.ts` | Pass, [STR-main-a9e8cc6](reports/STR-main-a9e8cc6.md) |
| REQ-I18N-001 | T | `src/core/i18n/i18n.test.ts`, `src/core/i18n/select-ordinal.test.ts` | Pass, [STR-main-a9e8cc6](reports/STR-main-a9e8cc6.md) |
| REQ-RNG-001 | T | `src/core/rng.test.ts` | Pass, [STR-main-a9e8cc6](reports/STR-main-a9e8cc6.md) |
| REQ-DMATH-001 | T | `src/core/dmath.test.ts` | Pass, [STR-main-a9e8cc6](reports/STR-main-a9e8cc6.md) |
| REQ-ECS-001 | T | `src/core/ecs/ecs.test.ts`, `src/core/ecs/query-iteration.test.ts` | Pass, [STR-main-a9e8cc6](reports/STR-main-a9e8cc6.md) |
| REQ-SIM-001 | T | `src/domain/sim/host.test.ts` | Pass, [STR-main-a9e8cc6](reports/STR-main-a9e8cc6.md) |
| REQ-INPUT-001 | T | `src/platform/input/keyboard.test.ts`, `src/platform/input/keys.test.ts` | Pass, [STR-main-a9e8cc6](reports/STR-main-a9e8cc6.md) |
| REQ-INPUT-002 | T | `src/platform/input/index.test.ts`, `src/platform/input/held.test.ts` | Pass, [STR-main-a9e8cc6](reports/STR-main-a9e8cc6.md) |
| REQ-ASSET-001 | T | `src/platform/assets/lease-cache.test.ts` | Pass, [STR-main-a9e8cc6](reports/STR-main-a9e8cc6.md) |
| REQ-ASSET-002 | T | `src/platform/assets/manifest.test.ts` | Pass, [STR-main-a9e8cc6](reports/STR-main-a9e8cc6.md) |
| REQ-ASSET-003 | T | `src/platform/assets/models.test.ts` | Pass, [STR-main-a9e8cc6](reports/STR-main-a9e8cc6.md) |
| REQ-GAME-001 | A, T | `npm run lint:game`; `scripts/lint/game-rules.test.mjs` | Pass, [STR-main-a9e8cc6](reports/STR-main-a9e8cc6.md) |
| REQ-TPL-001 | T | `src/app/templates.test.ts`, `scripts/lint/brief.test.ts`; `npm run gate:templates` in CI | Node tests pass, [STR-main-a9e8cc6](reports/STR-main-a9e8cc6.md); template gate not run locally |
| REQ-COMPAT-001 | T | `scripts/compatibility.test.mjs` | Pass, [STR-main-a9e8cc6](reports/STR-main-a9e8cc6.md) |
| REQ-ARCH-001 | A, T | `npm run lint:layers`; `npm run lint:arch`; `scripts/lint/layers.test.mjs`, `scripts/lint/architecture.test.mjs` | Pass, [STR-main-a9e8cc6](reports/STR-main-a9e8cc6.md) |
| REQ-PURE-001 | T | `scripts/package-pure.test.mjs` | Pass, [STR-main-a9e8cc6](reports/STR-main-a9e8cc6.md) |
| REQ-DEV-001 | T | `src/dev/replay.test.ts` | Pass, [STR-main-a9e8cc6](reports/STR-main-a9e8cc6.md) |
| REQ-HOST-001 | T | `scripts/host.test.mjs` | Pass, [STR-main-a9e8cc6](reports/STR-main-a9e8cc6.md) |
| REQ-DMATH-002 | T | `npm run test:dmath-browser` (`scripts/play/dmath-check.mjs`) | Pass, [STR-main-a9e8cc6](reports/STR-main-a9e8cc6.md) §3 |
| REQ-SUBPATH-001 | T | `npm run test:subpath-browser` (`scripts/play/subpath-check.mjs`) | Pass, [STR-main-a9e8cc6](reports/STR-main-a9e8cc6.md) §3 |
| REQ-SESSION-001 | T | `npm run test:session-browser` (`scripts/play/session-check.mjs`) | Pass, [STR-main-a9e8cc6](reports/STR-main-a9e8cc6.md) §3 |
| REQ-PERF-001 | A, T | `npm run lint:budgets`; `scripts/perf/budget-ratchet.test.mjs` | Pass, [STR-main-a9e8cc6](reports/STR-main-a9e8cc6.md) |
| REQ-TOOL-001 | T | `scripts/check.test.mjs` | Pass, [STR-main-a9e8cc6](reports/STR-main-a9e8cc6.md) |
| REQ-CI-001 | T | `scripts/ci-results.test.mjs` | Pass, [STR-main-a9e8cc6](reports/STR-main-a9e8cc6.md) |
| REQ-CI-002 | T | `scripts/ci-changes.test.mjs` | Pass, [STR-main-a9e8cc6](reports/STR-main-a9e8cc6.md) |
| REQ-CI-003 | T | `scripts/gate-ci.test.mjs` | Pass, [STR-main-a9e8cc6](reports/STR-main-a9e8cc6.md) |
| REQ-CI-004 | T | `scripts/gate-templates.test.mjs` | Pass, [STR-main-a9e8cc6](reports/STR-main-a9e8cc6.md) |
| REQ-REL-001 | T | `scripts/deploy-production.test.mjs` | Pass, [STR-main-a9e8cc6](reports/STR-main-a9e8cc6.md) |
| REQ-CHG-001 | T | `scripts/changelog.test.mjs`; `npm run lint:changelog` | Pass, [STR-main-a9e8cc6](reports/STR-main-a9e8cc6.md) |
| REQ-SEC-001 | T | `scripts/install-scripts.test.mjs` | Pass, [STR-main-a9e8cc6](reports/STR-main-a9e8cc6.md) |
| REQ-SCAF-001 | T | `scripts/new-game.test.mjs` | Pass, [STR-main-a9e8cc6](reports/STR-main-a9e8cc6.md) |
| REQ-CAP-001 | T | `scripts/capabilities.test.mjs` | Pass, [STR-main-a9e8cc6](reports/STR-main-a9e8cc6.md) |
| REQ-DOC-001 | T | `scripts/lint/docs-claims.test.mjs`; `npm run lint:docs-claims` | Pass, [STR-main-a9e8cc6](reports/STR-main-a9e8cc6.md) |
| REQ-DOC-002 | T | `scripts/docs/check-trace.test.mjs`; `npm run lint:trace` | Pass on this PR's head; recorded in the [assurance record](../assurance/assurance-record.md) |
| REQ-EVID-001 | I | Inspect `docs/guides/upgrade-acceptance-ledger.md` and `docs/policy/DEVICE-EXPERIENCE.md` for separate runtime, automated and device-evidence scopes | Inspected 2026-11-08 at `a9e8cc6`: explicit unverified device scope present; not device acceptance |
| REQ-FND-001 | A, T | `python3 -B tools/build_manifest.py --check`; `scripts/source-manifest.test.mjs` | Pass, [STR-main-a9e8cc6](reports/STR-main-a9e8cc6.md) |
| REQ-FND-002 | T, I | `scripts/foundation-contract.test.ts`; inspect the mapping table in `docs/icd/icd-dependencies.md` | Pass, [STR-main-a9e8cc6](reports/STR-main-a9e8cc6.md) |
| REQ-FND-003 | T | `scripts/foundation-bridge.test.mjs` | Pass, [STR-main-a9e8cc6](reports/STR-main-a9e8cc6.md) |

## 3. Backward trace

Every test file in the repository is supporting evidence for the engine or a kit.
Only the test files named above trace to an SRS requirement. The others verify
kit contracts that the [capability inventory](../capabilities.md) lists by feature ID.
`npm run lint:trace` reports how many test files the matrix cites. Untested behavior is
listed in [SRS §7](../requirements/requirements.md#7-untested-behavior-requirement-gaps).

## 4. Earlier evidence (historical)

The tables below were recorded by earlier documentation passes. They are kept as
written and are not current evidence.

### 4.1 Selected stock requirements, evidence baseline `294dfa9`

| Requirement | Method | Test file or command | Result | Source commit |
|---|---|---|---|---|
| REQ-ARCH-001 | A | `npm run lint:layers`; `npm run lint:arch` (included in `npm run lint`) | Passed locally as part of lint | `294dfa9` |
| REQ-BOOT-001 | T | `node --import tsx --test src/core/module.test.ts` | Passed locally in the combined test command below | `294dfa9` |
| REQ-DATA-001 | T | `node --import tsx --test src/core/registry.test.ts` | Passed locally in the combined test command below | `294dfa9` |
| REQ-SAVE-001 | T | `node --import tsx --test src/core/save/store.test.ts` | Passed locally in the combined test command below | `294dfa9` |
| REQ-LOOP-001 | T | `node --import tsx --test src/core/activity/loop.test.ts` | Passed locally in the combined test command below | `294dfa9` |
| REQ-GAME-001 | A | `npm run lint:game` (included in `npm run lint`) | Passed locally as part of lint | `294dfa9` |
| REQ-PERF-001 | A | `npm run lint:budgets` (included in `npm run lint`) | Passed locally against `origin/main` at this baseline | `294dfa9` |
| REQ-EVID-001 | I | `git show HEAD:docs/guides/upgrade-acceptance-ledger.md`; `git show HEAD:docs/policy/DEVICE-EXPERIENCE.md` | Inspection found explicit unverified device scope; not device acceptance | `294dfa9` |

The combined invocation passed all selected tests locally:

```sh
node --import tsx --test src/core/module.test.ts src/core/registry.test.ts src/core/save/store.test.ts src/core/activity/loop.test.ts
npm run lint
```

### 4.2 Foundation contract verification, 2026-11-01

| Requirement | Method | Test file or command | Evidence scope |
|---|---|---|---|
| REQ-FND-001 | A, T | `python3 -B tools/build_manifest.py --check`; `node --test scripts/source-manifest.test.mjs` | Passed locally (1 test): byte drift, deterministic output and newly tracked membership; hosted CI unverified. |
| REQ-FND-002 | T, I | `node --import tsx --test scripts/foundation-contract.test.ts`; ICD mapping | Passed locally (1 test): native bounds, defaults, enum pins and rejection cases; no transport execution. |
| REQ-FND-003 | T | `node --test scripts/foundation-bridge.test.mjs` | Passed locally: 6 tests covering handshake, inventory, both tools, defaults, schema rejection, unknown tools, framing limits and recovery. Hosted CI unverified. |

Local baseline run, 2026-11-01: Arch Linux, Python 3.14.8, Node 22.23.4 and
26.13.0, system Chromium 149.0.7827.55 with software GL. All 34 browser work steps,
both template shards (nine templates with phone smoke), the Node-current work
steps and all 11 additional `test:*` scripts passed in separate local runs.
Parallel source suites experienced process `SIGKILL`s; retries used eight-CPU or
two-CPU affinity, with unchanged assertions and budgets. Each complete source pass
ran 4,196 tests. Ubuntu browser dependency installation failed (`apt-get` absent);
installed Chromium supplied the local browser runs. These combined local results
are not a hosted CI run, independent review or physical-device acceptance.

## Change history

| Version | Date | Commit | Change | Reviewed in |
|---|---|---|---|---|
| 1.0 | 2026-11-01 | `39cf03b` | Selected stock requirements traced to local evidence | PR #328 |
| 1.1 | 2026-11-01 | `d9c7039` | Foundation contract rows | PR #333 |
| 2.0 | 2026-11-08 | `a9e8cc6` | One row per SRS requirement (53), last result linked to a test report, backward-trace rule; earlier tables kept as historical | PR #346 |
