# ADR 0067: shared dependency admission

Status: Accepted

## Context

A per-owner dependency limit does not bound overlapping owners. An active visit and a pending preflight can each satisfy their individual limit while exceeding their application's aggregate allowance. Cancellation also does not imply that an asynchronous acquisition has physically released its resources.

## Decision

The asset layer provides an explicit shared byte-admission owner. Applications inject the same owner into every dependency closure that belongs to one allowance. Construction reserves the entire validated graph's declared upper bound atomically, before any acquisition starts. Saturation rejects synchronously; the caller decides when to retry. Existing per-closure limits and concurrency limits remain enforced.

Reservations cover pending, ready and optional dependencies conservatively. They remain charged until the closure is closed and all its outstanding acquisitions settle. Closing hides values immediately but retains prerequisites still used by pending acquisitions; once all settle, reverse dependency cleanup releases held and late results before returning capacity. An acquisition that never settles retains this ownership deliberately. Releases are idempotent. One closure's cancellation cannot release another closure's reservation.

The shared allowance is not a global singleton or a resource cache. Equal dependency ids in separate closures are not assumed to share physical storage. Existing asset caches retain resource identity and ownership; conservative double charging is intentional. Callers explicitly choose application scope and account for overlap during preflight.

## Adjacent decode admission

Image decoding treats capacity rejection as a terminal admission outcome, never a reason to bypass the worker limit with an unbounded local decode. Each decoder admits at most four concurrent logical requests and 64 MiB of declared output across worker and local capability-fallback paths, with a conservative 16 MiB reservation when dimensions are unknown. A local fallback retains its charge until it settles. A cancelled worker request can resolve before physical work stops; the worker host independently retains the physical cancellation charge, so the decoder request limits do not claim to bound that remaining worker work. Supplied dimension hints must be finite and positive; decoded outputs are checked and oversized bitmaps are closed. Capability absence may use the local path subject to the same local allowance. These are declared output bounds, not a guarantee about native decoder peak memory. The existing worker host continues to own physical cancellation accounting.

## Evidence

Platform tests exercise atomic admission, invalid inputs, cancellation, late settlement and throwing cleanup. The diagnostic template shares one allowance between an outgoing owner and an incoming preflight. Its regression tests prove that saturation starts no acquisition, retained data remains available, and disposal restores capacity for a retry. Existing render and scene limits are unchanged.
