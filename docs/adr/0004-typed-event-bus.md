# ADR 0004: One typed event bus

- **Status:** Accepted
- **Date:** 2026-09-28
- **Area:** Kernel
- **Related:** [0003 Features are modules loaded through fixed boot phases](0003-module-system-boot-phases.md)

## Context

Untyped DOM custom events drift in payload shape, are dispatched on inconsistent targets, and invite polling.

## Decision

- `core/events.ts` provides `on/emit/tap` over an interface `EngineEvents` that each module augments in its own folder.
- Names follow `<area>.<verb-past>` or `<area>.<noun>.<verb-past>` (`scene.entered`, `player.changed`).
- Each area is reserved by one owning module (`eventAreas`), and the kernel's scoped `emit` enforces it (ADR 0063).
- Events report the past; commands are service methods. Nothing is emitted per frame.
- Delivery is synchronous, in subscription order, and a throwing listener is isolated.
- Listeners take an AbortSignal for cleanup.

## Consequences

- The compiler checks every payload.
- DOM events remain only for DOM concerns such as focus and resize (lint: `custom-event`).
