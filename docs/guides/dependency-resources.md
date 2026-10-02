# Bounded dependency preparation

Import `createDependencyLease`, `createDependencyBudget` and their types from `@engine`. A closure orders acquisitions by dependency, holds the returned leases and exposes required readiness independently from optional completion. Its owner calls `pump(maxWork)` from an existing preparation or update path; it creates no clock or render loop. `prepare(maxWork)` waits only until required data is ready and is suitable for scene preflight.

## Share admission across overlapping owners

```ts
const budget = createDependencyBudget(4096);
const closure = createDependencyLease({
  nodes: [{ id: 'primary', dependencies: [], bytes: 1024 }],
  required: ['primary'],
  maxPinnedBytes: 1024,
  maxConcurrent: 1,
  budget,
  signal,
  acquire,
});
await closure.prepare(8);
// Keep ownership while using closure.get('primary').
closure.dispose();
```

Create the budget once at the lifetime that owns the allowance, then pass that same instance to all overlapping closures. A separately created budget for each closure provides no aggregate bound. Omit `budget` only when the existing per-closure bound is sufficient.

`createDependencyBudget(maxBytes)` accepts a nonnegative safe integer. Its read-only `stats` snapshot contains `maxBytes`, `reservedBytes` and `owners`. `reserve(bytes)` returns an idempotently releasable reservation; dependency closures normally manage this operation for callers. Admission throws when the total cannot fit. The budget stores accounting, not resources, and does not deduplicate ids.

A closure reserves the sum of all declared node bytes before starting acquisition. Returned byte sizes must not exceed their declared bounds. The reservation is conservative: it does not shrink when optional data fails or the actual resource is smaller. Size the allowance for active data and incoming preparation together. If construction rejects, retain the current data and report or retry through the application's existing flow; do not spin on retries or raise a limit silently.

Closing a closure cancels its signal and immediately hides its values from consumers. Held prerequisite leases and the shared reservation remain owned while any acquisition is outstanding, including one that ignores cancellation. Once all acquisitions settle, held and late values are released in reverse dependency order, then capacity returns. An adapter that never settles deliberately retains its prerequisites and reservation; adapters must settle when cancelled. This avoids releasing data still used by pending operations or admitting new work against its ownership. Cleanup exceptions are counted in closure statistics; callers must still make their release implementations actually release resources.

These bytes describe declared lease ownership, not all decoder allocations, browser heap or GPU memory. Shared admission does not introduce a cross-closure acquisition semaphore, eviction policy, transport or cache. Each underlying resource owner keeps its own limits; the texture and model libraries' optional retention and eviction policy is [asset residency](asset-residency.md).

The expedition diagnostic uses a shared 416-byte allowance for two 208-byte closures. Its tests exercise overlap, denial before acquisition and retry after retirement. These numbers are diagnostic data bounds, not device memory recommendations.

## Built-in primitive geometry lifetime

Scene `Shape` geometry has a separate visit-local owner; it does not use the
explicit dependency graph above. Identical primitive kinds and dimensions share
one geometry while their meshes are live. Changing a mesh's dimensions acquires
and assigns its replacement before releasing the previous geometry. Removing the
last mesh using a shape releases that geometry immediately through the existing
scene resource owner; the owner retains live distinct shapes, not every size ever
visited. Transform/color-only updates do not acquire another geometry lease.
Scene exit detaches representations and disposes remaining owned geometry once.
This changes retention, not tessellation, quality, or the creator's mesh budget.

The focused `primitive-geometries.test.ts` tests cover sharing, repeated resizing,
last release, reentrant/throwing disposal and scene cleanup. The additional
**manual, opt-in browser diagnostic** exercises actual composed runtime mutations
and scene exit, observing Three's completed-render and geometry-disposal hooks:

```sh
node -r ./scripts/silent-browser.cjs scripts/play/primitive-retention-check.mjs /tmp/primitive-retention
```

It emits a JSON assertion report and screenshot. It is not part of
`test:ui-browser` or a default gate and must be run explicitly. Its instrumented
Chromium results establish resource lifecycle behavior in the diagnostic scene,
not physical-device performance or acceptance of an application's authored layout.
