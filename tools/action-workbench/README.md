# Action workbench

Optional, session-owned desktop diagnostic at `tools/action-workbench/index.html`. This composes existing action timing, target queries, resource changes, authored documents, timed policy modifiers and animation markers around creator-owned policies. It supplies no required combat design, save system, global scheduler or network authority.

Two native scene targets are shown with a compact summary. Open controls to prepare a bounded action, advance its explicit authority clock, resolve or retry its exact identity, cancel it, or deliberately replace/despawn its captured target. The accepted document contains resource values and immutable consequence receipts together. Target size projects accepted resource; it is cosmetic and does not silently alter the adapter's selected eligibility facts. Explicit target revisions, eligibility, position and component identity do invalidate captured authority.

The default controller uses its sweep policy; the optional native policy selector chooses eligible targets with guaranteed hits, or deliberately replaces/revises the target during a callback to demonstrate stale-publication refusal. These are sample creator policies, not engine rules. Up to four live bindings and 32 retained action identities are admitted. Target resources are continuous values from zero to 100, and overflow rejects. Terminal identities remain reserved until session retirement.

Temporary inputs use the existing timed-effect owner: four effects, eight modifier rows. The sample multiplier changes future requested amounts. Replacement retains a new exact handle; cancelling the first handle cannot remove its replacement. Advancing authority expires inputs transactionally before advancing action readiness. No wall clock runs this simulation.

Optional cue tracks have an independent explicit presentation clock and at most 16 marker occurrences per advance. Each accepted action may start one track; the sample cancels the previous visible cue when accepting another. Missing media reports skipped presentation while retaining the accepted receipt. Overloaded catch-up refuses without moving its cursor. Seek skips cues and never accepts a consequence. Cancelling presentation does not undo an accepted result.

Exit scene retires the controller, target bindings and cue tracks. Retained resolution/presentation callbacks lose authority. Starting a fresh session resets accepted resources and receipts. There is deliberately no durable or cross-reload exactly-once guarantee; targets are live ECS identities, not names restored as authority.

Headless queued-delivery regressions compose the real game clock, native ECS target adapter and controller. They check pause/resume with target replacement, aborting queued work on scene retirement, retained stale callbacks, and fresh sessions reusing authored names without reviving old authority. Run `node --import tsx --test tools/action-workbench/queued-delivery.test.mjs`. The test host explicitly advances authority and aborts its schedule scope; this adds no production scheduler or automatic lifecycle wiring. These tests do not establish projectile materialization, resource-cost policy, persistence or browser acceptance.

Run `node scripts/play/action-workbench-check.mjs`. Evidence goes to `playtest/action-workbench`. The runner uses native controls and independently enumerates actual ECS Shape/Transform/TargetState components, exact accepted receipt counts and expected numeric resource deltas. It checks actual render resumption after visible mutations, accepted retry after target removal, stale/reentrant target changes, cancellation/expiry, replacement effect handles, skipped/overloaded/seek presentation and scene retirement.

Selected profile: desktop keyboard/pointer at 1440×960. Automated Chromium evidence is not physical-device, phone/tablet, gamepad, thermal or multiplayer certification. The disclosed reading sheet pauses rendering; close resumes the actual scene. These example choices do not constrain other creator builds.

Acceptance status: integrated in PR #117 at `2aabe49`. The earlier
committed browser at `4aa2a29` failed reopening controls after retirement. Repair
`084124a` disables the opener until scene activation completes and makes the runner
wait for that same boundary. Final committed-head browser and all seven template
gates passed at `c245896`. Controller/adapters at `afb6dca` and
`2232acb` passed 23 focused regressions. Keep these evidence scopes separate.

See the [contract guide](../../docs/guides/action-workbench.md) and
[continuing acceptance ledger](../../docs/guides/upgrade-acceptance-ledger.md) for
subsequent verification and integration status.

### Integration checkpoint — PR #117

Integrated at `2aabe49` after candidate `c245896` passed its final native desktop
browser and all seven template gates: 1,830 tests, 129 performance checks, no
enforced breaches/regressions/inconclusive checks, and four advisory software-GL
heap warnings. Combined main tests and build passed. Earlier failed browser
observations above remain historical evidence; the scene activation repair is
included. This does not certify physical devices, durable action saves or networking.
