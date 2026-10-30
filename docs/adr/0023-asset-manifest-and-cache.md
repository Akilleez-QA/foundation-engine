# ADR 0023: One asset manifest with size variants, provenance and a shared cache

- **Status:** Accepted
- **Date:** 2026-09-28
- **Area:** Assets

## Context

Assets loaded by path from anywhere cannot be deduplicated, licensed or sized to the screen.

## Decision

- Each asset has a definition: id, kind, licence, author, source, colour space and variants.
- `platform/assets/` picks the smallest adequate variant from a reference-counted lease cache, with decoding on the worker host.
- Third-party notices are generated from the definitions.
- Lint: `texture-loader` is owned by `platform/assets/`.

## Consequences

- A shipped file without a licence fails the build once a game adds its asset build step.
