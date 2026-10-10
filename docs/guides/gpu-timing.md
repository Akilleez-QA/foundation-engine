# Measured GPU time and counter tracks

Two optional diagnostics (ADR 0172). Neither runs unless asked for, and creators may omit both.

- **GPU timer** (`src/platform/render/gpu-timer.ts`): measured GPU time of a frame's draw through WebGL2 timer
  queries (`EXT_disjoint_timer_query_webgl2`). It feeds `quality.stats().gpuMs`, which was declared before and never
  populated.
- **Counter trace** (`src/dev/counter-trace.ts`, dev/test only): per-frame numeric counters and frame markers in a
  bounded ring, exported as Chrome Trace Event JSON next to [event timing](event-trace.md) and
  [system timing](system-timing.md).

## Dev and test builds

```js
// GPU time of the running scene's draws (null without a scene).
const timer = engine.gpuTiming({ capacity: 4 });
timer.status; // 'available' | 'unavailable' | 'lost' | 'disposed'
// ...frames later
timer.take(); // [{ frame, gpuMs }, ...] oldest first
timer.stats(); // measured, disjoint, skippedBusy, skippedNested, abandoned, losses, droppedResults, invalid, ...
timer.dispose();

// Counter tracks on the one frame loop, with GPU time attributed to the frame it measured.
const capture = engine.counterTrace({
  capacity: 2048,
  gpu: true,
  sources: () => ({ queued: myQueue.stats().waiting }), // optional, O(1) reads of existing owners' stats
});
// ...exercise the scene
const file = capture.exportTrace(); // JSON.stringify(file) loads in a standard trace viewer
capture.dispose();
```

`engine.counterTrace()` occupies the loop's one observational sampler slot. While a
[session recorder](session-performance.md) holds it, starting a counter trace throws.
Dispose one before starting the other.

## Creators

A game using `@kits/three` can import `createGpuTimer` and time its own draws (see the
[kit README](../../src/kits/three/README.md#measured-gpu-time-optional)). Nothing is measured unless the creator
creates a timer. A production build of the stock runtime never creates one: the scene's draw path checks one null
reference per drawn frame.

## GPU timer contract

| | |
|---|---|
| Inputs | One WebGL2 context. Per frame, `poll()`, then `begin(frame)` and `end()` around the draw. |
| Outputs | `{frame, gpuMs}` results via `take()` or `onResult`, `lastMs` and `stats()`. In the scene runtime, each result also goes to `quality.gpuFrame(ms)`. |
| Owner | The frame owner that draws: the scene runtime (`src/author/runtime.ts`) in dev/test, or a creator's code. One timer per context and owner. |
| Bounds (checked at construction) | `capacity` 1..16 queries in flight (default 4), `maxResults` 1..4096 retained results (default 64), `maxPendingPolls` 1..600 (default 60). |
| Overload | A full ring skips that frame's measurement (`skippedBusy`). It never waits and never grows. A `begin` while a query is open is refused (`skippedNested`). A query unanswered after `maxPendingPolls` polls is deleted (`abandoned`). Results not taken are evicted oldest first (`droppedResults`). |
| Readback | `QUERY_RESULT_AVAILABLE` is checked oldest first. Polling stops at the first query that is not ready, and a result is read only after it is available. There is no `getQueryParameter` stall and no `finish`. |
| Disjoint | When `GPU_DISJOINT_EXT` reports a disjoint operation, every answered and pending result is discarded and counted. Discarded results are never reported. |
| Attribution | Each result carries the `frame` given to the `begin` that opened it. The scene runtime passes the loop's frame number, which the counter trace also uses. |
| Unavailable | No extension, WebGL1 or no query support: `status: 'unavailable'`. Every call is a no-op, and `lastMs` and `quality.stats().gpuMs` stay undefined. |
| Context loss | A lost context drops the ring without calling into the context. The timer notices the loss at its next call. The scene runtime's `contextRestored()` hook, called by the existing context-recovery path through the renderer pool, looks the extension up again. A scene that is recreated instead gets a new visit, and its timer has to be started again. |
| Cancellation and disposal | `dispose()` ends an open query and deletes the timer's queries when the context is live. The scene visit's end disposes its timer. Query objects also fall under the renderer pool's existing leak sweep. |
| Quality | `stats().gpuMs` is the median of the last 120 measured frames, or absent. GPU time never moves the governor or a preset. |

## Counter trace contract

| | |
|---|---|
| Inputs | `frame(frame, timeMs, values, stepped)` per loop frame (from `counterSampler`). `sample(frame, name, value)` adds a late value, such as GPU time, to the frame it belongs to. |
| Built-in counters | `intervalMs`, `workMs` and `rendered` from the loop's frame record. `gpuMs` comes from the GPU timer when `gpu` is set. Everything else (draws, triangles, queue depths, jobs in flight) comes from the caller's `sources`. |
| Bounds (checked at construction) | `capacity` 1..65536 frames (default 2048), `maxCounters` 1..64 names (default 16), `maxNameLength` 1..120 (default 64). |
| Overload | The oldest frames are overwritten and counted (`droppedFrames`). Values for names beyond `maxCounters` are dropped (`droppedCounters`). Late values for frames no longer in the ring are counted (`lateDropped`). Non-finite values (`invalidValues`), non-increasing frames or backwards times (`invalidFrames`) and throwing sources (`sourceErrors`) are all counted. |
| Export | Chrome Trace Event JSON with `displayTimeUnit: 'ms'` and microsecond timestamps. Each frame has one global instant event (`ph: 'i'`, `s: 'g'`, name `frame`, category `foundation.frames`, `args.frame`, `args.stepped`). Each value has one counter event (`ph: 'C'`, category `foundation.counters`, `args.value`). The metadata carries every drop count. |
| Merging | `mergeTraceExports(counters, events, systems)` orders events by timestamp and keeps each source's metadata. All recorders use the same process and thread, and the same `performance.now` timebase in the browser. |
| Cancellation | `dispose()` detaches the sampler and stops the GPU timer the capture started. The final snapshot stays readable. `reset()` clears the ring and counters. |

## Evidence

- Unit tests with a fake WebGL2 context (`src/platform/render/gpu-timer.test.ts`) cover:
  - the ring, the busy skip and nested refusal;
  - delayed availability with completion order kept;
  - disjoint discard, abandonment and invalid answers;
  - context loss (observed or reported), restore with and without the extension, and disposal (including after
    loss);
  - attribution, an unavailable extension, a WebGL1 context, construction bounds and the result listener;
  - a seeded randomized schedule.
- `src/dev/counter-trace.test.ts` covers:
  - the export format;
  - the ring, late attribution, bounds, reset and dispose;
  - merging with the event trace;
  - a composition with the real `FrameLoop` and a GPU timer, where late GPU time lands on the frame it measured.
- `src/platform/render/quality.test.ts` checks `gpuMs`.
- `src/dev/test-api.test.ts` checks the sampler slot, replacement and disposal.

## Not established

- **No browser or device measurement.** There is no browser or physical-device measurement. The unit tests use a
  fake context. The headless CI browser (SwiftShader) normally does not expose the extension. No measured GPU numbers
  are recorded here, and none should be inferred.
- **Coverage of the timed span.** The timed span is the scene's draw (`post.render` or `renderer.render`) on its
  leased context. Shadow cache updates, other pool roles (stage, utility) and the browser's compositor fall outside
  it, so `gpuMs` is not total GPU frame cost.
- **Driver variation.** Some browsers and drivers coarsen, disable or report disjoint results for timer queries for
  privacy or power reasons. On those, nothing is measured and the gap is counted, not filled.
- **Draws and triangles.** The engine supplies no draw or triangle source in production. In dev/test, `sources` must
  read them from an existing probe (for example, the bench's WebGL probe).
- **WebGPU.** WebGPU timestamp queries are not implemented. The WebGPU backend does not exist yet.
- **Sampler slot.** A counter trace and a session recorder cannot run at the same time.
