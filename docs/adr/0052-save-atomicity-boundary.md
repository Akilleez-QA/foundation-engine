# ADR 0052: Coherent saves before physical section splits

- **Status:** Accepted
- **Date:** 2026-09-28
- **Area:** Persistence
- **Related:** [0007 One save store with typed sections, scopes and migrations](0007-save-store-sections.md)

## Context

Splitting coupled state into separate storage keys invites torn writes that `batch` cannot prevent.

## Decision

- A typed section is an ownership boundary, not a reason to add a storage key. State that must stay coherent stays in one physical envelope.
- `store.batch(fn)` groups flush scheduling only. It is not atomicity.
- Any future multi-key protocol needs one writer and recovery owner, coherent snapshots for readers, and real-store fault injection before adoption.

## Consequences

- STD-SAV-16 stays Provisional until such a protocol is proven.
