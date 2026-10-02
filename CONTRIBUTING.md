# Contributing to Foundation Engine

Foundation Engine is infrastructure for independently authored browser games. Contributions should improve a reusable engine contract, an optional kit, or a small template that demonstrates a contract. A game's world, campaign, economy rules, and progression content belong in that game's repository.

Read [AGENTS.md](AGENTS.md), [the architecture standard](docs/STANDARD.md), and the relevant [recipe](docs/recipes/) before changing code. These documents apply to human and assisted contributions. Review [the conduct policy](CODE_OF_CONDUCT.md) and [security reporting guidance](SECURITY.md).

## Set up

Use Node.js 22.18 or later (`.nvmrc` / `.node-version` pin the Node 22 line), npm, and Git. CI currently uses Node.js 22. In a checkout:

```sh
npm ci
npm run dev
```

Without a `game/` folder, the blank template runs. Pass `--game templates/terrain/game` (for example `npm run play -- --game templates/terrain/game`; works on every shell) or set `GAME_DIR=templates/terrain/game` to select a diagnostic consumer. Shell examples use POSIX environment-variable syntax; in PowerShell use `$env:GAME_DIR="templates/terrain/game"; npm run …`, in cmd.exe `set GAME_DIR=templates/terrain/game&& npm run …`. The `test:*-browser` scripts assume bash (CI); on Windows run them from WSL or Git Bash.

Browser checks require Chromium. Install the matching browser with:

```sh
npx playwright-core install chromium
```

Linux CI may also need browser system dependencies (`npx playwright-core install --with-deps chromium`). The harness accepts `ENGINE_CHROMIUM` as an executable path, then tries Playwright's installed browser, then an installed Chrome or Chromium in its usual folder for the OS (`ENGINE_CHROMIUM_SYSTEM=0` skips those); without one it stops with the install command. Test browsers are isolated and muted; do not change system audio or use a personal browser profile for automation.

## Propose a change

For substantial changes, open an issue describing the problem, a minimal consumer, and the proposed contract before investing in an implementation. A bug report should include a commit/version, browser/device, steps, expected and actual behavior, and a small reproduction. Remove credentials, private assets, personal information, and unrelated application code. Follow SECURITY.md for suspected vulnerabilities.

Explain ownership and disposal, asynchronous cancellation, finite work/memory bounds, and compatibility with existing callers where relevant. An optional kit must stay optional. Do not import kits into core, platform, or the author API; game code imports only `@engine`, `@kits/<name>`, its own files, and JSON. Use existing scheduling, asset, worker, input, and save mechanisms instead of introducing parallel subsystems.

## Make and validate the change

Follow the per-task branch/worktree and integration rules in AGENTS.md. Contributors without write access can work from a fork and submit a pull request. Keep changes focused and preserve other contributors' work. Update a template's GAME.md/build brief when changing its behavior; changes to audience, minimum device, or budget ceilings need explicit agreement.

During development:

```sh
npm run check
```

`check` selects affected tests from working-tree changes against HEAD, including untracked files. A clean committed tree does not make it a full regression run. Before requesting review, run the complete source checks:

```sh
npm run typecheck
npm run lint
npm test
```

For changed runtime behavior, add tests that demonstrate the failure and intended outcome, including cancellation, retry, or disposal when applicable. For visible changes, capture and inspect desktop and relevant mobile screenshots with `npm run play:snap` and `npm run play:snap -- --mobile`; report page errors and measured counts. Development heap readings do not substitute for production benchmark results.

The integration contract remains `npm run gate` on the proposed head; run it with `GAME_DIR` for each affected template. Broad shared changes may need `npm run gate:templates`; before integration, `npm run gate:ci` runs everything CI runs, including its browser suites. Report commands, results, and any unavailable hardware/browser checks honestly. Never weaken a test, tolerance, or budget to obtain a pass. CI smoke checks do not replace the full integration gate.

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

Describe the concrete problem and resulting behavior, link the issue when one exists, and give reproduction/validation evidence. Explain public API or save-format compatibility changes and document new contracts. Include asset/source provenance and required notices for anything you add; do not copy proprietary implementation code or assets. Do not submit secrets, generated dependency directories, or unrelated local artifacts.

New original contributions to Foundation Engine are submitted under GNU GPL version 3 only (`GPL-3.0-only`), the project's license. See [LICENSE](LICENSE) for the full terms. Identify third-party material explicitly, retain its license and notices, and document any applicable exceptions in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md); do not relabel third-party work as original project code. This project does not require a separate contributor license agreement or copyright assignment.

Maintainers review and integrate changes; submission does not guarantee acceptance or a response deadline. Contributors should not deploy production builds or change repository settings as part of a code contribution.

## Release-facing documentation

Keep notable API, compatibility and workflow changes in [CHANGELOG.md](CHANGELOG.md).
Use Unreleased until a release exists. Follow [GOVERNANCE.md](GOVERNANCE.md) and
[release readiness](docs/guides/release-checklist.md). Private integration, a version
field and green CI do not publish source or establish device support.
See [SUPPORT.md](SUPPORT.md) for help channels.
