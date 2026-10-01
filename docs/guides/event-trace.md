# Bounded causal event diagnostics

The dev server and test builds expose an opt-in capture through the existing test
API. It explains synchronous nesting on one event bus without retaining event
payloads, exception objects, stacks or application entities:

```js
const capture = engine.eventTrace({ capacity: 2048, maxLabels: 256, maxLabelLength: 120 });
// Exercise the application.
const data = capture.snapshot();
const viewerFile = capture.exportTrace(); // JSON.stringify(viewerFile): Chrome Trace Event JSON
capture.dispose();
// JSON.stringify(data) is a detached export; no transport or persistence is installed.
```

Starting another capture through this API replaces the previous capture. Call
`dispose()` when finished; it is idempotent and keeps the bounded final snapshot
readable. `reset()` clears records, labels and counters, restarting local IDs and
sequence numbers; it does not revive a disposed capture. The capture is explicitly
caller-owned, not automatically tied to app disposal. Avoid retaining an old API
across application replacement; dispose its capture first.

Each record contains a sequence number, emission ID, parent emission ID (or null),
label dictionary index (or null), bus nesting depth, phase, listener-error count and
`timeMs` (same-thread monotonic milliseconds, or null for an invalid clock sample).
`begin` precedes listeners; `end` follows the existing debug taps. `rejected` records
an attempted emit blocked by the existing depth limit, with no matching begin/end.
Listener errors are counted at the emission that catches them, even when a nested
depth rejection caused the error. Reporter/tap errors are not listener errors.
The existing post-listener payload tap retains its ordering and behavior.

Capacity, label count and label length are configurable positive integers within
JavaScript's array-size range. Defaults are diagnostic choices, not game budgets.
Allocation can fail for impractically large configurations; there is no memory
admission guarantee. Appending a record uses a fixed-capacity ring with constant-time
replacement. `droppedRecords` counts overwritten records (and precision exhaustion
omissions); it is not evidence of missing application events. Dictionary overflow
uses a null label and increments `droppedLabels` per affected emission. Long names
are truncated and counted by `truncatedLabels` per emission; names sharing that
truncated prefix share a label. Labels are presentation, not unique event identity.
No full name is retained beyond the configured bound. Snapshot export copies the
bounded records and dictionary; modifying it cannot affect capture state.

Wraparound, reset, mid-delivery disposal/replacement, and starting inside an ongoing
emit can leave partial spans. Consumers must tolerate absent begin/end/parent
records. A reset suppresses pending completions from the previous capture generation.
Numeric counters saturate at the safe-integer maximum; capture stops issuing IDs
before precision is lost. Reset starts a fresh local numbering epoch.

The core bus exposes one replaceable scalar observer binding. Its exceptions are
contained. Emits originating inside diagnostic callbacks still deliver normally,
but are excluded from diagnostics to prevent diagnostic recursion. No payload
references reach this observer. Applications should keep observers observational:
the mechanism cannot undo side effects an observer deliberately performs.

This is not replay, CPU attribution, asynchronous context propagation,
cross-worker causality or a complete history. An event emitted later from a promise
or another task starts a new synchronous root. Nothing adds a scheduler, frame
callback, storage or transport. Other owners need their own explicitly designed
instrumentation if they require causal links.

The recorder, ring and test API live under `src/dev/`; the existing Vite dev/test
HTML injection is their entry point. Production omits that entry point. Core imports
no dev implementation. The generic observer registration and disabled conditional
branches remain in the core bus; this is not a claim of literally zero production
instructions. Production exclusion relies on that build entry boundary. For this change, the
production build passed and emitted JavaScript was inspected for recorder/API
markers (`droppedRecords`, `truncatedLabels`, `eventTrace`); none were present. This
inspection is separate from the gate and is not a dedicated CI regression guard.
Focused unit tests cover nesting, rejection, errors, wrapping, bounded labels,
snapshots, reset, disposal, diagnostic reentrancy and public test-API composition.


## Timed synchronous export

`capture.exportTrace()` returns a detached `{traceEvents, displayTimeUnit, metadata}`
object. Complete retained emission pairs become Chrome Trace Event `X` intervals;
`ts` and `dur` are microseconds, while `displayTimeUnit: 'ms'` is only a viewer
presentation hint. All intervals use one local process/thread pair. Their scalar
arguments preserve emission ID, parent ID, depth and listener-error count. A
parent may have been evicted even when its child's complete interval survives.
No artificial parent or missing endpoint is created. Begin order is retained,
including nested intervals with equal timestamps.

The default clock is `performance.now()`. Optional `now: () => number` supplies a
nonnegative monotonic millisecond clock for deterministic diagnostics. Its function
reference is captured at construction. Thrown, nonfinite, backward, negative or
microsecond-overflowing samples become null and increment `invalidClockSamples`;
normal bus delivery continues. The last valid sample remains the monotonic floor.
Reset clears that floor as well as capture IDs/counters. Reentrant reset/disposal
inside a clock callback cannot publish records from the previous generation.
Keep clock callbacks observational: capture cannot undo authored side effects.

`metadata.schemaVersion` is 1. `incompleteSpans` counts retained begins without ends
and retained ends without begins; it cannot count emissions whose every record was
evicted. `invalidTimingSpans` counts retained pairs excluded because an endpoint
was invalid. `rejectedRecords` counts retained depth-limit refusals, which have no
execution interval and are not exported as complete events. Metadata also copies
capture drop/label/clock counters and disposal state. Missing labels use a generic
placeholder; labels never establish identity. Zero duration is valid, including
when browser clock precision is reduced.

Conversion takes linear work and temporary space bounded by retained record count.
It adds no ongoing observer, second ring, scheduler, download, storage or transport.
Export after disposal remains available; reset clears the retained capture. These
are elapsed intervals around synchronous listeners and debug taps, including
instrumentation overhead, not measured CPU time. Separate asynchronous work is
not attributed to the originating event; worker clocks are never combined.

The format follows [Perfetto's official Chrome JSON documentation](https://perfetto.dev/docs/getting-started/other-formats).
The source-led design lesson from
[Tracy's scope macros at the inspected pin](https://github.com/wolfpld/tracy/blob/6dae06535c0c8af1e5ff7604a9cd29145fa8258c/public/tracy/Tracy.hpp)
is to instrument existing ownership boundaries and separate capture from transport.
This change extends the existing bus recorder rather than importing a native
collector or claiming system/worker coverage.

`npm run test:diagnostics-browser` exercises the actual app bus and
`engine.eventTrace()` in Chromium with its real clock, writes a detached trace file,
and checks interval nesting, units, metadata and page errors. CI runs this command.
The fixture does not claim an external viewer import was exercised. Focused tests
cover deterministic timing, invalid clocks, overwritten endpoints, interrupted
capture, reentrant clock callbacks, option ownership and detached export mutation.
Production-content exclusion is inspected separately at the validated build head;
there is no new automated production-marker guard in this command.
