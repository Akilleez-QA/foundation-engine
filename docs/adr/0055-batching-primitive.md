# ADR 0055: Batching is a small set of primitives chosen by what the art must still do

- **Status:** Accepted
- **Date:** 2026-09-28
- **Area:** Render

## Context

Hand-merged geometry breaks hiding, picking and recolouring, and every feature reinvents it.

## Decision

- Batching offers a small fixed set of primitives (`platform/render/batching/`), chosen by what the art must still do after the build (nothing, toggled, moved or recoloured).
- A feature never merges geometry itself.
- A batch that fails its guard is split back, never tuned.

## Consequences

- `platform/render/model-batching.ts`.
