# ADR 0063: Successful installation controls executable availability, not stored identity

- **Status:** Accepted
- **Date:** 2026-09-28
- **Area:** Kernel
- **Related:** [0003 Features are modules loaded through fixed boot phases](0003-module-system-boot-phases.md), [0005 All open sets live in validated registries; content is typed TypeScript](0005-registries-and-typed-content.md)

## Context

Treating a discovered module as installed runs code whose install failed; deleting rows of a failed module loses players' data.

## Decision

- Discovery eligibility and completed installation are distinct kernel states. `app.has(id)` means installed.
- After install settles, the kernel publishes one read-only availability snapshot before `app.started`.
- Definitions keep their identity. `availability.forEntry(registry, id)` decides whether their behaviour may run.
- A failed install never removes save sections, aliases or stored payloads.
- Services and event areas are claimed in the manifest (`serviceKeys`, `eventAreas`) and enforced.

## Consequences

- `core/app.ts`, `core/services.ts` (`Availability`).
