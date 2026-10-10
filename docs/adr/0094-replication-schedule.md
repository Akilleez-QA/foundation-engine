# ADR 0094: optional per-recipient replication schedule

- **Status:** Proposed
- **Date:** 2026-10-09
- **Area:** Optional kits / Network
- **Tracking:** discussion issue linked from the pull request

## Context

Complete scoped views resend every disclosed entity and leave delta encoding and
send priority to creators. The interest sets contract names its own limits: no
priority accumulation or starvation rotation for passed-over ids, no per-entity
update frequency and no delta encoding. A connection with many relevant entities
and a modest bandwidth therefore has no bounded way to send the most important
changes first without starving the rest.

## Decision

Add optional `@kits/replication`: a shared quantized numeric field schema, a
per-recipient schedule that tracks what each entity was last sent to each
recipient, and an order-safe replica for the receiving side. Each build ranks
removals, creations and field-mask updates in one queue by accumulated weighted
priority (updates wait for an acknowledged creation), fits
them to a byte budget (exact JSON length), honours an optional per-entry minimum
interval, and records the packet for acknowledgment or loss. Loss requeues
creations and removals and marks lost fields dirty; values are absolute, so
resending is safe. The replica orders by packet sequence per entity and field and
keeps bounded tombstones with an expiry floor; a per-recipient epoch, announced
by the first packet of each session, voids an earlier session's state.

No transport, timer, loop or registry is added. Interest sets stay the relevance
owner; complete views remain the simpler alternative. This kit's minimum interval is part of building a packet; it does not depend on any separately proposed cadence helper.

## Consequences

Memory and work are bounded by construction-checked limits; overload is reported,
never queued without bound. Packets are JSON with integer fields; binary packing,
bandwidth estimation, acknowledgment format and loss timing are creator choices.
Evidence is headless, including a lossy, reordering composition with interest
sets; browser, WAN and device acceptance are not claimed.
