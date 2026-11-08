# Foundation Engine software test plan and procedures

| Field | Value |
|---|---|
| Document ID | FENGINE-STP |
| Version | 1.0 |
| Status | Baselined |
| Owner | Akilleez-QA |
| Date | 2026-11-08 |
| Baseline commit | `a9e8cc6f175b5055b18abf26579ecc432a6ac53b` |
| Applies to | foundation-engine main at baseline commit |
| Classification | Self-assessed Class E analog; not safety-critical (see [SMP §1](../plan/software-management-plan.md#1-software-classification-self-assessed)) |

> Organized after [NPR 7150.2D](https://nodis3.gsfc.nasa.gov/displayAll.cfm?Internal_ID=N_PR_7150_002D_&page_name=all), [NASA-STD-8739.8B](https://standards.nasa.gov/standard/nasa/nasa-std-87398) and the [NASA Software Engineering Handbook](https://swehb.nasa.gov/display/SWEHBVD/7.18+-+Documentation+Guidance) documentation guidance. This is not a NASA compliance determination or certification. The software classification is a self-assessed analog (Class E, not safety-critical); no NASA authority, independent verification and validation, or hazard analysis is asserted. The document describes the implementation inspected at the baseline commit.

This plan merges the test plan (SWEHB 5.10) and test procedures (5.14). The
executable tests are the procedures; this page gives their commands, environment,
pass criteria and the manual procedures that are not automated.

## 1. Test levels

| Level | What runs | Command | Where |
|---|---|---|---|
| Unit and component | Node tests next to source (`*.test.ts`, `*.test.mjs`) | `npm test` | CI `node-current`; local |
| Static analysis | Prettier check, layers, game rules, architecture, type escapes, CSS, genericity, briefs, budgets, provenance, docs claims, changelog, trace | `npm run lint` | CI template jobs (through `npm run gate`); local |
| Type check | `tsc --noEmit` after generation | `npm run typecheck` | Local; `npm run build` in gates |
| Fast affected check | Typecheck, lint list and affected tests | `npm run check` | CI `node-current`; local |
| Integration (browser) | Built games in muted, isolated Chromium | `npm run test:*-browser` | CI `browser` job |
| System (templates) | Complete gate per template, with phone smoke | `npm run gate:templates -- --shard N/2 --phone` | CI `templates-1`, `templates-2` |
| Regression (compatibility) | Retained v0.2.0 template and save fixtures | `scripts/compatibility.test.mjs`, `src/core/save/released-v0.2.0.test.ts` (part of `npm test`) | CI; local |
| Source identity | Source manifest drift | `python3 -B tools/build_manifest.py --check` | CI `manifest` workflow; local |
| Acceptance | Physical-device and author acceptance | Manual, per game | See §6 |

Performance is checked by budgets (`npm run lint:budgets`, `npm run gate`), not by a
separate load test. Security checks are the install-script review test, the secret
scan (§5) and the host join-code test.

## 2. Environment

### 2.1 CI (from `.github/workflows/ci.yml` and `manifest.yml`)

| Job | Runner | Node | Runs when |
|---|---|---|---|
| `changes` | `ubuntu-latest` | runner default | every event |
| `browser` | `ubuntu-latest` | 22 | push or pull request with code changes |
| `templates-1`, `templates-2` | `ubuntu-latest` | 22 | push or pull request with code changes |
| `node-current` | `ubuntu-latest` | 26 | weekly schedule, or push to `main` with code changes |
| `check` | `ubuntu-latest` | 22 | always; aggregates the others |
| `manifest` (Source manifest workflow) | `ubuntu-latest` | none (Python 3 from runner) | push to `main`, pull request |

A docs-only change (only `docs/**` and `*.md`) sets `code=false`; the work jobs are
skipped and `check` accepts the skips. Browsers come from
`npx --no-install playwright-core install --with-deps chromium`.

### 2.2 Local reference run for this baseline

Arch Linux x86_64, 32 hardware threads, Node 22.23.3 and 26.13.0, npm from Node 22,
Python 3.14.9, Chromium 156.0.8078.79 started through a guarded local wrapper with
software GL (`ENGINE_CHROMIUM`). Heavy suites ran under a local CPU-weight slice. This is
one developer workstation, not a CI runner.

Install dependencies with the npm that ships with Node 22. On the reference machine,
`npm ci` under Node 26.13.0 installed only the musl build of the bundler's native
binding, and 10 build-dependent tests then failed with "Cannot find native binding".
Reinstalling under Node 22 fixed it. Treat that as an environment issue to check first.

## 3. Commands identical to CI

The `browser` job runs, in order:

```sh
npm ci
npx --no-install playwright-core install --with-deps chromium
npm run test:ui-browser
npm run test:diagnostics-browser
npm run test:capture-browser
npm run test:authoring-browser
npm run test:appearance-browser
npm run test:stage-journal-browser
npm run test:model-preview-browser
npm run test:ktx2-browser
GAME_DIR=templates/expedition/game npm run test:framework-browser
GAME_DIR=templates/expedition/game npm run test:regional-surface-browser
GAME_DIR=templates/expedition/game npm run test:model-attachment-browser
GAME_DIR=templates/expedition/game npm run test:progression-workbench-browser
GAME_DIR=templates/expedition/game npm run test:weighted-appearance-browser
GAME_DIR=templates/expedition/game npm run test:custody-composition-browser
GAME_DIR=templates/expedition/game npm run test:objective-workbench-browser
GAME_DIR=templates/expedition/game npm run test:action-workbench-browser
GAME_DIR=templates/expedition/game npm run test:crafting-workbench-browser
GAME_DIR=templates/expedition/game npm run test:network-workbench-browser
GAME_DIR=templates/expedition/game npm run test:replication-workbench-browser
GAME_DIR=templates/expedition/game npm run test:authority-workbench-browser
npm run test:blender-export-browser
npm run test:pose-to-pose-browser
npm run test:audio-browser
npm run test:first-use-browser
npm run test:first-use-browser:production
npm run test:creator-journey-browser
npm run test:session-browser
npm run test:replay-browser
npm run test:dmath-browser
npm run test:network-probe
npm run test:material-browser
npm run test:particle-browser
npm run test:sound-browser
npm run test:subpath-browser
```

The template jobs run `npm run gate:templates -- --shard 1/2 --phone` and
`npm run gate:templates -- --shard 2/2 --phone`. The `node-current` job runs
`npm run test` and `npm run check`. The `check` job runs `node scripts/ci-results.mjs`.
The manifest workflow runs `python3 -B tools/build_manifest.py --check`.

`npm run gate:ci` runs every run step of `ci.yml` locally on a suitable machine
(REQ-CI-003). `scripts/gate-ci.test.mjs` fails if this page's source workflow gains a
step that `gate:ci` cannot mirror.

## 4. Pass criteria

- Node tests: zero failures, zero cancelled. A wall-clock-bound test that fails once
  on a loaded machine is re-run alone and then in the suite; both results are reported
  and the bound is never widened (CONTRIBUTING).
- Lint: every lint exits 0. The budget ratchet passes only with a reviewed trailer for a raise.
- Browser checks: each script exits 0 and writes its evidence under `playtest/`.
- Template gates: every selected template passes the complete gate and phone smoke.
- CI: the `check` job succeeds, which requires every expected job to succeed.
- Trace: `npm run lint:trace` reports zero problems.

Formal test witnessing is N/A; the merge record names who ran what. MC/DC coverage is
N/A because the software is not safety-critical (SWE-219).

## 5. Coverage and static analysis

Coverage is measured with Node's built-in coverage; no threshold is set. Measured at
the baseline commit on the reference machine (Node 22.23.3), over `src/**` with test
files excluded, running the 3,282 `src/**/*.test.ts` tests:

```sh
node scripts/generate.mjs
npx tsx --test --experimental-test-coverage --test-coverage-include="src/**" --test-coverage-exclude="**/*.test.ts" "src/**/*.test.ts"
```

| Scope | Lines | Branches | Functions |
|---|---|---|---|
| `src/**` (all files) | 89.76 % | 89.48 % | 93.74 % |

Scripts and tools are not in this figure. The secret scan uses the repository
`.gitleaks.toml` (default rules); its result for each baseline is in the
[assurance record](../assurance/assurance-record.md).

## 6. Procedures

Automated tests are their own procedures: the test name states the purpose, the
assertions state the expected result, and a rerun of the same command at the same
commit gives the same verdict. The procedures below need a person or a browser.

### P-1 Browser check (any `test:*-browser` script)

- Preconditions: `npm ci`; a Chromium (`npx --no-install playwright-core install chromium`, or `ENGINE_CHROMIUM=<path>`).
- Steps: run the script, for example `npm run test:dmath-browser`.
- Expected: exit 0 and a PASS line; evidence under `playtest/<name>/`.
- Last run: 2026-11-08 at `a9e8cc6` for `test:dmath-browser`, `test:subpath-browser`
  and `test:session-browser` (pass; [STR-main-a9e8cc6](reports/STR-main-a9e8cc6.md) §3).
  The other browser scripts ran in hosted CI only.

### P-2 Template gate with phone smoke

- Preconditions: as P-1.
- Steps: `npm run gate:templates -- --shard 1/2 --phone`, then `--shard 2/2 --phone`.
- Expected: every template passes.
- Last run: hosted CI on code changes; not run locally for this baseline.

### P-3 Stdio bridge smoke

- Preconditions: Python 3 only.
- Steps:

  ```sh
  printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"foundation-engine-jsonrpc/1"}}' '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"validate_scene_output","arguments":{"output":{"toneMapping":"aces"}}}}' | python3 -B tools/foundation_engine_bridge.py
  ```

- Expected: two response lines; the second is
  `{"id":2,"jsonrpc":"2.0","result":{"isError":false,"structuredContent":{"exposure":1,"toneMapping":"aces"}}}`; exit 0.
- Last run: 2026-11-08 at `a9e8cc6`, pass.

### P-4 Physical-device acceptance

- Manual, per game and per device profile, under the [device experience policy](../policy/DEVICE-EXPERIENCE.md).
- Not performed for this baseline. CI phone smoke is emulation, not device acceptance (GAP-004).

## 7. Test data

Fixtures are committed and byte-pinned: save envelopes in `src/core/save/fixtures/`,
the retained compatibility snapshot in `scripts/fixtures/compatibility/`, and golden
vectors in `src/core/dmath.golden.json` and `src/kits/numeric/numeric.golden.json`.
`.prettierignore` keeps them byte-exact.

## 8. Risks to testing

- Wall-clock bounds can fail on a heavily loaded machine (see §4).
- Browser checks depend on a working Chromium and GPU or software GL.
- Template gates and phone smoke are emulation; they do not replace device acceptance.
- Docs-only pull requests skip the work jobs by design, so a docs PR proves no runtime behavior.

## 9. Trace to requirements

The [verification matrix](verification-matrix.md) maps each requirement to its test.
Results per run are in the [test reports](reports/README.md).

## Change history

| Version | Date | Commit | Change | Reviewed in |
|---|---|---|---|---|
| 1.0 | 2026-11-08 | `a9e8cc6` | Initial test plan and procedures | This PR |
