---
name: ship
description: Take a finished milestone to integration and, only when authorised, production - gate, merge, deploy through the guard, and verify live. Use when the author says a milestone is done or asks to ship, release or deploy.
---

# Ship

Follow AGENTS.md exactly; this is its checklist.

1. All success criteria of the milestone: `npm run play:criteria -- --gate`. Everything PASS, or the author has accepted what is not.
2. GAME.md: milestone marked done; changelog rows for brief or budget changes.
3. Commit in the task's worktree; rebase onto current `origin/main`; `npm run gate` on that head. Put the gate summary in the merge.
4. Integrate from the main checkout, one branch at a time; verify the combined build and tests; push `main` without force.
5. Production only when the author asks, only with `npm run deploy:production` from a clean `main` equal to `origin/main`. Never a direct provider command.
6. Verify the live build through its public URL (the commit, the first scene opens, no page errors) and report.
