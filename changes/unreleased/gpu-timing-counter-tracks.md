- **Measured GPU time and counter tracks.** An optional GPU timer (`createGpuTimer`, also in `@kits/three`) wraps a
  frame's draw in a WebGL2 timer query. It reads the result frames later without stalling, discards disjoint
  results and survives context loss. It feeds `quality.stats().gpuMs` and is unavailable, not guessed, without the
  extension. Dev/test builds add `engine.gpuTiming()` and `engine.counterTrace()`, whose bounded per-frame counters
  and frame markers export as Chrome Trace Event JSON. See [the guide](docs/guides/gpu-timing.md) and
  [ADR 0172](docs/adr/0172-measured-gpu-time-and-counter-tracks.md).
