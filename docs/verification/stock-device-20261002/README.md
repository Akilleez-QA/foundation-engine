# Lesson layout repair: emulated evidence

2026-10-02, branch `feat/device-acceptance` on the public repository, on
`origin/main` `f7619ef`. The saved [report](layout-report.json) identifies the clean
commit `b593583cb694d397b4d50fe4d6b1bf0ef1033c35` (after the PR #9 review fixes) with
**workingTreeDirty: false** and **passed: true**; the screenshots below come from that
run. An earlier clean run at `95f8929` (before the review fixes) also passed; this
report replaces it. This is Chromium
touch emulation, not physical-device acceptance. DV-01 remains unresolved.

## The defect

The [2026-10-01 receipt](../stock-device-20261001/README.md) showed that at
320×568 the learn kit's control bar wraps to three rows while the chalkboard kept a
fixed 76px bottom inset, so Back / Show again sat inside the stage and the bar
covered the board caption ([before](../stock-device-20261001/learn-day-night-compact.png)).
An exploratory pass through the whole lesson (board, sim, quiz) at five profiles found
the same class of collision elsewhere:

| Profile (CSS px) | Before the repair |
|---|---|
| 320×568 | Bar (3 rows) covers the board's lower 96px including the caption; quiz panel covers the caption line by 22px; caption line runs into the progress pill |
| 390×844 | Bar (2 rows) covers the board caption by 40px; caption line runs into the progress pill |
| 844×390 | Caption line runs into the progress pill and is drawn over the quiz's "Question 1 of 3" and prompt |
| 820×1180 | Caption line (centred, 640px) starts at x=75 under the progress pill |
| 1280×800 | No collision |

## The repair (learn kit layout seam)

The learn controls own one `ResizeObserver` over the bar, the progress line, the
overlay and lesson content registered through `controls.arrange(...)`. They publish
`--learn-controls-reserve` and, only on collision, `--learn-top-clear` /
`--learn-top-side` on the overlay. The board, its caption and the slider sit above
the bar through `aboveControls(min)`; the caption line drops below the progress pill
only if the two would touch; the objectives/finished cards and the quiz keep their
authored centre unless they would cover the top content, reach the bar or (cards
only) cover the board caption, in which case they start below the top content and
scroll in the space left. A fitted panel takes `pointer-events: auto` (the scene
overlay is `pointer-events: none`) and, if it has none, `tabindex="0"`, so wheel,
touch and keyboard can scroll it; both are restored when it no longer needs fitting.
The observer only marks the layout dirty; `controls.layout()`, called once per frame
by the lesson runtime, measures and writes, so no size is written during observer
delivery. Every inset keeps its authored value where there is space.
See [learn mode: layout on narrow screens](../../guides/learn-mode.md#layout-on-narrow-screens).

Desktop (1280×800): in the exploratory pass, the bar, board, board caption, slider,
quiz and caption line rectangles at every lesson state matched the measurements
taken with the original caption, card and quiz code, and the board and slider
insets resolve to their original 76px / 84px. The opening board also matched the
fully unrepaired build. The exploratory script itself was exploratory and is not saved.

## What ran

```sh
node -r ./scripts/silent-browser.cjs scripts/play/stock-touch-check.mjs playtest/stock-touch
```

The runner's 16 cases (Mechanics lab, Expedition field and shelter, Learn day-night
at 320×568, 390×844, 844×390 and 820×1180) still assert 48×48 targets, 16px text,
viewport containment and center hit testing. For Learn it now also asserts that no
visible bar rectangle intersects the board, slider or quiz, and that the caption
line does not intersect the quiz, first at the paused opening board and then on
every state of a held-clock traversal that taps Next and fills the slider until the quiz
appears. Each profile reached the board, slider and quiz. Every fitted panel that
overflows must be hit-testable at its centre, focusable and actually scrolled by a
wheel event; a six-objective card is also checked in a `pointer-events: none` host.
Results in this report: the fitted quiz scrolled by 7px at 320×568 and 85px at
844×390; the six-objective card scrolled by 82px and 96px there and did not need
fitting at 390×844 or 820×1180. The runner also records window `error` events
(not reported as page errors) and fails on them; none were recorded.

Negative checks (same runner, learn kit sources altered, not saved):
- learn kit sources reverted to before the repair:
  `learn/day-night/compact: .scene-overlay nav overlaps .chalkboard`;
- the first repair, before the review fixes: `compact: fitted panel covered at its
  centre`;
- that first repair with measurement inside the observer callback:
  `ResizeObserver loop completed with undelivered notifications.`;
- the final code without `pointer-events: auto` on fitted panels: the wheel did not
  scroll the long card (timeout). With the final frame-time layout, measuring inside
  the observer callback no longer reproduces the loop error, because a newly shown
  panel is fitted before the observer runs; the deferral remains as a guard.

## Inspected screenshots

- [Compact opening board](learn-day-night-compact.png): the paused board and its
  (empty, early) caption end above Back / Show again; the bar's three rows are clear.
- [Phone portrait opening board](learn-day-night-phone-portrait.png): two-row bar
  below the board and caption.
- [Compact quiz](learn-day-night-compact-quiz.png): progress pill, caption line,
  quiz (all three answers visible) and the bar are separate.
- [Phone landscape quiz](learn-day-night-phone-landscape-quiz.png): the quiz starts
  below the caption line and scrolls above the bar; only the first answer and part
  of the second are visible without scrolling.

## Still open

- Scrolling a fitted panel was checked with emulated wheel events only; touch-drag
  scrolling was not exercised. In phone landscape the second and third answers need
  it (keys 1-3 still answer).
- The compact board shrinks to about 240px tall to make space; the objectives card
  still covers the board drawing at the opening step (by design, as on desktop).
- The objectives/quiz cards use content-box widths and reach within 2px of the
  edges on phones; the sim's 3D framing is unchanged, and at 320×568 the slider
  covers the lower part of the Earth.
- 200% text, browser zoom, localisation, gamepad, assistive technology, the full
  touch lesson and every other template workflow remain unverified.
- No physical phone, tablet or laptop was used. Minimum phone, tablet and
  laptop/desktop profiles are still pending creator selection. **DV-01 remains
  unresolved.**
