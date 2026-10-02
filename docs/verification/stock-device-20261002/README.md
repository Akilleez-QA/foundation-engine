# Lesson layout repair: emulated evidence

2026-10-02, branch `feat/device-acceptance` on the public repository, rebased onto
`origin/main` `1b0b846`. The saved [report](layout-report.json) identifies the
clean commit `cc6c521b9862c153945d9e1dd86186c09e01e889` (before the rebase; the
rebase changed only documentation inherited from `main`) with
**workingTreeDirty: false** and **passed: true**. This is Chromium touch emulation,
not physical-device acceptance. DV-01 remains unresolved.

## The defect

The [2026-10-01 receipt](../stock-device-20261001/README.md) showed that at
320×568 the learn kit's control bar wraps to three rows while the chalkboard kept a
fixed 76px bottom inset, so Back / Show again sat inside the stage and the bar
covered the board caption ([before](../stock-device-20261001/learn-day-night-compact.png)).
An exploratory walk of the whole lesson (board, sim, quiz) at five profiles found
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
scroll in the space left. Every inset keeps its authored value where there is room.
See [learn mode: layout on narrow screens](../../guides/learn-mode.md#layout-on-narrow-screens).

Desktop (1280×800): in the exploratory walk, the bar, board, board caption, slider,
quiz and caption line rectangles at every lesson state matched the measurements
taken with the original caption, card and quiz code, and the board and slider
insets resolve to their original 76px / 84px. The opening board also matched the
fully unrepaired build. The walk script itself was exploratory and is not saved.

## What ran

```sh
node -r ./scripts/silent-browser.cjs scripts/play/stock-touch-check.mjs playtest/stock-touch
```

The runner's 16 cases (Mechanics lab, Expedition field and shelter, Learn day-night
at 320×568, 390×844, 844×390 and 820×1180) still assert 48×48 targets, 16px text,
viewport containment and center hit testing. For Learn it now also asserts that no
visible bar rectangle intersects the board, slider or quiz, and that the caption
line does not intersect the quiz, first at the paused opening board and then on
every state of a held-clock walk that taps Next and fills the slider until the quiz
appears. Each profile reached the board, slider and quiz. The same runner with the
learn kit sources reverted fails at the first case:
`learn/day-night/compact: .scene-overlay nav overlaps .chalkboard`.

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

- Touch scrolling inside the fitted quiz was not exercised; in phone landscape the
  second and third answers need it (keys 1-3 still answer).
- The compact board shrinks to about 240px tall to make room; the objectives card
  still covers the board drawing at the opening step (by design, as on desktop).
- The objectives/quiz cards use content-box widths and reach within 2px of the
  edges on phones; the sim's 3D framing is unchanged, and at 320×568 the slider
  covers the lower part of the Earth.
- 200% text, browser zoom, localisation, gamepad, assistive technology, the full
  touch lesson and every other template workflow remain unverified.
- No physical phone, tablet or laptop was used. Minimum phone, tablet and
  laptop/desktop profiles are still pending creator selection. **DV-01 remains
  unresolved.**
