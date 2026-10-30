# Configuration management

## Source baseline and versions

The source baseline for this documentation pass is
`294dfa96394e208c4d53d78caaeb79f071e28143` (`origin/main` when the pass began).
Use `git rev-parse origin/main` to identify the local tracking baseline; it is not
an immutable release identifier. Use `git rev-parse HEAD` to identify a candidate.

[Governance](../../GOVERNANCE.md#releases) specifies semantic versioning; before
stable API status, a minor release can break author interfaces. `package.json`
records the source package version and `private: true` prevents accidental npm
publication. A version field, tag and release publication are separate facts.
Use `git tag --list` and `git show <tag>` to inspect local release identifiers.

## Dependency and environment pins

`package-lock.json` records the dependency installation resolved by `npm ci`.
`package.json` declares the supported Node range; `.node-version` and `.nvmrc`
select the development Node line. The CI workflow records its own runtime and
Action pins. These files remain authoritative; this page does not duplicate their
values or change package metadata.

`GAME_DIR` or `--game <dir>` selects a consumer. With no local game the blank
template is selected. Build briefs, scene budgets and asset provenance stay with
the selected game. Record that configuration alongside evidence so results from
one template are not presented as acceptance of another.

## Change and release control

Contributions follow [CONTRIBUTING.md](../../CONTRIBUTING.md), with a focused branch,
reviewable changes and checks tied to the candidate revision. Release notes use
[unreleased fragments](../../changes/unreleased/README.md); `npm run changelog`
shows them and `npm run changelog -- --fold` folds them during release preparation.
No folding or release operation is part of this documentation change.

Maintainers tag releases from a clean accepted main branch under the governance
policy. Follow the [release checklist](../guides/release-checklist.md) for source,
license, notices, evidence and publication review. `npm run gate:ci` reproduces the
repository workflow on a suitable runner; partial selections do not establish full
integration acceptance. `npm run deploy:production` is the guarded production path;
a game author can instead build and share the game's static output.

## Evidence baseline

Record source commit, compared base, selected game, commands, results and missing
acceptance evidence together. The [verification matrix](../verification/verification-matrix.md)
covers the selected stock requirements. It does not certify a release, a deployment
or physical devices. Revalidate combined changes after integration changes the base.
