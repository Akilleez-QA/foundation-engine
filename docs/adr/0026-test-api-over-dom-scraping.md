# ADR 0026: Verifiers use a typed test API, not DOM scraping

- **Status:** Accepted
- **Date:** 2026-09-28
- **Area:** Testing

## Context

Tests that scrape DOM text or read serialised state from attributes break with every copy change and cost frame time.

## Decision

- `dev/test-api.ts` installs `window.engine` in development and test builds only, never in production.
- It provides `ready`, `modules`, `probe`, `probes`, `registry`, `goto`, `events` and `save.export`.
- State is read on demand from registered probes (`core/probe.ts`).
- Serialising state into `dataset` is banned by lint (`dataset-json`).
- The scene shell marks `#app[data-scene][data-scene-state]` with plain tokens (not serialised state), for the bench's readiness wait.

## Consequences

- Product code never imports `dev/` (lint).
