# ADR 0172: optional measured GPU time and per-frame counter tracks

- Status: Proposed
- Tracking: discussion issue linked from the pull request
- Date: 2026-10-10
- Area: Platform / render / diagnostics

## Context

`FrameStats.gpuMs` has been declared in `src/platform/render/quality-knobs.ts` from the start, but nothing ever
filled it. The session recorder, the bench and the budget check report frame intervals and main-thread work time.
None of them measures GPU time, and the session-performance guide says so. The trace exports (event timing,
system timing) hold intervals only, so per-frame numbers such as draws, GPU time or queue depths cannot be lined up
against them in a trace viewer. Creators who profile need both, but only on demand: production frames must not pay
for it.

## Decision

1. **A platform GPU timer** (`src/platform/render/gpu-timer.ts`) over WebGL2 `EXT_disjoint_timer_query_webgl2`,
   built on the context the render backend already leases:
   - one timer per context and frame owner;
   - a bounded ring of in-flight `TIME_ELAPSED` queries (1..16), with one active query at a time;
   - non-blocking readback, oldest first, that stops at the first unanswered query;
   - disjoint batches discarded, and queries that never answer abandoned after a bound;
   - results attributed to the frame number `begin` was given;
   - loss handled by dropping the ring without calling the dead context, with the extension looked up again on the
     scene's existing `contextRestored` hook;
   - disposal that deletes only on a live context.

   Without the extension the timer is `unavailable` and `gpuMs` stays undefined.
2. **The scene runtime** wraps its draw only when a timer exists. One is created only by `engine.gpuTiming()` or
   `engine.counterTrace({gpu})` in dev/test builds. Results feed a new `Quality.gpuFrame(ms)`, and
   `stats().gpuMs` is the median of the last 120. GPU time never governs. Creators get the same timer from
   `@kits/three` for their own draws.
3. **A dev/test counter trace** (`src/dev/counter-trace.ts`) is the loop's observational sampler. It keeps a bounded
   ring of per-frame rows (frame, time, named values, stepped) with drop counts and late attribution by frame. It
   exports Chrome Trace Event `C` counters and global `frame` instants on the same process, thread and timebase as
   the event and system traces, and `mergeTraceExports` combines them.

## Alternatives and consequences

- *Reading results synchronously or calling `finish`* would give same-frame numbers, but it stalls the pipeline and
  changes what it measures. Rejected.
- *Timing inside the frame loop (core)* would put GPU types into L0 and time frames with nothing drawn. The draw
  owner holds the context, so the timer lives with it.
- *Adding GPU time to the session recorder's frame record* is not possible as things stand: the record is reused
  synchronously and GPU answers come frames later. The counter trace attributes late values by frame number instead.
  The recorder is unchanged.
- *A second sampler slot* would change the loop's at-most-one sampler rule (STD-SYS-18). A counter trace and a
  session recorder are therefore mutually exclusive, and starting the second one throws.
- *Counter values for draws and triangles from `renderer.info`* would be wrong with post-processing, because the
  info is reset per `render` call. These counters come from caller-supplied sources until a production-free
  per-frame draw source exists.

Consequences: production cost when off is one null check per drawn frame, and the module is in the bundle (as
system timing is). One timer per context means a creator's own timer must not wrap a draw that the engine is already
timing.

## Evidence

- Fake-context unit tests (`gpu-timer.test.ts`, 18) cover the ring, busy and nested refusal, delayed and in-order
  availability, disjoint discard, abandonment, invalid answers, context loss (observed and reported), restore with
  and without the extension, disposal (including after loss), attribution, unavailable and WebGL1 contexts, bounds,
  the listener and a seeded randomized schedule.
- `counter-trace.test.ts` covers the format, ring, late attribution, bounds, reset and dispose, a merge with the
  event trace, a composition with the real `FrameLoop` and timer, and source failure.
- The quality and test-API tests check `gpuMs` and the sampler slot.

All of this is local and unofficial. No browser, device or GPU measurement was taken. See
[the guide](../guides/gpu-timing.md) for the "not established" list.
