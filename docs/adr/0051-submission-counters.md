# ADR 0051: Submission counters are report-only until two benches agree

- **Status:** Accepted
- **Date:** 2026-09-28
- **Area:** Performance

## Context

Draw counts alone miss state-change costs, but new counters are noisy until they are proven stable.

## Decision

- The bench probe reports per-frame `useProgram`, programs linked, uniform calls, `bindVertexArray`, `bufferSubData` and texture uploads.
- A counter becomes gated only after two consecutive benches agree within tolerance.

## Consequences

- `scripts/perf/probe-inject.mjs`, `PerfSample.submission`.
