# ADR 0031: Layers with a presentation-kit layer, content packs and ports for upward needs

- **Status:** Accepted
- **Date:** 2026-09-28
- **Area:** Structure

## Context

Without enforced direction, shared code accretes game nouns and features import each other.

## Decision

- The layers are `L0 core/ → L1 platform/ → L2 domain/ → L2.5 kits/ → L3 features/ and packs/ → L4 app/`, plus `content/` (data, type imports only), `dev/` and `testing/`.
- `platform/` knows no game noun.
- A kit is shared presentation of domain things. It needs two feature importers and never imports a feature.
- Packs follow the rules of features.
- Ports are the only upward mechanism. The lower layer declares a small interface (`LayerPort`, `SurfacePort` in `core/activity/ports.ts`) and the higher layer implements it.
- `scripts/lint/layers.mjs` enforces the imports; `scripts/lint/architecture.mjs` ratchets owned capabilities.

## Consequences

- A feature can be deleted without touching another feature.
