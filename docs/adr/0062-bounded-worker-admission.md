# ADR 0062: Bounded worker admission, physical cancellation and current-owner delivery

- **Status:** Accepted
- **Date:** 2026-09-28
- **Area:** Workers
- **Related:** [0059 One worker host; pure, keyed, cancellable jobs; the frame never waits on a worker](0059-one-worker-host.md)

## Context

An unbounded job queue exhausts memory, and a cancelled job that keeps running still blocks capacity.

## Decision

- Admission precedes allocation. The host bounds running slots, pending requests and reserved bytes. Supersession is scoped by owner, job kind and key.
- Authored `materialise()` is a reentrant lifetime boundary. Worker-bound entries remain discoverable as pending until it returns; cancellation, owner shutdown, host disposal or supersession during allocation prevents posting the payload and releases its reservation once. The inline fallback rechecks the same authority before constructing slices. A cancelled payload is never revived as running.
- Distinct `(kind, key)` version histories are bounded per owner signal by `WorkerHostOptions.maxKeysPerOwner` (default 4096, configurable nonnegative safe integer; zero disables keyed admission). A new identity at capacity resolves `saturated` before recording history, cancelling work or materialising payloads. Known identities remain usable and older versions remain superseded. Histories are not evicted when jobs finish: they are weakly owned by the signal lifetime so stale requests cannot become current again.
- Observing a version below the history limit preserves the existing ordering: its high-water mark is retained and previous same-key work is cancelled before execution-capacity admission. Thus a later pending/byte saturation still retains that observed version and consumes its identity slot. Already-aborted and individually oversized requests return before observing history. Completing jobs does not free history slots; applications reuse stable keys, configure a suitable limit or deliberately start a new owner lifetime. Unkeyed jobs are unaffected. This bounds retained identity count, not caller-supplied key-string length or the total number of live owners.
- Cancellation invalidates delivery at once and stops execution within a bound. An unsliced job is terminated and its worker replaced.
- Keyed versions must be finite numbers; negative and fractional finite versions remain valid. Invalid versions throw before history mutation, so a non-orderable NaN cannot poison a retained high-water mark.
- Delivery re-checks the owner and version. Invalid results are released exactly once.
- Foreground and background classes keep speculative work from starving current work.

## Consequences

- `platform/workers/pool-sizing.ts`, `host.ts` with tests.
