# Optional authored-system timing

Dev/test builds offer `engine.systemTrace({capacity: 2048, maxLabels: 256,
maxLabelLength: 120})` for the current authored scene. It returns a capture or null
when no supported current scene exists. Creators may omit this tool entirely.

The capture has `snapshot()`, `exportTrace()`, `reset()` and `dispose()`. Starting
another capture on that visit disposes the previous one; invalid options leave it
unchanged. Visit/activity abort stops recording. A stale scene handle cannot start
another capture. Disposal preserves the final snapshot, and reset clears it without
reviving a disposed capture. Nothing schedules updates or changes scene coverage.

The existing runtime wraps its existing system callbacks only under `TEST_API`;
the core runner, phase ordering, arguments, exception handling and timestep logic
are unchanged. Each completed row records the scene-local system ordinal, phase,
bounded presentation label, same-thread start/duration in milliseconds and whether
the callback threw. A throw still reaches the runner's existing reporter, and
siblings continue. Timing ends before error reporting and excludes the renderer's
subsequent synchronization. Intervals include clock/wrapper overhead; they are not
CPU samples, worker time, asynchronous completion timing or deterministic replay.
A callback's returned promise is not awaited by this synchronous runner or tool.

Capacity and label bounds are configurable positive array-sized integers. Defaults
are diagnostic choices, not game budgets. Impractically large allocations can fail;
this is not a memory-admission guarantee. A fixed ring replaces completed rows in
constant time and counts overwritten rows. Labels have independent count/length
bounds; overflow records a null label, and truncation/overflow are counted per
invocation. Labels are presentation only: ordinals plus the visit epoch identify
systems within this capture. Export and snapshots copy scalars and labels, never
contexts, component values, error objects or authored closures. Export takes linear
work/space in retained rows. Nested execution is ordered by completion, not start.
No cross-system parentage is claimed.

Reset/dispose/replacement during a callback suppresses that unfinished row. A
callback that never returns produces no completed interval. Thus an empty capture
is not proof of no activity. Clock failures/nonfinite/negative/backward/overflowing
samples are counted and make affected timing unavailable; authored execution still
runs. Clock callbacks are captured once and should be observational: diagnostics
cannot undo their side effects. Diagnostic-clock reentry executes normal authored
work without recursively recording it.

`exportTrace()` produces Chrome Trace Event `X` intervals in microseconds, on one
process/thread pair, with category `foundation.systems`. Invalid timing rows are
excluded and counted in metadata. Zero duration is valid. The format follows the
same [official Perfetto Chrome JSON convention](https://perfetto.dev/docs/getting-started/other-formats)
as [event timing](event-trace.md). The event recorder's nested begin/end/parentage
model is intentionally not generalized: this small recorder holds completed system
rows and has a visit owner. Neither emits synthetic application events nor adds a
scheduler, transport, resource registry or competing execution owner.

`npm run test:diagnostics-browser` includes an actual authored-scene consumer,
recording deliberate synchronous work beside a sibling and exercising disposal,
scene replacement and app teardown. Focused tests cover fixed/frame invocations,
original errors, bounded retention, clock failures/reentry and interrupted capture.
The production import is guarded. On 2026-09-30, controlled Expedition production
builds at `dcb30b6` and base `e85f24d` each emitted 25 JavaScript files, with 244,804
static-entry bytes and 1,026,546 total JavaScript bytes: zero-byte delta. Five timing
recorder/API/category markers were absent across all emitted JavaScript. This is
recorded evidence for that build, not a permanent exclusion guarantee or an
additional automated CI marker check. The exact-head gate passed 1,390 tests and
28 performance checks, reusing `82bc09f` evidence after matching the unchanged
production fingerprint; all four diagnostic browser scripts passed locally.
This guide does not claim an external viewer import, physical-device performance
or a general system/worker causal profiler.
