# Release candidate `ffa8c6a`

**Prepared, not released.** This bundle lets the author review and tag a release. Nobody has created a tag,
a GitHub release, a package or a deployment for it. The version **0.3.0** and its date are proposed; the
author decides both.

| | |
|---|---|
| Candidate | [`ffa8c6afb8858db1b85ac9906f5f86662ba7f872`](https://github.com/Akilleez-QA/foundation-engine/commit/ffa8c6afb8858db1b85ac9906f5f86662ba7f872), the `main` merge of #174 |
| Replaces | Candidate [`7c26db7`](../candidate-7c26db7/README.md) (#123), which stopped at #121 and is stale: 53 PRs merged after it |
| Previous release | [v0.2.0](https://github.com/Akilleez-QA/foundation-engine/releases/tag/v0.2.0), tag `071e3c2` |
| Proposed version | 0.3.0: new optional APIs (lights, shadows, sky, materials, scatter, post, `@kits/three`, KTX2, asset contracts, pose-to-pose, flipbooks), stricter checks and a new phone start tier; pre-1.0, so a minor bump. Author decides |
| Certified main | `main`'s CI completed green on the candidate SHA ([below](#ci-evidence)); every merge from #170 to the candidate completed green on its own merge commit |
| Changelog | [0.3.0, proposed](../../../CHANGELOG.md#030--proposed-author-decides) |

## Contents

- [Release notes](release-notes.md): everything since v0.2.0, grouped for creators, with known limits.
- [Upgrade guide](upgrade.md): how to move a 0.2.0 game (or a game on `7c26db7`), linking the changelog's
  [Upgrading from 0.2.0](../../../CHANGELOG.md#upgrading-from-020) notes.
- [Support matrix](support-matrix.md): nine templates × phone, tablet, laptop and desktop × input, plus Node
  22 and 26, browsers and operating systems. Each cell says CI (headless), emulated, manual or unverified. No
  cell is manual or physical.
- [Reproducible build](build.md): instructions and a clean-checkout verification on the candidate, including
  `npm run gate` for blank.
- [Asset and licence notices check](notices.md).
- [CI evidence](#ci-evidence), [simulated trials](#simulated-trials) and
  [author-only steps](#only-the-author-can-do-these) below.

## CI evidence

@CI_TABLE@

## Simulated trials

@TRIALS@

## Evidence classes in this bundle

- **Runtime-enforced and CI-checked:** typecheck, lints (including budgets, docs claims, provenance), the Node
  test suite on Node 22 and 26, per-template gates with software-GL count budgets and browser playtests, the
  browser regression suite, the phone smoke at the phone tier. All are headless Chromium on Linux.
- **Local verification:** the clean-checkout install, check, lint, test, build and blank gate in
  [build](build.md); emulated phone and Calm views; the bench re-measurement of every template's shadow rows
  (#174).
- **Simulated trials:** agent trials, labelled as such; not human evidence.
- **Author judgement:** the author judged three simulated agent-built games (forest, neon arena, island, on
  software GL screenshots) "good enough" for the look goal. That is the authoritative look sensor for this
  candidate; it is not device evidence.
- **Not evidence of experience:** none of this establishes physical-device performance, touch feel, audible
  output, LAN between machines, WAN, Windows or macOS, or a human newcomer's experience.

## Only the author can do these

1. **Choose the version and date** (0.3.0 is proposed), bump `package.json` (still 0.2.0), and create the
   tag on the candidate SHA.
2. **Create the GitHub release** from the changelog section or the [release notes](release-notes.md).
   Deploying anything (`npm run deploy:production`) is a separate authorisation.
3. **Choose the merge settings.** Merges are serialized by a self-enforced rule (GOVERNANCE.md). GitHub's
   merge queue and `enforce_admins` would enforce it in the repository; both are repository settings.
4. **Upload the social preview** (`assets/brand/social-preview.png`) and **set the description and topics**.
5. **Confirm that the v0.2.0 release was intended.** It was published at 2026-10-03T18:33:33Z by
   `cursor[bot]`, not by the author.
6. **Physical devices:** run the templates on real phones, tablets, laptops and desktops, and decide which
   support targets to claim.
7. **A human newcomer trial:** the onboarding evidence here is a simulated agent trial.
8. **LAN between two machines** for the shared-world template (CI covers loopback only).
9. **Session host-liveness:** decide whether the session client should detect a silent host loss itself
   (a protocol change, next milestone), or keep relying on the host's idle timeout.
