# ADR 0071: optional HUD disclosure through owned reading sheets

- **Status:** Accepted
- **Date:** 2026-09-30
- **Area:** Author API, UI and activity lifetime
- **Implements:** ADR 0068 and ADR 0069 without imposing a device profile.

## Decision

The HUD kit retains inline text by default. An author may explicitly mark secondary
lines as detail and choose a disclosed presentation. Essential lines remain in the
play view; one labeled Details control opens the read-only content. Presentation
is independent of viewport heuristics, pointer capability and graphics settings.
This is a reusable presentation option, not a forced phone or tablet layout.

`ViewState.openReadingSheet` supplies the visit-owned reading capability. It starts
a child activity through the existing host and pushes its sheet through the
existing layer manager. A distinct child owner is necessary: a sheet with the
parent's owner would not cover that parent's highest layer and would not pause it.
Scrim coverage pauses the scene, and the current input owner cancels pending
presses and pointer holds at entry. No secondary clock, layer manager or document
key listener is introduced. Closing and Back retire the child rather than merely
removing its layer.

One controller is owned once per visit; there is at most one pending or active
reading sheet. Replacement, early cancellation, parent exit and entry errors must
retire the old intent and any late child. Ownership is rechecked across asynchronous
start boundaries. `ready` resolves when available or canceled; cancellation is
identified by the aborted signal. Entry failure rejects `ready`. Closing is
idempotent. Focus return uses existing layer behavior and falls back to the scene
if the trigger has disappeared.

The HUD keeps state when presentation changes. It renders resolved text as text,
not HTML. Disclosed content scrolls while the Close control remains accessible.
Inline presentation remains valid for any authored target where it meets that
application's own visibility and interaction requirements.

## Supporting lifetime corrections

Activity error reporters cannot interrupt owned cleanup or recursively report
their own failures. Layer change subscriptions reject already-retired signals
and release their abort listener when manually removed. These corrections preserve
existing leave order and listener dispatch semantics. Initial-focus callbacks are
reentrant boundaries: the layer must still be current before applying their result.

The existing action dispatcher gains modal-scoped Confirm and reading-page actions.
They operate through the current layer owner, retain keyboard-native editing
behavior, and cannot replay into newly exposed gameplay on key repeat. A named,
focusable reading region makes long content reachable without a mouse. No separate
keyboard or controller event stream is created.

## Acceptance and limits

Focused tests cover backwards compatibility, distinct-owner pause, focus return,
replacement and cancellation, entry failure, parent retirement and repeated
open/close cycles. A real engine composition browser fixture covers the actual
HUD, activity host, layer manager and input dispatcher together.

This slice does not select responsive profiles automatically, add arbitrary nested
interactive editors, promise safe ongoing simulation behind a reading panel, or
certify physical-device performance. Applications still declare their supported
profiles, critical regions, text limits and hardware evidence.
