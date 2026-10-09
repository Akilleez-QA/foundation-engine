# Durable interaction continuation lab

Headless, unexported creator composition using existing dialogue, inventory,
objectives and SaveStore APIs. No public kit, registry, scheduler or quest engine
is added. The two authored consumers are a repeatable conversation reward and a
one-time interaction unlock. Text keys and effects are fixture data, not UI.

The requirement is to retain an accepted choice's undelivered work across reload,
without giving an old callback authority over a new owner. Dialogue already checks
session/revision/node and emits effect intents. Inventory already deduplicates
operation IDs; objectives already deduplicates event IDs. The adapter supplies the
small missing composition: those facts share a single validated save envelope.

Run from the repository root:

```sh
node --import tsx --test tools/interaction-continuation-lab/continuation.test.ts
npx tsc --noEmit -p tools/interaction-continuation-lab/tsconfig.json
```

## Contract and ownership

`fixture('reward' | 'unlock', maxIntents?, capacity?)` supplies a SaveSection and an
owner factory. The scene/interaction creates one owner for the current player,
passes its AbortSignal, and disposes it on exit or before replacement. Disposal
removes the player-change and abort subscriptions. A player change permanently
retires it, even if the player later switches back. The application owns the
SaveStore lifetime and must retire interaction owners before disposing the store.
Do not create competing live owners over one section.
An external section replacement, import or reset changes the immutable SaveStore
value identity. The next owner operation detects this and permanently retires its
tickets, even if the new envelope reuses an old stable intent ID. Recreate the owner
after such replacement; stable sink IDs do not themselves authorize callbacks.

`choose` uses the real dialogue reducer on a detached candidate, constructs stable
intent IDs from fixture session and pre-choice revision, then saves the combined
state. `begin` returns an opaque exact-object ticket for the first unacknowledged
intent only when the section status is saved. `deliver` executes the existing
inventory transaction or objective record on a candidate and saves its receipt
together with changed sink state. `acknowledge` requires delivery and saves the
acknowledgment; it does not apply the effect again. Repeated delivery before
acknowledgment uses the same durable sink ID and returns a duplicate result.

Tickets are runtime-only. A copied, foreign or retired ticket is refused. Reload
creates fresh tickets from saved pending work. Aborting an owner retires its
callback authority; it deliberately does not erase already accepted obligations.
An explicit product policy would be needed for abandoning those obligations.

The lab chooses synchronous one-envelope delivery. It has no network, separate
database, asynchronous external sink, worker, animation or browser integration.
Unlock state is the real objective's completion state, rather than a separate
mutable door flag. Rewards use the real inventory ledger's stock and operation
receipt. A game must route its authoritative reads through this saved owner; a
second unsynchronized inventory or world flag would break the demonstrated scope.

## Checkpoints and interruption windows

| Interruption point | Durable state | Recovery |
|---|---|---|
| Before choice | Original dialogue, no intent | The choice can be made normally |
| Choice saved, before delivery | Advanced dialogue and pending intent | Create a fresh ticket and deliver |
| Delivery saved, before acknowledgment | Sink mutation and receipt, intent still pending | Retry yields duplicate, then acknowledge |
| Acknowledgment saved | Sink receipt and acknowledged intent | No pending ticket or repeated effect |
| Any injected write failure | Previous durable envelope; newer candidate may exist in this tab | Block further work until `checkpoint` succeeds, or reload old envelope |

SaveStore reports a failed write as session-only state. `save-failed` does **not**
mean rollback: the candidate remains in memory, and the UI must not announce it as
durable. `checkpoint` retries existing SaveStore work. Quarantined, unavailable
or newer-version sections block work rather than overwriting fallback state. Tests
simulate a crash by copying committed MemoryBackend bytes into a fresh store,
before calling disposal (which would otherwise attempt a final flush).

Mutation and its receipt are coherent here because both reside in the same physical
SaveStore envelope. Several section writes are not a transaction. This is not a
claim of exactly-once delivery to arbitrary external effects, power-loss durability,
multi-tab conflict safety, remote authority or rollback of other owners. A sink
that cannot atomically persist its mutation and receipt has an unresolved crash
window; do not hide that by persisting only a local acknowledgment.

## Bounds, refusal and validation

`maxIntents` is an integer from 1 to 8 (default 4). At most that many intent records
and sink receipts survive, plus one closing choice. Each authored choice emits at
most one intent. Inventory capacity is 0 to 8 (default 8). The fixture uses fixed
definitions, keys, batches and event names; these ceilings are lab configuration,
not new constraints on existing kits or creator worlds.

Saturation refuses before dialogue publication. Inventory capacity refusal retains
pending work and cannot be acknowledged. The parser replays bounded choices through
real dialogue and reconstructs admitted sink operations/events through their real
reducers, then compares all coupled facts. Missing inventory/objective fields,
orphan receipts, mismatched dialogue, out-of-order delivery and acknowledgment
without delivery are rejected. SaveStore owns quarantine and storage failures.
Canonical serialized shapes are intentional for this version; migrations are not
implemented. Parsing is not an arbitrary JavaScript/proxy sandbox or a raw input
byte-budget guard. Work and retained records are bounded, not measured CPU/heap
deadlines. Each operation may replay the small history; there is no idle work.

## Evidence and next decision

Twenty-one headless tests pass: both consumers at four interruption points, failures
at all three write points, retry deduplication, refusal, saturation, stale/copy/
replacement tickets, envelope rewind, player-switch retirement, malformed snapshots and actual
SaveStore quarantine. Scoped strict TypeScript checking also passes. No full CI,
browser, visual, physical-device, sustained performance or runtime playability
acceptance is claimed.

This is an experiment, not a proposed universal quest engine. The authored replay
validator deliberately understands these two consumers. Extending it to arbitrary
effects would require a creator-defined schema, revision/migration policy and
documented sink guarantees. Review this composition before deciding whether any
shared helper is warranted. The [proposal](ISSUE.md) records that decision.
