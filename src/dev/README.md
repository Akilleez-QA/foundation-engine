# `dev/`: test API and development tools

The typed test API (`window.engine`, ADR 0026) and development-only probes. Added to the page only by the dev server and `vite build --mode test`; product code never imports `dev/`.

`session-recording.ts` wires the optional PERF-01 sustained-session recorder (`platform/perf/session-recorder.ts`) to the
one frame loop for `engine.sessionRecorder()` and `?session-record`. Its evidence is exported only locally. See
[the guide](../../docs/guides/session-performance.md).

`counter-trace.ts` is the opt-in per-frame counter ring behind `engine.counterTrace()`: the loop's one sampler slot,
bounded rows with drop counts, late GPU time attributed by frame, and Chrome Trace Event `C` counters and frame
markers (`mergeTraceExports` joins them with the event and system traces). `engine.gpuTiming()` starts the running
scene's GPU timer (`platform/render/gpu-timer.ts`). See [the guide](../../docs/guides/gpu-timing.md) (ADR 0172).

`engine.dispose()` (dev/test only) retires the booted app through the kernel's own `App.dispose()` and reports what
is left: a still-attached scene handle, remaining probe getters and the page renderer pool's release audit. Production
has no page-level disposal trigger; the page renderer pool and frame loop outlive the app, so a retired app's clock
cannot be stepped. Reload the page to start again. The explorer creator journey uses it as its final step.
