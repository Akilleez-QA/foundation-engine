# Inventory

`inventory()` is an optional kit with no frame system, inputs or rendering. `createInventoryLedger({capacities}, snapshot?)` provides a synchronous local ledger for quantity-limited containers, persistent material batches, reservations, transfers and atomic local consume/produce exchanges.

```ts
import { createInventoryLedger } from '@kits/inventory';
const inventory = createInventoryLedger({ capacities: { bag: 20, storage: 100 } });
const ore = { id: 'deposit-a-batch-1', material: 'iron', properties: { conductivity: 12 } };
inventory.transact('pickup-1', [], [{ container: 'bag', batch: ore, quantity: 8 }]);
inventory.transfer('store-1', 'bag', 'storage', ore.id, 3);
inventory.reserve('craft-1', [{ container: 'bag', batchId: ore.id, quantity: 2 }]);
inventory.commitReservation('craft-1-complete', 'craft-1', [
  { container: 'bag', batch: { id: 'plate-1', material: 'plate', properties: { strength: 5 } }, quantity: 1 },
]);
```

A batch's ID, material ID and finite numeric properties remain stable even after its last unit is consumed. The same batch ID cannot be used with different properties. Property names and units are game-authored; the ledger does not invent universal quality scores or physically calculate recipe outputs. `material(id)` returns a copy. Deposit occurrence identity can be represented by a stable batch ID allocated by the game; spatial spawn simulation is separate.

Each operation has a stable transaction ID. Successful exact retries report `{ok:true, duplicate:true}` without applying again; changing the payload under that ID reports `conflict`. Failed operations leave no receipt or partial mutation and can be corrected/retried. IDs are shared across all operation kinds. Operation array order is significant for retry identity; use the same request on retries. Quantities must be positive safe integers, capacities nonnegative safe integers. Fractional units should use an explicitly chosen integer base unit.

`transact(id, consume, produce)` checks all inputs, metadata and final capacities on a draft before committing. Empty consumption supports pickup/rewards; empty production supports disposal. This is an author-controlled helper, not a security boundary: recipes and item creation permissions must be validated by the game/authority before invoking it.

`reserve(id, consume)` locks available units without consuming them. `release(id, reservationId)` cancels the lock. `commitReservation(id, reservationId, produce)` consumes the reservation and creates outputs together. If output capacity fails, the reservation remains intact for retry or explicit release. Released/completed reservation IDs cannot resurrect through retries. `quantity` includes reserved units; `available` excludes them. Transfer and crafting cannot consume another reservation's units.

## Persistence and limits

Persist `snapshot()` through the engine's **existing `defineSaveSection`**. In the section's `parse`, use `createInventoryLedger(options, raw).snapshot()`. Restore validates the version and configured capacities and replays the successful operation history, rejecting invalid transitions or duplicate receipts. Snapshots and incoming requests are copied. Changing capacities requires an explicit migration; it is not silently accepted at restore.

When inventory, mission reward acknowledgement and factory job status must remain coherent, place their snapshots in one physical save envelope. A game can draft a restored ledger, execute a local transaction, and replace that one envelope. This helper does not perform persistence; `SaveStore.batch` does not create cross-envelope atomicity. Check save status and handle unavailable/quarantined saves through the existing store. No exactly-once external delivery or cross-ledger exchange guarantee is claimed.

Cost: zero draws/triangles, no idle work; operations copy current stocks and scan capacities/reservations. History and batch metadata are retained for idempotency, so memory and snapshot size grow with successful operations. Restore replays that history and is intended for bounded sessions/fixtures, not an MMO database or indefinite factory simulation. Use a deliberate retention/checkpoint design before long-lived high-volume workloads; never drop retry receipts casually. Networking, prices, equipment slots, recipe suitability calculations, factory scheduling and UI remain separate responsibilities.

`maxOperations` defaults to 10,000 accepted operations per ledger lifetime. Once full, new operations return `history-full`; matching retries still return their prior receipt. Do not discard receipt IDs to make room without an application generation/archive policy, since that could repeat a past transfer. Restoration rejects histories exceeding the configured bound.

## Explicit checkpoints for long sessions

`createCheckpointInventory` wraps the same ledger with explicit request epochs and compact stock/reservation checkpoints. Call `apply(epoch, operation)`; matching retries deduplicate in the active epoch. `checkpoint()` advances the epoch and retains current stock, active reservations and immutable batch metadata, while old-epoch requests are rejected rather than replayed after their receipt was discarded. Save the entire returned snapshot atomically before publishing the new epoch to request producers.

The default window is 256 operations and 1,024 distinct material identities. `checkpoint-required` and `materials-full` are explicit admission outcomes. Active reservations retain their IDs across checkpoints; do not reuse those IDs. Material IDs cannot be recycled to change historical properties. This bounds operation history, not an infinite universe of unique material identities. Applications archive retired identity generations explicitly. A legacy unversioned producer must migrate to epoch-bearing requests before using this API.

## Optional retirement of qualified identities

`createRetirementInventory(options, snapshot?)` is an additive facade over the
checkpoint ledger. Existing ledgers and producers do not change. Choose this
helper only when the creator can enclose all relevant live references. It does
not prescribe material properties, recipes, item categories or archive policy.

```ts
const owner = createRetirementInventory({
  capacities: { bag: 20 }, maxOperations: 256, maxMaterials: 1024,
  maxReferences: 128,
});
const batchId = owner.qualify('creator-local-name'); // "0:creator-local-name"
owner.apply(owner.epoch, {
  kind: 'exchange', id: 'delivery-1', consume: [],
  produce: [{ container: 'bag', batch: {
    id: batchId, material: 'creator-material', properties: { grade: 2 },
  }, quantity: 1 }],
});
const claim = owner.claim(batchId); // register a job/catalog reference before retaining it
// Consume all units and finish external use before releaseClaim(claim) + retire([batchId]).
```

`qualifiedInventoryId(generation, localId)` and `owner.qualify(localId)` produce
canonical `<generation>:<localId>` IDs (at most 256 characters). The local name may
contain colons. **The owner enforces issuance inside `apply`**: unknown output
identities must belong to the current generation. Known older identities still
require exactly their original material/properties. An unknown historical or
future ID returns `retired-generation`; malformed IDs throw. Qualifying a name
is not a reservation or allocation. Repeated names in one generation denote the
same batch; uniqueness within that generation remains creator-selected.

`claim(batchId)` returns a monotonically allocated numeric claim, or `null` for
unknown material/reference-capacity exhaustion. Separate consumers may claim the
same batch independently. `releaseClaim(claim)` releases only that claim; released
IDs never repeat, including after reload. Treat claims as owner-local: this helper
is not a capability/security boundary and arbitrary numbers are not authority.
The default maximum live references is 1,024. Exhausted safe-integer counters throw
without mutation. Register references held by jobs, catalogs or other owners
before those owners retain the ID, and release only when they truly stop using it.
Unregistered references, older independent saves and remote owners cannot be
observed or protected by this local helper.

`retire([id, ...])` rejects unknown identities (`unknown-material`), registered
references (`referenced`) or any remaining quantity, including reserved units
(`stock`). Duplicate/empty/oversized candidate lists throw. If any candidate fails,
the whole snapshot, stock, metadata, reservations, epoch and receipts remain
unchanged. Success rebuilds stock and active reservations through a copied
checkpoint, removes only eligible metadata there, validates the replacement, then
swaps it in. It increments issuance generation **and** request epoch. Even a fresh
request in the new epoch cannot recreate a forgotten old ID with either its old
properties or different ones. Reusing a local name with the new generation creates
a different identity. Retained older identities can continue to be transferred.

Current-epoch successful retries and conflicting transaction IDs retain checkpoint
semantics. Successful retirement intentionally discards that epoch's receipts;
requests bearing the old epoch fail `stale-epoch`. Ordinary `checkpoint()` advances
only request epoch and preserves issuance generation and metadata. Failed
retirement does not discard receipts. Reserved operation IDs and active reservation
identity behavior remain the underlying checkpoint contract.

Persist the **entire** `snapshot()` envelope (generation, next claim counter,
references and checkpoint) together in the existing `defineSaveSection`. Restore
through `createRetirementInventory(options, raw).snapshot()` in its parser. Save
atomically and check save status before publishing a new epoch/generation to
producers. In-memory acceptance is not a durable commit; this helper adds no
persistence owner, remote transaction or rollback of a creator's other systems.
Do not merge claim tables or checkpoints from different envelopes. Rewinding a
whole application save rewinds this owner too; reconciling later external effects
is an application policy.

No idle/frame work is added. Live identity, operation and claim counts are bounded
by configured limits. Request payload bytes and creator property counts have the
same existing ledger limits; this is not an untrusted-input CPU or byte sandbox.
Retirement copies/replays the bounded checkpoint and scans configured containers
and candidate identities; it is an explicit maintenance operation, not a per-frame
collector. Inputs/snapshots are detached, and reentrant mutation through input
getters throws. The current test evidence is a headless consumer with stock,
reservation and job references, including reload and failed all-or-nothing
retirement; no game, production pipeline or browser integration is implied.
