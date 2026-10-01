# Optional ordered industrial transfer batches

Creator requirement: an authored local conveyor simulation shares one stock,
power and accepted-clock transaction. A reachable24link/5machine100tick settle
was measured around0.8seconds with repeated stock parsing. The existing ephemeral
industry candidate is the extension seam; no new scheduler or persistent owner.

`IndustryCommand` now optionally accepts `{kind:'transfer-batch',transfers}`.
Each transfer supplies from/to/batch/positive integer quantity. All transfers are
captured within `floor(bounds.stock.changes/2)` before mutation, retaining the
existing two-stock-changes cost. One batch is one candidate command. Transfers
execute in supplied order; every intermediate capacity, phase and position bound
applies. A later transfer cannot rescue an earlier overfill. A failure rejects the
entire batch. Protected machine installed/work containers remain inaccessible.
Empty batches are unchanged candidates. Self transfers retain existing semantics.

`prepareStockTransfers` is the corresponding optional inventory pure helper.
It parses the stock once, executes bounded ordered transfers in private maps,
validates intermediate capacity and the final canonical stock, and returns equal
consumed/produced mass totals. Limits, exact integer arithmetic and detached
snapshots remain enforced. Throwing caller accessors publish nothing; native
candidate capture retains its busy/retirement barriers. Disposal discards the
candidate. Failed persistence still retries the enclosing world's exact ticket,
not an independently queued batch.

Validation: sequential-equivalence/chain/self-transfer, late-failure atomicity,
intermediate capacity, phase, position/admission bounds, hostile array capture and
retirement tests accompany the change. Runtime work is bounded by configured
transfer and stock bounds; this does not promise a physical-device deadline.

Candidate observations copy the already validated private bounded canonical graph
rather than revalidating every immutable plan. All nested arrays/records, batch
property dictionaries and output definitions remain detached; external admission,
command capture and stock validation are unchanged. Snapshot cost is linear in
configured canonical state size, without another full plan-validation pass.
