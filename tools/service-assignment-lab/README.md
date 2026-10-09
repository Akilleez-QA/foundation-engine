# Service assignment experiment

Question: can one small ownership ledger support both one-shot service requests and persistent weighted worksite occupancy without selecting gameplay policy?

This Node-runnable lab now consumes the optional `@kits/assignments` helper. `assignments.mjs` is a compatibility re-export; there is one implementation in the kit. Product code must not import this folder. The two fixtures exercise different lifecycles; they are not two integrated game consumers. See the [public kit contract](../../src/kits/assignments/README.md).

```sh
node --import tsx tools/service-assignment-lab/demo.mjs
node --import tsx --test tools/service-assignment-lab/assignments.test.mjs
```

## Owner and contract

`createAssignments(options)` creates one ledger for one visit. The caller owns disposal. Actors hold at most one claim; targets hold positive integer capacity, and claims consume positive integer units. A capacity-one target models an exclusive request. A larger target can hold multiple weighted claims. Eligibility, priority, fairness, arrival, task effects, rewards and matching remain consumer decisions.

IDs are 1–64 ASCII characters matching `[a-z0-9][a-z0-9.-]*`. `addActor(id)` and `addTarget(id, capacity)` return `{status: 'added', handle}`. Each handle is frozen, local to its ledger, and has an increasing generation. IDs can be reused only after removal. A copied or reconstructed handle is not valid.

`claim(actorHandle, targetHandle, units = 1)` returns `{status: 'claimed', token}`. Tokens are frozen local object capabilities, not serializable credentials. `transfer(token, targetHandle, units = 1)` validates the live token and destination capacity before replacing the claim. A refused transfer changes nothing, including the old token. Same-target transfer credits the old units before checking its replacement. Successful transfer always issues a fresh token, even for an unchanged target and quantity.

`complete(token)` and `cancel(token)` release capacity once. They differ only in their result status; neither grants rewards nor removes a target. Repeated, foreign or stale tokens return `stale` without mutation. A service consumer removes a completed request explicitly; a worksite consumer keeps its target for future assignments.

`retry(token)` releases the current claim immediately. It returns `ready` while the actor's retry budget remains, leaving the caller to choose whether, when and where to submit another claim. After that budget is spent, a further retry returns `retry-exhausted`, releases the claim and refuses further claims for that actor generation. Cancellation, completion and transfer do not reset this budget. Explicitly removing and re-adding an actor starts a new generation and budget; the owner must not use that operation to disguise automatic unbounded retries. There is no pending retry queue or backoff timer.

`removeActor(handle)` releases its claim. `removeTarget(handle)` releases every claim on that target. Removal does not charge a retry or create replacement work. Stale handles cannot delete replacements sharing the same ID. `dispose()` is idempotent, clears all retained state and causes every subsequent mutation to return `disposed`.

`snapshot()` returns detached, deeply frozen descriptions in admission order, including capacities, usage, retry state and active claims. Snapshot records cannot be used as handles or completion tokens. Snapshot generation is explicit diagnostic work, not a per-frame subscription API. Issued objects held by callers are their responsibility; the ledger retains only current actors, targets and claims, with no terminal receipts or tombstones.

## Admission, work and failure bounds

| Option | Default | Allowed range | What it bounds |
|---|---|---|---|
| `maxActors` | 64 | 1–4096 | Current actors and their handle lookup |
| `maxTargets` | 64 | 1–4096 | Current targets and their handle lookup |
| `maxClaims` | 64 | 1–4096 | Current claim tokens |
| `maxCapacity` | 64 | 1–4096 | Capacity per target and units per claim |
| `maxRetries` | 2 | 0–64 | Successful explicit retry withdrawals per actor generation |

Options are captured at construction; invalid values throw `RangeError`. Runtime invalid IDs/capacities/units return `invalid`. Other refusal statuses are `duplicate`, `saturated`, `full`, `busy`, `stale`, `retry-exhausted`, `generation-exhausted` and `disposed`. A monotonic safe-integer generation never wraps; generation exhaustion refuses admission and transfer while completion, cancellation, removal and disposal remain available. It is not reached by practical fixtures and has no executed exhaustion test.

Normal claim/transfer/release operations use map lookups and constant ledger work. Target removal scans at most `maxClaims`; snapshot and disposal visit at most the configured record bounds. These are logical bounds, not hard CPU deadlines or exact JavaScript heap-byte accounting. There are no callbacks, promises, timers, threads, I/O or automatic scans for candidates. No caller code runs between transfer validation and publication. Out-of-memory failure is not recoverable transactional storage.

## Evidence and limits

`assignments.test.mjs` has 15 tests: both consumer fixtures, independent claim lifetimes, failed transfer preservation, weighted same-target resize, claim saturation, foreign/copied handles, stale actor/target generations, retry limits, input validation, detached snapshots, disposal, 1000 admission/removal cycles, and 600 mixed commands compared after every step with an independent allocation model. These establish selected state transitions, not fairness, multiplayer determinism, worker safety, browser timing, persistence or physical-device performance.

The guide [Service assignment prototype](../../docs/guides/service-assignment-lab.md) describes the existing engine seams and graduation criteria. The optional kit supplies public exports and a capability row; this lab adds no package script or global owner.
