# Production output exchange and unique custody

The optional resources kit accepts explicit inventory exchanges through the existing
production owner. This closes a composition gap: factory output can leave its
container without editing the production snapshot behind its replay validator.
Creators supply quantities, batches, container names and conversion policy. The
framework does not decide recipes, item definitions, pricing or who may transfer.

```ts
const result = model.apply({
  kind: 'exchange', id: 'claim-17',
  consume: [{ container: 'products', batchId: 'plate-v1', quantity: 1 }],
  produce: [],
}, model.epoch);
```

`exchange` uses the checkpoint inventory already owned by `createProduction`.
It supports withdrawal, replenishment and exact material transformation. Produced
batches retain immutable material facts under their identities. Empty sides are
allowed; an empty exchange still consumes a successful command receipt. This is
a creator-authorized ledger operation, not a network authorization check or a
physical conservation law.

## Bounds and publication

Each exchange admits at most 64 consumption rows, 64 output rows and 64 numeric
properties per output. Field validation reuses the inventory parser. Quantities
must be positive safe integers; inventory identities have the existing 256-character
bound and production command IDs retain the resources identifier convention.
Caller arrays are captured by index under a mutation guard; overridden array methods
are not called. Invalid rows/properties throw. Unavailable stock, conflicting batch
facts, full containers or exhausted material identity capacity reject without changing
accepted production state.

Accepted exchange does not advance any job clock, partial cycle, completed count
or deposit reserve. Its successful result has `throughTick: null`, `produced: 0`
and `pending: false`. Existing job commands retain numeric `throughTick`. The null
value explicitly distinguishes an inventory operation from a time segment.

Exchange shares the existing command history limit, 256 by default and configurable
through 4096. Exact command retries in the current epoch return the recorded result
with `duplicate: true`; changed payloads under that ID return `conflict`. Imported
batch identities count toward the 1024 known-material bound and all later container
capacity calculations, including after checkpoint restoration. Identities remain
reserved even after their quantity reaches zero. This retains the production owner's
existing bounded, non-retiring material namespace.

Checkpoint is an explicit boundary: persist the complete returned state before
accepting commands at the new epoch. Earlier epochs reject as `stale-epoch` before
reading command payloads. Restoration replays exchanges alongside production and
configuration history. Directly editing the inventory portion remains invalid.
Older snapshots remain readable; older engine versions cannot replay the new command.
An application distributing saves across versions must establish its own compatibility
or migration policy.

Work remains bounded by admitted rows, retained material identities and current
history. Restoring/copying the existing ledger for a candidate is not constant time.
These are count bounds, not a measured CPU-time or multiplayer scale guarantee.

## Composing a unique item

Use an application-owned envelope containing production, equipment and a delivery
receipt. Restore temporary production and equipment owners from that envelope;
check unique-item acquisition and the production exchange; stage the **complete**
next envelope through the existing authored document. Publish through one SaveStore
section. Updating unrelated save sections separately does not provide this boundary.

The receipt must retain the creator-selected item facts and command identity. A
changed item definition on a retry is a conflict, not permission to regenerate the
item from the latest catalog. Equipment capacity failure leaves accepted stock
unchanged. Rendering and equipping are later projections of accepted custody.

Once a candidate has been passed to external persistence, a failed return does not
prove that nothing was accepted: SaveStore can retain dirty data for a later flush.
Retain the exact candidate, prevent other publications, and retry it or reload the
whole envelope. Do not discard it and publish a competing candidate. Before the
first external attempt, cancellation may discard the unpublished candidate safely.
The production exchange itself is synchronous and has no cancellation queue; a
later reverse transfer is a new creator-selected operation.

`src/kits/resources/production-exchange.test.ts` demonstrates this composition with
the real SaveStore and its memory storage adapter. It exercises full custody,
unchanged accepted state on rejected publication, identical retries after write
failure, pinned item facts, reload, duplicate/conflicting delivery and equipment
adoption, unequipping and restored custody. Its parser cross-checks the exact
production history against delivery presence; a fabricated receipt with unconsumed
stock rejects. This finite example deliberately retains epoch zero (one production
segment and one delivery) and exposes no checkpoint. Applications needing compaction
must define a coherent receipt/checkpoint migration instead of dropping that proof.
Other focused cases exercise epoch rejection, checkpoint replay, imported
batch capacity, capture bounds and reentry. The consumer is finite test/application
code, not a new global transaction owner or durable exactly-once distributed service.
No browser, UI, network authority or physical-device acceptance is claimed here.
