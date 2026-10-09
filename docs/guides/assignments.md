# Service and worksite assignments

Choose `@kits/assignments` when a creator needs one live task or worksite claim per actor, with exclusive or weighted target capacity. The [kit contract](../../src/kits/assignments/README.md) describes its public inputs, outputs, lifecycle, refusal statuses and bounds. The helper is optional and installs no system; add `assignments()` to the game's kit list when using it.

## Choose the existing owner

Create one ledger in the scene or interaction lifetime and dispose it on owner loss. Register actors and targets once per corresponding entity lifetime; remove their handles when those entities are retired. Removing a target releases its occupants but does not choose new assignments. Keep suitability, permissions, priorities and stable tie-breaking in the consumer that owns those rules.

The command or turn owner decides which assignment command is accepted and in what order. The ledger applies a synchronous capacity transition. It is not a replacement command log, global scheduler, entity registry or navigation queue.

For a service request, create a target with capacity 1. Claim it, then start route preparation through the existing navigation owner. Associate the exact claim token with the request. A computed path is not physical arrival: the movement owner must verify destination identity, clearance and arrival. Before adopting a result, check that its token is still live. If a route fails or the owner cancels, release route work and call `retry` or `cancel` according to the chosen policy. Withdrawing a claim alone cannot stop external execution.

For a worksite, choose the capacity unit and each worker/team's demand. `transfer` checks the replacement site's capacity before releasing the source. A full destination therefore leaves the actor's current work assignment intact. A successful transfer changes the token, so a delayed source-site completion cannot release the new occupancy. Target capacity is fixed for its registered lifetime; retire/recreate the target explicitly if its capacity model changes, releasing affected claims for deliberate reassignment.

## Effects and persistence

`complete` retires assignment authority only. Inventory owns material custody, resources owns production and vehicles owns seats/frame attachment. Do not represent any of those as a second stock or seating ledger inside assignments. For an effect requiring persistent exactly-once publication, use the existing operation receipt and save owner; define recovery if one owner succeeds and another fails. A check followed by an asynchronous effect is not atomic.

The returned snapshot is diagnostic, not a save format. Persist creator-owned task definitions and durable outcomes in registered save sections. Reconstruct transient claims under a new owner after loading; do not serialize local handle objects or accept tokens from a network client. If a creator needs persistent or distributed assignments, that is a separately specified admission and migration contract.

## Runnable examples and evidence

`tools/service-assignment-lab/service-requests.mjs` and `worksite-slots.mjs` are two separate consumer fixtures importing the kit. Run `node --import tsx tools/service-assignment-lab/demo.mjs`. The original lab entry is a compatibility re-export, so there is one implementation.

`src/kits/assignments/consumers.test.ts` exercises a real lifetime route queue with visit cancellation, stale prepared-result rejection and replacement claim protection, plus weighted worksite transfers. `ledger.test.ts` and the original lab suite cover the ownership and bound regressions. These are headless tests, not two playable game integrations. Full integration gates, browser behavior, device timing and game-specific matching/arrival policies remain separate acceptance work.
