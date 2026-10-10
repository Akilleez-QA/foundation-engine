# Worker render pipelining: feasibility and measurement (2026-10-10)

Question: should Foundation build frame N+1's render state on another thread while frame N draws (double-buffered
frame data with a back-end render thread, here a worker with `OffscreenCanvas`)? Decision recorded in
[ADR 0099](../../adr/0099-defer-worker-render-pipelining.md). This page is the evidence. It is a measurement of the
stock templates on one desktop GPU, not physical-device evidence.

## What pipelining could hide

All of a frame's engine work runs on the main thread, back to back, in one loop tick
(`src/core/activity/loop.ts`, the scene ticker in `src/author/runtime.ts`): fixed-step systems, the ECS-to-three sync,
then `renderer.render` (or the post pass). In Chromium the GPU commands are already executed by a separate GPU process,
so GPU time is not on the main thread. Pipelining can hide at most the main-thread CPU cost of a frame's work
(simulation, sync and draw submission), and only on frames that draw.

## Measurement

`GAME_DIR=templates/showcase/game npx tsx scripts/perf/bench.mjs --gpu --viewport 4k --only courtyard,garden --no-check`
at `a6211bd3` (clean tree): NVIDIA GeForce RTX 4080 through ANGLE (OpenGL ES 3.2), Chromium 141, 3840×2160 at DPR 1,
reference preset, load average 6.9 during the run. Raw run: [bench-showcase-gpu-4k.json](bench-showcase-gpu-4k.json).
The showcase courtyard is the heaviest stock scene (34–41 draws, 10 post draws for bloom, vignette and grade, a
2048 shadow map, 22–27k triangles).

`taskMsPerFrame` is the window's mean renderer-main-thread task time (CDP `TaskDuration`) divided by its frames
(here every frame drew). It includes the bench's own WebGL call counting, garbage collection and any synchronous GL
stall inside a task, so it overstates engine work; it excludes GPU-process and compositor time. It is a mean, not a
p95; `frameMsMax` 16.8 ms in every window shows no frame missed a vsync. The run records no CPU model.

| Window | Rendered frames | Mean main-thread task ms per frame (`taskMsPerFrame`) | Frame p95 ms |
|---|---|---|---|
| courtyard (steady) | 121/121 | 0.60 | 16.8 |
| courtyard:active (moving) | 241/241 | 0.64 | 16.7 |
| garden (steady) | 121/121 | 0.35 | 16.7 |
| garden:active (moving) | 241/241 | 0.54 | 16.7 |

Earlier recorded software-rendered benches of the other templates show 0.13–1.41 ms of main-thread task time per
frame (`templates/*/verification/**/*bench*.json`), and the ten-minute expedition session recording
(`docs/verification/session-perf-20261002/`) shows loop work p95 0.6 ms across all frames, of which 17% drew.

## Result

The whole main-thread cost of the heaviest stock scene, drawn every frame at 4K, is about 0.6 ms of a 16.7 ms frame
(under 4%). Frames are display-paced, not CPU-bound. Pipelining could hide at most that 0.6 ms, and in practice less:
overlapping two stages recovers at most the shorter one, and Chromium's command buffer already overlaps main-thread
submission with GPU-process execution. It does not help GPU-bound frames at all, and while simulation and frame
content are produced on the main thread, a main-thread stall (garbage collection, layout, UI; the session recording's
worst work interval was 50.7 ms) delays the next frame either way. Main-thread cost scales with draws and entities,
not pixels, so the 4K viewport loads the GPU process rather than the measured quantity; a phone CPU several times
slower would still put this scene's work at a few milliseconds, under half a frame. The price would be moving or
duplicating nearly every render owner:

- the renderer pool (canvas parking, held-frame overlay, per-visit renderer leases) and context-loss recovery, which
  depend on DOM canvases and document events;
- the three.js scene built from ECS data, the model loaders and KTX2 binding, post, the shadow scheduler, light rig,
  particles and scatter, all of which would need to move with the renderer or be serialised each frame;
- synchronous scene services that read three.js state (model state, sockets, attachments, pose links), pointer
  picking and the audio listener;
- `@kits/three` sessions that own the draw, the dev/test probes and the bench's WebGL instrumentation.

The cheaper variant (simulation in a worker, rendering the previous snapshot) would need real transform
interpolation (the runtime draws at the latest fixed step today; only particles interpolate) and would break the synchronous scene services and
the replay tick tap. It hides the same small budget.

## What would change the decision

Re-measure on a declared physical target (for example a mid-tier phone) with normal UI and effects. If main-thread
work p95 exceeds about half the frame interval with GPU headroom left, and a browser performance trace (or a future
GPU-timer and submission probe; the bench has no such split today) shows draw submission or sync dominating that
work, pipelining or a narrower worker offload becomes a candidate. Before that, the measured levers are fewer draws (instancing,
batching) and cheaper sync. Not measured here: phones, tablets, thermal behaviour, WebGPU.
