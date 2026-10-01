# Source release preparation — 2026-10-01

Candidate branch: `chore/open-source-release-prep`, based on integrated `b6fb4a3`.
This is a historical preparation record, not proof of publication or completion
of the framework program. Check the live repository for current visibility.

## Completed preparation

- Private remote mirror created and `git fsck --full` passed. Local refs and the
  separate device worktree's diff/untracked files were backed up privately.
- Older preparation PR reviewed selectively; current security-channel caveats and
  dependency notices retained. Added governance, support, changelog, CODEOWNERS and
  dependency-update configuration. These files do not enable hosted settings.
- Application-specific naming removed from two documents. Template table repaired;
  networking integration evidence reconciled from the existing documentation work.
- Five verification files have explicitly labelled local-path redactions, with
  original/redacted hashes. Their measurements and outcomes are unchanged.
- Fresh worktree dependency install, build, lint and 2,018 tests passed locally.
  This run used the installed host runtime, not a new minimum-Node qualification.
- Tracked-file credential-pattern triage found no matching credential signatures.
  Local-path hits included five saved artifacts and two source-path false positives.
  This is not comprehensive secret, copyright, historical or binary clearance.
- Private one-commit export of `b96bc4b` reproduced tree
  `49e0860601fcefeffa37d08b6e9cba2d28abd01d` exactly, before exercising the blank
  generator from the announcement. The generator passed in that isolated copy.
  No remote was configured there; final export install/build qualification remains.
- [Discord draft](publication-announcement.md) prepared; no message posted.

## Release work still required

- Choose the final source tree after deciding how to include the outstanding device
  branch. It contains unintegrated cleanup and touch-sizing work; lesson layout and
  physical-device acceptance are unresolved. Nothing was silently dropped.
- Review full history and binary evidence; preserve any required hosting records.
  A Git mirror excludes issue/PR conversation, settings and hosted artifacts.
- Run all seven exact-head gates before integration and the final export. Earlier
  `883f4ad` gate results are historical, not results for this preparation branch.
- Validate the final sanitized one-commit export and corresponding-source archive
  in a fresh environment; document budget-baseline handling after history removal.
- Select/authorize the public destination and migration operation. GitHub state observed during preparation: private, Issues enabled, Discussions disabled. The private-vulnerability
  endpoint returned 404, which does not prove its availability. Branch protections
  and public security-reporting access remain unverified.
- Verify anonymous clone/download access after publication, then use the announcement.

At this preparation checkpoint no repository deletion, history replacement, public
visibility change, package publication, deployment or Discord posting had occurred. Follow the
[release procedure](release-checklist.md#source-publication-procedure).
