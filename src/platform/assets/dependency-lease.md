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
