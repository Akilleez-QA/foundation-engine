# ADR 0074: application-owned controller polling

- **Status:** Accepted
- **Date:** 2026-09-30
- **Area:** Input and frame ownership

## Problem

The registered action dispatcher accepted controller edges but application boot
installed only keyboard delivery. The legacy frame-input reader used a separate
path. Injected edges verified dispatch semantics without proving controller polling.

Binding a poller to a scene owner is insufficient: opaque menus pause that owner,
and legal ownerless layers cannot supply a replacement owner. Input needed to close
the menu must remain available while simulation beneath it stays paused.

## Decision

The existing frame loop supports explicit application-scoped, update-only tickers.
They cannot render and remain subject to hidden-tab suspension. Scene ticker coverage
is unchanged. The input module owns one such polling adapter; there is no second
animation loop or alternate action vocabulary.

The adapter reads standard controller positions and digital stick directions,
then feeds state edges to the existing dispatcher. Effective remaps remain owned by
that dispatcher. Existing button hysteresis, family identification and neutral gate
primitives are reused. Neutral sampling is required after focus, visibility, owner,
connection and cancellation changes. Disconnect releases held actions. No connected,
focused controller means no continuous input ticker; application teardown removes
its ticker and listeners. Reentrant dispatch cannot install duplicate tickers.

Keyboard actions retain their event timestamps. Events outside a key dispatch use
the current monotonic clock, so polled input never inherits an old keyboard timestamp.

## Limits and evidence

This adapter supports portable standard-mapped controllers and one selected connected
pad. Digital direction tokens do not claim analog magnitude, multiplayer switching,
vibration, controller-family glyphs or operating-system remap awareness. Browser
integration replaces navigator snapshots to exercise polling and modal actions;
physical controller and platform acceptance remain unverified.

Unit tests cover neutral arming, held trigger hysteresis, ownership changes, hidden
and blurred states, disconnect, disposal and reentrant ticker creation. A real-loop
regression covers an ownerless opaque modal without waking the covered scene.
