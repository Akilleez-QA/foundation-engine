# Explicit staged objectives

`createStagedObjectives` from `@kits/objectives` composes existing counted objective
runs into an optional finite activity. The creator supplies events, targets, branches
and terminal choices. It installs no scheduler, event bus, persistence backend or UI.

```ts
const run = createStagedObjectives({
  runId: 'session-12', maxEventsPerStage: 64,
  definition: { id: 'assembly', revision: 1, start: 'prepare', stages: [
    { id: 'prepare', requirements: [{ id: 'parts', event: 'part-made', target: 2 }],
      choices: [{ id: 'continue', to: 'inspect' }] },
    { id: 'inspect', requirements: [{ id: 'checked', event: 'inspection', target: 1 }],
      choices: [{ id: 'finish', to: null }] },
  ] },
});
// Capture this ticket when the producing operation begins.
const ticket = run.ticket();
run.record({ ...ticket, eventId: 'accepted-production-7', event: 'part-made', amount: 2 });
run.transition({ ...ticket, id: 'advance-1', choice: 'continue' });
```

A completed counter stays on its stage until the creator explicitly selects a named
outgoing choice. A null destination completes the run. Definitions may branch but
must be acyclic in this version; repeated activities use a fresh run ID. No random
branch selection, reward, failure policy or world mutation is implied. Keep using
`createObjectiveRun` directly when counted objectives alone suffice.

Events carry run ID, stage ID and incarnation. An earlier stage's delayed event
returns `stale`, even if the successor uses the same event name. Within the active
stage, exact event retries are `duplicate`; changed payloads conflict. Transition
IDs are retained for the entire run: exact retries are `duplicate`, changed retries
`conflict`. Capture the ticket at operation admission; assigning a fresh ticket to
an old result would deliberately bypass this protection. These local identifiers
are not authentication or server authority.

`cancel()` is terminal and idempotent. It does not remove stock, undo production or
cancel an external worker: the scene/operation owner must retire those resources.
Cancellation after counter completion but before choosing an outgoing edge is valid.
No reward claim API is exposed by this helper, and snapshots containing nested reward
claims are rejected. The creator can pair terminal progress with an independently
identified reward in one authoritative save envelope. Existing standalone objective
reward claims remain unchanged; this helper does not transfer or discard them.

`view()` returns detached progress and status. `snapshot()` includes the captured
definition, run identity, complete transition history and current objective.
Restore with the same options and snapshot: the helper validates every predecessor,
completed counter, edge, incarnation and current progress. Definition changes require
an explicit creator migration. Null, missing fields and inconsistent history reject;
only an omitted snapshot begins a new run. Restored state is a local checkpoint,
not proof that submitted events were authorized gameplay.

Publish this snapshot together with any coupled production/inventory state through
one existing save section. The headless production consumer in
`src/kits/objectives/stages.test.ts` restores both owners, retries production and
progress, rejects an old-stage receipt and cancels without changing inventory.
This proves local composition, not durable storage, distributed atomicity or a
physical-device experience. The helper changes no template UI or interaction.

Runtime bounds: 64 stages, 16 choices per stage, 64 requirements per stage,
96 characters per identity, and 1–4,096 events per stage (default 256). Every stage
must have at least one requirement and choice. Acyclic transitions retain at most
64 receipts and completed objective snapshots; total event retention is at most
64 times the configured per-stage limit, plus the terminal current snapshot copy.
Exceeding event capacity returns `saturated` without mutation. Invalid definitions
and snapshots throw before exposing an owner. Work scales with these configured
bounds; validation, restoration and snapshot copying are not constant time or CPU
deadline guarantees. No history is silently evicted and no background work runs.
