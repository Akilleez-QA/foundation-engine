# Optional sustained-session performance recorder (PERF-01)

A creator can use this dev/test-build tool to collect frame-time evidence over a long session. The evidence is
kept as a local file. The tool records rolling-window frame-time percentiles, long-frame counts and a drift
estimate across session minutes, which can serve as a proxy for thermal throttling. Creators may omit it,
configure it, or replace it with their own recorder. It provides a standard evidence format and a way to collect
it. It does not accept any device: **DV-01 stays open until the creator selects profiles and an operator records
physical-device runs.**

## Creator requirement and seam

DV-01 requires cold and sustained measured evidence for each supported profile
([device policy](../policy/DEVICE-EXPERIENCE.md) DX-16,
[device acceptance gaps](device-acceptance-gaps.md)). Before this change there was no standard artifact to collect.
The recorder reuses existing owners:

- **The one frame loop (STD-RUN-1).** `FrameLoop.attachSampler(sampler)` is a single observational slot, like
  `attachClock`. It adds no loop, ticker, timer or `requestAnimationFrame`. The loop passes one reused `FrameRecord`
  per frame: timestamp, interval, rendered/idle, `sinceEnterMs` and work time. It also passes one record when the
  tab becomes hidden.
- **ADR 0053 window classes.** Each window carries a `WindowClassification` (`CLASSIFICATION_VERSION`). An
  interrupted window is `invalid`. The recorder has no upload or request facts, so it never declares a complete
  window `steady`, `entry` or `firstUse`. It reports `unclassified` instead.
- **The router's run epochs.** `scene.entering` pauses recording. `scene.entered` starts a segment keyed by scene,
  visit epoch and quality preset. A preset change starts a new segment.
- **The dev/test API (ADR 0026).** Only `src/dev/` imports the recorder.

## Use

In a dev server or a `vite build --mode test` build:

```js
const rec = engine.sessionRecorder({
  windowMs: 30_000, maxWindows: 120, overflow: 'stop', budgetMs: 1000 / 60,
  meta: { profile: 'phone-minimum', evidence: 'physical', build: '<revision>' },
  counters: () => ({ draws: myDraws, triangles: myTriangles }), // optional cumulative counters
});
// … play the authored workload …
rec.stop();
rec.download('phone-minimum-sustained.json'); // a local browser download
// or: copy(rec.json()) from a remote inspector; rec.evidence() returns the object
```

To include cold start, add `?session-record` to the address. The recorder then starts when the test API attaches,
before the first scene. Address options:

- `session-profile`, `session-evidence` (`physical` | `emulated` | `unspecified`) and `session-build`: operator
  labels.
- `session-window-ms`, `session-max-windows`, `session-overflow` and `session-budget-ms`: bounds.

`engine.currentSession()` returns the running recorder. On a phone or tablet, use the platform's remote inspector
(Chromium remote debugging or Safari Web Inspector) to call `currentSession().stop()` and `download()`. There is no
on-screen control and no UI text.

## Inputs, outputs, owner and bounds

| Item | Contract |
|---|---|
| Inputs | One `FrameRecord` per loop frame and per hidden transition. Segment keys come from router events and the quality service. Optional cumulative counters are read only when a window opens and closes. Operator labels are bounded to 120 characters, with control characters replaced. |
| Output | `SessionEvidence`, schema `foundation.session-perf` version 1. It contains labels, recorder bounds, state, a truncation marker, session totals, segments, retained windows, a drift estimate per scene and preset, and fixed limitations. The data is plain JSON and is detached from the recorder. |
| Owner | The `SessionRecorder` started by the dev/test API, which owns at most one at a time. Starting a new recorder disposes the previous one. Invalid options throw and leave the running recorder in place. The loop has one sampler slot: a second attach throws. |
| Window | Closes when its summed frame intervals reach `windowMs` (default 30 000), so hidden and idle time is excluded. Windows also record their start and end on the session timeline, and `startMinute` is the drift x-axis. |
| Percentiles | Nearest rank from a fixed 776-bin histogram: 0.1 ms bins below 50 ms, 1 ms bins below 250 ms, 10 ms bins below 1000 ms, then overflow. A result is never below the exact value and at most one bin width above it, clamped to the observed minimum and maximum. |
| Frame classes | Long: interval > `longFrameMs` (default 1.5 × `budgetMs`). Severe: interval ≥ `severeFrameMs` (50). Gap: interval ≥ `gapMs` (1000), which is counted but excluded from percentiles. Resume: interval 0, the first frame after an idle or hidden loop. |
| Memory | Four histograms of 776 32-bit counters, at most `maxWindows` (≤ 4096) window summaries and at most `maxSegments` (≤ 4096) segments. A frame does constant work and allocates nothing. A window close allocates one summary. |
| Drift | Computed per scene and preset, over complete windows only. It is the least-squares slope of window p95 against minutes, and the late/early ratio of mean p95 over the first and last k = max(1, ⌊n/3⌋) windows. It is reported for both frame interval and work time. |

## Overload, cancellation and recovery

- **Capacity.** With `overflow: 'stop'` (the default), the window that fills `maxWindows` is retained. The recorder
  then sets `truncated: {reason: 'capacity', atMs}`, enters state `truncated` and releases the loop slot. With
  `'ring'`, the oldest window is evicted and `evictedWindows` is counted, while session totals still cover every
  frame. Exceeding `maxSegments` truncates with reason `segments` under either policy.
- **Hidden tab.** The loop's hidden record closes the open window with end `hidden` (an `invalid` window) and counts
  the transition. The loop resumes with interval 0, so the hidden time never appears as a frame interval.
- **Clock anomalies.** A backwards or non-finite timestamp is counted in `clockAnomalies`, and session time stays
  monotonic. A forward jump at or above `gapMs` is a gap.
- **Stop.** `stop()` closes the open window with end `stopped`, keeps it if it has at least two frames, and detaches.
- **Dispose.** `dispose()` drops the open window (counted in `discardedWindows`), freezes the session totals,
  releases the histograms and detaches. Both calls are idempotent, and the retained evidence stays readable.
- **Sampler failure.** A sampler that throws is detached, the failure is reported once as `frame-sampler`, and every
  ticker continues. Counter readers that throw or return non-finite values are counted in `counterFailures`, and
  the affected means are `null`.
- **No idle wake.** Attaching a sampler neither schedules nor keeps a frame. A still scene that renders nothing
  produces no records, as STD-RUN-2 and STD-RUN-9 intend.

## Telemetry and production

The recorder has no transport, storage or scheduler. Its evidence leaves the page only through an explicit local
action (`download()`, `json()` or `evidence()` through the dev/test API). This follows STD-SYS-18: no number leaves
the device. The browser check fails if any request leaves the local dev server during a run.

The production change is limited to the loop's sampler slot. Without a sampler, a frame makes one `undefined`
comparison and no clock read; unit tests count the clock reads. The recorder, the dev wiring and the address
auto-start are reached only from `src/dev/`, which production builds do not include. The recorded bundle
measurement is in the [verification note](../verification/session-perf-20261002/README.md).

## Evidence and limitations

- `src/platform/perf/session-recorder.test.ts` covers:
  - percentiles on constant, uniform, bimodal, heavy-tail and single-value distributions against exact nearest rank;
  - window rollover;
  - stop truncation and ring eviction bounds;
  - segment capacity;
  - hidden-tab windows;
  - backwards, non-finite and forward clock jumps;
  - stop and dispose mid-window;
  - segment and pause semantics;
  - a synthetic throttling ramp and a flat session;
  - counters and option validation.
- `src/core/activity/loop.test.ts` covers the zero-overhead path, the reused record, no idle wake, the hidden record
  and the detachment of a throwing sampler.
- `src/dev/session-recording.test.ts` covers router and quality segmentation, address options and replacement
  through the test API.
- `npm run test:diagnostics-browser` runs `scripts/play/session-recorder-check.mjs` for 30 seconds in the muted,
  isolated browser. The run covers:
  - address auto-start and local download;
  - a deliberate stall that must be recorded as a severe frame;
  - a synthetic hidden period;
  - a route change when the game has two scenes;
  - counters from the bench probe;
  - no request leaving the local server.
- A 10-minute emulated sample is saved under
  [docs/verification/session-perf-20261002](../verification/session-perf-20261002/README.md). It is labelled
  `evidence: emulated`.

Limitations:

- Frame interval is requestAnimationFrame pacing, so it is quantized by the display rate.
- Work time is main-thread elapsed time around the loop's tickers. It is not CPU, GPU, compositor or worker time.
  Under vsync, work-time drift is usually the more sensitive signal.
- Drift is a proxy. Content changes, background load or a power mode can produce it as well as throttling.
- The device profile and the evidence class are operator labels that the recorder cannot verify.
- The recorder records no temperature, clock speed, battery or power state, and no GPU timer queries.
- Draws and triangles appear only when the caller supplies counters. The stock app has no production-free
  per-frame draw source; the browser check reuses the bench's WebGL probe.
- Window classes never reach `steady`, so this output is not baseline gate evidence. It is manual evidence.
- After a hot module reload the previous API's recorder can still hold the sampler slot. A new start then throws
  until that recorder is stopped.
- This tool does not close DV-01. Physical phone, tablet and laptop/desktop runs on creator-selected profiles,
  with declared thresholds and reproducible workloads, remain required.
