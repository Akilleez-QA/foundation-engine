# Foundation Engine software assurance record

| Field | Value |
|---|---|
| Document ID | FENGINE-SAR |
| Version | 1.0 |
| Status | Baselined |
| Owner | Akilleez-QA |
| Date | 2026-11-08 |
| Baseline commit | `a9e8cc6f175b5055b18abf26579ecc432a6ac53b` |
| Applies to | foundation-engine main at baseline commit |
| Classification | Self-assessed Class E analog; not safety-critical (see [SMP §1](../plan/software-management-plan.md#1-software-classification-self-assessed)) |

> Organized after [NPR 7150.2D](https://nodis3.gsfc.nasa.gov/displayAll.cfm?Internal_ID=N_PR_7150_002D_&page_name=all), [NASA-STD-8739.8B](https://standards.nasa.gov/standard/nasa/nasa-std-87398) and the [NASA Software Engineering Handbook](https://swehb.nasa.gov/display/SWEHBVD/7.18+-+Documentation+Guidance) documentation guidance. This is not a NASA compliance determination or certification. The software classification is a self-assessed analog (Class E, not safety-critical); no NASA authority, independent verification and validation, or hazard analysis is asserted. The document describes the implementation inspected at the baseline commit.

This rolling record holds the requirements, design, testing and code-quality analyses
(SWEHB 5.21, 5.22, 5.23, 5.26), the configuration audit (5.25) and the peer-review
summary (5.03). Newest entry first.

## Entry 2026-11-08: baseline `a9e8cc6` (documentation standard pull request)

- Analyzed by: an agent documentation lane working for the maintainer. Agent analysis is
  not independent review.
- Inputs: the repository at `a9e8cc6`, the CI workflows, the GitHub issue and pull-request
  lists, the v0.2.0 tag, and the local runs listed below.

### Requirements analysis

- Techniques: extraction of behavior from test names and assertions; trace check
  (`npm run lint:trace`); orphan check; testability review of each existing requirement.
- Result: 53 requirements, 53 traced to a verification row, 0 TBD, 4 untested behaviors
  recorded as gaps (GAP-001 to GAP-004 in the [SRS](../requirements/requirements.md#7-untested-behavior-requirement-gaps)).
- Finding: REQ-BOOT-001 cited only `src/core/module.test.ts`, which tests version ranges,
  budgets and id ordering; the boot-order and dependency-graph tests are in
  `src/core/app.test.ts`. The matrix now cites both.
- Finding: the earlier register had 11 requirements and no derivation or allocation
  fields. Rows now have all seven fields.

### Design analysis

- Techniques: comparison of the SDD component table with `src/`, `scripts/` and `tools/`;
  ADR index inspection; ICD comparison with `tools/foundation_engine_bridge.py`.
- Finding: the ICD said the bridge runs native TypeScript in a Node subprocess with a
  ten-second timeout. Since PR #341 the bridge computes results from the schema alone and
  starts no Node process. The ICD is corrected.
- Finding: the ICD omitted the runtime dependency `@dimforge/rapier3d-deterministic-compat`
  0.21.0 (optional physics kit). Added.
- Finding: two ADR files share the number 0078
  (`0078-creator-selectable-render-backend.md` and `0078-foundation-contract-baseline.md`).
  Both are indexed; renumbering a decision record is left to the maintainer.
- Finding: the ADR index had a duplicate row pointing at a non-existent
  `0130-offline-format-converters.md` (the record is 0133) and lacked rows for ADRs 0064,
  0065 and 0066. Fixed.

### Testing analysis

- Techniques: full Node suite runs at the baseline and at the v0.2.0 tag; three browser
  checks; coverage measurement; matrix-to-test existence check.
- Node suite at `a9e8cc6`, Node 22.23.3: 4,204 tests, 4,204 passed
  ([STR-main-a9e8cc6](../verification/reports/STR-main-a9e8cc6.md)).
- Node suite at `v0.2.0`, Node 22.23.3: 4,194 tests, 4,194 passed
  ([STR-v0.2.0](../verification/reports/STR-v0.2.0.md)).
- Browser: `test:dmath-browser`, `test:subpath-browser`, `test:session-browser` passed
  (Chromium 156.0.8078.79, software GL, guarded local wrapper).
- Coverage of `src/**` by the `src` tests: lines 89.76 %, branches 89.48 %, functions
  93.74 % ([test plan §5](../verification/test-plan.md#5-coverage-and-static-analysis)).
- Tutorial: the [getting started](../guides/getting-started.md) steps were run in a fresh
  clone at `a9e8cc6`: `npm ci`, `npm run new-game -- --template arcade --id my-game --title "My game"`,
  the branch and commit step, `npm run check` (pass), `npm run play:snap` (pass),
  `npm run play:script -- game/playtest/restart.json` (pass) and `npm run build` (pass).
  The long-running `npm run play` and `npm run preview` servers, the mobile snapshot, the
  criteria run and the code-change step were not run.
- Finding (environment): `npm ci` under Node 26.13.0 on the reference machine installed
  only the musl build of `@rolldown/binding-*`, and 10 build-dependent tests failed with
  "Cannot find native binding". Reinstalling with Node 22's npm fixed it. Recorded in the
  [test plan §2.2](../verification/test-plan.md#22-local-reference-run-for-this-baseline).
- Gaps: bridge error -32603 and the output-size bound have no test (GAP-001, GAP-002); the
  deploy publication step is untested (GAP-003); no physical-device acceptance (GAP-004).
- Not run locally: template gates with phone smoke, and the 31 other steps of the CI `browser` job.

### Source code quality

| Tool | Command | Findings |
|---|---|---|
| Lint chain | `npm run lint` on this pull request's head | 0 after one fix (a genre word in the new SRS, found by `lint:generic`) |
| Trace and links | `npm run lint:trace` | 0 on this pull request's head. Before this change: 3 dead links and 1 dead heading anchor across the repository, all fixed |
| Secret scan | `gitleaks git --config .gitleaks.toml --log-opts=a9e8cc6` (gitleaks 8.30.1) | 78 hits, all rule `generic-api-key` on SHA-256 values in `SOURCE-MANIFEST.json`: false positives. Open PR #334 addresses the rule |
| Install-script review | `scripts/install-scripts.test.mjs` | Pass |

### Configuration audit

- Release `v0.2.0`: the tag points at `294dfa96394e208c4d53d78caaeb79f071e28143`, created
  2026-10-30. The CHANGELOG dates 0.2.0 to 2026-10-03, so the tag date and the changelog
  date differ. The tag contains no `SOURCE-MANIFEST.json`, so it has no source-manifest
  identity; [VDD-v0.2.0](../releases/VDD-v0.2.0.md) records the available digests.
- Baseline `a9e8cc6`: `python3 -B tools/build_manifest.py --check` passed before this
  change; the manifest is regenerated in this pull request.
- Finding: [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md) names ws 8.22.0,
  prettier 3.9.9 and playwright-core 1.56.1, while the lockfile pins 8.22.1, 3.9.10 and
  1.61.1. The license terms are unchanged; the notice versions were not edited here
  because the file records the date each was checked. Open draft PR #344 also edits
  notices.
- Finding: the README "Measured" section described an older documentation candidate
  (`37dc4a5`). It now cites the baseline report.

### Peer review summary

The 20 pull requests merged between `v0.2.0` and `a9e8cc6` (#319 to #345, from
`gh pr view`): 18 by the maintainer, 2 by Dependabot. 5 carry a GitHub review record and
17 carry at least one comment. Open pull requests at this baseline: #334, #337, #338,
#339 and #344.

### Findings

| ID | Severity | Finding | Location | Issue | Status |
|---|---|---|---|---|---|
| F-1 | S4 | ICD described a Node subprocess the bridge no longer starts | `docs/icd/icd-dependencies.md` | none | Closed in this PR |
| F-2 | S4 | ICD omitted the Rapier runtime dependency | `docs/icd/icd-dependencies.md` | none | Closed in this PR |
| F-3 | S4 | Dead ADR links and a duplicate index row; three ADRs not indexed | `docs/adr/README.md`, `src/kits/formulas/README.md` | none | Closed in this PR |
| F-4 | S4 | Stale README anchor `#not-here-yet-and-workarounds` | `docs/recipes/README.md` | none | Closed in this PR |
| F-5 | S4 | Two ADRs numbered 0078 | `docs/adr/` | none | Open |
| F-6 | S4 | Third-party notice versions lag the lockfile | `THIRD_PARTY_NOTICES.md` | PR #344 (draft) touches notices | Open |
| F-7 | S3 | Bridge -32603 and output-bound paths untested | `tools/foundation_engine_bridge.py` | none | Open (GAP-001, GAP-002) |
| F-8 | S4 | Secret scanner flags manifest hashes | `SOURCE-MANIFEST.json` | PR #334 | Open |
| F-9 | S4 | v0.2.0 tag lacks a source manifest; tag and changelog dates differ | tag `v0.2.0` | none | Open |

### Overall assessment

The documentation set now traces every requirement to a test that passed at the baseline
commit, records untested behavior openly, and is checked by `npm run lint:trace`. The
remaining open findings are documentation-level (S4) except the untested bridge error
paths (S3). Hosted CI on this pull request's head, the template gates and the other
browser scripts are outside this local record.

## Change history

| Version | Date | Commit | Change | Reviewed in |
|---|---|---|---|---|
| 1.0 | 2026-11-08 | `a9e8cc6` | First entry | This PR |
