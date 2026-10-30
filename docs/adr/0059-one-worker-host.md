# ADR 0059: One worker host; pure, keyed, cancellable jobs; the frame never waits on a worker

- **Status:** Accepted
- **Date:** 2026-09-28
- **Area:** Workers
- **Related:** [0062 Bounded worker admission, physical cancellation and current-owner delivery](0062-bounded-worker-admission.md)

## Context

Ad hoc workers outlive their screen, duplicate threads and invite frames that await results.

## Decision

- `platform/workers/` is the only code that creates workers (lint: `new-worker`). It hosts one pool of generic workers that load registered job modules on demand, and knows no game noun.
- A job is a pure function of its request. Every run takes the caller's AbortSignal. A newer job with the same key supersedes the older one. Payloads travel as transferables.
- The frame never waits: results are picked up by the next frame that finds them.
- A failure rejects with a named error, and each job kind declares its fallback.
- The pool is sized from the hardware's concurrency, with a warm minimum, and grows on demand.

## Consequences

- `platform/workers/host.ts`, `platform/assets/decode-image.job.ts`.
