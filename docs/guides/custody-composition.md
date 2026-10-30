# Coherent custody composition sample

The optional `tools/custody-composition` consumer demonstrates a creator-owned
publication protocol across the existing equipment, resource materialization,
retirement inventory, AuthoredDocument and SaveStore contracts. It does not add an
inventory service or prescribe a game's item types, containers, crafting rules,
network authority or persistence policy.

This finite sample chooses four authored identities, one equipment slot, one bag
slot, fixed world positions, two input units and one pinned output definition.
The creator can replace those choices. Changing the authored catalog or rules
requires an explicit saved-data migration or a new section; silently loading an
old record against a different catalog is not supported.

## Authority and publication

`createCustodyController({saveHandle, readPersisted})` retains exactly one visible
AuthoredDocument. `preview({epoch, id, payload})` reconstructs temporary kit owners
from its accepted snapshots. These owners may locally publish private proposals,
but neither storage nor rendering observes them. They are closed immediately.
The resulting full envelope becomes an authentic document candidate, not a visible
change. Multiple unattempted previews can coexist; publishing one makes older
candidates stale through exact document-ticket identity.

Every action follows the same protocol:

1. Preflight location, identity, capacity, reservation, command history and pinned
   material facts. Refusal changes neither accepted state nor SaveStore memory.
2. `commit(candidate)` locks that exact candidate before calling SaveStore. The
   full envelope is written as one section. SaveStore may retain dirty memory and
   retry after failure; the visible document still contains the old envelope.
3. `read()` reports `pending`, `saveStatus`, `durable` and `canAcknowledge`. It never
   publishes. `durable` describes the accepted visible envelope; it can be false
   while a newer candidate is durable and awaiting acknowledgment.
4. `retry()` writes the identical retained candidate without rerunning consumption,
   issuance or checkpoint advancement. `acknowledge()` publishes only when the
   physical section has version 1, validates as the complete exact candidate, and
   SaveStore reports `saved`. A `saved` initial default with no stored bytes is not
   durability. A background successful flush alone does not publish gameplay.
5. Once a write has been attempted, cancellation and competing edits are refused.
   An unattempted candidate can be cancelled. `dispose()` retires the document
   authority; the caller then disposes its SaveStore, whose final flush may write
   the pending envelope. Reload restores whichever coherent version reached
   storage. Disposal is not a promise to undo an attempted write.

The observer projects only accepted state: `view.world`, `view.bag`,
`view.equipped`, `view.reservation`, `view.stock` and `view.issued`. Accepted
projection objects are cached by immutable document identity; previews never
replace that cache. Physical save parsing is cached by the raw bytes while status
and external changes are still observed on every read.

## Commands and bounded history

Commands have `{epoch: number, id: string, payload}`. IDs contain 1–64 characters.
The payloads are:

- `{kind: 'pickup' | 'drop' | 'equip' | 'unequip', item}`.
- `{kind: 'reserve'}` reserves one input unit with definition revision 1 pinned.
- `{kind: 'settle' | 'cancel-reservation', request}` references the accepted serial.
- `{kind: 'checkpoint'}` advances the retry epoch.

The sample's `crafted` identity is issued only once. Settle first checks equipment
capacity, then privately settles the reservation and withdraws the exact output
batch into that identity. The envelope combines consumption, selected definition,
output withdrawal, equipment and permanent issuance. A capacity failure leaves the
accepted reservation editable and cancellable. Equipping may displace another
item only if the resulting bag fits; dropping requires an unequipped bag item.

Current-epoch receipts are bounded at 16; a checkpoint can clear them. The lifetime
replay journal is bounded at 64 successful actions **including checkpoints** and
is not compacted. At the bound the sample refuses further actions. This is an
explicit finite demonstration, not an unlimited persistence design. Checkpoints
preserve issuance and input-consumption evidence. Older epochs are refused; an
exact same-epoch retry returns `duplicate` even after the item has been dropped
again, without moving it. Reusing an ID for another payload is a conflict.

The saved section is bounded to 131,072 characters; the document also bounds
UTF-8 bytes to 131,072, nodes to 16,384 and depth to 24. Kit owners separately
retain their declared capacities, request, material and operation limits. No
existing engine budget is raised.

## Storage wiring and recovery

Use `sectionDefinition` with the core SaveStore under namespace
`custody-composition`. Its initial value is a function. An author-layer
`defineSaveSection` wrapper expects an initial value instead; retain the full core
section definition in that wrapper so its parser and bounds are not dropped.
The physical key is exported as `storageKey`.

Wrap the local StoragePort with `createCustodyStoragePort(port)` before giving it
to SaveStore, and use that same port for `readPersisted`. The synchronous guard
pins observed bytes and checks them before each write/removal, including background
retry and teardown. Observed deletion, malformed replacement or another valid
writer blocks further acceptance and preserves the external record. This is a
single-writer example, not a cross-process atomic compare-and-swap or a distributed
transaction. A different process can still race between comparison and writing.

Corrupt, newer-version and unreadable initial storage blocks editing. The
controller does not treat SaveStore's quarantined fallback as permission to seed
new objects. Strict bounded command replay reconstructs the entire envelope and
compares every field, rejecting mismatched equipment, location partition,
materialization, selected definition, withdrawal, receipts or issuance. Arbitrary
creator recovery/migration is intentionally not provided by this finite sample.

## Evidence and limits

Focused tests use the real SaveStore and MemoryBackend. They cover full-bag
refusal, stale/foreign/cancelled tickets, equip displacement and unequip, exact
retry after redrop/reload, pinned materialization, capacity preflight, reservation
cancellation, failed writes, automatic retry without publication, explicit
acknowledgment, epoch retry, old/new teardown outcomes, retired authority,
corruption/newer/read failure, external deletion/replacement and coupled-data
tampering. The browser consumer is separately validated by the integration owner;
these unit tests are not browser, physical-device or storage-hardware evidence.
