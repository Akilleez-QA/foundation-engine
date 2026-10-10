# Replication schedule: per-recipient deltas under a byte budget

Complete scoped views resend every disclosed entity whenever anything changes.
When many entities are relevant to many connections and only some change, the
optional [`@kits/replication`](../../src/kits/replication/README.md) kit sends each
connection only the fields that changed, quantized, ranked to fit a per-packet
byte budget, with loss recovery. This guide composes it with existing owners; it
adds no loop, timer, socket or service.

## 1. Agree a field schema

Both sides call `defineFieldSchema` with the same fields (ranges and steps). A
step is the smallest change worth sending: 0.01 world units for a position, one
degree for a heading, 1 for a small state number. Put identity-like or rarely
changing data that does not fit a numeric field in a complete view or a separate
reliable message.

## 2. Feed authoritative state

In the authority's fixed-step system, after simulation: `schedule.set(id, values)`
for each replicated entity and `schedule.delete(id)` when one despawns.

## 3. Drive relevance from interest sets

For each connection, the [interest sets](../../src/kits/spatial/README.md#interest-sets-sc-02)
update reports `entered` and `left` ids. Call `relevant(conn, id, {weight})` for
entered ids (a higher weight for nearer or more important ones, perhaps from the
interest tier) and `irrelevant(conn, id)` for left ids. Interest decides **who
knows what**; this kit decides **what to send next** within the budget.

## 4. Build, send, acknowledge

On the connection's send cadence (for example each network tick):

```ts
const b = schedule.build(conn, simTime, budgetBytes);
if (b.status === 'built') transport.send(conn, b.json);
if (b.oversize) report('a single entry exceeds the budget'); // creator policy
```

The client applies packets with `replica.apply(json)` and acknowledges
`applied.sequence` only when the status is `applied` (`expired` and
`stale-epoch` packets must not be acknowledged). When a connection is replaced,
`removeRecipient` then `addRecipient` starts a new epoch; a reused client replica
discards the old session's state when the new epoch's first packet arrives. On acknowledgment call `schedule.ack(conn, seq)`; when the
creator's protocol judges a packet lost (an acknowledgment timeout, or a gap after
later acknowledgments), call `schedule.lost(conn, seq)`. On a reliable ordered
transport packets are never lost, and the budget and ranking still apply.

## Choices that stay with the creator

- Field ranges and steps (precision against bytes).
- `weight` per connection and entity, and `minInterval` for slow-changing ones.
- The byte budget per build and how often to build.
- The loss rule and acknowledgment format.
- What the client presents between packets (for example a playout buffer).

## Limits

Packets are JSON with integer fields, not a bit-packed binary format. The kit does
not estimate bandwidth, pick a transport, or establish browser, WAN or device
behaviour. Its evidence is headless tests including a lossy composition with
interest sets; see the [kit contract](../../src/kits/replication/README.md#evidence-and-limits).
