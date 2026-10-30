# Public contributor-path rehearsal — 2026-10-03

## Scope

A fresh HTTPS clone of public `Akilleez-QA/foundation-engine` at `5a68f06cc6b180780bced73a0444b8b704b8a378` was used independently of existing development worktrees. Instructions were read from public CONTRIBUTING, AGENTS, the game-directory helper/tests, governance and release/support documents. The rehearsal used Linux x86-64, Node 22.23.3, npm and Git; no browser, paid coding tool, private source, generated game folder or remote maintainer write was needed for this test-only contribution. Dependencies were installed in the task worktree itself with `npm ci --no-audit --no-fund` (33 packages; npm cache was already warm).

A local bare repository represented the personal fork push destination. `origin` remained the canonical public upstream and `fork` named that local destination. An isolated task worktree started from `origin/main`. This exercises Git remote/branch/worktree and push semantics, not GitHub fork creation, PR submission, fork CI permissions or a human newcomer's experience. No extra public repository or PR was created by the rehearsal.

## Representative contribution

The existing subprocess test in `scripts/lib/game-dir.test.mjs` verified that explicit `--game templates/arcade/game` reaches a child process. The rehearsal strengthened its environment to `GAME_DIR: 'templates/stale-selection/game'`, requiring the explicit flag to override even an invalid inherited selection. It also clarified the assertion message. No implementation behavior changed.

The local rehearsal commit was `2ac182d` (not a published project commit). It remains a test-only candidate separate from this documentation change. Its reproduction is the two-line test edit described above; no private fixtures are needed.

| Stage | Command | Result |
| --- | --- | --- |
| Uncommitted test edit | `npm run check` | PASS; typecheck/listed lints and one selected test file; about 8 seconds on this machine |
| Save the contribution | `git add scripts/lib/game-dir.test.mjs` then commit | One focused test-only commit |
| Verify after committing | `node --test scripts/lib/game-dir.test.mjs` | **4/4 pass**, zero failures/skips; actual subprocess argument/environment behavior exercised |
| Check clean committed tree | `npm run check` | PASS; explicitly selected **zero tests**. This is not additional test coverage |
| Source lints | `npm run lint` | PASS |
| Review change | `git diff --check origin/main...HEAD` | PASS; clean working tree, one branch commit |
| Submit to simulated fork | `git push -u fork rehearsal/game-selection` | Branch created in the local bare destination; canonical upstream unchanged |

Commands requiring computation ran at niceness 15. No `gate`, `gate:templates`, `gate:ci`, full local browser suite or deployment was run. Full hosted integration evidence remains required for any submitted implementation change.

## Gaps found and documentation response

- Fork setup previously lacked runnable remote/worktree instructions. Canonical upstream is now explicitly `origin`, with a separate personal `fork` remote, because existing history/budget tools compare against `origin/main`. This avoids comparing to a stale fork branch without changing tooling.
- A clean committed check does not select the branch's prior edits on this base. Explicit relevant test paths work now; the instructions do not depend on proposed `--base`/`--all` changes.
- Contributor and agent instructions implied duplicating all hosted gates locally. They now distinguish focused development checks, complete reviewed-candidate CI evidence and optional local reproduction without weakening required coverage.
- The sole-maintainer approval edge case now has an explicitly owner-authorized, recorded exception that keeps required checks and separate source review; it does not call self-review or agent evidence a GitHub human approval.
- Release guidance still named Node 22.13 despite the declared 22.18 minimum, described source distribution ambiguously as private, and presented initial migration steps without a clear routine-release boundary. These are corrected; historical receipts stay historical.
- Support/device records are accessible but intentionally incomplete. The application matrix contains unverified placeholders; the stock-device document is a historical seven-template audit. Release preparation now links and explains their scope rather than claiming new device coverage or treating every current template as already accepted.

## Limits and follow-up

This is an agent-operated contributor rehearsal, separate from the earlier game-creator onboarding trials. It does not establish minimum-hardware, Windows/macOS, unfamiliar-human usability, GitHub fork permissions, protected-branch settings, release publication or complete CI acceptance. Node and Git were already installed. No paid-agent workflow was required by the commands. The proposed workflow/governance clarification needs maintainer review before integration; hosted settings were not changed.
