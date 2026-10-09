# Service assignment prototype

The creator requirement is an optional experiment in assigning exclusive service requests and weighted worksite capacity, with stale-completion protection and failed-transfer preservation. The runnable experiment is in [tools/service-assignment-lab](../../tools/service-assignment-lab/README.md). The current lab consumes the public optional assignments helper candidate; it remains a headless experiment, not a framework requirement. See [the kit guide](assignments.md).

Run `node --import tsx tools/service-assignment-lab/demo.mjs` to see the two fixtures. One models a failed service route, replacement worker and late completion; the other models a full destination, preserved original occupancy, successful transfer and destination deletion. They choose assignments explicitly. No fixture invents a shared priority, eligibility or fairness policy.

## Fit with existing owners

- The scene visit would own a ledger and its disposal. Actor and target handles would be bound to the scene's existing entity lifetime, not global strings alone.
- The current action or turn owner would admit commands. The ledger would apply one synchronous claim/transfer/release; it does not schedule simulation time or implement an independent command history.
- Existing navigation ownership would prepare a route separately. A caller would associate a route result with the exact current claim token and withdraw the claim on a selected failure policy. Releasing ledger capacity alone does not stop route execution; the route owner must also cancel its work.
- The worker host would remain the only owner of future expensive scoring jobs. Their result could propose an assignment, but live claim/capacity admission must still occur in the authoritative owner. This experiment creates no threads or scheduler.
- Inventory and production remain the authorities for goods. Assignment capacity is not inventory custody or a transaction spanning another ledger. Persistent work definitions would use registered save sections; these ephemeral object tokens are neither saved nor sent over a network.

## Contract decisions demonstrated

The prototype captures admission limits and validates integer units. A live actor has one claim. Each successful transfer publishes a fresh token and releases the old claim only after destination admission succeeds. Removal or completion makes previous tokens stale, including after an ID is reused. Retry withdrawals have a per-generation budget, with explicit exhaustion and no retained queue. Disposal releases the whole visit. See the README for statuses, precise limits and work bounds.

Its implementation is independently authored. The public kit adds a typed optional helper, changes no existing gameplay, and imposes no service matching policy. The two fixtures provide evidence that the same small mechanism can describe different lifecycles; they do not establish that this belongs in every game.

## Before graduation

Choose a real consumer requirement and specify eligibility, candidate-comparison limits, tie-breaking, arrival failure, retry reset policy and action ordering. Bind the typed kit API to actual scene/entity lifetime ownership. Test route cancellation separately from claim withdrawal and define how accepted effects, inventory and rewards coordinate with completion. If persistence or networking is required, design its versioned data and admission boundary rather than serializing local tokens.

Keep existing frame, worker, command and save owners. Broader tests and any required integration gates still apply before production use. The current evidence is a Node prototype and focused state tests; there is no browser integration, sustained-device measurement, automated matcher, persistence adapter, cross-ledger transaction or multiplayer acceptance.
