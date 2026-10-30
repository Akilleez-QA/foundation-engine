# ADR 0005: All open sets live in validated registries; content is typed TypeScript

- **Status:** Accepted
- **Date:** 2026-09-28
- **Area:** Kernel
- **Related:** [0006 Content packs change content through ordered patches](0006-patch-layer-content-packs.md), [0043 The extension model made true: one folder, folder-local strings, open registries, behaviour bound lazily by id](0043-extension-model.md), [0063 Successful installation controls executable availability, not stored identity](0063-boot-availability-without-data-loss.md)

## Context

Hand-written constant tables scattered across files validate nothing, and extensible sets written as closed unions force edits in many places.

## Decision

- `defineRegistry<T>(name, {validate, problems, aliases, idForm})` is the single primitive.
- Content is typed TypeScript, so the compiler checks it and bundling can split it by scene. JSON is only for large generated data and text shards.
- Registries are created per app from their owner module's `defines`, and freeze after the patch phase.
- Validation throws in development and test builds (`BootValidationError`). In production it drops the entry and reports it.
- Ids are lowercase kebab-case and are never renamed; aliases carry renames. Ids that are already save data keep their stored form.
- Rows are eager and data-only. Heavy payloads are `Lazy<T>` fields.

## Consequences

- Adding a scene, panel, reward or action is one data row.
- `src/app/registries.test.ts` validates every registry from the frozen boot, with no edit per new registry.
