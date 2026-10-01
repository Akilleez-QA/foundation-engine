# ADR 0040: Share immutable set resources; keep activity scenes private

- **Status:** Accepted
- **Date:** 2026-09-28
- **Area:** Render
- **Related:** [0016 Renderer pool and reference-counted resource ownership](0016-renderer-pool-resource-ownership.md)

## Context

Handing a live scene from one visit to the next leaks state between visits and makes disposal ambiguous.

## Decision

- Shared set pieces are immutable leases: geometry, textures and immutable materials.
- Each run instantiates its own private node hierarchy, cameras, lights, uniforms and animation state.
- Static batching happens within semantic groups that can be hidden separately.
- The pool owns renderers only. A run disposes its view before releasing the set lease.

## Consequences

- No live scene is ever transferred between runs.
