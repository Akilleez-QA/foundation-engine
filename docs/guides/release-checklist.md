# Release readiness

Foundation Engine can be installed and tested without accounts or deployment credentials. The repository's examples use local assets. The package remains private until maintainers explicitly choose a distribution channel.

## A new checkout

Use Node.js 22.13 or newer in the 22.x line for the full checks (the optional
SQLite authority host requires at least 22.13), and run:

```sh
npm ci
npm run build
npm test
npx --no-install playwright-core install --with-deps chromium
npm run gate:ci
```

`npm run gate:ci` runs every `run:` step of `.github/workflows/ci.yml` in order with the same env, GitHub's `bash -eo pipefail` shell and `CI=true`: the browser regression suites, `gate:templates` and the phone smoke. It skips only the setup steps (`npm ci`, the browser install), stops at the first failure with the step, exit code and duration, and resumes with `--from <step>` or narrows with `--only <step>` (`--list` shows the step ids). It refuses a Node major other than the workflow's unless given `--any-node`. A workflow construct it cannot mirror (a second job, `if:`, `shell:`, a matrix) is an error, and `scripts/gate-ci.test.mjs` fails when the workflow gains a step it would not run. It reproduces CI's commands, not CI's machine: a pass does not certify a different browser build, hardware or timing. `npm run gate:templates` remains the template gates alone.

The browser installation may need administrator privileges for operating-system libraries. It is explicit: `npm ci` installs the locked packages, while the browser command installs the matching Chromium. Tests use a fresh, muted browser profile and software rendering by default. `ENGINE_CHROMIUM` can select an existing compatible executable; no developer-specific executable path is required.

`npm run build`, `npm test`, and the gates regenerate ignored catalogues and types. Do not copy generated output or `node_modules` from another machine. The `three` source alias resolves inside the local locked installation. Keep the lockfile with dependency changes.

A source ZIP supports installation and builds. Budget comparison and other history checks require a Git checkout with its base history. CI checks out full history so the budget ratchet can compare against `origin/main`.

## Contribution checks

The workflow runs on ordinary pull requests, including forks, with read-only repository permissions and no deployment secrets. Checkout credentials are not persisted. Actions are pinned to verified commits; update the pins deliberately when upgrading them. It runs the complete integration gate for every discovered template and a separate phone smoke for each template. Browser workers, scratch files and build output stay within the runner job; concurrent runs for the same ref replace obsolete runs.

Do not change this workflow to execute unreviewed contributions through `pull_request_target`, add write permissions, or expose publishing credentials to test jobs. Tests and release publication are separate operations.

## Before making a release

- Confirm the selected GPL-3.0-only license, package metadata and third-party notices agree, including bundled sample assets.
- Confirm a fresh Node.js 22 installation and `npm run gate:ci` (which includes all template gates) pass on the exact reviewed commit.
- Check the repository and release archive for credentials, private configuration and machine-specific paths. Ignoring local credential files prevents accidental additions; it does not replace review or remove historical material.
- Inspect dependency and asset changes; retain source, license and attribution records.
- Record known limitations, the tested platforms and any reference-performance warnings with the release.
- Distributors must provide the exact corresponding source for the distributed build, including application code and build scripts as applicable, and preserve third-party notices. A private repository URL is not publicly available source. Check the emitted `LICENSE.txt` and `THIRD_PARTY_NOTICES.txt`; those files alone are not a source offer.
- Choose and authorize a release channel explicitly. This CI workflow does not deploy, upload a package or publish a release.

## Local readiness evidence

On 2026-09-30 a fresh temporary source snapshot, without `node_modules`, generated files or build output, installed with `npm ci` and built under the official Node.js 22.23.3 binary. No authentication was supplied. The manifest and lockfile contain no local-path dependencies. Tracked filename inspection found no `.env`, credential-store, private-key or provider-state files; this is a filename audit, not proof that every historical revision is free of secrets. Hosted CI, including private runs, is confirmed only by its actual GitHub run; public visibility is a separate state.


## Device experience claims

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
