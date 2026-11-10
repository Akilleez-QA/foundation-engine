# Foundation Engine software management plan

| Field | Value |
|---|---|
| Document ID | FENGINE-SMP |
| Version | 1.0 |
| Status | Baselined |
| Owner | Akilleez-QA |
| Date | 2026-11-08 |
| Baseline commit | `a9e8cc6f175b5055b18abf26579ecc432a6ac53b` |
| Applies to | foundation-engine main at baseline commit |
| Classification | Self-assessed Class E analog; not safety-critical (see §1) |

> Organized after [NPR 7150.2D](https://nodis3.gsfc.nasa.gov/displayAll.cfm?Internal_ID=N_PR_7150_002D_&page_name=all), [NASA-STD-8739.8B](https://standards.nasa.gov/standard/nasa/nasa-std-87398) and the [NASA Software Engineering Handbook](https://swehb.nasa.gov/display/SWEHBVD/7.18+-+Documentation+Guidance) documentation guidance. This is not a NASA compliance determination or certification. The software classification is a self-assessed analog (Class E, not safety-critical); no NASA authority, independent verification and validation, or hazard analysis is asserted. The document describes the implementation inspected at the baseline commit.

This plan covers SWEHB 5.08 (development and management), 5.04 (maintenance), 5.17
(assurance) and 5.27 (risk), plus the 5.15 training decision.

## 1. Software classification (self-assessed)

- Assessed against: NPR 7150.2D Appendix D and NASA-STD-8739.8B §4.2, as an analog. Foundation Engine is not NASA software and no NASA authority has reviewed this assessment.
- Analog class: **Class E** (general-purpose research and technology software). Rationale: it runs on general-purpose computers in a browser or Node.js; it supports no ground test, flight test or operation; a defect affects the productivity of an individual game author, player or small group; it is not used for decisions about an operational system.
- Not Class F: it is not Agency business or IT infrastructure, and it is not deployed as a shared service.
- Safety-critical determination (SWE-205 analog): **not safety-critical.** Foundation Engine meets none of the five criteria in NASA-STD-8739.8B §4.2, and no hazard analysis assigns it a hazard cause, control or mitigation. It commands no hardware.
- Documentation baseline: Class E with voluntary adoption of the Class D documentation set; see the [compliance matrix](compliance-matrix.md).
- Re-evaluation triggers: commanding physical hardware; use in a regulated, safety or production decision path; handling personal or secret data beyond a game's local saves and settings; external deployment of the session host as a shared Internet service.
- Assessed by / date / baseline commit: Akilleez-QA / 2026-11-08 / `a9e8cc6f175b5055b18abf26579ecc432a6ac53b`.

## 2. Purpose, scope and organization

Foundation Engine is a genre-neutral TypeScript and three.js engine for browser games,
distributed as source. In the Cstack family (code name Mjölnir) it is the
foundation-type repository whose interface is a library API plus a read-only stdio
bridge. It has no runtime dependency on other family repositories
([ICD](../icd/icd-dependencies.md)).

| Role | Who | Authority |
|---|---|---|
| Maintainer | Accounts in [.github/CODEOWNERS](../../.github/CODEOWNERS) | Reviews and merges, owns the standard and budgets, cuts releases ([GOVERNANCE](../../GOVERNANCE.md)) |
| Contributors | Anyone, through fork pull requests; agent lanes working for the maintainer | Propose changes; no merge authority |
| Users | Game authors and players | Report problems through issues |

## 3. Life-cycle model and work tracking

Trunk-based development on `main`. Each change is a focused branch and pull request
([CONTRIBUTING](../../CONTRIBUTING.md)). Author API, standard, budget-raise and new-kit
changes need an issue and an ADR first ([GOVERNANCE](../../GOVERNANCE.md)). Issues are
the work breakdown; there are no funded milestones. Releases follow semantic
versioning; before 1.0 a minor release may break the author API. Release notes are one
fragment per change in `changes/unreleased/`, folded into `CHANGELOG.md` at release.

Cost estimation, staffing, budgets, subcontractor management and CMMI are N/A: this is
an unfunded open-source project with one active maintainer.

## 4. Engineering and test environment

| Item | Version or source | Where defined |
|---|---|---|
| Node.js | `>=22.18`; development line 22; CI Node 22 and 26 | `package.json` `engines`, `.node-version`, `.nvmrc`, `ci.yml` |
| TypeScript | 6.0.3 (lockfile) | `package.json`, `package-lock.json`, `tsconfig.json` |
| Test runner | `node:test` through tsx 4.23.15 (lockfile) | `package.json` `test` script |
| Bundler and dev server | Vite 8.3.2 (lockfile) | `vite.config.ts` |
| Renderer | three 0.186.1 | `package.json` |
| Formatter | Prettier 3.9.10 | `.prettierrc.json`, `.prettierignore` |
| Static analysis | `npm run lint` chain (`scripts/lint/`, `scripts/perf/budget-ratchet.mjs`, `scripts/docs/check-trace.mjs`) | `package.json` |
| Browser automation | playwright-core 1.61.1 (pinned exactly) | `package.json`, `.github/dependabot.yml` |
| Python | Python 3 standard library | `tools/build_manifest.py`, `tools/foundation_engine_bridge.py` |
| CI | `.github/workflows/ci.yml`, `.github/workflows/manifest.yml` | [test plan §2](../verification/test-plan.md#2-environment) |

## 5. Verification and validation approach

Verification: pull-request review, Node tests, static analysis, browser checks and
template gates, as listed in the [test plan](../verification/test-plan.md). Records:
the [verification matrix](../verification/verification-matrix.md), the
[test reports](../verification/reports/README.md) and the
[assurance record](../assurance/assurance-record.md).

Validation: templates and the creator journey browser check show that a new author can
run and modify a game; the first-use and creator-journey checks run in CI. Physical
device acceptance is manual and per game ([device policy](../policy/DEVICE-EXPERIENCE.md)).

Release acceptance criteria: the governance merge rule holds for the release commit
(branch current, CI green on that head, `main` green), the CHANGELOG section exists, a
version description is generated and the release checklist in
[release-checklist.md](../guides/release-checklist.md) is complete.

## 6. Software assurance

There is one active maintainer, so there is no organizational independence. Agent
reviewers and CI gates give separation of method, not of organization. An agent review
is evidence, not a human approval ([GOVERNANCE](../../GOVERNANCE.md#review-and-integration)).

| Gate | Command | Fails on | Record |
|---|---|---|---|
| Format | `npm run format:check` | Unformatted code or data files | CI log |
| Layers and architecture | `npm run lint:layers`, `npm run lint:arch` | Upward or forbidden imports | CI log |
| Game rules | `npm run lint:game` | `Math.random()` or literal UI text in game code | CI log |
| Type escapes | `npm run lint:types` | Unmarked `any` or double casts | CI log |
| CSS, genericity, brief, provenance | `npm run lint:css`, `lint:generic`, `lint:brief`, `lint:provenance` | Rule violations in styles, genre vocabulary in engine docs, brief drift, missing asset provenance | CI log |
| Budget ratchet | `npm run lint:budgets` | A budget raise without a reviewed trailer | CI log |
| Docs claims | `npm run lint:docs-claims` | A page calling a shipped feature missing | CI log |
| Changelog | `npm run lint:changelog` | Malformed fragments | CI log |
| Trace and links | `npm run lint:trace` | Untraced requirement, missing test file, missing metadata, dead link | CI log; SAR |
| Type check | `npm run typecheck` | TypeScript errors | CI log |
| Tests | `npm test`, browser checks, template gates | Any failure | CI log; STR |
| Source manifest | `python3 -B tools/build_manifest.py --check` | Byte drift in any tracked file | CI log |
| Install scripts | `scripts/install-scripts.test.mjs` | An unreviewed dependency install script | CI log |
| Secret scan | `gitleaks` with `.gitleaks.toml` | A detected secret | Local run recorded in the SAR; not a CI job |

## 7. Security, privacy and secure coding

Attack surface: browser game code (untrusted clients), the optional local session host
(`npm run host`, WebSocket with a join code), the stdio bridge (bounded JSON-RPC on
stdin, no file or network access), npm dependency installation, and build tooling that
reads and writes local files. Practices: bounded input everywhere the engine accepts
external data (save quarantine, bridge limits, manifest checks), host-side authority for
networked games ([integrity guide](../guides/integrity.md)), reviewed install scripts,
pinned GitHub Actions by SHA, `persist-credentials: false` in CI, read-only CI
permissions, and Dependabot updates. Reporting: [SECURITY.md](../../SECURITY.md).

## 8. Open-source, reused and vendored components

Runtime dependencies: three (MIT), wasmoon (MIT, optional scripting kit) and
`@dimforge/rapier3d-deterministic-compat` (Apache-2.0, optional physics kit). Dev
dependencies are listed in `package.json`. The lockfile pins every version;
`npm ci` installs exactly that graph. Third-party terms are in
[THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md). Updates arrive through
Dependabot (weekly npm, monthly Actions). Dependabot skips playwright-core entirely,
major releases of TypeScript, Vite and `@types/node`, and minor or major releases of
three and `@types/three`; those are bumped by hand. The bridge and manifest tool are
adapted from Foundation Refrigeration at pinned commits
([SCMP](../configuration/configuration-management.md)). The project is reusable under
GPL-3.0-only; commercial licenses are offered separately ([NOTICE](../../NOTICE.md)).

## 9. Problem reporting and severity

Problems and changes are GitHub issues created from the templates in
`.github/ISSUE_TEMPLATE/`. The bug form records severity. A closing pull request
records the fix and its verification.

| Severity | Meaning | Response |
|---|---|---|
| S1 | Wrong result presented as valid, save data loss, or security exposure | Fix or withdraw the release before the next merge |
| S2 | Feature unusable, no workaround | Next release |
| S3 | Feature degraded, workaround exists | Scheduled |
| S4 | Cosmetic or documentation | As convenient |

## 10. Configuration management

Baselines are commits and tags on `main`. `SOURCE-MANIFEST.json` pins every tracked file
by SHA-256. See [configuration management](../configuration/configuration-management.md).

## 11. Operations, maintenance and retirement

Changes are analyzed in the issue, implemented in a pull request, reviewed under the
governance merge rule and released by tag. Migration notes go in the CHANGELOG
"Upgrading" sections. Distribution is the public Git repository and GitHub Releases;
the package is `private: true` and is not published to npm. Users find version data in
`package.json`, tags, the CHANGELOG and the [version descriptions](../releases/README.md).
Supported versions: [SECURITY.md](../../SECURITY.md). Backup operational software is N/A;
the previous tag is the fallback. Retirement: a final tag, an archive notice in the
README Status section, then GitHub repository archive.

## 12. Risk register

Reviewed at each release. L = likelihood, C = consequence, 1 to 5.

| ID | Risk | L | C | Mitigation | Status | Issue |
|---|---|---|---|---|---|---|
| R-1 | Single maintainer: no organizational independence in review or release | 5 | 3 | Agent reviews labelled as not independent; CI gates; recorded merge exceptions (ADR 0077) | Open | none |
| R-2 | Docs drift from code after many parallel merges | 4 | 3 | `lint:docs-claims`, generated capability inventory, `lint:trace` link and trace check | Open | none |
| R-3 | Browser or GPU instability makes browser checks flaky locally | 3 | 2 | Hosted CI is the integration gate; local runs use a guarded browser wrapper | Open | none |
| R-4 | A dependency major release breaks the renderer adapter or build | 3 | 3 | three minors and majors, TypeScript and Vite majors are excluded from Dependabot and bumped by hand | Open | none |
| R-5 | No physical-device acceptance for templates (GAP-004) | 4 | 2 | Device policy keeps device acceptance separate; emulated phone smoke in CI | Open | none |
| R-6 | Third-party notice versions lag the lockfile | 3 | 2 | Release checklist reviews notices; finding recorded in the SAR | Open | none |

## 13. Measurement

Each test report carries a metrics block produced by `scripts/docs/reports.mjs`: test
totals from the TAP log, requirement and trace counts from `scripts/docs/check-trace.mjs`,
tracked-file and line counts from Git, and open and closed issues from `gh`. No metric is
typed by hand.

## 14. Training

Not applicable. SWEHB 5.15 anticipates one training plan per NASA Center, NPR SWE-017
applies only to Classes A to C, and the project has no staff. Contributor onboarding is
[CONTRIBUTING](../../CONTRIBUTING.md) and [getting started](../guides/getting-started.md).

## 15. Documentation list

The [documentation index](../README.md) lists every control document and guide.

## Change history

| Version | Date | Commit | Change | Reviewed in |
|---|---|---|---|---|
| 1.0 | 2026-11-08 | `a9e8cc6` | Initial baseline | PR #346 |
