# Stock touch controls: exploratory evidence

2026-10-01, candidate branch `feat/device-acceptance`, based on integrated
`b6fb4a3`. Both saved reports identify HEAD
`81e84babbb1bf10ac990beddef93244cd8e3635d` and **workingTreeDirty: true**.
They are exploratory working-copy observations, not exact-head acceptance or an
integrated release. [Source hashes](source-hashes.json) identify the relevant files
retained after the retry; they are not the source identity of the initial failure.

## What ran

The candidate [runner](../../../scripts/play/stock-touch-check.mjs) opens isolated,
muted Chromium sessions with touch emulation. Four routes run at 320×568,
390×844, 844×390 and 820×1180 CSS pixels: Mechanics lab Ride, Expedition field
Begin, Expedition shelter return and Learn day-night Pause. Assertions check visible
primary buttons for 48×48 minimum size, 16px primary text, viewport containment,
center hit testing and the named tap's visible outcome. Disabled navigation buttons
are measured but not activated. This is not a full lesson or template playthrough.

Run manually from the repository root:

```sh
node -r ./scripts/silent-browser.cjs scripts/play/stock-touch-check.mjs playtest/stock-touch
```

The runner regenerates template inputs serially and retains reports/screenshots.
It is not currently part of `test:ui-browser`, CI or the seven-template gate.

## Outcomes and contradiction

The [initial report](initial-report.json) failed on the compact shelter's computed
button font after eight preceding cases passed. Inheriting the panel's 16px font
repaired that measured failure. The [retry report](target-retry-report.json) passed
all 16 target/tap cases. Selected screenshots were then inspected:

- [Compact lesson](learn-day-night-compact.png): the 48px controls wrap across three
  rows and cover part of the board/caption region. The runner pauses early, so the
  blank board is not evidence that actual lesson content is readable.
- [Landscape field](expedition-field-phone-landscape.png): the wrapped panel fits
  the viewport. No projected player/current-target obstruction criterion was measured.

**DV-01 remains unresolved.** Target sizing and successful taps do not establish
usable content layout. The lesson board uses a fixed 76px bottom inset while the
compact control bar occupies substantially more vertical space. Source inspection
also finds that the lesson runtime does not call its controls' cleanup method;
adding a layout observer requires explicit scene-lifetime cleanup first. These
are open follow-ups, not completed repairs.

Next acceptance must include actual lesson content, caption/answer reachability,
control/content separation, orientation and text scaling, and cleanup on scene exit.
Other template workflows, essential world regions, localization, assistive input,
physical touch/controllers and sustained minimum-device performance remain
unverified. No advertised device target, budget or quality floor was removed.

Original screenshot paths inside the reports identify temporary local evidence.
The selected images above are durable copies; reports remain unchanged. Neither
report claims the later documentation commit or future layout fixes were tested.

## Cleanup prerequisite — subsequent working copy

A later manual run at dirty `108b29c` passed the same 16 target/tap cases plus
standalone lifecycle assertions in the four Learn browser contexts. Real retained
button and range elements delivered exactly one callback before destruction and
none afterward, including attempted re-registration. Repeated destruction left no
owned nodes, and retired setters did not revive them. That report is retained as
[lifecycle-report.json](lifecycle-report.json); it does not supersede the earlier
layout failure or identify an exact checked commit. Focused scene-lifetime tests
separately exercise lazy exit, queued commands, reentry and slider replacement.

The current candidate wires visit cleanup and exposes standalone slider/quiz
`destroy()`. Responsive content composition remains pending. No layout observer has
been added, and no physical-device or complete lesson usability claim is made.
