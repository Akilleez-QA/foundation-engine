# ADR 0045: Prepare a scene, then activate only the current request

- **Status:** Accepted
- **Date:** 2026-09-28
- **Area:** Router
- **Related:** [0041 Scene handover presentation](0041-scene-handover.md), [0047 Reachability is a path; an input press has one owner](0047-input-reach-and-ownership.md)

## Context

Async scene loads that finish out of order enter stale scenes, grant rewards twice, or leave a previous scene's listeners alive.

## Decision

- Each navigation captures one epoch, `{epoch, player, destination, params}`, and every awaited boundary checks it. A newer request, a player change, a timeout or a failure aborts the pending visit and disposes it exactly once.
- Preparation is dormant: `enter` builds private state, and `ready` means prepared. No gameplay effects run.
- The sequence is:
  1. The current run gets its first render.
  2. A final epoch check runs, then the synchronous `activate()`.
  3. A recheck runs, then `arrive()`, which drains the work queued during preparation.
  4. `scene.entered` is emitted exactly once.
- Held input is cleared at activation.

## Consequences

- `core/router/handover.ts` with `handover.test.ts`; the scene shell drives it.
