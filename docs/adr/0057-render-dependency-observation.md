# ADR 0057: Render dependencies are observed, never guessed

- **Status:** Accepted
- **Date:** 2026-09-28
- **Area:** Render
- **Related:** [0056 Change trackers observe batches and skeletons](0056-trackers-observe.md)

## Context

A dirty-flag protocol that features must remember to call silently freezes the picture when one is forgotten.

## Decision

- Trackers observe; unknown dependencies force colour and shadow updates.
- Private engine state is read through one pinned adapter.
- A dirty flag never replaces a complete scan without proof that it covers every supported mutation.
- Features need no reporting protocol.

## Consequences

- STD-REN-38.
