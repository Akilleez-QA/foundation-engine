# Window resize contact retirement

Base: Foundation `3a97ca6d716addcd7975adfdfdb5cbe484a96a6e` (fetched main).
The creator requests consistent held-contact cancellation when viewport geometry
changes, following a separately observed application defect. Application evidence
is not used as proof of Foundation behavior.

## Reproduction and bounded fix

Actual adapters `bindPointerControl`, `attachPointer`, and `bindScenePointer`
retain, respectively, a registered held action, a two-contact pinch and scene
down/pressed after window resize. [Before](before.txt): 23 pass, 3 fail at
neutral-state assertions. [After](after.txt): all 26 pass. The test fixture gives
the fake document a real EventTarget defaultView; no browser is involved.

One resize listener per existing owner invokes the same reset/cancel used on
blur/pagehide. No additional loop, owner, queue, timer, bounds or action mapping.
Capture releases; stale moves/up cannot restore a gesture; fresh down succeeds.
Regression coverage retains blur/pagehide/cancel and owner teardown. Previously
emitted actions are not undone; no visualViewport-only or hardware claim.

## Validation boundary

Focused command: `tsx --test src/platform/input/pointer.test.ts
src/platform/input/pointer-control.test.ts src/author/scene-pointer.test.ts`.
[Affected check](check.txt) passed all 53 selected test files, typechecking and
configured lint; [architecture](architecture.txt) also exited zero on the tracked
graph. Exact committed-head gate and browser snapshot results follow. No thresholds or
baselines changed, no deployment or main integration performed.

## Final candidate acceptance

Exact tested HEAD: `8b1aa34fde1add2894687da513048ef5653ebb7a`. Runtime change
commit `954c9db`; subsequent commits reconcile the upstream network checkpoint
and correct the template changelog row. Fresh fetch/rebase before gates
remained on upstream `3a97ca6d`.

Commands, sequential and exclusive after the application browser released graphics:

- `env -u GAME_DIR npm run gate`: default `templates/blank/game`, PASS 38 s.
- `npm run gate:templates -- arcade expedition explorer learn mechanics terrain`:
  PASS, inner gate durations 31/49/49/31/32/36 s respectively.
- `env -u GAME_DIR npm run play:snap -- --mobile`: PASS, desktop and mobile.

[Default gate](gate-blank.txt) and [six remaining gates](gate-six.txt) retain all
1,922 passing tests per template, type/lint/build/bundle checks, and 129 software
performance checks total. Zero enforced breaches, regressions or inconclusive
results; four advisory software-GL heap warnings (two Mechanics, two Terrain).
These are fresh SwiftShader measurements, not reference hardware timing claims.
All seven templates ran exactly once. Budgets/baselines/accounting were unchanged.

[Snapshot output](mobile.txt), [probe](probe.json), [desktop](main-desktop.png)
and [390×844 mobile](main-mobile.png) were personally inspected: visible cube and
floor, contained Settings control, no clipping or page errors. This ordinary
blank-template smoke does not exercise a native held-contact resize or prove
physical-device acceptance. That behavior is established here by the actual
adapter Node regressions. Browsers were closed and graphics released afterward.

This documentation-only receipt follows the tested commit; no executable source
changed after the gates. Main integration/deployment has not been performed by
this lane.

## Documentation gate correction

The subsequent final-head gate on `b9e68f7` failed the documentation genericity
check: a verb in this receipt matched a forbidden engine-vocabulary token.
[Raw failed gate](gate-b9e68-failed.txt) is retained unchanged. It reported
1,921/1,922 tests, the matching lint failure, successful snapshot and bundle, and
11 passing reused count checks. This was not a runtime or budget failure.
The wording is corrected in this candidate; its exact committed-head gate must
pass before integration. Runtime and budget files are unchanged.

## Publication copies

The text logs and probe report listed in [redaction-manifest.json](redaction-manifest.json)
replace the local home-directory prefix with `/REDACTED_HOME`. These are explicitly
redacted copies, not byte-identical original output. Measurements and outcomes are
unchanged. The manifest retains original and redacted SHA-256 identities; originals
remain in the private pre-release mirror. This is not an audit of all historical
commits or binary screenshots.
