# ADR 0070: independent graphics selection and bounded UI diagnostics

- **Status:** Accepted
- **Date:** 2026-09-30
- **Area:** Quality, UI and diagnostics
- **Amends:** ADR 0029's historical first-run touch selection; implements part of ADR 0068.

## Decision

Input capability does not select a graphics preset. When neither a verification pin,
saved choice nor authored startup preset is supplied, the first-run detector applies
its existing hardware rule to every input configuration: recognized reference
hardware starts at Reference; other hardware starts at High. Resource constraints
continue to produce a lighter suggestion rather than silently lowering quality.
The pointer signal remains in the probe contract for compatibility. Existing saved
choices, including previously detected Medium, are never reset or migrated.
Preset values, budgets, governor behavior and application support scope do not change.
The platform quality module now registers the existing device save section and
installs the service before any dependent scene can allocate a renderer. Startup
precedence is verification pin, saved choice, then the authored `brief.quality.tier`.
The authored default remains unsaved until an explicit change; it is not reported
as hardware detection or a player choice. Direct factory callers that omit an
authored preset retain hardware detection. A failed quality installation prevents
dependent scene activation. Retiring one binding cannot clear a newer binding,
even if both bind the same service object. Query pins never read or write the
graphics save section. The `quality` probe reports preset, source and governor state.

This does not install a new settings screen or feed the optional governor from the
frame loop. The module exposes the existing quality service; presentation and
rendered-frame sampling remain separately owned tasks.

This deliberately replaces the historical touch-to-Medium branch, including its
pixel-ratio cap. It can increase first-run rendering cost on touch devices. It is
not a performance certification: authors must measure their selected builds on
supported hardware and players retain their quality choice. Pinned reference gate
evidence cannot establish sustained performance of unpinned first-run devices.

The existing notification center bounds pending data per channel even during a
hold or a same-task burst. Oldest pending entries overflow first. The inbox is
separately bounded. Required recoverable information belongs in persistent
application state; a best-effort notification is not its only access path.
Renderer callbacks are reentrant boundaries, and queue ownership is checked again
before each group. The engine does not claim a bounded visual toast stack merely
because its pending data is bounded.

An optional author-facing `measureUiOcclusion` computes union footprint area and
per-critical-region overlap. It has bounded inputs, no frame-loop subscription,
no DOM traversal, no device inference and no universal pass threshold. Callers
supply real rectangles, including transparent input blockers and modeled hand
coverage. They declare task limits for their own supported configurations.

## Acceptance

- Identical hardware with different pointer capabilities resolves identically;
  saved choices are neither re-probed nor rewritten.
- Held notification bursts remain bounded; renderer reentrancy cannot bypass holds
  or lose ownership of undelivered groups.
- Union geometry agrees with an independent grid oracle; overlapping footprints
  count once and critical regions are evaluated independently.
- Browser diagnostic fixtures distinguish geometric evidence from actual input
  interception. They are not application or physical-device acceptance.

Partly or fully offscreen targets need an additional containment/visible-fraction
check: a zero clipped overlap ratio is not proof that the player can see a target.
Desktop and tablet builds remain free of unsupported phone constraints.
