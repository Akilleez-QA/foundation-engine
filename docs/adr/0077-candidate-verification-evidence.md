# 0077 Candidate verification evidence

Status: proposed for maintainer review, 2026-10-03.

## Context

Contributors can run focused checks without a browser or paid tool, but the public instructions implied that each person must duplicate the complete hosted workflow locally. Forks also commonly call their own repository `origin`, whereas existing budget checks compare against `origin/main`. A sole maintainer cannot approve their own GitHub pull request.

## Decision

Use canonical upstream as `origin` and a separate `fork` remote for personal pushes in the documented contributor path. Start isolated task worktrees from current `origin/main`; keep full history for history-sensitive checks. This changes documentation, not Git or budget behavior.

Working-tree checks are development feedback. After committing, run relevant test paths explicitly and record counts; clean-tree zero selection is not regression evidence. This decision does not depend on proposed new test-selection flags.

The complete hosted CI workflow on the reviewed candidate supplies the integration gate. Reproducing it locally with `gate:ci` is optional on a suitable runner; partial or historical passes do not substitute for missing full coverage. Recheck the combined candidate when the base changes. Integration remains serial through pull requests.

The normal protected-review route remains preferred. For a sole active human maintainer, a repository-owner-authorized administrative exception may address the inability to approve one's own PR only after required checks pass and a separate source review is recorded. Owner authorization may cover a specified merge or a bounded integration session; link the standing authorization in each merge record, honor its scope and do not request it again within that scope. Record exact head/base, CI link, reviewer identity/type, resolved findings and the exception's reason. Do not describe self-review or an agent review as a GitHub human approval. Never bypass failed or missing checks.

## Consequences

Contributors need no upstream write permission or private operational notes to reproduce the scoped path. Maintainers retain complete integration coverage and a reviewable acceptance record. Physical devices, publication and deployment remain separate acceptance/authorization steps. No API, runtime budget, device target, GitHub setting or workflow command changes in this decision.
