---
name: ship
description: Take a finished milestone to a shareable build (a game of your own, on its branch) or, for engine contributions, to integration and, only when authorised, production - gate, merge, deploy through the guard, and verify live. Use when the author says a milestone is done or asks to ship, release, share or deploy.
---

# Ship

Follow AGENTS.md exactly; this is its checklist. First decide which kind of change this is.

## A game of your own (a clone, on the author's game branch)

1. All success criteria of the milestone: `npm run play:criteria`. Everything PASS, or the author has accepted what is not. `npm run gate` is recommended before sharing.
2. GAME.md: milestone marked done; changelog rows for brief or budget changes.
3. Commit on the game branch in the author's checkout. Do not rebase onto, merge into or push to this repository's `main`, and do not use `npm run deploy:production`.
4. To share: `npm run build`, then `npm run preview` to try `dist/`. The author uploads `dist/` to a static host; follow docs/recipes/share-your-build.md (root-of-domain hosting works as built; under a sub-path, models and textures do not load yet).
5. Check the uploaded copy: the first scene opens, no console errors, no 404s.

## An engine contribution (this repository)

1. All success criteria of the milestone: `npm run play:criteria -- --gate`. Everything PASS, or the author has accepted what is not.
2. GAME.md: milestone marked done; changelog rows for brief or budget changes.
3. Commit in the task's worktree; rebase onto current `origin/main`; `npm run gate` on that head. Put the gate summary in the merge.
4. Integrate from the main checkout, one branch at a time; verify the combined build and tests; push `main` without force.
5. Production only when the author asks, only with `npm run deploy:production` from a clean `main` equal to `origin/main`. Never a direct provider command.
6. Verify the live build through its public URL (the commit, the first scene opens, no page errors) and report.
