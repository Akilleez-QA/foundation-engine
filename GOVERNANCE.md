# Governance

## Roles

- **Users** build games on the engine and report what breaks.
- **Contributors** send issues, docs, reviews and pull requests. Anyone can be one: see [CONTRIBUTING.md](CONTRIBUTING.md).
- **Maintainers** review and merge pull requests, triage issues, own the standard and the budgets, and cut releases. They are listed in [.github/CODEOWNERS](.github/CODEOWNERS).

## How decisions are made

- Day-to-day changes: one maintainer's approval and green CI.
- Changes to the author API (`@engine`), [docs/STANDARD.md](docs/STANDARD.md), a budget raise, or a new kit: an issue or discussion first, then an ADR in [docs/adr/](docs/adr/README.md) that records the decision. Maintainers aim for consensus. When there is none, the lead maintainer decides and records the reasoning in the ADR.
- The standard's laws change only by an ADR that names the law, the reason and the migration.

## Review and integration

The normal route is a protected pull request with required checks passing and maintainer review. Record review findings and their resolution against the exact proposed head. Full hosted CI can supply the integration gate; a second local run of the same heavy suites is optional. A base update creates a new combined candidate that needs current evidence.

**Merge rule.** Merge a pull request only when all three hold at the moment of merging: (1) the branch is up to date with `main` (no commits on `main` missing from it); (2) CI completed green on that exact head, not on an earlier head or before a base update; (3) `main`'s latest CI run has completed green. When `main` moves, update the branch and wait for CI on the new head. When `main`'s latest run is red or still running, wait or fix `main` first. One merge at a time, so each merge's CI can finish before the next: merging faster than CI completes leaves `main` uncertified.

When there is only one active human maintainer and GitHub cannot accept that person's approval of their own PR, the repository owner may explicitly authorize an administrative merge exception. Keep all required checks passing; do not use this exception to bypass a failing or missing CI result. Before merging, record the exact head/base, CI link, separate source review, resolved findings and why the human-approval rule needs the exception. Identify whether the separate reviewer is a person or an agent. An agent review is evidence, not a GitHub human approval, and a maintainer's own reread is not independent review.

This exception does not authorize contributors to change branch protection, bypass checks, release packages or deploy. Owner authorization may cover a specified merge or a bounded integration session. Link that standing authorization in each merge record and honor its scope; no repeated authorization request is needed within that scope. See [ADR 0077](docs/adr/0077-candidate-verification-evidence.md).

## Becoming a maintainer

A contributor with a steady record of merged work and useful reviews can be nominated by a maintainer. The existing maintainers agree by consensus, and the new maintainer is added to CODEOWNERS.

## Releases

The engine is versioned with [semantic versioning](https://semver.org). Before 1.0, a minor version may break the author API. Every release has notes in [CHANGELOG.md](CHANGELOG.md). Maintainers tag releases from a clean `main` that passes the gate.
