# ADR 0016: Renderer pool and reference-counted resource ownership

- **Status:** Accepted
- **Date:** 2026-09-28
- **Area:** Render
- **Related:** [0040 Share immutable set resources; keep activity scenes private](0040-scene-instance-ownership.md)

## Context

Creating a WebGL context per screen exhausts the browser's context limit. A consumer that disposes a shared texture breaks every other user of it.

## Decision

- `platform/render/renderer-pool.ts` owns contexts by role (`world`, `stage`, `utility`).
- Shell handover and diagnostics use the lightweight `platform/render/app-renderer-pool.ts` accessor. They may settle or inspect the existing pool, but must not initialize rendering. Before any render consumer requests a pool, settlement is a no-op and pool statistics are undefined (the shell probe presents its existing empty-object fallback).
- The lightweight accessor holds the single app pool reference. `appRenderers()` supplies the implementation factory on first use; render consumers retain synchronous leases and the same resource owner. The original `rendererPoolStats` export remains available from `renderer-pool.ts`. This boundary removes the shell's eager renderer dependency; it does not guarantee that a particular game has no other eager GPU imports.
- A `world` lease hands the pooled canvas to one visit, with a fresh renderer bound to the pooled context, so no state leaks between scenes.
- Release resets GL state, audits leaks and deletes what the lease left behind.
- A recycle valve retires a context whose lease left an implausible amount behind.
- Context loss is watched once, in the pool.
- Shared GPU resources come from the asset lease cache. Activities own their handles, and a consumer never disposes a shared one.
- Every load takes the owner's AbortSignal.

## Consequences

- Scene changes create no new context (budget metric `contexts`).
- Lint: `webgl-renderer` and `context-lost-listener` are owned by the pool.
