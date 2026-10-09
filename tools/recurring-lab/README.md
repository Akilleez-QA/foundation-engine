# Recurring phase experiment

Question: can recurring intent preserve its phase across load while bounding
catch-up and reusing the existing clock and save owner?

This headless, unexported lab has a pure phase planner and two creator consumers:
a capped replenishment station and a bounded alert count. It is not a new clock,
scheduler, public kit, world director or durable external-effect service.

Run `node --import tsx --test tools/recurring-lab/recurring.test.mjs`.
Typecheck the planner with `node node_modules/typescript/bin/tsc --noEmit -p tools/recurring-lab/tsconfig.json`; the root configuration does not include this lab's TypeScript helper.

## Contract

The definition contains a 1–64 character ID, nonnegative safe-integer revision and
first deadline, positive safe-integer period, and `maxBatch` from 1–256.
This prototype uses integer **game seconds** for phase boundaries and finite
nonnegative clock seconds for observations. It does not model calendar intervals,
fractional periods, negative timelines or other time units automatically.
Revision changes require explicit creator migration/reset.

The version-1 phase stores the exact definition, next occurrence ordinal and last
committed firing ordinal. Stable receipt identity encodes the tuple
`[definition ID, revision, ordinal]`. Stacking/independent events require separate
creator definitions. There is no registry. Pure plans are immutable detached values.

`planDue(phase, now, policy)` requires one explicit policy:

- `skip`: move beyond all currently due occurrences without emitting an outcome.
- `coalesce`: emit one latest-occurrence row carrying the count of due occurrences.
- `replay`: emit at most `maxBatch` oldest due rows and retain the remaining backlog.

Exact deadline is due. Advancement remains anchored to the first deadline, not
the latest observation. BigInt arithmetic computes missed periods without iterating
over elapsed time. Only replay iterates, bounded by `maxBatch`. Inputs and outputs
must remain representable safe integers; phase/next-deadline exhaustion throws
before returning a proposal. No automatic offline-time or drop-backlog policy exists.

A proposal is not a committed firing. Consumers publish its phase, receipt and
outcome in one in-memory envelope, then hand that envelope to their existing save
section at the host-selected save boundary. The station caps its value at creator capacity; alerts refuse overflow.
Both capacities are 1–4096, with constant retained history and at most one armed
callback. These are example semantics, not engine defaults.

## Clock, lifetime and persistence boundary

The consumers borrow `GameClock.schedule` and a creator-provided `SaveHandle`
whose `json` field stores their envelope. The enclosing host calls `arm()` at most
once per selected dispatch boundary. Callbacks **never rearm themselves**: this
prevents a large warp from repeatedly draining a replay backlog in one clock
advance. The host chooses retry/dispatch cadence. The clock's existing owner pause
set controls delivery. Catch-up uses the provided game time; no wall-clock read,
catch-up subscription or clock driver is added.

A callback checks its AbortController and exact current scheduled
identity before publication. Restore and disposal abort it. Reentry during
validation/persistence is refused; disposal remains allowed and prevents later
publication. Failed input/overflow preserves accepted state. Explicit restore
validates the entire envelope before retiring the active attempt.

The clock drops all scheduled callbacks on timeline restore. At load or player/map
replacement, restore/dispose this consumer too, then arm a fresh attempt. Merely
restoring the clock cannot notify this fixture that its scheduled callback vanished.
Clock time must match the saved envelope's `time`; this fixture has no authority
to restore the clock. The production save/loop owner must perform that coordination.
Backward time without an explicit consumer restore rejects when dispatched/saved.

`retrySave()` checkpoints the existing clock's current time with accepted phase,
outcome and receipt, and returns the actual save status. It also works for a
mid-period checkpoint. It does not change phase or apply missed outcomes.
The host selects save boundaries outside the frame hot path.

The scheduled callback only stages accepted state and reports `staged`. It never
writes storage. The host calls `retrySave()` outside clock/frame dispatch. A staged
state is not a durable save; the real SaveStore tests verify no writes until that
explicit boundary.

Failed writes preserve the newer accepted in-memory state but not durability.
Retry can persist that state; crash/reload uses the last successful envelope.
Replayed effects are safe only for these in-envelope projections. There are no
external messages/audio/network mutations here, and no claim of exactly-once
external delivery. Existing sink receipts/transactions remain necessary for that.

## Evidence ceiling

Twelve tests cover exact boundaries; all three due policies; large jumps; malformed
data and arithmetic exhaustion; pause through the real clock; explicit backlog
dispatch; alert capacity failure; stale callbacks and replaced definitions; reentry;
two consumers through real SaveStore; failed writes; and mid-period reload.

No renderer, device-performance, calendar, external delivery or complete gameplay
save migration evidence is claimed. The prototype remains unexported pending its
own consumer integration and review. See
[ADR 0084](../../docs/adr/0084-persisted-recurring-phase.md).
