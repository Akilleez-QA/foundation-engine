# Optional action phases

`createActionPhases` from `@kits/capabilities` describes one action as a creator-authored
timeline. A timeline has named **windows** and named **marks**. Windows are half-open
position ranges, for example "listen for the next input", "a follow-up may interrupt",
"protected", "cannot turn" or "contact is active". A mark is a position where something
becomes due exactly once, such as a cost payment or an effect. The helper is pure and
optional. It stores no actors and installs no clock, callback, scheduler, effect or
persistence owner. A game that does not import it is unchanged.

Tracking: [issue #229](https://github.com/Akilleez-QA/foundation-engine/issues/229),
[ADR 0088](../adr/0088-action-phase-windows.md).

## Creator requirement and seam

Many action games author attacks, evasions and tool uses as timelines in fixed simulation
ticks. They then need answers to questions like these:

- Is a buffered press allowed to interrupt now, for this kind of follow-up?
- Is this actor protected or turn-locked at this position?
- Has this hit's cost already been charged? Has its contact already landed in this range?

Hand-written versions of these answers tend to fail in the same places:

- costs charged twice when one action hands over to another;
- effects skipped when a step crosses several milestones at once;
- contact that lands every tick instead of once per range.

Existing owners stay in charge:

- [`@kits/input-history`](../../src/kits/input-history/README.md) records, buffers and consumes inputs;
- [action runs](action-runs.md) admit identities and handle completion;
- `resolveAction` and `createShots` in `@kits/combat` resolve consequences;
- the animation kit's root motion moves the actor.

Animation markers remain presentation-only. Do not drive simulation marks from them.

## Inputs and outputs

```ts
import { createActionPhases } from '@kits/capabilities';

const phases = createActionPhases({
  timelines: [{
    id: 'swing', length: 30,                       // creator unit: here fixed ticks
    windows: [
      { id: 'listen', ranges: [[8, 30]] },
      { id: 'cancel:attack', ranges: [[18, 30]] },
      { id: 'contact', ranges: [[10, 14], [20, 23]] },
    ],
    marks: [{ id: 'pay-1', at: 10 }, { id: 'pay-2', at: 20 }],
  }],
});

let state = phases.start('swing');               // plain, frozen: {timeline, definition, position, marks, claims}
const step = phases.advance(state, 1);           // one fixed tick; pass 0 for a frozen (hit-stop) actor
for (const mark of step.marks) { /* charge the cost named by mark.id once */ }
state = step.state;
if (phases.isOpen(state, 'cancel:attack')) { /* consume the buffered press; start the follow-up */ }
const contact = phases.claim(state, 'contact');  // once per open range
if (contact.kind === 'claimed') { state = contact.state; /* resolve, e.g. id `${serial}:${contact.range}` */ }
```

| Call | Result |
|---|---|
| `start(id)` | A fresh state at position 0 with no marks delivered and nothing claimed. |
| `advance(state, delta)` | Moves forward by `delta` (finite, `>= 0`), clamped at `length`. It returns the new state and every mark that became due, ordered by position and then declaration. `endedNow` is true only on the step that reaches the end. |
| `isOpen(state, window)` / `open(state)` | Window membership is `from <= position < to`. A window may have several ranges. Nothing is open at the end position. |
| `claim(state, window)` | `claimed` with a new state and the flattened range index, `already-claimed` with the unchanged state and the same index, or `closed`. Ranges within one window may touch but not overlap. |
| `openRange(state, window)` | The flattened index of the open range, or `-1`. Use it with an action serial and target to build per-target identities for a consequence owner. |
| `pending(state)` | Marks not yet delivered or suppressed. |
| `suppress(state, ids)` | Retires marks without delivering them. Use it for a handover whose costs were settled elsewhere. |
| `restore(data)` | Reads each field once and validates it against the current definitions, returning `restored` or `invalid` with a reason. It never throws. States from a changed definition, and states no step sequence could produce (a mark left undelivered behind the position, a claim on a range not yet started), are invalid. `-0` is normalized. |

Every result is frozen. States hold primitive values only, so `JSON.stringify` round-trips them.
Mark and claim bits are positional (declaration order). Each state therefore carries a
`definition` fingerprint of its timeline's length, windows, ranges and marks; any edit to
those invalidates older states rather than silently reinterpreting their bits.
Advancing the same state twice gives equal results. That is the rollback contract: store the
state with the actor and replay from it.

### Time units and determinism

Positions use the creator's unit. Integer ticks are recommended. With integer steps, the
delivered marks and the final state do not depend on how steps are partitioned (one step
of 30 or thirty steps of 1). Fractional steps in seconds work, but floating-point sums can
land a hair before a boundary. The creator decides how render time maps to ticks. Hit-stop
is a zero step. Play-rate is a scaled step.

In the usual advance-then-query loop, position 0 is observed only before the first step.
A `[0, 4)` window is then seen on ticks at positions 1, 2 and 3. Query before advancing
when the first position should count, as the per-request example in the tests does.

## Ownership, bounds and overload

- The caller owns each state value. The helper owns only the immutable definitions it
  captured at creation, reading each input field once.
- Per timeline: at most 32 marks and 32 window ranges in total (bit sets), ids of 1–256
  UTF-16 code units, non-overlapping ranges within each window, `0 <= from < to <= length`, `0 <= at <= length`, positive finite length.
  Timeline count defaults to 256, with a maximum of 4,096.
- Malformed definitions, including non-object entries and array holes, throw `RangeError`
  at creation. No partial set is created. A throwing input getter propagates its own error.
- `suppress` accepts at most 32 ids per call.
- `advance` and the queries visit at most 32 marks or ranges. Results allocate only their own records.
- Every operation reads a state's fields exactly once and validates that copy. An invalid
  delta, a nonfinite position sum, an unknown timeline, window or mark, or a state that
  `restore` would reject throws `RangeError` before any result is produced.

## Cancellation and recovery

To cancel an action, drop or replace its state. Marks not yet delivered then never fire.
`suppress` covers the explicit handover case. A restore that fails leaves the caller's
current state untouched, and the caller chooses a fallback such as idle. Changing a
definition between save and load makes old states invalid through the fingerprint;
`restore` reports this and does not migrate. Migration (for example restarting the
action, or mapping by mark id) is a creator decision.

## Limits

- This is not a combat system. It has no damage, stamina, priority, hit-reaction or
  move-selection rules, and no target or contact geometry.
- One state covers one action instance. Per-target "hit once" bookkeeping across many
  targets belongs to the consequence owner (for example `createShots` identities built from
  the action serial, `openRange` and the target).
- The fingerprint is a 32-bit hash plus length: it detects edits, it is not a security check.
- Marks are facts for the caller. Applying a cost and recording the delivered mark must
  happen in the same state transition as the consequence.
- There is no network replication or server authority.

## Evidence

[`action-phases.test.ts`](../../src/kits/capabilities/action-phases.test.ts) covers:

- exact boundaries;
- jumps across several marks;
- zero steps;
- the end transition;
- half-open and repeated ranges;
- once-only claims per range;
- suppression;
- capture-once definitions;
- the 32-bit bound;
- invalid steps and position overflow;
- hostile and changing getters in restore and advance (one read per field);
- definition fingerprints (reordered or moved marks reject old saves);
- unreachable and `-0` states;
- overlap rejection and malformed entries;
- integer partition independence;
- per-request cancel windows (evade earlier than a follow-up attack);
- a composition with input-history buffering and consumption, a cancel window,
  once-only costs, once-per-range contact through `resolveAction`, handover suppression and
  replay of a restored state.

This is headless unit evidence. It is not browser, device, template or multiplayer acceptance.
