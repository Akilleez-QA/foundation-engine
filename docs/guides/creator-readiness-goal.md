# Creator readiness milestone

Tracking: [issue #66](https://github.com/Akilleez-QA/foundation-engine/issues/66).
Status: **active goal; acceptance open**. This document defines the outcome and work
sequence. Status update 2026-10-03: the evidence cards B1 to B6 are merged (#95, #97,
#98, #104, #116, #96) and the status records are reconciled; the current scorecard is in
the [acceptance ledger](upgrade-acceptance-ledger.md#creator-readiness-milestone-2026-10-03).
No release candidate is named yet, so the release row is not met. It does not declare pending implementations, branches or releases accepted.
The [creator contract](../CREATOR-CONTRACT.md), [standard](../STANDARD.md),
[contribution workflow](../../CONTRIBUTING.md) and [governance](../../GOVERNANCE.md)
continue to apply.

## Goal and boundary

Make Foundation a dependable, approachable and extensible browser-game foundation.
An independent creator should be able to discover, run, customize, verify, share
and upgrade a game using public instructions. A contributor should be able to
reproduce a problem, change a bounded contract and submit evidence without private
context or a paid coding account.

Complete a finite creator-readiness milestone on one named release candidate.
Preserve creator choices about design, devices, quality and optional frameworks.
A general editor, additional platforms and every possible gameplay capability are
not prerequisites. Existing experiments earn inclusion through a demonstrated
consumer; they do not automatically become release blockers.

## Acceptance scorecard

Record revision, environment, evaluator, command or procedure, result and limitations
for each row. Link evidence from issue #66; use the existing capability and acceptance
records for implementation details rather than creating another capability inventory.

| Outcome | Completion evidence |
| --- | --- |
| Discover and start | Clear routes to making a game and contributing; public prerequisites and runnable example; two fresh setup trials, including the owner-selected fresh-context agent acting as a first-time creator. Record this as a simulated newcomer trial. Target first playable result within 15 minutes on a declared reference setup, with prerequisite downloads timed separately. |
| Change and share | Make a meaningful edit, run the relevant checks, build and serve the output from a subpath using documented steps without engine edits. |
| Reliable local session | A representative consumer composes start, play, settings, focus interruption, scene replacement, save, reload and retirement. Refused/interrupted operations and retry have explicit consumer evidence; separate unit coverage remains labeled separately. |
| Optional shared session | Within its declared local scope: admission, baseline, disconnect/reconnect, fresh-state recovery and terminal refusal. No broader network claim without corresponding evidence. |
| Reproducible assets | One original or licensed source asset has a documented export/import path, provenance, scale/pivot, material bounds and verified in-consumer appearance. |
| Measured performance | Existing budgets pass. Record raw context-cold and repeated-use observations; distinguish resource fetch, decode, preparation and rendered interaction where observable. Unavailable stages stay unmeasured. Repeated visits and cancellation retain bounded resources after settlement. |
| Compatibility | Public API/save changes include migration guidance and retained regression cases. Prior supported data loads, migrates or fails with a documented recovery route. |
| Contributor access | A clean fork can follow public setup/check instructions and rehearse a focused change without private files, credentials or a commercial agent. |
| Release candidate | Required checks run on the named candidate; changelog, support limits, notices and reproducible build instructions agree. Release preparation and publication remain distinct. |

These are acceptance targets, not measured results. Record any target revision and
its rationale explicitly. The owner selected an agent persona for this milestone’s newcomer exercise.
That trial can satisfy the stated exercise, but cannot certify human experience or
physical devices. Keep those evidence limits explicit.

## Sequence and parallel work

| Phase | Deliverable | Dependency and ownership |
| --- | --- | --- |
| Establish baseline | Named public revision, classified pending changes and exact test selection | Audits can run independently; one maintainer owns integration. |
| Make entry paths coherent | Setup, first edit/share and contribution rehearsals | Documentation and test-tool improvements can separate after command contracts agree. |
| Prove complete journeys | Consumer success, interruption, refusal and recovery evidence | Independent consumers can proceed in parallel; one owner per shared API or save schema. |
| Measure and refine | First-use baseline, bounded retention and one reproducible asset path | Asset and diagnostic work can separate; shared renderer/scheduler edits are serialized. |
| Prepare release | Candidate scorecard, compatibility notes and complete checks | Evidence assembly can parallelize; final validation and release have single owners. |

Start with a coordinator, at most two implementation lanes and an independent
review lane when capacity permits. Worktrees isolate changes, not machine resources.
Allocate one local browser-test slot initially; serialize heavyweight checks or use
the designated CI runner. Increase concurrency only when resource measurements and
review throughput support it. An additional agent is not independent runtime proof.

## Pick up a task

Claim a bounded task in the tracking issue before overlapping work begins. Use this
card in its issue or pull request:

- Creator outcome and observable problem; baseline revision.
- Existing extension seam, owner, allowed scope and explicit exclusions.
- Dependencies and any shared API/schema agreement.
- Acceptance examples plus relevant cancellation, stale result, refusal and recovery cases.
- Commands, selected tests, resource needs and evidence location.
- Compatibility risks, completion condition and unresolved manual checks.

Run the loop: reproduce → agree acceptance → implement the smallest coherent change
→ run focused checks → exercise the consumer → review → integrate serially → verify
the combined revision → update evidence. Follow CONTRIBUTING for required checks;
a clean working tree or configured CI step is not a test result. After repeated
attempts without an improved outcome, inspect the hypothesis before another edit.

Prioritize data loss, crashes and blocked creator journeys, then observed costs and
usability defects. Keep pull requests focused and usable without the conversation.
Do not weaken an existing requirement silently to produce a pass.

## Evidence and status vocabulary

| State | Meaning |
| --- | --- |
| Planned | Outcome and acceptance are agreed; implementation is not established. |
| Implemented | Code exists at a named revision; verification can still be missing. |
| Verified | Named checks passed for their recorded revision, workload and environment only. |
| Merged | The change landed on the public integration branch; earlier evidence does not automatically certify later combinations. |
| Released | A maintainer published a version and artifacts identifying the accepted revision. |

Maintain current claims in the [composition map](composition-framework-status.md),
[framework record](framework-upgrade-status.md) and
[acceptance ledger](upgrade-acceptance-ledger.md) where relevant. Preserve historical
receipts with their original scope. Report failures, skipped checks and manual gaps.

Measure completed creator journeys, observed defects, first-use costs, retained
resources, check reliability and review backlog. Commit counts and agent activity
are not completion criteria. End this milestone when its scorecard passes; open a
new bounded milestone instead of absorbing every new feature into this one.
