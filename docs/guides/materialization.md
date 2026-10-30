# Optional delayed materialization

`createMaterializationOwner` from `@kits/resources` composes the existing retirement
inventory and authored-document prepare/publish owner. It supplies explicit
reservation, selection, settlement and retry boundaries. Creators choose whether
to use it and what outputs, properties, costs and definitions mean. It introduces
no factory mechanics, background clock, catalog service or storage backend.
Existing `createProduction` and its fixed catalog remain unchanged.

## Select the meaning of a delayed output

An `admit` command reserves the exact supplied `consume` amounts and returns an
owner-local request serial. Serial numbers never repeat within an envelope's
history, including after checkpoint/reload. A late settlement cannot accidentally
target a different request. They are not security capabilities or global IDs.

The admission policy is explicit:

- `frozen`: retain the supplied output facts immediately.
- `pinned`: copy a specific `{id, revision, output}` definition at admission. This
  is a **pin by value**, retained within the bounded request, not a reference to an
  external registry. Evicting an external catalog revision cannot erase it.
- `current`: retain the intended `definitionId` and wait for an explicit `select`
  command. The creator supplies the definition currently observed by its adapter.
  Selection copies its facts and revision. The engine does not establish whether
  a remote catalog is current or authoritative.

`select` does not change admitted input costs. Once selected, a request cannot be
reselected. A changed definition requires creator-directed cancellation and a new
admission. Output quantity, container and properties are part of retained output
facts; the framework does not infer balancing or recipe suitability rules.

For example, when definition v1 has `grade: 2` and a later v2 has `grade: 9`, frozen
and pinned v1 requests still produce grade 2. A current request explicitly selected
against v2 produces grade 9. Both consume only their originally reserved amounts.

## Prepare and publish explicit commands

```ts
import { createMaterializationOwner } from '@kits/resources';
const owner = createMaterializationOwner({
  inventory: { capacities: { bag: 100, output: 100 }, maxMaterials: 1024 },
  maxPending: 32, maxReceipts: 256,
  limits: { maxBytes: 1_000_000, maxNodes: 100_000, maxDepth: 32 },
});
// Seed/move/dispose stock using an exchange command first.
const admitted = owner.prepare(owner.epoch, {
  id: 'request-17', kind: 'admit',
  consume: [{ container: 'bag', batchId: '0:ore', quantity: 1 }],
  policy: { kind: 'current', definitionId: 'creator-definition' },
});
if (admitted.status === 'prepared') {
  // Default publish accepts in memory only; it does not promise a durable save.
  const published = owner.publish(admitted.candidate);
  if (published.status === 'accepted') {
    const request = published.result.request;
    // Use this serial for explicit select, settle or cancel commands.
  }
}
```

`prepare(epoch, command)` returns `prepared` with a candidate and proposed result,
`duplicate` with the prior accepted receipt, or `rejected` with a reason. Malformed
inputs and exhausted underlying counters throw. Prepared results are proposals:
no reservation, quantity change or request is live until `publish` accepts it.
The owner retains at most one prepared candidate; additional preparations return
`publication-pending`. Only that exact candidate object can publish or discard.
All input/output data is detached. Mutation from a callback is guarded.

Commands are `exchange`, `admit`, `select`, `settle`, `cancel`, `checkpoint` and
`retire`. Exchange uses ordinary inventory consume/produce values; externally
supplied qualified batch IDs must obey the retirement inventory's generation
rules. Direct inventory mutation and externally owned reservations are deliberately
not exposed through this composition. Supply existing unreserved stock through
`initialInventory` if needed; restoration rejects reservations without a matching
pending request. Independent games may use the lower-level inventory instead.

Settlement drafts a restored inventory and commits the reservation and outputs
atomically in that draft. Capacity, identity conflict or other admission failures
leave the complete published envelope unchanged. The selected output persists, so
freeing space and retrying cannot accidentally select a newer definition.
Cancellation releases the reserved inputs and creates no output.

A future output does not claim an unknown inventory batch. Its retained
creator-local name is qualified with the inventory's **current generation at
settlement preparation**. The exact qualified ID and selected facts/revision then
appear in the settlement receipt and candidate. Retiring an unrelated consumed
identity while a request waits therefore does not strand that request in an old
issuance generation. If changed facts reuse an already-known local name in the
same generation, settlement reports `batch-conflict`; the creator must select
appropriate identity semantics, not rely on automatic renaming.

## Retry, bounds and persistence

Successful commands retain an exact normalized command signature and result in the
current epoch. Matching retries return `duplicate`; changed payloads under the
same command ID return `conflict`. Failed preparations create no receipts. Requests
and receipts have separate configured bounds; receipt exhaustion returns
`checkpoint-required`, and pending-request exhaustion returns `pending-full`.
The document's byte/node/depth limits bound the published envelope. Existing
inventory operation/material bounds still apply. No trusted creator callback or
input serialization is a CPU-time sandbox.

A successful `checkpoint` advances the inventory/request epoch and prunes completed
command receipts while preserving pending requests, selected facts and active
reservations. `retire` follows the retirement inventory's rules and advances both
request epoch and issuance generation. These boundary commands do not retain a
receipt in the new epoch: their old-epoch retries return `stale-epoch`. Request
serials are never reset. Both boundaries are merely prepared until published.

Persist `snapshot()` as **one** existing `defineSaveSection` value. Its parser can
restore through `createMaterializationOwner(options, raw).snapshot()`. The envelope
contains inventory, pending requests/selections, next serial and retry receipts.
Do not save these in independent sections or merge their parts from different
versions. Loading revalidates the inventory, pending reservation correspondence,
selected definitions and receipt shapes. This is not cryptographic provenance or
an event-history proof against deliberate snapshot fabrication.

For durable acceptance, obtain the author handle with `ctx.save(section)` and pass
a publisher which accepts that whole envelope (the section stores this fixed envelope schema):

```ts
const result = owner.publish(candidate, envelope =>
  sectionHandle.update(draft => { Object.assign(draft, envelope); }, { now: true }) === 'saved'
);
```

This uses the existing save owner and its truthful status. `false` or an exception
retains the **same candidate** for retry; further preparations are blocked. The
publisher must tolerate the same envelope repeatedly. A failed SaveStore write may
remain dirty and later flush, so `discard(candidate)` is permitted only **before**
any publisher invocation. After an attempt, finish/retry that publication or close
the owner and recover through the application's save lifecycle. `close()` ends
in-memory ownership; it cannot cancel an external store's pending writes.

The default publisher performs in-memory acceptance only. External callbacks cannot
be rolled back by the document owner. One-store acceptance does not create atomicity
with remote services, other save sections, notifications or physical devices. A
crash after the save accepts but before in-memory adoption must recover from that
saved complete envelope. Single-writer ownership and application recovery remain
explicit prerequisites; no multiplayer conflict resolution is claimed.

## Acceptance evidence

The headless consumer uses actual inventory quantities and reservations for the
v1 grade-2/v2 grade-9 scenario, capacity refusal/retry/reload, local-ID conflicts,
retirement before settlement, cancellation and stale serial/epoch rejection. A
second consumer uses the existing SaveStore with MemoryBackend quota failure:
failed publication leaves live inventory unchanged, retry presents byte-identical
state, and reload retains one output plus its duplicate receipt. This is automated
local-store evidence, not browser/device timing or remote durability evidence.
