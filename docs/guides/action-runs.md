# Optional action runs

`createActionRuns` from `@kits/capabilities` supplies bounded, scene-owned timing
and completion facts for creator-defined interactions. A calibration, tool use,
delayed interaction or combat action can use it without adopting an ability tree,
resource formula, target schema or animation policy. It extends the existing
optional capabilities kit; it installs no service, scheduler or global owner.

```ts
import { createActionRuns } from '@kits/capabilities';

const runs = createActionRuns({ now: 0, maxActions: 32 });
runs.admit({ id: 'scene-1:calibrate-1', owner: 'instrument', readyAt: 2, expiresAt: 5 });
runs.advance(2); // Feed the existing scene's simulation time before attempting effects.
const ready = runs.get('scene-1:calibrate-1');
if (ready?.state === 'ready') {
  // Creator code decides whether to accept the operation and prepares its outcome.
  // If it declines, leave this run ready and retry before its deadline.
  const result = runs.acknowledge(ready.id, ready.revision);
  if (result.kind !== 'applied') {
    // Caller handles stale/cancelled/expired readiness; publish no consequence.
  } else {
    // Assign the already-prepared, nonthrowing local outcome here.
  }
}
// At scene teardown, before late work can publish:
runs.cancelOwner('instrument');
```

Readiness allows the creator to attempt acceptance; it does not apply or promise an
effect. `acknowledge` records that the caller accepted a ready run. Read and check
its result. A stale revision, unknown identity, terminal run or pending run cannot
complete. Cancellation is also revision-checked. A failed creator acceptance needs
no helper rollback: leave the run ready, then retry or cancel.

All definitions and returned records are captured/frozen. `admit` returns
`admitted`, an exact-definition `duplicate`, a changed-definition `conflict`,
`capacity`, or `expired`. Identity includes the caller's session namespace; IDs
cannot be reused with changed timings or owners. Terminal records remain retained,
so replay cannot accidentally target a new action. An expired admission does not
reserve a new identity. Retire the whole helper when its bounded session ends.

`advance(time)` accepts finite, monotonically nondecreasing caller time and returns
only changed records in admission order. It performs no callbacks. The exact
`expiresAt` boundary expires a run before it can become ready; jumping across both
boundaries yields only `expired`. Negative finite timeline origins are supported.
No progress occurs until the caller advances time. Deadlines are absolute caller values; the helper performs no duration addition. Any overflow in caller deadline arithmetic produces a nonfinite value and is rejected on admission. Use one chosen simulation time
domain consistently (seconds when using `ctx.time.t`); wall time, offline progress and persistent cooldown rules
are creator decisions. Do not drive this helper with animation markers.

`cancelOwner` cancels currently pending/ready runs and leaves terminal records
unchanged. It does not permanently disable the owner. The creator's existing scene
lifetime must prevent new admission after disposal, then release the helper.
Old callbacks must carry the original action identity and revision; do not replace
them with the identity of whichever action happens to be current.

## Bounds and publication

Default admission is 256 identities; `maxActions` is a positive safe integer up to
65,536. IDs and owner strings each contain 1–256 UTF-16 code units. Admission and
identity lookup use one Map; advance and owner cancellation visit at most the
configured number of records. Changed-record output is bounded by that same count.
Each action has at most two lifecycle transitions. The helper retains no unbounded
history. These are record/work-count limits, not CPU-time guarantees for arbitrary
creator code. Capacity never evicts or silently replaces an action.

The helper does **not** coordinate atomic writes across inventory, world state,
saves or a server. For synchronous local composition, prepare a pure candidate,
acknowledge the current ready revision, then assign the prepared state without
callbacks or an asynchronous gap. This works only when the final assignment cannot
fail. Do not acknowledge and then call an arbitrary throwing publisher while
claiming atomicity. A durable or external outcome needs one creator-owned envelope
or an explicit receipt/retry protocol; this helper has no persistence/restore API.
A local revision is not network authorization.

Malformed input throws before admission. Backward/nonfinite time leaves the owner
unchanged. Reentrant mutation from input getters throws before it can alter the
owner; a getter exception releases the guard for a later valid operation. Late
acknowledgement after expiry/cancellation is rejected. Presentation consumes
accepted outcomes independently and must not decide simulation completion.

## Evidence

`src/kits/capabilities/action-runs.test.ts` covers boundaries, finite bounds,
immutable capture, duplicate/conflicting identities, reentrancy and stale/terminal
transitions. Its headless probe consumer composes the helper with `resolveAction`,
declines and retries publication, cancels a previous action, rejects its late
completion and expires another action without a consequence. This is executable
local composition evidence, not a browser, physical-device, persistence or
multiplayer certification. A second headless scene consumer feeds `ctx.time.t` through an existing frame system and cancels on scene exit. No runtime template behavior changes in this slice.
