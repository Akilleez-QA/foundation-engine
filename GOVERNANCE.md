# Governance

## Roles

- **Users** build games on the engine and report what breaks.
- **Contributors** send issues, docs, reviews and pull requests. Anyone can be one: see [CONTRIBUTING.md](CONTRIBUTING.md).
- **Maintainers** review and merge pull requests, triage issues, own the standard and the budgets, and cut releases. They are listed in [.github/CODEOWNERS](.github/CODEOWNERS).

## How decisions are made

- Day-to-day changes: one maintainer's approval and green CI.
- Changes to the author API (`@engine`), [docs/STANDARD.md](docs/STANDARD.md), a budget raise, or a new kit: an issue or discussion first, then an ADR in [docs/adr/](docs/adr/README.md) that records the decision. Maintainers aim for consensus. When there is none, the lead maintainer decides and records the reasoning in the ADR.
- The standard's laws change only by an ADR that names the law, the reason and the migration.

## Becoming a maintainer

A contributor with a steady record of merged work and useful reviews can be nominated by a maintainer. The existing maintainers agree by consensus, and the new maintainer is added to CODEOWNERS.

## Releases

The engine is versioned with [semantic versioning](https://semver.org). Before 1.0, a minor version may break the author API. Every release has notes in [CHANGELOG.md](CHANGELOG.md). Maintainers tag releases from a clean `main` that passes the gate.
