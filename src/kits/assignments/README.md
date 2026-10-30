# Assignments

Optional, headless ownership for exclusive service requests and weighted worksite capacity. Import the pure helper directly; no kit-list registration is needed. `createAssignments(options)` creates a synchronous visit-owned ledger. The creator chooses eligibility, priority, target selection, retry timing, arrival rules and effects.

```ts
import {createAssignments} from '@kits/assignments';

const ledger = createAssignments({maxActors: 32, maxTargets: 16, maxClaims: 32, maxCapacity: 8});
const worker = ledger.addActor('worker');
const site = ledger.addTarget('assembly', 4);
if (worker.status === 'added' && site.status === 'added') {
  const claim = ledger.claim(worker.handle, site.handle, 2);
  if (claim.status === 'claimed') {
    // Associate external work with this exact token; the owner checks arrival separately.
    if (ledger.check(claim.token)) ledger.complete(claim.token);
  }
}
ledger.dispose();
```

This example releases capacity only; completing a claim does not prove arrival, grant a reward, remove a request, mutate inventory or commit persistent effects. See the [composition guide](../../../docs/guides/assignments.md).

## Inputs, outputs and ownership

IDs contain 1–64 ASCII characters matching `[a-z0-9][a-z0-9.-]*`. Targets have positive integer capacity; a claim consumes positive integer units (default 1). An actor holds at most one claim. A capacity-one target is exclusive; larger targets admit several claims while their total units fit.

`addActor` and `addTarget` return `AssignmentAdmission`: `{status: 'added', handle}` or a refusal. `claim` and `transfer` return `AssignmentClaim`: `{status: 'claimed', token}` or a refusal. Handles and tokens are frozen, ledger-local object identities with monotonic safe-integer generations. Removal permits ID reuse with a fresh identity. A copied, deserialized, foreign or retired handle/token is refused; diagnostic strings and generation numbers alone never confer authority. Handle/token arguments intentionally accept `unknown` and validate identity without reading caller properties.

`transfer(token, destination, units = 1)` preflights the live token and destination capacity before changing either side. Every refusal preserves the old claim and token. On success it publishes a fresh token; the old token becomes stale. Same-target resize credits the original units, and transfer works at the maximum active-claim count because it replaces a claim.

`check(token)` returns whether the exact token still owns a claim. Use it before adopting an external result, then recheck or complete after any intervening asynchronous boundary. `complete` and `cancel` release once and return `completed`/`cancelled`; repeats return `stale`. They do not remove the target. `removeActor` releases its claim; `removeTarget` releases all of its claims. They return `removed` or a refusal. They do not cancel routes, workers or other external resources: those existing owners must be retired separately.

`retry(token)` withdraws the claim immediately. It returns `ready` while that actor generation has retry allowance. After the configured number of successful retry withdrawals, the next retry returns `retry-exhausted`, still releases capacity and prevents further claims for that actor generation. Completion, transfer and cancellation do not reset the retry count. Removing and re-admitting an actor explicitly starts a fresh generation; this is lifecycle replacement, not an automatic retry bypass. There is no pending retry queue.

`snapshot()` returns detached, deeply frozen diagnostic descriptions in admission order. Snapshot claims are not valid tokens. There is no restore API, terminal history or persistence schema. A scene/interaction owner calls idempotent `dispose()` when it ends; disposal clears retained state, makes `check` false and returns `disposed` from subsequent mutations.

## Bounds and refusals

| Option | Default | Allowed integer range |
|---|---|---|
| `maxActors` | 64 | 1–4096 current actors |
| `maxTargets` | 64 | 1–4096 current targets |
| `maxClaims` | 64 | 1–4096 current claims |
| `maxCapacity` | 64 | 1–4096 units per target or claim |
| `maxRetries` | 2 | 0–64 successful retry withdrawals per actor generation |

Options are captured at construction; invalid bounds throw `RangeError`. Runtime malformed IDs, capacities and units return `invalid`. Other refusals are `duplicate`, `saturated`, `busy`, `full`, `stale`, `retry-exhausted`, `generation-exhausted` and `disposed`. Refused admissions do not enqueue work. When generation space is exhausted, new admission/transfer is refused; release/removal/disposal remain available. No practical generation-exhaustion execution evidence is claimed.

Storage consists of bounded current records and lookup maps; no retired identities are retained internally. Single-claim operations do constant logical work using map lookups. Target removal scans at most `maxClaims`, and snapshot/disposal visits the configured records. These bounds are not CPU deadlines, exact heap accounting or guarantees about JavaScript allocation failure. Returned objects retained by callers are outside ledger retention. No timers, callbacks, workers, I/O, draws or per-frame work are installed.

## Evidence and limits

Headless tests cover typed public admission, atomic transfer refusal, stale generations/tokens, independent claim lifetimes, limits, retries, teardown and detached snapshots. Consumer tests combine an assignment with the existing lifetime route queue and shared visit abort; a second consumer uses weighted worksite occupancy. The original lab regressions now run against this implementation, including 600 mixed commands checked against an independent allocation model and 1000 admission/removal cycles. The separate service/worksite lab fixture modules import the public kit; product code never imports the lab.

No automatic matching, fairness, movement, collision clearance, authoritative multiplayer, persistence or cross-ledger effect transaction is provided. The creator supplies ordered commands; this kit does not certify cross-machine determinism of external policies. There is no playable template consumer or browser/physical-device acceptance yet. This is a public optional helper candidate, not a complete service simulation.
