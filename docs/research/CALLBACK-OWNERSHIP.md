# Callback ownership and bounded diagnostics

Study date: 2026-09-30. These are independent engine changes and implementation
recommendations. No upstream implementation was copied or translated.

## What the source implementations teach

[Godot Voxel's task runner](https://github.com/Zylann/godot_voxel/blob/fa52579ec97a93c915663a55330e4ea57e6a728a/util/tasks/time_spread_task_runner.cpp)
removes work under a queue lock, invokes work outside that lock, and returns
postponed tasks only after the current pass. Its elapsed-time check happens after
work; one callback can exceed the budget. Strict priority also needs a starvation
policy. Its shutdown drain assumes producers have stopped. These are separate
contracts: admission bounds, pass boundaries, execution cost and retirement.

[Tracy's client](https://github.com/wolfpld/tracy/blob/6dae06535c0c8af1e5ff7604a9cd29145fa8258c/public/client/TracyProfiler.cpp)
separates record production from queue draining and releases associated allocations
when clearing records. Its
[instrumentation macros](https://github.com/wolfpld/tracy/blob/6dae06535c0c8af1e5ff7604a9cd29145fa8258c/public/tracy/Tracy.hpp)
become no-ops when disabled. This supports separating capture from transport and
avoiding record construction when disabled. The inspected implementation does not
establish a fixed total-memory limit suitable for this engine; do not infer one
from queue preallocation.

## Independent fixes in this implementation pass

- `src/platform/ui/notify.ts` retains the newest configured number of pending
  notices per channel whether a renderer exists or delivery is held. Incoming
  records and outgoing inbox/renderer data have independent scalar metadata copies.
- Notification bursts distinguish individual posts, respect holds and renderer
  changes between groups, and defer callback-generated posts to a later burst.
  Duplicate hold signals subscribe once. Registration identity prevents a stale
  removal handle from removing a newer registration of the same renderer object.
- Narration clears its current hold before aborting it, allowing a delivery callback
  to establish a replacement hold without losing ownership.
- `src/core/events.ts` snapshots diagnostic tap membership at emit entry, preserving
  application listener snapshot semantics. Error reporters cannot interrupt later
  delivery or recursively report their own failures. Invalid depth limits fail
  before dispatch.

Focused tests cover notification overflow, callback mutation, copied data,
replacement registration and narration restart, plus tap mutation, reporter failure
and nested reporting. Passing these tests does not establish a callback time limit,
renderer-visible notification limit or complete replay capability.

## Additional callback findings resolved

1. Synchronous injected notification schedulers can still release the initial burst
   immediately. Callback-generated follow-up bursts now use a real microtask
   boundary, preventing recursive stack growth. A 10,000-delivery finite-chain
   regression exercises this behavior. This bounds stack depth, not total CPU:
   an application that reposts forever can still starve the event loop.
2. A retired narration binding has a disposed guard. The event bus may still invoke
   a captured subscriber under its documented snapshot semantics, but that callback
   cannot create a new hold after retirement.
3. An injected scheduler failure restores the scheduled marker and propagates to
   the caller. Already accepted notices remain bounded and a subsequent post or
   renderer registration can retry scheduling. There is no automatic retry timer.

The focused notification suite now has 18 passing tests; the event-bus suite has
7. These are focused results, not an integration or hardware acceptance claim.

## Next bounded mechanism: causal diagnostic recording

The existing `src/platform/input/controls-trace.ts` is development-only and caps its
array at 20,000 records, but evicts through array splicing and exposes mutable
records. It describes control observations, not generic causal operations or replay.
`src/core/activity/loop.ts` already owns frame scheduling, snapshots tickers, skips
removed entries and prevents scheduling during a tick. Preserve that ownership.

After callback reliability fixes, prove a development-only fixed-capacity scalar
record ring at one ticker boundary and one notification boundary. Use sequence,
frame/owner epoch, operation/parent identity, phase and result fields; bound any
label dictionary. Do not retain arbitrary event payloads, closures or DOM objects.
Insertion must be constant-time; dropped-record counts must be explicit; export
returns detached data. Disabled capture must skip producer construction. Capture
must not invoke observers or create another frame loop.

Acceptance includes wraparound ordering, exact drop counts, detached exports,
retirement/reset, disabled capture and distinct failure/cancellation outcomes.
Use the existing test API for a small interruption diagnostic. Keep the existing
control trace until an explicit compatibility adapter is verified. Portable replay
requires additional clock/input/randomness/state-schema contracts and remains a
separate milestone; a causal trace must not be presented as deterministic replay.
