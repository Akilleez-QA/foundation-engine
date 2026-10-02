# kits/ui

A heads-up display over a scene: `hud(ctx).line(id, text)`, `hud(ctx).banner(text)` (announced politely) and `hud(ctx).prompt(text)`. Text should come from string keys (`ctx.text`). No draws; the DOM updates when text, importance or presentation changes. Tests read it with `hud(ctx).read()`.

Readability: each inline line and the prompt sit on a translucent dark plate (`rgb(10 16 22 / 62%)`, rounded), so text
stays readable over a light sky or a bright floor on any background; the banner keeps its text shadow. The banner and
the prompt start `hidden` and are shown only while they have text, so no empty plate appears. Lines in the disclosed
detail sheet use the sheet's own background, without plates. A game that wants a different look styles `.hud-lines
[data-hud]`, `.hud-prompt` and `.hud-banner` itself. Evidence for the plates is emulated (SwiftShader, 1280×800 and
390×844); physical-device contrast is unverified.

## Creator-selected viewport layouts

Layout following is optional. Existing HUDs stay inline until `present(...)` or
`layout(...)` is called. A creator may choose separate layouts for different
viewport sizes, the same layout everywhere, separate editions, or another UI
framework. No device classification or graphics-quality change is involved.

```ts
const display = hud(ctx);
display.layout({
  select: ({ width, height }) => width < 700 || height < 450
    ? { mode: 'disclose', label: ctx.text('game.details'), closeLabel: ctx.text('game.close') }
    : { mode: 'inline' },
});
```

These example thresholds are application choices, not engine defaults or device
support rules. Dimensions are the **scene viewport's CSS pixels**, independent of
canvas backing resolution and device pixel ratio. They are not the full screen,
safe-area-adjusted content bounds, or an occlusion measurement. Creators still
choose which lines are essential; layout selection never hides essential lines.

`layout({ select })` replaces any previous selector and evaluates immediately,
then on changed viewport dimensions through the scene's existing resize owner.
Return the existing `HudPresentation` union. Resolve labels through the game's
catalog. Selectors should be cheap and have no side effects. A selector that
throws or returns malformed presentation leaves the previous valid presentation
in place; the scene logs the error and may retry at the next changed size. A
selector calling `present(...)` or replacing its own layout cannot have that
explicit choice overwritten by its returned value.

`layout(null)` unsubscribes and retains the current presentation. `present(...)`
also unsubscribes, including when the supplied presentation equals the current
one. Scene exit removes all viewport subscriptions. Headless contexts without
`view.observeSize` keep their current presentation; no guessed phone or desktop
size is supplied. `read()` retains its existing state-only shape.

Same-presentation resize does not reopen a reading sheet or steal focus. Moving
to inline closes an open sheet through its existing layer owner and restores
scene focus when the trigger becomes hidden. Resizing into disclosure does not
automatically open a sheet. The existing reading-sheet owner handles input
cancellation and pause/resume; the layout selector adds no input handler or clock.

### Evidence scope

Focused HUD and viewport tests cover selection, manual override, failures,
reentrant selection, sheet retention/closure and subscription disposal. The real
engine diagnostic `scripts/play/fixtures/hud-entry.mjs?layout=profiles` uses an
explicit sample width threshold of 700 CSS pixels. Browser acceptance should
resize across that boundary with a sheet open and held input, verify focus and
scene resumption, then leave/reenter the scene. These are integration checks,
not physical phone/tablet/controller or general UI acceptance. Each creator
chooses the affected target profiles and the evidence needed for their game.

The inline screenshots intentionally contain overflowing stress-test text that
obscures the game world. They demonstrate that inline selection remains available,
not a recommended or accepted desktop layout. Passing lifecycle assertions does
not certify gameplay visibility, readability or playability for an application.
