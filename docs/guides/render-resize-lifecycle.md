# Author scene resize lifecycle

The author runtime uses the same visit-owned resize callback for CSS box changes
(`ResizeObserver`) and its document window's `resize` event. This matters when a
live graphics quality change updates the renderer's pixel ratio: Three.js resizes
and clears the drawing buffer, while the CSS box can remain unchanged. The existing
quality owner emits a coalesced window resize event; the author scene must resize,
update its projection and invalidate one on-demand redraw in response.

Both paths refuse work when the visit signal is aborted or the activity is leaving,
before touching the renderer lease. Cleanup removes the window listener and
disconnects the observer. A queued observer callback still checks the same lifetime
guard. No new clock, scene restart, quality budget or continuous render policy is
introduced. Repeated events use existing loop invalidation/coalescing.

Four focused Node regressions execute the actual runtime resize block with a native
EventTarget, Three.js camera and the existing quality pixel-ratio bridge. The
browser diagnostic uses a static stock scene and measures successful native render
calls, unchanged CSS dimensions, world data and scene epoch, then return to idle.
It is part of `npm run test:framework-browser`; run it alone after generation with
`node -r ./scripts/silent-browser.cjs scripts/play/dpr-redraw-check.mjs`.

See [the focused receipt](../verification/dpr-redraw-20261003.md) for source, commands
and observed evidence. Software-browser evidence does not certify GPU completion,
physical display transitions or physical-device quality.
