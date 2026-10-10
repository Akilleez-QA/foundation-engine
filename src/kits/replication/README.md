# Optional per-recipient replication

`@kits/replication` sends each recipient only what changed, ranked to fit a byte
budget. It complements the network kit's
[complete scoped views](../network/README.md#optional-complete-scoped-views): views
are simple and self-healing but resend every disclosed entity; this kit tracks, per
recipient, what each entity's fields were last sent as, quantizes fields so noise
below a step costs nothing, and lets the creator give important entities more of
the budget without starving the rest. It is pure: no socket, timer, loop, ECS
reflection or registration. A game can omit it.

The composition guide is [replication schedule](../../../docs/guides/replication-schedule.md);
the decision record is [ADR 0094](../../../docs/adr/0094-replication-schedule.md).
It fills the limits the [interest sets](../spatial/README.md#interest-sets-sc-02)
contract leaves open: priority accumulation and rotation for passed-over ids,
per-entity update cadence and delta encoding.

```ts
import {createReplica, createReplicationSchedule, defineFieldSchema} from '@kits/replication';

const schema = defineFieldSchema([
  {name: 'x', min: -1000, max: 1000, step: 0.01},
  {name: 'z', min: -1000, max: 1000, step: 0.01},
  {name: 'heading', min: 0, max: 360, step: 1},
]); // example ranges, not required ones; the client uses the same schema
const schedule = createReplicationSchedule({
  schema,
  limits: {maxEntities: 4096, maxRecipients: 64, maxRelevant: 128, maxInFlight: 32, maxItems: 128},
});
// authority, each step: schedule.set(id, [x, z, heading]); schedule.delete(id) on despawn
// per connection: addRecipient(conn); from interest results: relevant(conn, id, {weight, minInterval}) / irrelevant(conn, id)
const b = schedule.build(conn, now, 1200); // built | idle | starved | absent | retired
if (b.status === 'built') send(conn, b.json); // the client acknowledges b.sequence
// on acknowledgment: schedule.ack(conn, seq); when the creator judges it lost: schedule.lost(conn, seq)

const replica = createReplica({schema, limits: {maxEntities: 128, maxTombstones: 256, maxBytes: 65536, maxNodes: 8192}});
const applied = replica.apply(json); // created / updated / removed ids; then acknowledge applied.sequence
replica.read(id, out);
```

## Inputs, outputs and owner

- **Schema.** 1 to 31 numeric fields, each a finite `min < max` and `step > 0`
  with at most 2^30 steps. Values are clamped and stored as step counts; the wire
  carries those integers. Names are unique labels for diagnostics.
- **Authority state.** `set(entity, values)` quantizes once per call (finite values
  or it throws); `delete(entity)` removes it and queues a removal for every
  recipient that knows it. Entity and recipient ids are nonnegative safe integers
  (ECS entities and interest ids fit).
- **Recipients.** `relevant(recipient, entity, {weight = 1, minInterval = 0})`
  starts tracking (a creation is queued) or updates weight and cadence;
  `irrelevant` queues a removal if the client was ever sent the entity, otherwise
  forgets it at once. Re-entering while a removal is pending queues a fresh
  creation with a later sequence.
- **Packets.** `build(recipient, now, maxBytes)` returns JSON
  `{v:1,type:'replica',seq,c,u,r}`: `r` removed ids, `c` creations
  `[id, ...every field]`, `u` updates `[id, mask, ...changed fields in order]`.
  `bytes` equals the JSON's UTF-16 length and never exceeds `maxBytes`. Each
  recipient has its own sequence from 1. `now` is the creator's time (any unit),
  non-decreasing per recipient.
- **Acknowledgment.** The creator's protocol reports `ack(recipient, seq)` or
  `lost(recipient, seq)` (for example after a timeout). Acknowledged creations
  become live and acknowledged removals forget the entry.
- **Replica.** `apply(json)` admits a packet under byte/node/depth bounds and
  validates it against the schema (never throws for content). It keeps, per
  entity, the sequence of its last creation or removal and, per field, the
  sequence that last wrote it, so late, duplicated or reordered packets never
  overwrite newer state; removed ids keep a bounded tombstone so a delayed older
  creation cannot resurrect them.

## Ranking, starvation and cadence

Removals go first (ascending id), then creations, then updates. Every entry with
something to send gains `weight x elapsed` priority per build while it waits;
sending resets it. Ties break by id, so ranking is deterministic. Entries that do
not fit are skipped (`deferred`) and keep gaining priority, so with positive
weights every entry whose item fits the budget is eventually sent. An entry whose
single item is larger than the whole budget is reported `oversize` and is never
sent at that budget. `minInterval` holds an entry's updates (not its creation or
removal) until that much time has passed since its last send; it still gains
priority meanwhile. (A general per-member cadence helper for other work, if a
creator prefers one, composes separately.)

## Bounds, overload and recovery

- **Memory.** Entities `maxEntities` x fields integers; per recipient at most
  `maxRelevant` entries (including pending removals) of fields + 1 numbers, and at
  most `maxInFlight` packets of at most `maxItems` items.
  `maxRecipients x maxRelevant x (fields + 1) <= 2^24` is checked at construction.
  The replica keeps at most `maxEntities` entities and `maxTombstones` tombstones.
- **Work.** `build` is O(entries log entries) for one recipient; one local run
  (Node 26, x86_64, not a gate) measured 0.8 ms per step for 64 recipients x 128
  relevant entries of 4 fields with a third of 4,096 entities moving, about 880
  bytes per recipient per step at a 1,200 budget.
- **Overload.** A full entity table or recipient table reports `saturated`; a
  full relevant set refuses new entries (`saturated`) while pending removals
  drain. Building with `maxInFlight` packets outstanding declares the oldest lost
  (`expired`). A budget too small for the envelope or any item is `starved`.
  Nothing is queued without bound.
- **Loss.** A lost creation is queued again with every field; a lost removal is
  queued again; a lost update marks its fields dirty, so the current value is
  resent. Values are absolute, never relative, so resending is always safe.
- **Lifetime.** `removeRecipient` forgets a recipient and its in-flight packets;
  `dispose` is terminal. There is no asynchronous work to cancel. Invalid host input
  throws before any change.

## Evidence and limits

Eight headless tests: quantization and schema validation; creation, field-mask
updates and sub-step noise; byte budget, weighted priority and no starvation over
60 builds with 20 constantly changing entries (no entry waited more than 20
builds); cadence; loss of creations, updates and removals and in-flight expiry;
oversize entries; replica ordering, duplicates, tombstones, saturation and
malformed packets; and a composition in which `@kits/spatial` interest sets drive
two moving recipients over a link that drops 20 % of packets, duplicates 5 % and
reorders them. After a lossless settling period both replicas equal the
authority's quantized state for exactly their relevant sets. Over that run the
replication packets totalled 48,306 characters against 547,046 for complete views
of the same relevant sets.

Not established: transport, acknowledgment protocol and loss timing (creator
choices), binary encoding (packets are JSON with integer fields), bandwidth
estimation, client presentation (see the optional playout kit where available),
browser, WAN or device behaviour.
