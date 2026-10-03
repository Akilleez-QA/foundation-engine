# ADR 0078: Creator-selectable render backend

- **Status:** Accepted
- **Date:** 2026-10-03
- **Area:** Render
- **Supersedes:** [ADR 0034](0034-one-webgl2-path.md)

## Context

ADR 0034 kept one WebGL2 render path and allowed a superseding ADR only with named, measurable criteria. three.js
r186 ships `WebGPURenderer`, and compute-based work (GPU particles, culling, indirect draws) would live behind it. It
is not yet a replacement for `WebGLRenderer` in this engine:

- Upstream still describes `WebGPURenderer` as experimental and recommends `WebGLRenderer` for pure WebGL 2
  applications.
- Per-object CPU cost is higher on WebGPU (three.js issue #30560 is open). A local, indicative measurement at 3000
  unique meshes gave a median of 16.0 ms CPU on WebGL and 83.6 ms on WebGPU. WebGPU has no multi-draw, so
  `BatchedMesh` is unrolled and draw counts rise. The engine's budgets are per-scene draw counts.
- three's WebGL2 fallback inside `WebGPURenderer` is slower than `WebGLRenderer` and cannot render to several
  canvases, which the renderer pool's stage role needs. Devices without WebGPU therefore need the engine's own
  WebGL2 path in any WebGPU build.
- WebGPU is not shipped by default on every browser and operating system a brief can name (for example Firefox on
  Linux and Android, and most GPUs under Chrome on Linux).
- The verification tooling counts draws on WebGL contexts only, and headless capture of a WebGPU canvas can be blank.
  A WebGPU scene would read 0 draws and pass every draw budget.

Those observations are not device acceptance. They come from upstream sources and a local headless spike.

## Decision

- **Two backends behind one seam.** The renderer pool (STD-REN-3) remains the only owner of renderers and contexts.
  It creates them through a render backend interface. WebGL2 (`WebGLRenderer`) is one backend and WebGPU
  (`WebGPURenderer`) is the other.
- **WebGL2 is the default.** A brief that says nothing renders exactly as before: the same output, the same budgets
  and the same quality-guard baselines.
- **WebGPU is opt-in and creator-selected.** The creator chooses it in the build brief
  (`defineBuild({ render: { backend: 'webgpu' } })`). It is a brief setting, not a feature flag; the flag registry
  gets no render-path flag. Until the WebGPU backend exists, selecting it fails with a clear "not available yet"
  error rather than falling back silently.
- **WebGPU is loaded lazily.** Only `src/platform/render/backends/webgpu/` imports `three/webgpu` or `three/tsl`, and
  the pool reaches it through a dynamic `import()`. A WebGL2 user downloads none of it.
- **three's WebGL fallback backend is never used.** No `forceWebGL`, and no reliance on `WebGPURenderer`'s automatic
  fallback. A device without a usable WebGPU adapter runs the engine's WebGL2 backend, and the run records the
  backend that actually ran.
- **Effects stay modular.** Effects are shader modules with declared uniforms and hooks. A WebGPU port adds a node
  (TSL) implementation beside a GLSL one, one module at a time.
- **Budgets and baselines are per backend.** A WebGPU budget column is derived by measurement; it is not a raise of
  the WebGL2 number, so budgets still only fall per backend. A WebGPU run asserts the backend that actually ran and
  counts its own draws.
- **Lint.** `three-webgpu` stays strict: `three/webgpu` and `three/tsl` imports are allowed only under
  `platform/render/backends/webgpu/`, and banned in the rest of the engine, in kits and in game code (`lint:game`,
  with no escape). `webgl-renderer` allows `new WebGLRenderer` only in the pool and `platform/render/backends/webgl/`.

### Criteria for switching the default

The default changes from `webgl2` to `webgpu` only by a later, separate author decision, recorded with a brief
changelog row, and only when all five criteria hold:

| # | Criterion | Measured by |
|---|---|---|
| C1 | three.js documentation no longer calls `WebGPURenderer` experimental, or issue #30560 is closed with per-object overhead at or below WebGL | Upstream |
| C2 | For every template scene, WebGPU CPU frame time is at or below WebGL at the scene's draw budget, on every supported device class | `npm run bench` on both backends, on physical devices |
| C3 | WebGPU ships enabled by default on every browser and operating system that the brief's `devices` names | The gpuweb implementation-status wiki and caniuse at the time |
| C4 | A WebGPU gate is green on CI for 20 consecutive runs, with no silent fallback | A CI job that asserts the actual backend |
| C5 | The quality-guard picture difference is within tolerance on each template, against WebGPU baselines | `npm run quality:guard` |

**Owner.** The renderer pool owns backend creation, loss and recovery. The build brief owns the selection. The author
owns the decision to change the default; an agent may report that C1 to C5 hold, but never switches the default on
its own.

## Consequences

- The WebGL2 path is unchanged for every existing game. The seam must keep its output byte-identical.
- A WebGPU build carries two backends. Device claims for it must name the backend that actually ran on each profile,
  and need manual evidence per DEVICE-EXPERIENCE.md. Headless Chromium is not device evidence.
- One set of budgets and one quality guard becomes one set per backend.
- Effects, the shadow scheduler hook, program preparation, the probe counters and canvas capture each need a WebGPU
  implementation before a WebGPU scene can be accepted. Until then the WebGPU backend is incomplete, and saying so is
  part of the contract.
