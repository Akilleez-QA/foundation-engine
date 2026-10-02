# Dependency lease owner

`createDependencyLease` owns a bounded acyclic dependency closure over injected
lease acquisitions. It does not cache values, create workers, schedule frames or
replace the router. Adapters can return existing `LeaseCache`/`AssetLeases` leases
or owned results from the existing worker host.

Admission validates at most 1,024 nodes, 8,192 edges and depth 64, then reserves the
sum of declared bytes against `maxPinnedBytes` before calling any acquisition.
This is a per-owner pinned-byte reservation, distinct from the existing cache's
warm-byte LRU. Shared underlying values can be conservatively reserved by both
owners. The loader must report actual bytes and an idempotent release; results
larger than their reserved size fail instead of becoming usable.

`required` roots include their entire dependency closure. Required failure closes
admission and releases everything acquired. Once required values are ready,
`status` is `partial` while optional values are pending or failed, or `ready` when
all are ready. Readiness does not mean the optional set has completed. `get(id)`
returns only acquired values. `pump(maxWork)` bounds node examinations and completion
publication while respecting the concurrent-acquisition limit. `prepare(maxWork)`
awaits critical readiness, pumping in bounded slices and waiting on completion
notifications without installing a frame loop. A routed preparation hook can await
it and retain the returned owner for the activated visit.

The caller supplies the lifetime signal and disposes the owner on exit. Cleanup
releases dependents before prerequisites, catches individual release failures,
and aborts in-flight work; late results release once without publication. The
`releaseErrors` counter records cleanup failures. Acquisition work itself must use
the existing worker admission contract when expensive; the closure cannot make an
unbounded synchronous loader safe. Optional work can continue through the active
owner's existing frame system after `prepare` completes.

## Cooperative preparation and priority (M2)

`prepare(maxWork = 16)` crosses a real task boundary between pending pump slices,
including immediately resolving acquisitions. It uses the shared `scheduleTask`
core seam also used by worker-runtime checkpoints. `DependencyOptions.scheduleTask`
may supply an existing owner's scheduler: accept a resume callback, return an
idempotent cancellation function, and resume on a later task (never synchronously
or solely through microtasks). No additional frame loop is installed. After a
task boundary, unresolved I/O sleeps on completion notification rather than polling.
Disposal cancels scheduled continuations immediately; unresolved acquisitions keep
existing byte admission and prerequisite ownership until actual settlement.
A scheduler exception retires the closure and rejects preparation.

`pump(maxWork)` remains synchronous, bounded by counted examinations/publications,
and schedules no continuation. Critical nodes and their transitive prerequisites
have stable topological priority. While critical work is pending, at most
`maxConcurrent - 1` optional nodes may occupy acquisition slots. Thus concurrency
one starts required work first; larger limits admit optional work while retaining
capacity for a prerequisite's successor. Running callbacks are never preempted.
Once critical readiness is reached, all slots become available to optional work;
callers continue optional pumping explicitly. `prepare()` still returns at critical
readiness, not at completion of every optional node.

These counts are not millisecond deadlines. A synchronous acquisition can block
arbitrarily; split it into bounded authored work or use the existing WorkerHost.
Timer scheduling may be delayed or throttled by the browser. This mechanism does
not infer hardware headroom, promote intent, change resource byte budgets, or
certify frame responsiveness. The public native task oracle is
`scripts/play/fixtures/dependency-preparation.ts`; browser evidence is separate
from deterministic ownership and Node task-queue tests.

The default task seam prefers feature-detected `scheduler.postTask` at user-visible
priority, with a per-task AbortController. Unsupported hosts or rejected scheduling
fall back to a cancellable timer task. This avoids timer nesting clamps where the
native scheduling API is available; it does not promise a latency bound or task
ordering across different browser task sources. Native scheduling callbacks must
still cooperate; an already running callback cannot be cancelled.
