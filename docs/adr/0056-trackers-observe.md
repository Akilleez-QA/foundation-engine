# ADR 0056: Change trackers observe batches and skeletons

- **Status:** Accepted
- **Date:** 2026-09-28
- **Area:** Render
- **Related:** [0057 Render dependencies are observed, never guessed](0057-render-dependency-observation.md)

## Context

On-demand rendering is only correct if every change that affects a frame is seen.

## Decision

- Change trackers (`platform/render/change-tracker.ts`) scan every supported render dependency, including batches and skinned meshes, after animation and before a frame is skipped.
- An object's type alone never forces a redraw.

## Consequences

- Mutation coverage tests (`change-tracker.coverage.test.ts`).
