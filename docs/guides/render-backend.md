# Render backend

The render backend is how the renderer pool creates renderers and GPU contexts
([ADR 0078](../adr/0078-creator-selectable-render-backend.md), STD-REN-1). The creator
selects it in the build brief. WebGL2 is the default and is the only backend that
exists today.

```ts
// game/build.brief.ts
export default defineBuild({
  // ...
  render: { backend: 'webgl2' }, // the default; leaving `render` out means the same
});
```

## Inputs and outputs

- **Input:** `defineBuild({ render: { backend } })`, either `'webgl2'` (the default)
  or `'webgpu'`. The resolved brief always carries `brief.render.backend`.
- **Output:** the app's renderer pool (`appRenderers()`) is created with that
  backend. Scenes, kits and game code do not change: they still receive a
  `RenderSurface` from the pool and never import a renderer.

## The seam

[`render-backend.ts`](../../src/platform/render/render-backend.ts) defines
`RenderBackend<C, R>`, where `C` is the backend's context and `R` its renderer. It
covers the following:

- Renderer construction.
- The `stage` role's shared context.
- Object tracking and its leak sweep.
- Context loss: the event names, `isLost` and `lose`.
- Program readiness and frame readiness.
- Capabilities (`multiCanvas`, `syncReadback`, `programIntrospection`, `multiDraw`).

The pool (`renderer-pool.ts`, `pool-stage.ts`, `pool-snapshot.ts`) reaches the
backend only through this interface. The WebGL2 implementation is
[`backends/webgl/backend.ts`](../../src/platform/render/backends/webgl/backend.ts).
It is the code the pool used to run inline, moved without change.

The `utility` role (`pool-snapshot.ts`) reads pixels back synchronously, so it keeps
its own WebGL2 context and needs `capabilities.syncReadback`.

## Owner, bounds and failure

- **Owner.** The renderer pool owns backend creation, context loss and recovery
  (STD-REN-3, STD-REN-5). The brief owns the selection. The author alone decides to
  change the default; ADR 0078 lists the five criteria (C1–C5) that must hold first.
- **Selection.** Selection happens when the game compiles at boot
  (`selectAppRenderBackend`), before any render consumer creates the pool. The
  backend cannot change after the pool exists.
- **Refusal.** Selecting `'webgpu'` is refused with "render.backend 'webgpu' is not
  available yet", both by `defineBuild` and therefore by `npm run check` /
  `lint:brief`, and at boot by `RenderBackendUnavailableError`. An unknown name is
  refused the same way. Nothing falls back silently to another backend.
- **Bounds, overload, cancellation and recovery** are unchanged from the WebGL pool:
  - The recycle valve, the live-context count, and the 15 s and 1024-program
    preparation bounds.
  - Preparation stops when its `AbortSignal` aborts or the lease is released.
  - Loss recovery stays in `context-recovery.ts`.
- **Cost.** The seam runs at lease, release, preparation and loss, never per frame.

## Limitations

- There is no WebGPU backend yet. `three/webgpu` and `three/tsl` may be imported
  only under `src/platform/render/backends/webgpu/` (lint `three-webgpu`), and that
  folder does not exist yet.
- `RenderSurface.renderer` is still typed as three's `WebGLRenderer`. A renderer type
  common to both backends arrives with the WebGPU backend.
- Budgets, quality-guard baselines and the probe's draw counters are WebGL2 only.
  A WebGPU build needs its own budget column and baselines (ADR 0078).
- A WebGPU device claim needs physical-device evidence per
  [DEVICE-EXPERIENCE.md](../policy/DEVICE-EXPERIENCE.md). Headless Chromium is not
  device evidence.
