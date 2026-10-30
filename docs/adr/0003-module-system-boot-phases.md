# ADR 0003: Features are modules loaded through fixed boot phases

- **Status:** Accepted
- **Date:** 2026-09-28
- **Area:** Kernel
- **Related:** [0004 One typed event bus](0004-typed-event-bus.md), [0005 All open sets live in validated registries; content is typed TypeScript](0005-registries-and-typed-content.md), [0006 Content packs change content through ordered patches](0006-patch-layer-content-packs.md), [0063 Successful installation controls executable availability, not stored identity](0063-boot-availability-without-data-loss.md)

## Context

Hand-wired start-up code grows a positional list of callbacks, and one exception in any install stops the whole boot. Adding a feature then means editing shared files.

## Decision

- Each unit of installable behaviour exports one `EngineModule {id, version, requires, optional, conflicts, provides, serviceKeys, eventAreas, defines, register, patches, install}`.
- Boot runs `discover → register → patch → freeze → validate → install → start`.
- Modules are ordered by `requires`; ties break by layer prefix, then id.
- A module whose install throws is disabled and reported; its dependants cascade; the rest boots.
- The composition root holds only the module lists (ADR 0036).

## Consequences

- A new feature is one folder with zero edits elsewhere.
- Install order is explicit data, not line order in a file.
- `core/app.ts` implements the phases; `core/module.test.ts` and `core/app.test.ts` prove them.
