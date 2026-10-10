# Contributing to Foundation Engine

```text
      [##]          FOUNDATION ENGINE
    [======]        =================
  [==][==][==]      PLAYER 2 HAS JOINED
 [############]
```

Foundation Engine is infrastructure for independently authored browser games. Contributions should improve a reusable engine contract, an optional kit, or a small template that demonstrates a contract. A game's world, campaign, economy rules, and progression content belong in that game's repository.

Read [AGENTS.md](AGENTS.md), [the architecture standard](docs/STANDARD.md), and the relevant [recipe](docs/recipes/) before changing code. These documents apply to human and assisted contributions. Review [the conduct policy](CODE_OF_CONDUCT.md) and [security reporting guidance](SECURITY.md).

## Set up

Use Git, npm and Node.js 22.18 or later (`.nvmrc` / `.node-version` select Node 22; CI uses Node 22). No paid AI tool, coding agent, deployment credential or private repository is required.

For a contribution without upstream write access, create your own GitHub fork, then clone the canonical repository and add your fork as the push destination. Replace `YOUR-NAME` and `my-change` below:

```sh
git clone https://github.com/Akilleez-QA/foundation-engine.git
cd foundation-engine
git remote add fork https://github.com/YOUR-NAME/foundation-engine.git
git fetch origin main
git worktree add ../foundation-engine-my-change -b my-change origin/main
cd ../foundation-engine-my-change
npm ci
```

Here **`origin` is the canonical upstream; `fork` is your personal repository**. This is intentional: history and budget checks compare against `origin/main`. If you already cloned your fork as `origin`, rename that remote with `git remote rename origin fork`, add the canonical URL with `git remote add origin https://github.com/Akilleez-QA/foundation-engine.git`, and fetch it before creating the task worktree. Keep each worktree's own dependencies; do not reuse another contributor's `node_modules`. A new dependency with an install script needs a reviewed `allowScripts` entry in `package.json` (`npm approve-scripts <pkg>` or `npm deny-scripts <pkg>`; those commands need npm 12 or newer, while Node 22 ships npm 10, so run them with `npx npm@12 approve-scripts <pkg>` or edit the entry by hand); `scripts/install-scripts.test.mjs` fails until it has one.

### Testing against a fixed candidate commit

`git fetch origin main` always moves `origin/main` to the current upstream tip. To rehearse or review against a fixed commit (a release candidate, or the base a reviewer named), start the worktree from that commit and pass it as the base instead of `origin/main`:

```sh
git fetch origin
git worktree add ../foundation-engine-candidate -b my-change 7c26db7   # the candidate's full or short SHA
cd ../foundation-engine-candidate
npm ci
BUDGET_BASE=7c26db7 npm run check -- --base 7c26db7
git diff --check 7c26db7...HEAD
```

`--base` sets the test selection; `BUDGET_BASE` sets the revision that `lint:budgets` (in `npm run check` and `npm run lint`) compares budgets with, which is otherwise `origin/main`. Both leave `origin/main` alone, so a later fetch changes nothing. Do not move `origin/main` with `git update-ref`: the next fetch resets it. Rebase onto the current `origin/main` before opening a pull request.

For a first contribution, a small reproduction, test, recipe correction or accessibility finding is useful. Choose the relevant existing contract and avoid unrelated cleanup. Making your own game instead? Follow [getting started](docs/guides/getting-started.md); game branches are not engine pull requests.

Without a `game/` folder, the blank template is selected. To inspect another consumer, use `npm run play -- --game templates/terrain/game` (works on every shell). It prints the URL and keeps running; use a second terminal for checks or stop it with Ctrl+C. Browser inspection is needed for affected visible behavior, not to run a pure Node test.

Shell examples with `GAME_DIR=...` use POSIX syntax; PowerShell uses `$env:GAME_DIR="templates/terrain/game"; npm run …`, and cmd.exe uses `set GAME_DIR=templates/terrain/game&& npm run …`. The `test:*-browser` scripts assume bash (CI); on Windows run those from WSL or Git Bash.

Browser checks require Chromium. Install the matching browser with:

```sh
npx --no-install playwright-core install chromium
```

Linux CI may also need browser system dependencies (`npx --no-install playwright-core install --with-deps chromium`). The harness accepts `ENGINE_CHROMIUM` as an executable path, then tries Playwright's installed browser, then an installed Chrome or Chromium in its usual folder for the OS (`ENGINE_CHROMIUM_SYSTEM=0` skips those); without one it stops with the install command. Test browsers are isolated and muted; do not change system audio or use a personal browser profile for automation.

For the current improvement milestone, see the [creator-readiness goal](docs/guides/creator-readiness-goal.md): acceptance criteria, task cards, parallel ownership and evidence requirements.

## Propose a change

For substantial changes, open an issue describing the problem, a minimal consumer, and the proposed contract before investing in an implementation. A bug report should include a commit/version, browser/device, steps, expected and actual behavior, and a small reproduction. Remove credentials, private assets, personal information, and unrelated application code. Follow SECURITY.md for suspected vulnerabilities.

Explain ownership and disposal, asynchronous cancellation, finite work/memory bounds, and compatibility with existing callers where relevant. An optional kit must stay optional. Do not import kits into core, platform, or the author API; game code imports only `@engine`, `@kits/<name>`, its own files, and JSON. Use existing scheduling, asset, worker, input, and save mechanisms instead of introducing parallel subsystems.

## Describe systems and patterns

Use system and pattern names instead of external game titles, franchise names,
their acronyms, or references to their source projects in contribution titles, issues, proposals,
pull requests, goals, documentation, code comments, and examples. Describe the
behavior and reusable contract directly: for example, sectioned persistence,
scene ownership, authoritative replication, data-driven crafting, or bounded
asset streaming. State requirements and acceptance evidence so the submission
stands on its own without familiarity with another game.

Study mechanics, architecture and behavior as reusable systems and patterns;
this repository does not require inspiration credits or game-name citations for
independently implemented mechanics. Describe our own requirements, design and
verification evidence.

Do not submit proprietary source excerpts, source links, or private study notes.
Attribution and license notices apply to third-party material actually included
or adapted in a contribution, such as code, assets or documentation, and to
dependencies. Preserve required notices for that material. A change of programming
language alone does not make adapted code an independent implementation.
Foundation's own template names and reproducible file/API identifiers remain
appropriate when needed to explain or verify a change. Reviewers should request
neutral system/pattern wording before accepting a submission.

## Make and validate the change

Follow the per-task branch/worktree and integration rules in AGENTS.md. Contributors without write access can work from a fork and submit a pull request. Keep changes focused and preserve other contributors' work. Update a template's GAME.md/build brief when changing its behavior; changes to audience, minimum device, or budget ceilings need explicit agreement.

During development:

```sh
npm run check
```

Run `npm run format` (Prettier) before committing; CI checks it through `npm run format:check`, which `npm run lint` and `npm run check` include. Markdown is not formatted.

`check` selects affected tests from working-tree changes against HEAD, including untracked files. A clean committed tree can select **zero tests**; the output reports that explicitly, and a pass then does not establish that a regression test ran. Use `npm run check -- --base origin/main` (or your fork's upstream base) to include committed changes since the merge base, together with staged, unstaged and untracked changes. This selection is a local heuristic, not complete dependency coverage. Use `npm run check -- --all` to run the canonical `npm test` suite during the check. Invalid revisions and unknown selection options fail instead of silently selecting no tests. With `--base`, a zero selection means that nothing changed since the merge base affects a test (a documentation-only branch, for example); the message then suggests `--all` or explicit tests, not `--base` again.

Run relevant tests explicitly before requesting review, including after a commit. For example, a game-directory argument change uses:

```sh
node --import tsx --test scripts/lib/game-dir.test.mjs
```

Use the test files for your actual change, not this example by default. Record the test count and result. Before requesting review, also run the complete source checks:

```sh
npm run typecheck
npm run lint
```

`npm test` is the complete source suite; use it for broader changes when practical. A few tests assert wall-clock bounds (for example a bounded pump or admission cost). On a heavily loaded machine one of them can fail once and pass on a re-run. Re-run the failing file alone (`node --import tsx --test <file>`) and then the suite before investigating, and report both results; never widen the bound to get a pass. If a required check cannot run locally, say so and obtain its result through CI before integration. A focused selection is not the full suite.

For changed runtime behavior, add tests that demonstrate the failure and intended outcome, including cancellation, retry, or disposal when applicable. For visible changes, capture and inspect desktop and relevant mobile screenshots with `npm run play:snap` and `npm run play:snap -- --mobile`; report page errors and measured counts. Development heap readings do not substitute for production benchmark results.

## Review and integration evidence

The complete repository CI workflow on the reviewed candidate supplies the required integration evidence: browser suites, template gates and phone smoke. A green focused check or historical CI run cannot replace it. Contributors do not need to duplicate the full hosted workflow on a constrained local machine. `npm run gate:ci` remains the reproduction command for a suitable runner after dependency/browser installation; `npm run gate` for one template and `gate:templates` alone cover less than full CI. Record the checked head, base, CI run, local commands and unverified hardware claims.

Keep the PR current with canonical upstream. If its base changes, the maintainer must review and validate the resulting combined candidate before merging. Local assembly is staging, not accepted integration. Never weaken a test, tolerance or budget to obtain a pass. CI does not establish physical-device acceptance. [Governance](GOVERNANCE.md#review-and-integration) describes the review requirement and the explicitly authorized sole-maintainer exception; ordinary contributors do not need administrative permissions.

## Maintain documentation with the implementation

Update the capability guide and its examples in the same change as the API. Record
inputs, owner, configured limits, overload, cancellation, recovery and unsupported
behavior. When a capability changes, reconcile the [composition map](docs/guides/composition-framework-status.md),
[framework record](docs/guides/framework-upgrade-status.md) and
[acceptance ledger](docs/guides/upgrade-acceptance-ledger.md). Keep historical results
attached to their revision; replace stale current-status claims rather than adding
contradictory notes at the end. Update the kit catalog and relevant roadmap links
when adding an entry point.

Separate authored code, focused checks, native consumer evidence, integration and
physical-device acceptance. A configured CI command is not a passed CI result.
Record failures and missing checks, and update the acceptance entry after the final
checks and integration. This keeps the documentation useful to the next creator or
agent without requiring this conversation.

## Submit a pull request

Commit the focused change and push only your branch to your fork. Replace the example file path with the files you changed:

```sh
git add -- path/to/changed-file
git commit -m "Describe the concrete change"
git push -u fork my-change
```

`push -u` makes `fork/my-change` the branch's upstream (the worktree command set it to `origin/main`), so a later plain `git pull` or `git status` compares with your fork, not canonical `main`. Compare with upstream explicitly: `git fetch origin && git log --oneline origin/main..HEAD`.

On GitHub, open a pull request to `Akilleez-QA/foundation-engine`, base `main`, comparing your fork's `my-change` branch. No upstream write permission is needed. Include `git rev-parse HEAD`, relevant test commands/counts, and any missing checks in the PR template. Do not push to canonical `main`. A [recorded public-source rehearsal](docs/verification/contributor-rehearsal-20261003.md) shows this path with explicit post-commit tests and its remaining limits.

Describe the concrete problem and resulting behavior, link the issue when one exists, and give reproduction/validation evidence. Explain public API or save-format compatibility changes and document new contracts. Include asset/source provenance and required notices for anything you add; do not copy proprietary implementation code or assets. Do not submit secrets, generated dependency directories, or unrelated local artifacts.

New original contributions to Foundation Engine are submitted under GNU GPL version 3 only (`GPL-3.0-only`), the project's license. See [LICENSE](LICENSE) for the full terms. Identify third-party material explicitly, retain its license and notices, and document any applicable exceptions in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md); do not relabel third-party work as original project code. This project does not require a separate contributor license agreement or copyright assignment.

Maintainers review and integrate changes; submission does not guarantee acceptance or a response deadline. Contributors should not deploy production builds or change repository settings as part of a code contribution.

## Release-facing documentation

Record notable API, compatibility and workflow changes as a fragment in
[changes/unreleased/](changes/unreleased/README.md) (one file per change, so parallel pull requests do not conflict);
they are folded into [CHANGELOG.md](CHANGELOG.md) at release time. Do not add new entries to CHANGELOG.md directly. Follow [GOVERNANCE.md](GOVERNANCE.md) and
[release readiness](docs/guides/release-checklist.md). Private integration, a version
field and green CI do not publish source or establish device support.
See [SUPPORT.md](SUPPORT.md) for help channels.
