# ADR 0043: The extension model made true: one folder, folder-local strings, open registries, behaviour bound lazily by id

- **Status:** Accepted
- **Date:** 2026-09-28
- **Area:** Structure
- **Related:** [0036 Feature anatomy: an eager manifest, a lazy body, discovered by folder; shared baselines are sharded](0036-feature-anatomy.md), [0005 All open sets live in validated registries; content is typed TypeScript](0005-registries-and-typed-content.md), [0006 Content packs change content through ordered patches](0006-patch-layer-content-packs.md)

## Context

Extension that still needs a shared file edit (a string catalogue, a union type, a list) is not extension.

## Decision

- Discovery has no list: the glob, plus a test that every feature and pack folder produced exactly one module.
- A pack is `src/packs/<name>/` with the feature anatomy.
- Strings are shards in the folder, merged into generated, gitignored catalogues that the gate rebuilds.
- Closed unions become open registries with validation.
- Behaviour is a row with a lazy implementation, bound by id at an async boundary (`Services.bind`). A missing implementation binds a reported placeholder that keeps its saved data verbatim.
- A pack's problems disable that pack, not the app.
- There is one `StationDef` shape.

## Consequences

- Adding a feature or pack edits no shared file.
