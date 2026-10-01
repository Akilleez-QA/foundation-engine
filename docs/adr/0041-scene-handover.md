# ADR 0041: Scene handover presentation

- **Status:** Accepted
- **Date:** 2026-09-28
- **Area:** Router
- **Related:** [0045 Prepare a scene, then activate only the current request](0045-handover-activation.md)

## Context

A blank screen between scenes, or a half-built scene, reads as a crash.

## Decision

- The scene shell shows a loading card only after a delay (150 ms), so a scene that is already fetched never flashes it.
- A failure shows one card with Try again and Go back.
- The renderer pool can hold the old scene's last frame (`hold()`) over the change, with a fade that is zero under Calm.
- On context loss, a DOM recovery layer replaces any GPU hold.
- Music and narration change context at activation.

## Consequences

- `platform/ui/scene-shell.ts`, `platform/render/renderer-pool.ts` (`hold`).
