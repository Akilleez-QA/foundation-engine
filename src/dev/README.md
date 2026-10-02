# `dev/`: test API and development tools

The typed test API (`window.engine`, ADR 0026) and development-only probes. Added to the page only by the dev server and `vite build --mode test`; product code never imports `dev/`.

`session-recording.ts` wires the optional PERF-01 sustained-session recorder (`platform/perf/session-recorder.ts`) to the
one frame loop for `engine.sessionRecorder()` and `?session-record`. Its evidence is exported only locally. See
[the guide](../../docs/guides/session-performance.md).
