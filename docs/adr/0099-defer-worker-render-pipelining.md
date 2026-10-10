# ADR 0099: defer worker render pipelining until a measured need

- Status: Accepted (decision not to build now); revisit on new device evidence.
- Date: 2026-10-10
- Area: Render / Frame loop / Workers

## Context

Native engines often pipeline rendering: the front end builds frame N+1's draw data into one of two frame-data
buffers while a back-end thread submits frame N. The browser equivalent is a worker that owns the renderer through an
`OffscreenCanvas`, or a worker that runs the simulation while the main thread draws the previous snapshot. The creator
asked for this to be built if it is measurable on the GPU bench, and otherwise for the finding to be recorded.

## Decision

Do not build worker render pipelining now. On the GPU bench at 4K the heaviest stock scene spends about 0.6 ms of
main-thread time per drawn frame (under 4% of a 16.7 ms frame); every window is display-paced. The GPU already runs
in a separate process. Moving the renderer would touch the renderer pool, context recovery, the stage, loaders, post,
shadows, particles, synchronous scene services, the three.js kit and the test probes, for a gain bounded by that
0.6 ms. Evidence: [render pipelining verification](../verification/render-pipelining-20261010/README.md).

## Alternatives and consequences

A simulation worker needs transform interpolation that does not exist yet and would make synchronous scene services
asynchronous. A narrower offload (a worker job for an expensive, pure per-frame computation) already fits the worker
host contract (STD-RUN-35 to STD-RUN-41) and needs no new mechanism. The consequence is that main-thread frame work
stays serial; a game whose own systems are heavy should move pure work to worker jobs. The decision is revisited when
physical-device measurements on a declared target show main-thread work above about half the frame interval with
submission or sync dominant.

## Evidence

One GPU bench run (RTX 4080, ANGLE, Chromium 141, 3840×2160) recorded with its raw JSON, plus the earlier recorded
software benches and the ten-minute session recording. No phone, tablet, thermal or WebGPU measurement.
