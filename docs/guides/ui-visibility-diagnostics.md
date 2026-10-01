# Measuring UI visibility

Use `measureUiOcclusion` from `@engine` when checking an authored layout. It is an
optional diagnostic, not a layout engine or an automatic support claim. Run it on
layout changes or in a test, not on every simulation frame.

```ts
import { measureUiOcclusion } from '@engine';

const report = measureUiOcclusion(
  { x: 0, y: 0, width: 390, height: 844 },
  [{ x: 0, y: 0, width: 390, height: 64 }],
  [{ x: 160, y: 300, width: 70, height: 70 }],
);
// report.occupiedRatio: union footprint / viewport area
// report.criticalRegions[0]: independently clipped critical-region measurement
```

Supply current CSS-pixel rectangles from the same coordinate system. For a DOM
consumer, `getBoundingClientRect()` provides viewport coordinates; use actual
usable visual-viewport bounds and insets rather than assuming the layout viewport
is fully visible. Include visual obstruction and transparent input blockers.
Supply separate visual-only and hit-only footprint sets when their acceptance
limits differ. Geometry does not determine z-order, opacity, pointer routing,
contrast, text readability or screen-reader behavior.

Each result contains clipped `area`, `occupiedArea` and `occupiedRatio`. Overlap
between footprints counts once. Critical regions remain in supplied order and
are assessed separately. Empty clipped regions report zeros. Check target
containment or its required visible fraction against its original area separately;
a mostly offscreen target with no covering UI is not a successful interaction.
Use real pointer hit tests to establish that required targets receive input.

The operation rejects nonfinite coordinates, negative dimensions, overflowing
edges/areas, more than 256 footprints, or more than 64 critical regions. Results
are frozen snapshots. These are work limits, not gameplay or layout limits: a
consumer with more elements may provide conservative precombined footprints or
measure smaller task-specific sets, documenting that choice.

Record profile, edition, viewport, task, authored limits, geometry, pointer
behavior and screenshots together. Phone, tablet and computer layouts need only
exist where the author declares support. Browser fixtures do not replace physical
hand-obstruction, sustained performance or accessibility acceptance.

## Reproducible synthetic check

Run `node -r ./scripts/silent-browser.cjs scripts/play/ui-occlusion-check.mjs`.
The isolated, muted browser checks phone, tablet and computer viewport fixtures
at normal and enlarged text size, then resizes each. It records source hashes,
rectangles, pointer hit results, screenshots and limitations under
`/tmp/foundation-ui-evidence` by default. An optional first argument selects a
different output directory. This is a diagnostic test, not an application UI
implementation or device-support certificate.

## Composed HUD regression

The CI HUD diagnostic (`scripts/play/hud-check.mjs`) also measures an authored
64×64 CSS-pixel region around a projected scene point in phone, tablet and
desktop viewports. It measures rendered text and trigger boxes, including when
their parent uses `display: contents` and has no box of its own.

The intentionally overcrowded inline layout must violate this fixture's zero
obstruction criterion; switching back to disclosure must restore a fully in-view,
unobstructed region. Both measurements and the negative-case screenshot are
retained in the report. A passing regression means the diagnostic detected the
bad layout, not that the inline layout passed acceptance. These conservative
rectangles do not measure glyph opacity, contrast, pointer routing or every
application's critical subjects. Creators choose their own regions and limits.
