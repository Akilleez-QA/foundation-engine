# ADR 0001: Record architecture decisions as ADRs

- **Status:** Accepted
- **Date:** 2026-09-28
- **Area:** Process

## Context

A game grows through many parallel streams of work. If decisions live only in commit messages and chat, later work re-argues them or breaks them without knowing.

## Decision

- Every decision that shapes structure, data formats, ownership or budgets gets a numbered ADR in `docs/adr/`.
- Status is Proposed, Accepted, Superseded by NNNN, or Rejected.
- ADRs are never rewritten. A new ADR supersedes or amends an old one.
- The standard (`docs/STANDARD.md`) cites the ADRs it codifies.

## Consequences

- People and agents read one index before changing structure.
- A review can reject a change that contradicts an Accepted ADR, unless the change comes with a superseding ADR.
