# ADR 0020: A UI shell owns buttons, layers, focus, Back and input priority

- **Status:** Accepted
- **Date:** 2026-09-28
- **Area:** UI
- **Related:** [0044 One action map: keys, pad and pointer resolve to registered actions](0044-one-action-map.md)

## Context

Screens that append their own overlays and key listeners fight over focus and Escape.

## Decision

- `platform/ui/shell.ts` owns the header zones; buttons are rows (`appShell().add`).
- `platform/ui/layers.ts` owns the layer stack with five ranked kinds, focus trapping, inertness and Back.
- Input priority follows the layer stack (ADR 0044).
- Design tokens are CSS custom properties (`--engine-*`) in `platform/ui/tokens.css`, inside a fixed cascade-layer order.
- Narration and music follow the top layer through events, not polling.

## Consequences

- Nothing touches the shell DOM except through rows.
- `scripts/lint/css.mjs` enforces layers, scoping and tokens.
