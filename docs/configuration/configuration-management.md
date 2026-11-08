# Foundation Engine software configuration management plan

| Field | Value |
|---|---|
| Document ID | FENGINE-SCMP |
| Version | 2.0 |
| Status | Baselined |
| Owner | Akilleez-QA |
| Date | 2026-11-08 |
| Baseline commit | `a9e8cc6f175b5055b18abf26579ecc432a6ac53b` |
| Applies to | foundation-engine main at baseline commit |
| Classification | Self-assessed Class E analog; not safety-critical (see [SMP §1](../plan/software-management-plan.md#1-software-classification-self-assessed)) |

> Organized after [NPR 7150.2D](https://nodis3.gsfc.nasa.gov/displayAll.cfm?Internal_ID=N_PR_7150_002D_&page_name=all), [NASA-STD-8739.8B](https://standards.nasa.gov/standard/nasa/nasa-std-87398) and the [NASA Software Engineering Handbook](https://swehb.nasa.gov/display/SWEHBVD/7.18+-+Documentation+Guidance) documentation guidance. This is not a NASA compliance determination or certification. The software classification is a self-assessed analog (Class E, not safety-critical); no NASA authority, independent verification and validation, or hazard analysis is asserted. The document describes the implementation inspected at the baseline commit.

## 1. Organization and policies

The maintainer listed in [.github/CODEOWNERS](../../.github/CODEOWNERS) owns
configuration control. Contributors and agent lanes propose changes by pull request.
[GOVERNANCE.md](../../GOVERNANCE.md) sets the review and merge rule and the release
policy; [CONTRIBUTING.md](../../CONTRIBUTING.md) sets the branch and validation rules.

## 2. Configuration items and identification

| Item | Identified by | Where |
|---|---|---|
| Source tree | Git commit (40-hex SHA); release tag | `main` on GitHub |
| Package version | `version` in `package.json` (0.2.0 at the baseline) | `package.json` |
| Dependency graph | `package-lock.json` | repository root |
| Runtime selection | `engines.node` (`>=22.18`), `.node-version`, `.nvmrc` | repository root |
| CI definition | Action SHAs and Node versions in the workflows | `.github/workflows/` |
| Every tracked file | SHA-256 in `SOURCE-MANIFEST.json` (`foundation-engine-source-manifest/1`) | repository root |
| Read-only tool contract | `schemas/read-only-tools.json` (`foundation-engine-tools/1`, version 0.2.0) | `schemas/` |
| Bridge protocol | `foundation-engine-jsonrpc/1` | `tools/foundation_engine_bridge.py` |
| Released save and template fixtures | Pinned manifests | `src/core/save/fixtures/v0.2.0/`, `scripts/fixtures/compatibility/` |
| Documentation | Baseline commit in each control document's header | `docs/` |

Use `git rev-parse origin/main` to identify the local tracking baseline; it is not an
immutable release identifier. Use `git rev-parse HEAD` to identify a candidate and
`git tag --list` and `git show <tag>` for releases. A version field, a tag and a release
publication are separate facts. `private: true` prevents accidental npm publication.

`GAME_DIR` or `--game <dir>` selects a consumer. With no local game the blank template
is selected. Build briefs, scene budgets and asset provenance stay with the selected
game. Record that configuration with any evidence, so results from one template are not
presented as acceptance of another.

## 3. Baselines

A baseline is a commit on `main` reached through a merged pull request, or a tag.
Tags at the baseline commit: `v0.2.0` (`294dfa96394e208c4d53d78caaeb79f071e28143`). The
CHANGELOG also records 0.1.0 (untagged first public source) and a proposed 0.3.0
candidate that has not been released.

Digests of the controlled files at the baseline commit, from
`node scripts/docs/reports.mjs digests --commit a9e8cc6`:

| File | SHA-256 |
|---|---|
| `SOURCE-MANIFEST.json` | `1af0cc17c8050d97a4a3297680839e689bf91cb217fe07e0fd6b7d6ff9556a34` |
| `package.json` | `51f36b75a28bb73a943afd2d27e568361d7ddbf5cd9d6aaae117d1074979c5cf` |
| `package-lock.json` | `9779882e901df123b3381996222c963ed60acdfd9d6d467cba8f034cf72f3509` |
| `schemas/read-only-tools.json` | `5b554fdee331f129ef0043d117a9b2caa7248515fe08caee60cccc6fb6c12972` |
| `tools/foundation_engine_bridge.py` | `72f5361c2fc820879df5d2afdbf2da6fc77ab649001b22a8f7a094c5bba04528` |
| `tools/build_manifest.py` | `34de42165e27b31079493899c9b60f1823834eb661779b4060645874752800e4` |

Each [version description](../releases/README.md) carries the same table for its tag.

## 4. Change control

Contributions follow [CONTRIBUTING.md](../../CONTRIBUTING.md): a focused branch,
reviewable changes and checks tied to the candidate revision. The governance merge rule
requires the branch to be current with `main`, CI green on that exact head and `main`'s
latest CI green. Author API, standard, budget-raise and new-kit changes need an ADR.
Budget raises need a reviewed commit trailer (`npm run lint:budgets`). Dependabot
proposes dependency updates as pull requests.

A change to any dependency pin goes through `package-lock.json` and `npm ci` and is
noted in the changelog. Release notes use [unreleased fragments](../../changes/unreleased/README.md);
`npm run changelog` shows them and `npm run changelog -- --fold` folds them during
release preparation.

## 5. Control of generated outputs

| Output | Generator | Committed | Check |
|---|---|---|---|
| `src/generated/`, `src/core/i18n/keys.gen.ts` | `node scripts/generate.mjs` (run by `dev`, `build`, `test`, `typecheck`) | No (git-ignored) | Regenerated before every build and test |
| `docs/capabilities.json`, `docs/capabilities.md` | `npm run capabilities` | Yes | `npm run lint:docs-claims` fails on drift |
| `SOURCE-MANIFEST.json` | `python3 -B tools/build_manifest.py` | Yes | `python3 -B tools/build_manifest.py --check` in CI |
| `docs/releases/VDD-*.md` | `node scripts/docs/reports.mjs vdd` | Yes | Regenerate and diff at release |
| `docs/verification/reports/STR-*.md` | `node scripts/docs/reports.mjs str` | Yes | Never hand-edited |
| Golden vectors (`src/core/dmath.golden.json`, `src/kits/numeric/numeric.golden.json`) | `npm run dmath:golden -- --write`, `npm run numeric:golden -- --write` (a deliberate contract change) | Yes | The same scripts without `--write` compare; tests compare exactly |

Generator inputs are tracked source; generators run on the Node and Python versions in
the [SMP §4](../plan/software-management-plan.md#4-engineering-and-test-environment).

## 6. Source manifest and schema pins

Stage intended source files with `git add`, then run
`python3 -B tools/build_manifest.py` and stage `SOURCE-MANIFEST.json`.
`python3 -B tools/build_manifest.py --check` compares bytes without rewriting and fails
on changed, missing or newly tracked files. Untracked artifacts are excluded; review
`git status --short` for omitted source before committing. `PR_BODY.md` is local review
material and excluded even if accidentally staged.

The manifest uses `foundation-engine-source-manifest/1`, the package version from
`package.json`, and a sorted `files` path-to-SHA-256 map. Compact JSON keeps this large
repository's baseline within the small-change line limit; its hash is not a signature
or proof of correctness. The standalone `manifest.yml` CI job checks it without npm
dependencies; `gate:ci` covers `ci.yml`, so run this check separately.

The generator follows the GPL-3.0 Foundation Refrigeration convention at
[3fe90a9](https://github.com/Akilleez-QA/foundation-refrigeration/blob/3fe90a939f85aeb4e4aa6913b0993374e115f176/tools/build_manifest.py),
adapted to Git-tracked membership, compact encoding, package version and check mode.
The tool inventory version is pinned to `package.json`; schema changes need source
mapping, regression evidence and review. Transport is implemented by
`tools/foundation_engine_bridge.py`, adapted from Foundation Refrigeration
`4bd3311b31766c00083c582a8c4f99467501df7f`; protocol identity is
`foundation-engine-jsonrpc/1`. Stage bridge and test sources before regenerating.

## 7. Status accounting

Status comes from Git: `git log`, `git tag`, the CHANGELOG, the source manifest and the
version descriptions. Open and closed issues come from GitHub (`gh issue list`). The
[verification matrix](../verification/verification-matrix.md) records which baseline
each requirement was last verified at.

## 8. Configuration audits

At each release, a configuration audit compares the documentation baseline with the tag,
the source manifest with the files (`--check`), and the version description with the
tag contents. The result is an entry in the [assurance record](../assurance/assurance-record.md).

## 9. Release management and delivery

Maintainers tag releases from a clean, accepted `main` under the governance policy and
follow the [release checklist](../guides/release-checklist.md) for source, license,
notices, evidence and publication review. `npm run gate:ci` reproduces the repository
workflow on a suitable runner; partial selections do not establish full integration
acceptance. `npm run deploy:production` is the guarded production path and refuses
anything but a clean `main` equal to `origin/main`; a game author can instead build and
share the game's static output.

## 10. Plan maintenance

This plan is reviewed when the release process, CI or tooling changes, in the same pull
request as the change.

## Change history

| Version | Date | Commit | Change | Reviewed in |
|---|---|---|---|---|
| 1.0 | 2026-11-01 | `39cf03b` | Baselines, pins, change and release control | PR #328 |
| 1.1 | 2026-11-01 | `70810ba` | Source manifest, schema pins and bridge provenance | PRs #333, #340, #341 |
| 2.0 | 2026-11-08 | `a9e8cc6` | Family documentation standard: metadata, configuration items, baseline digests, generated outputs, status accounting, audits | This PR |
