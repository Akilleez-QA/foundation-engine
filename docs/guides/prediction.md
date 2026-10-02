# Optional bounded prediction and reconciliation

This optional helper predicts finite creator-defined data by replaying captured
inputs through a pure reducer. It supplies no physics, simulation clock, smoothing,
ECS mutation or accepted gameplay effects. Creators may omit it or use a maintained
networking framework's existing prediction owner. Do not layer two prediction owners
over the same state. The native diagnostic passed on clean `8317c69`; see
[acceptance evidence](../verification/authority-20261001/README.md). NW-03 is integrated on private `main` by merge `b6fb4a3` (PR #123 in the private development history). Exact head `883f4ad` passed all seven template gates: 2,018 tests, 129 performance checks, zero enforced breaches/regressions/inconclusive results and four advisory heap warnings. Combined main tests (2,018) and build passed.

## Baseline and control ownership

`createPrediction` takes a trusted control `epoch`, an initial baseline
`{revision, processedThrough, stateJson}`, creator validators/reducer, and explicit
limits. The baseline state and processed prefix must come from the same coherent
authoritative checkpoint. A disclosure sequence, transport acknowledgment or latest
unrelated receipt cannot substitute for that prefix.

The initial floor can be nonzero after recovery. Later prefixes cannot acknowledge
inputs beyond this owner's initial floor plus locally admitted contiguous inputs.
A new connection, controlled subject or discontinuity requires a trusted replacement
owner and baseline. An arbitrary incoming epoch cannot grant that authority. Multiple
writers sharing one command stream require explicit control arbitration; this helper
does not invent it.

## Example and return values

These optional exports are available from `@kits/network`. This
small integer example demonstrates data flow, not a required game simulation.
The host must provide the trusted epoch and coherent baseline in a real consumer.

```ts
import { createPrediction } from '@kits/network';

const integer = (value: unknown) =>
  typeof value === 'number' && Number.isSafeInteger(value);
const prediction = createPrediction({
  epoch: 'controller-1',
  baseline: { revision: 0, processedThrough: 0, stateJson: '0' },
  limits: {
    state: { maxBytes: 64, maxNodes: 1, maxDepth: 1 },
    input: { maxBytes: 64, maxNodes: 1, maxDepth: 1 },
    maxPending: 8, maxPendingBytes: 512, maxReplaySteps: 8,
  },
  validateState: integer,
  validateInput: integer,
  reduce: (state, input) => JSON.stringify(Number(state) + Number(input)),
});
const first = prediction.push('2');
if (first.status === 'predicted') {
  // Send or retry these exact facts through the creator's transport:
  console.log(first.input.sequence, first.input.json); // 1, "2"
}
prediction.push('3'); // Pending suffix: sequence 2.
prediction.reconcile({
  epoch: 'controller-1', revision: 1, processedThrough: 1, stateJson: '1',
});
console.log(prediction.read().predicted?.value); // 4: corrected 1 + pending 3.
prediction.dispose();
```

`push` returns its captured command under `result.input`, including `sequence`,
`value`, `json` and `bytes`. `read().confirmed.state` and `read().predicted` contain
`{value,json,bytes}` rather than bare game values. Handle non-success statuses
before reading result-specific fields. Invalid construction throws; a malformed or
schema-invalid push, capacity exhaustion or failed reducer invalidates the entire
owner and clears its pending predictions. These are resynchronization events, not
permission to skip an individual sequence.

## Input, replay and correction

`push(inputJson)` captures an already normalized wire-equivalent input, predicts
once, and returns its sequence and canonical JSON for sending or exact retry. Any
codec quantization must happen before this call. Predicting the original object and
sending a separately rounded value would violate the contract. Frozen captured
inputs remain stable if the caller later changes its original data.

`reconcile({epoch,revision,processedThrough,stateJson})` adopts the paired baseline
and replays only its retained unprocessed suffix. Lower revisions are obsolete.
Equal revisions with equal canonical baseline facts are duplicates; conflicting
facts require resynchronization. A foreign epoch returns `foreign` without
adopting or replacing the current owner. A newer revision may keep the same prefix when
other authoritative work changes state, but cannot move the prefix backward.

Count, total pending canonical bytes, state/input JSON structure and replay steps
have separate limits. Replay traverses the retained array, never a numeric range
supplied by a remote sequence. Capacity and replay-work limits are checked before
extra reducer calls. Throwing or invalid reducer output cannot publish a partial
replay. Reads see complete published states, not a working draft. Correction facts
are separate from accepted consequences. `correction.changed` compares the final
post-replay prediction to the previous prediction, not the incoming baseline alone;
`correction.replayed` counts replayed suffix inputs. A new successful `push` clears
`correction` to `null`.

The reducer must be deterministic for its captured inputs and perform no external
writes, sounds or other accepted effects. The engine cannot sandbox arbitrary
creator callbacks. Dispose and invalidate take effect even during a callback;
ordinary reentrant mutations return busy instead of publishing over each other.

## Refusal, overflow and lifecycle

A refused send leaves the already predicted input available for exact retry. Retry
its returned sequence and JSON; calling `push` again predicts another command.
An unconsumed authorization/schema refusal leaves a sequence gap. Keep and retry
that exact input when permitted, or explicitly invalidate and obtain a fresh trusted
control baseline. Never silently drop the gap or renumber later inputs.

A terminal domain rejection can consume its sequence with unchanged authoritative
state. Reconciliation then removes that input and replays the suffix normally.
This differs from a transport or authorization refusal, which consumes nothing.

`invalidate` clears pending input and predicted/correction facts and marks prediction
unavailable. Last-confirmed baseline may remain explicitly stale for display.
`dispose` retires the owner and clears its owned facts. Recovery constructs a fresh
trusted owner; it does not accept an arbitrary network reset. Already-returned
immutable values cannot be recalled from caller storage.

Use the existing [scene activity hook](scene-activity.md) and frame scheduler for
consumer lifecycle and presentation. No additional animation loop is needed. A
successful reducer or visible correction is not a durable write; see
[durable authority](durable-authority.md).

Acceptance must demonstrate a deliberate visible correction and suffix replay under
delayed, duplicate and reordered baselines, actual scene/control retirement, and
bounded callback work. Sending inputs and displaying authoritative snapshots alone
is not prediction evidence. NW-03 in the [acceptance ledger](upgrade-acceptance-ledger.md)
is integrated through PR #123 with those finite checks recorded. DV-01 remains open; the minimum phone, tablet and laptop/desktop profiles are pending creator selection.
