# ADR 0086: Bounded optional work roster

Status: Proposed

## Context

Creators need finite fair visits over changing registrations in both entity
observation and worksite inspection. Restarted queries can starve later entries;
numeric cursors shift on removal. Existing route queues own path-search work,
while the system runner owns time. Neither should acquire another responsibility.

## Decision

Expose an optional pure `@kits/work-roster` helper with finite admission, ordered
rotation and exact runtime membership tickets. It owns no callbacks, clocks,
payloads, entities or result revisions. Return bounded immutable batches and let
the creator drive them through existing systems. Do not install an empty kit
registration. Two headless consumers graduate the shared invariant without
imposing gameplay policy or a new framework service.

A maintained application recipe remains suitable when creators need different
fairness semantics. Centralizing this specific contract avoids duplicating
membership/refusal logic. This is a bounded allocating preparation helper, not
an allocation-free numerical hot path (STD-SIM-24).

## Consequences

Exact tickets cannot be saved, transferred or recreated by copying. Consumers
own fresh registration after load, association cleanup and result freshness.
Map entry/visit counts are logical bounds, not native memory or CPU guarantees.
Tests use an independent order model and real World/runner effects. Public API
admission and lifecycle tests are distinct from hosted integration and physical
device acceptance, which remain separate obligations.
