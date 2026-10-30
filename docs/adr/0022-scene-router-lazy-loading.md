# ADR 0022: A scene registry drives routing and per-scene code splitting

- **Status:** Accepted
- **Date:** 2026-09-28
- **Area:** Router
- **Related:** [0045 Prepare a scene, then activate only the current request](0045-handover-activation.md), [0041 Scene handover presentation](0041-scene-handover.md)

## Context

Hash routes hard-coded in shell code, and eager imports of every scene, make first load grow with every addition.

## Decision

- `SceneRow {id, kind, routes, title, icon, color, parent, chrome, screens, budget}` rows live in the router's `scenes` registry; redirects are rows too.
- The hash router (`core/router/router.ts`) resolves an address (`#scene/<id>?key=value`) to a scene and its parameters.
- Each scene module adds a dispatch row (`SceneEntry {id, label, preload, load, enter}`) in install; its body is a lazy chunk.
- Superseded loads are dropped; failed chunk loads are retried as a fresh request.

## Consequences

- First-load JavaScript is checked by the bundle check.
- The scene shell (`platform/ui/scene-shell.ts`) drives the handover (ADR 0045).
