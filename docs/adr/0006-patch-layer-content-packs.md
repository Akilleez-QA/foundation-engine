# ADR 0006: Content packs change content through ordered patches

- **Status:** Accepted
- **Date:** 2026-09-28
- **Area:** Kernel
- **Related:** [0005 All open sets live in validated registries; content is typed TypeScript](0005-registries-and-typed-content.md), [0043 The extension model made true: one folder, folder-local strings, open registries, behaviour bound lazily by id](0043-extension-model.md)

## Context

Seasonal or optional content should not edit the files that own the base content, or packs cannot coexist.

## Decision

- A `Patch` targets registry entries by id or predicate, and declares `needs`, `before` and `after`.
- Patches apply in the patch phase, in dependency order and deterministically. Each change is logged against its source pack.
- `final` patches are reserved for `pack.*` modules and checked at boot.
- A pack's failing patch or row disables that pack and rolls back its entries (ADR 0043).

## Consequences

- The patch log shows which pack changed which field.
- `core/patch.ts` and `core/patch.test.ts`.
