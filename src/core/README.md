# L0 `core/`: the kernel

Module kernel and boot phases, registries and patches, the typed event bus, services and probes, activity runs and the one frame loop, the save store, settings and feature flags, the game clock and seeded randomness, strings, and the router. Imports nothing above L0 (`lint:layers` rule `core-is-bottom`). See docs/STANDARD.md chapters 2–8.

`ecs/` holds the world (entities, components, queries) and the system runner. Its optional change ticks, queued observers and cached queries (`ecs/world-tracking.ts`) allocate nothing until used: [guide](../../docs/guides/world-change-detection.md), [ADR 0170](../../docs/adr/0170-optional-world-change-detection.md).
