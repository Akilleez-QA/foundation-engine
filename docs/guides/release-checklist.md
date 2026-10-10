# Release readiness

Foundation Engine is distributed as public source. `package.json` uses `private: true` to prevent accidental npm publication; that setting does not make the Git repository private. Installation and checks require no paid AI tool or deployment credentials.

For an ordinary contribution, start with [CONTRIBUTING.md](../../CONTRIBUTING.md). For a release from this public repository, use [Before making a release](#before-making-a-release). The [source-publication procedure](#source-publication-procedure) is only for a separately authorized repository/history migration, not a routine release.

## A new checkout

Use Node.js 22.18 or newer; the 22.x line matches the primary CI jobs (a `node-current` job runs `npm run test` and `npm run check` on Node 26 for a push to `main` and a weekly schedule, not for pull requests). From a full Git checkout:

```sh
npm ci
npm run build
```

Complete hosted CI on the reviewed revision supplies integration evidence. To reproduce that full workflow locally on a suitable runner (optional when hosted evidence exists):

```sh
npx --no-install playwright-core install --with-deps chromium
npm run gate:ci
```

`npm run gate:ci` reproduces every checking command from `.github/workflows/ci.yml`
serially with the job/step environment, GitHub's `bash -eo pipefail` shell and
`CI=true`. Setup steps (`npm ci` and the browser install) remain explicit. A failure
stops that job; independent jobs continue, and the terminal aggregate uses their
actual results. `--from` and `--only` select partial runs, which cannot establish
full CI acceptance; `--list` shows job-qualified step IDs. The runner rejects
unsupported workflow graphs, conditions, shell overrides, matrices and expressions,
and requires the workflow's Node major unless given `--any-node`. See
[Complete CI and template shards](#complete-ci-and-template-shards) below.
A pass reproduces commands, not GitHub's machine, browser build or physical-device
performance. `npm run gate:templates` remains the complete template gates alone.

The browser installation may need administrator privileges for operating-system libraries. It is explicit: `npm ci` installs the locked packages, while the browser command installs the matching Chromium. Tests use a fresh, muted browser profile and software rendering by default. `ENGINE_CHROMIUM` can select an existing compatible executable; no developer-specific executable path is required.

`npm run build`, `npm test`, and the gates regenerate ignored catalogues and types. Do not copy generated output or `node_modules` from another machine. The `three` source alias resolves inside the local locked installation. Keep the lockfile with dependency changes.

A source ZIP supports installation and builds. Budget comparison and other history checks require a Git checkout with its base history. CI checks out full history so the budget ratchet can compare against `origin/main`.

## Contribution checks

Full hosted CI on the reviewed candidate is the required coverage; contributors need not duplicate it locally. Follow the [public review policy](../../GOVERNANCE.md#review-and-integration), including exact-head evidence and any explicitly authorized sole-maintainer exception.

The workflow runs on ordinary pull requests, including forks, with read-only repository permissions and no deployment secrets. Checkout credentials are not persisted. Actions are pinned to verified commits; update the pins deliberately when upgrading them. It runs the complete integration gate for every discovered template and a separate phone smoke for each template. Browser workers, scratch files and build output stay within the runner job; concurrent runs for the same ref replace obsolete runs.

Do not change this workflow to execute unreviewed contributions through `pull_request_target`, add write permissions, or expose publishing credentials to test jobs. Tests and release publication are separate operations.

## Before making a release

- Fold the unreleased changelog fragments: `npm run changelog -- --fold` moves every file in `changes/unreleased/` into CHANGELOG.md's Unreleased section (newest first) and deletes them; then give the section its version heading.
- Confirm the selected GPL-3.0-only license, package metadata and third-party notices agree, including bundled sample assets.
- Record the exact source commit/tree and successful complete hosted CI run (or equivalent `npm run gate:ci` result), including all template gates. Record fresh Node 22.18+ install/build evidence separately. Focused checks and an earlier head's pass do not establish acceptance of the release candidate.
- Check the repository and release archive for credentials, private configuration and machine-specific paths. Ignoring local credential files prevents accidental additions; it does not replace review or remove historical material.
- Inspect dependency and asset changes; retain source, license and attribution records.
- Record known limitations, the tested platforms and any reference-performance warnings with the release.
- Distributors must provide the exact corresponding source for the distributed build, including application code and build scripts as applicable, and preserve third-party notices. A private repository URL is not publicly available source. Check the emitted `LICENSE.txt` and `THIRD_PARTY_NOTICES.txt`; those files alone are not a source offer.
- Choose and authorize a release channel explicitly. This CI workflow does not deploy, upload a package or publish a release.

## Local readiness evidence

On 2026-09-30 a fresh temporary source snapshot, without `node_modules`, generated files or build output, installed with `npm ci` and built under the official Node.js 22.23.3 binary. No authentication was supplied. The manifest and lockfile contain no local-path dependencies. Tracked filename inspection found no `.env`, credential-store, private-key or provider-state files; this is a filename audit, not proof that every historical revision is free of secrets. Hosted CI, including private runs, is confirmed only by its actual GitHub run; public visibility is a separate state.


## Device experience claims

Use these existing records instead of inventing a second support matrix:

| Record | What it establishes |
| --- | --- |
| [Application device matrix](../APPLICATION.md#device-experience-acceptance-adr-0068) | Template for declaring each target, inputs, quality, reference hardware and evidence; placeholder rows remain unverified |
| [Stock template device audit](../kits/stock-device-acceptance-matrix.md) | Historical seven-template source audit with later scoped receipts; not a current exhaustive list or physical-device certification |
| [Current upgrade acceptance ledger](upgrade-acceptance-ledger.md) | Per-feature integration and evidence boundaries; consult the referenced revision/consumer before making a claim |

For each release, identify its actual included templates and fill the chosen target rows from real evidence. A new template or a later integration is not automatically covered by an older audit.

- Confirm author-selected targets, modes and edition scope. Single-target maximum
  quality and explicit cross-platform tradeoffs are valid; unsupported targets do
  not constrain this release.
- Apply [DEVICE-EXPERIENCE.md](../policy/DEVICE-EXPERIENCE.md) to every advertised
  profile. Attach the APPLICATION.md matrix and affected interaction captures.
- Verify active-world visibility, panel recovery, simultaneous touch where needed,
  tablet hybrid/split view, narrow laptop windows and accessible text scaling.
- Record physical-device cold and sustained performance separately from emulation
  and software-rendered counts. A reference-only pass cannot certify other profiles.
- Missing acceptance evidence blocks an unqualified supported-device claim. Record
  limitations explicitly; do not silently remove a target or weaken its thresholds.

## Source-publication procedure

**Separate migration only.** The source is already public. Do not repeat history export, repository recreation, backup deletion or visibility changes for a normal release. The steps below apply only when the repository owner explicitly commissions a new publication/migration operation. The [historical publication record](release-preparation-status.md#publication-outcome-2026-10-01) documents the initial transition; its old pending checklist is not the current release checklist.

Preparation does not change repository visibility. Record the selected source
commit, tree identity, checks and remaining limitations before publication.

1. Preserve a private mirror of the existing remote and verify it with `git fsck`.
   Preserve local branches and uncommitted work separately. A mirror does not contain
   GitHub issues, reviews, discussions, Actions artifacts, settings or working copies.
   Export required hosting records before any deletion.
2. Reconcile outstanding branches and release claims. Do not copy an old release
   branch over newer code or silently discard unfinished work. Select the exact
   release tree; keep private research and credentials outside that tree.
3. Inspect tracked files, dependency/asset notices, source archive, history,
   filenames and binary evidence. Regex scans are triage, not clearance. Review
   images and logs for private information; preserve originals privately when
   preparing redacted public copies, and label those copies accurately.
4. If clean history is required, prepare a fresh local repository from the selected
   source export with one initial commit. Do not push historical refs into it.
   Preserve licenses, copyright, attribution and reproducible build sources.
   Squashing is not secret revocation or evidence of original authorship.
5. Run all template gates in the reviewed lineage before export. Establish the new
   repository's reviewed budget baseline explicitly: an orphan tree lacks original
   comparison history. Separately validate the exported tree's fresh install,
   build and tests, and retain both evidence scopes.
6. Prepare release notes, known limitations and corresponding-source downloads.
   Confirm the release channel and exact repository before public creation,
   visibility changes, history replacement or deletion. Retain the old repository
   privately until backup and migration verification are complete.
7. Configure and verify protected branches, required CI checks, maintainer
   permissions and private vulnerability reporting for the authorized destination.
   Enable Discussions only with an intended support workflow. Configuration text
   does not establish that a hosted setting is active.
8. Verify anonymous clone/source-download access, fresh-checkout instructions,
   release links and notices. Then publish the prepared announcement and record
   the public commit/tag separately from private preparation commits.

The deletion/recreation suggestion in an earlier PR is not a completed step.
Hosted records, permissions and redirects require separate migration decisions;
do not delete a repository merely because an orphan export has been prepared.

## Complete CI and template shards

Hosted CI runs framework/browser checks serially in `browser`, alongside two
isolated template runners, all on Node 22. Each sorted discovered template belongs to exactly one
shard; each still runs the complete gate (including full tests) and phone smoke.
Those three jobs run on pull requests and on pushes to `main` when the diff contains a path outside
`docs/` and Markdown. A fourth, cheap `node-current` job runs `npm run test` and `npm run check` on the
newest Node major (26; raise it when a newer major ships), with no browser or template
gates. It runs on a code push to `main` and on a weekly Monday 06:00 UTC schedule, not on pull requests.
The weekly run does not start the Node 22 jobs. A `changes` job reads the diff (the same paths as `docs/**`
and `**/*.md`). When every changed path is docs or Markdown, the heavy jobs are skipped. The workflow
still starts, and the terminal required check remains `check`: it depends on `changes` and all four work
jobs, and it passes for that skip. On a pull request that changes code it accepts success from the three
Node 22 jobs and a skipped `node-current`. On a code push to `main` it accepts only explicit success from
all four. On the weekly schedule it accepts success from `node-current` and skipped Node 22 jobs.
Failure, cancellation, or a missing result does not pass. A skipped result passes only for a job that this
event does not run. In-progress runs are cancelled only for pull requests. No job uploads an artifact.
Existing budgets, runner permissions, pinned actions and timeouts are unchanged.

On a suitable local machine, `npm run gate:ci` reads this workflow and executes all
work jobs serially, then checks their actual results. It does not apply the hosted event
filters or the docs path filter, so a full local run still executes `node-current` and requires every work job to succeed.
The `changes` job is not executed locally.
A failed step stops its job; other independent jobs still execute. Steps of a job that uses another Node major than
the local one are skipped and the run is reported as partial (no aggregate); run them
under that Node with `npm run gate:ci -- --only node-current/test,node-current/check`,
or pass `--any-node` to run everything under the local Node. Install dependencies and Chromium first as
shown above. This reproduces the checks, not GitHub runner isolation or hardware.
Unsupported job graphs, conditions and expressions fail before execution. The hosted event
filters on `changes` and the four work jobs are the only job `if` values the reader accepts, and it does not evaluate them.

`npm run gate:ci -- --list` prints job-qualified step IDs. `--from` and `--only`
produce partial results and omit the terminal aggregate; they cannot establish full
CI acceptance. For a focused template run use
`npm run gate:templates -- --shard 1/2 --phone` (or `2/2`). Unknown template names,
invalid shard arguments and empty selections fail. Templates are rediscovered on
each run, so additions need no maintained name list. Hosted elapsed-time improvement
must be measured after integration; the sharding change does not reduce total tests.
