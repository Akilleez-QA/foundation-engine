# Allocation workbench: one coherent authored envelope

`tools/progression-workbench/controller.mjs` is an optional finite sample, not an engine character, economy or progression service. Its authored choices, costs, capacity formula and tokens are examples a creator may replace. The sample composes progression candidates, grant contributor inspection, modifier explanations, resource candidates, the inventory ledger, AuthoredDocument and SaveStore.

The four sample choices are alpha, beta, advanced and delta. Alpha and beta independently grant the `access` certificate; the tutorial grants the same certificate independently. Advanced requires alpha. With alpha, beta and advanced accepted, capacity is `(10 + 2 + 3) * 2 = 30`. The trace reports that aggregate formula, not a sequence of intermediate capacity changes. Surrender removes only its skill contribution and token, consumes a voucher and returns allocation; it does not refund spent XP or remove tutorial facts.

Awards hold three units and initially contain three blockers. Learning first fails until the creator explicitly releases those blockers. Vouchers hold two units. Commands use an explicit epoch, bounded id and captured payload. A maximum of 24 accepted receipts is retained without eviction. Exact retries are no-ops, changed payloads under an accepted id conflict, and other epochs refuse. Inventory uses its existing operation history; there is no second inventory implementation.

The discrete resource starts at 8 within [0,10]. Capacity changes prepare a retain-current, clamp-to-domain candidate inside the same envelope, so expansion does not refill and shrinking can reduce current only when necessary. A separate continuous resource starts at .75 within [0,1] and demonstrates fractional adjustments. These policies are sample choices, not engine defaults.

## Controller boundary

Exports are `storageKey`, `sectionDefinition`, `initialEnvelope`, `parseEnvelope`, `createWorkbenchStoragePort` and `createWorkbenchController`.

Wrap the local StoragePort with `createWorkbenchStoragePort` before constructing the real SaveStore. Register `sectionDefinition` directly with `store.section`. The controller requires that handle, `hasEnvelope()` and `readPersisted()` returning the raw stored string or null. `readPersisted` should use the guarded port. Author API registration must adapt the save definition's initial-value convention; the raw core definition has an `initial()` function.

- `read()` returns frozen accepted `envelope`, projected `view`, `saveStatus`, exact `durable` comparison, `blocked`, `retired` and `message`.
- `preview(command)` returns `{status:'prepared', candidate, view}`, `{status:'duplicate'}`, or a refusal. The candidate is the authentic PreparedDocument object; its preview is not accepted state.
- `commit(candidate)` publishes only an authentic candidate from the current document revision and lifetime. A newer acceptance, cancellation or retirement prevents later publication of stale work.
- `cancel(candidate)` discards that candidate only.
- `save()` retries the latest accepted envelope, never a saved closure over an older candidate.
- `dispose()` retires edit authority. The caller separately disposes its SaveStore, which may perform its own final write.

Commands are `{epoch,id,payload}`. Payloads are `{kind:'learn'|'surrender',skill}`, `{kind:'free'|'voucher'}`, `{kind:'earn',amount}` (positive integer at most 20), or `{kind:'adjust',resource:'capacity'|'continuous',delta}` (finite magnitude at most 100). Invalid precision refuses; current-resource overflow uses the sample's explicit clamp policy. Capturing inputs is guarded against reentrant mutations.

## Restoration and durability

One save section contains progression, inventory, external grants, resources, epoch, persisted revision and receipts. Restore replays the bounded receipts from the fixed seed and requires exact structural agreement with every saved consequence. Unknown nested fields, mismatched rules, missing stock/grants, changed resource quantities and fabricated receipts fail restoration. Changing the sample rules requires an explicit migration or a new sample identity.

Accepted memory and durable bytes are different facts. A quota failure retains accepted memory, reports it as unsaved and retries the latest envelope on explicit retry, ordinary SaveStore autosave or teardown. A failure test must keep its injection enabled through teardown if a reload is meant to demonstrate the old saved state. A `saved` status with no physical record is not treated as durable.

Quarantined, newer or unreadable saves block edits instead of silently treating the fallback seed as recovery. The sample has no reset or conflict-resolution UI: recovery requires an explicit creator decision outside this controller. Its section merge preserves a valid divergent stored record; the controller blocks when the save owner and accepted document diverge.

The storage adapter pins the sample key's first successful read and advances that baseline only after its own successful write. Before set/remove it checks that current bytes still equal that baseline. This also protects against deletion or malformed external writes between a controller check and autosave/disposal. Other storage keys pass through. This is a synchronous one-writer sample boundary, **not an atomic compare-and-swap across processes**: a separate process can still race between a storage read and write. Multi-writer games need a stronger creator-selected persistence protocol.

Focused tests use real SaveStore with MemoryBackend failure injection. They cover numeric trace and overlapping sources, blocked consequences, dependent/voucher refusals, stale/cancelled/foreign/retired candidates, resource preview purity and shrink, replay integrity, full history, receipt retries, failures through teardown, explicit and automatic latest-envelope retries, quarantine reload, getter reentry and external-write preservation. Browser and physical-device acceptance remain separate evidence; these controller tests do not certify UI usability or cross-process isolation.
