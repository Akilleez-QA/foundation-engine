# Engine upgrade milestone 1

Validated source commit: `1b6c9e4` (2026-09-30). This records a delivery milestone, not completion of the overall engine-upgrade request.

`npm run gate:templates` passed for all seven templates on that clean commit: arcade (26s), blank (26s), expedition (30s), explorer (44s), learn (26s), mechanics (26s), terrain (29s). Each gate passed the full 973-test suite, type/layer/architecture/brief checks, production bundle check, browser snapshot, and reference performance checks. No budget ceiling or test was weakened.

Browser measurements used isolated muted Chromium with SwiftShader. They establish deterministic resource counts and the stated reference checks, not physical iPad/GPU performance. Additional desktop/phone action and reload evidence is in this folder's `resources/` directory, `../../mechanics/verification/`, and `../../terrain/verification/`.

Playable coverage includes canonical terrain and revisions; a route/arrival/reward/save flow; resource survey/harvest/craft/checkpoint; riding/control handoff; gear/capabilities; pose/marker/socket presentation; local market delivery; spatial cue ownership; and authorized placement/occupied teardown refusal.

The [upgrade status](../UPGRADE-STATUS.md) records remaining engine mechanisms separately from game content. No game application or Vercel deployment was made by this engine milestone.
