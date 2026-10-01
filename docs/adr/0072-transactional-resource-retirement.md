# ADR 0072: transactional resource publication and retirement

- **Status:** Accepted
- **Date:** 2026-09-30
- **Area:** Asset leases and renderer resources

## Decision

A cache entry and its real readiness promise are registered before invoking a loader.
Its initial reference and cancellation listener are installed before fetch starts.
Fetch still starts immediately, while synchronous failure and same-key reentrant
acquisition now observe a valid ownership record.

Upload takes ownership of decoded data at call entry. The cache must not discard
that data again if upload throws. Once upload returns a resource, the cache owns
retirement even if accounting fails or the last requester cancels inside upload or
accounting. Publication requires the original entry to remain current after both
callbacks. Invalid byte accounting rejects acquisition and retires the allocation.

Entries are detached before abort or disposal callbacks. Stale cleanup cannot delete
a replacement for the same key. A new resource publication does not run unrelated
warm eviction callbacks that could reject acquisition after creating live ownership.

Eviction checks entry identity and references immediately before retirement. Warm
bytes are maintained across acquire, release and retirement; ordinary eviction does
not rescan the map for every candidate. A reentrant drain uses a finite snapshot of
ready entries, retiring each at most once. Additional passes must retire an original
candidate; callback-created loads cannot extend the synchronous drain indefinitely.
Nested full eviction upgrades that drain. Explicit budget changes made by callbacks
remain in effect afterward.

Texture retirement captures the original decoded image before notifying disposal
listeners. Texture disposal and bitmap close are independently attempted, and both
errors remain observable. A callback replacing the image does not transfer ownership
of the replacement to this cleanup operation.

## Acceptance and limits

Regressions exercise synchronous failure and retry, same-key acquisition and
replacement, cancellation in preparation callbacks, failed accounting, throwing
cleanup, live reacquisition during eviction, and release during a nested drain.
Existing variant selection, lease shape and performance ceilings remain unchanged.

This establishes ownership correctness; it does not make arbitrary loader callbacks
cheap or safe to block. Reentrant mutation can require additional bounded passes over
the original candidates. Physical GPU/context behavior remains distinct from these
callback and accounting tests.

Cancellation before lease delivery always settles the acquisition as an AbortError;
if retirement fails, its error is retained as the cause. Explicit release continues
to report aggregate cleanup errors. After delivery, errors from signal-triggered
release retain the existing host AbortSignal reporting behavior; this change does
not introduce a separate resource-error notification API.
