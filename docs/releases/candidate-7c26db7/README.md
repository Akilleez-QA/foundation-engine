# Release candidate `7c26db7`

**Prepared, not released.** This bundle lets the author review and tag a release. Nobody has created a tag,
a GitHub release, a package or a deployment for it. The version **0.3.0** and its date are proposed; the
author decides both.

| | |
|---|---|
| Candidate | [`7c26db7efa5634d1e32b2c18a1a2e63451157f89`](https://github.com/Akilleez-QA/foundation-engine/commit/7c26db7efa5634d1e32b2c18a1a2e63451157f89), the `main` merge of #121; it contains #108 (Node 23+ test reporter, Node 26 in CI) |
| Previous release | [v0.2.0](https://github.com/Akilleez-QA/foundation-engine/releases/tag/v0.2.0), tag `071e3c2` |
| Proposed version | 0.3.0: new optional APIs (`touchButton`, `createTestSaves`, `dmath`, particles, session kit and others) and stricter checks; pre-1.0, so a minor bump. Author decides |
| Not in this candidate | Anything merged to `main` after `7c26db7` (#122, a test-only deflake, merged during preparation); it belongs to the next version unless the author re-cuts the candidate |
| Changelog | [0.3.0, proposed](../../../CHANGELOG.md#030--proposed-author-decides) |

## Contents

- [Release notes](release-notes.md): everything since v0.2.0, grouped for creators, with known limits.
- [Upgrade guide](upgrade.md): how to move a 0.2.0 game, linking the changelog's
  [Upgrading from 0.2.0](../../../CHANGELOG.md#upgrading-from-020) notes.
- [Support matrix](support-matrix.md): eight templates × phone, tablet, laptop and desktop × input, plus
  Node versions, browsers and operating systems. Each cell says CI (headless), emulated, manual or
  unverified. No cell is manual or physical.
- [Reproducible build](build.md): instructions and a clean-checkout rehearsal on the candidate.
- [Asset and licence notices check](notices.md).
- [CI evidence](#ci-evidence) and [author-only steps](#only-the-author-can-do-these) below.

## CI evidence

Main CI on the exact candidate SHA: workflow `ci`, push event, run
[37161502287](https://github.com/Akilleez-QA/foundation-engine/actions/runs/37161502287), attempt 1, head `7c26db7efa5634d1e32b2c18a1a2e63451157f89`. **Every job passed.**

| Job | What it runs | Node | Result | Job ID | Started → completed (UTC, 2026-10-03) |
|---|---|---|---|---|---|
| `browser` | 32 browser regression steps (UI, capture matrix, workbenches, creator journey, first use dev and production, session, replay, dmath, audio offline render, particles, sounds, sub-path build) | 22 | success | 111315780824 | 23:21:44 → 23:28:37 |
| `templates-1` | `gate:templates --shard 1/2 --phone`: complete gate (typecheck, lint, tests, snap, build, software-GL bench) plus phone smoke | 22 | success | 111315780951 | 23:21:45 → 23:33:36 |
| `templates-2` | `gate:templates --shard 2/2 --phone` | 22 | success | 111315780930 | 23:21:45 → 23:34:06 |
| `node-current` | `npm run test`, `npm run check` | 26 | success | 111315780925 | 23:21:45 → 23:23:52 |
| `check` | Required aggregate; every work job must succeed | 22 | success | 111317748715 | 23:34:09 → 23:34:15 |

The two shards together cover all eight templates. Earlier main runs on the way here: run 37161086646 on
`01014c9` (#108's merge) was cancelled when #121 was pushed (the workflow cancels an older run on the same
ref), so its aggregate `check` reported failure without any test failing; it is not evidence either way.
#108's own PR CI passed all jobs before merging. The local [clean-checkout rehearsal](build.md) on the same
SHA is separate evidence.

## Evidence classes in this bundle

- **Runtime-enforced and CI-checked:** typecheck, lints, 2,900+ Node tests, per-template gates with
  software-GL count budgets, the browser regression suite, the phone smoke. All are headless Chromium on Linux.
- **Local rehearsal:** the clean-checkout install, check, lint, test and build in [build](build.md).
- **Not evidence of experience:** none of this establishes physical-device performance, touch feel,
  audible output, LAN between machines, WAN, Windows or macOS, or a human newcomer's experience.

## Only the author can do these

1. **Choose the version and date** (0.3.0 is proposed), bump `package.json` (still 0.2.0), and create the
   tag on the candidate SHA.
2. **Create the GitHub release** from the changelog section or the [release notes](release-notes.md).
   Deploying anything (`npm run deploy:production`) is a separate authorisation.
3. **Upload the social preview** (`assets/brand/social-preview.png`, from #93) in the repository settings,
   and **set the description and topics**. On 2026-10-03 the description was set and the topics list was
   empty.
4. **Choose the `enforce_admins` setting.** On 2026-10-03 `main` required the `check` status (strict) and
   one approving review, with `enforce_admins: false`, which allows the documented sole-maintainer admin
   merge. Keep it or enforce it.
5. **Confirm that the v0.2.0 release was intended.** It was published at 2026-10-03T18:33:33Z by
   `cursor[bot]`, not by the author. Its tag (`071e3c2`) and notes match the changelog, and
   [public compatibility](../../guides/public-compatibility.md#version-and-source-identity) already treats
   it as released; only the author can confirm that it was meant to be published.
6. **Decide which support targets to claim.** The [support matrix](support-matrix.md) records evidence;
   it does not choose targets.

Also outside an agent's reach: a human newcomer trial, physical-device acceptance, LAN with two machines,
and a real fork → PR → fork CI (needs a second GitHub account).
