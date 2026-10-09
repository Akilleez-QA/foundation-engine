# ADR 0085: atomic cell batches and immutable raster occupancy

- Status: Proposed (candidate implementation)
- Date: 2026-10-09
- Area: Optional procedural data and spatial queries

## Decision

Extend existing sparse cell edits with bounded revision-checked batch publication.
Add pure immutable occupancy queries to spatial helpers, without another kit
registration or world/scheduler/persistence owner. Creators classify materials,
choose outside policy and compose existing derived-resource preparation.

Single-cell loops cannot provide atomic region admission. A point spatial index
does not represent a dense occupancy raster, and a scalar heightfield cannot
represent arbitrary cavities. Reusing existing storage and adding focused queries
avoids a second world model. Batches preserve the encoding and refuse revision
exhaustion; publication uses staged sparse state. Segment queries use bounded
supercover traversal and exact dyadic ordering, with explicitly rounded output.

## Costs and evidence

Changed batches cost O(existing edits + batch); snapshots copy one byte per cell.
Segment work scales with crossed cells and a configured cap; BigInt operand sizes
are bounded by the admitted Number domain but no wall-time guarantee is made.
The [guide](../guides/cell-occupancy.md) specifies contact ties, refusal, ownership,
limits, two consumers, persistence failure tests and independent geometric oracles.
This is neither a durable transaction nor a renderer/physics replacement.
