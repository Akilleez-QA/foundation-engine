# Optional prediction presentation: correction smoothing and predicted-event deduplication

Two optional helpers sit beside the existing [prediction owner](prediction.md) and change
only what is presented. `createPrediction` keeps its behaviour, state and return values;
neither helper wraps, replaces or writes to it. A creator may use either, both or neither,
or keep presentation in a maintained networking framework they already use. Both are
exported from `@kits/network`. Decision record: [ADR 0142](../adr/0142-prediction-presentation.md).

Both compose the same way: read the prediction snapshot before and after one `push` or
`reconcile`, then pass the pair to `observe`.

```ts
const before = prediction.read();
prediction.reconcile(baseline); // or prediction.push(inputJson)
const after = prediction.read();
smoothing.observe(before, after);
const update = events.observe(before, after);
for (const e of update.emitted) startEffect(e.key, e.tick); // creator code
for (const c of update.cancelled) stopEffect(c.key, c.tick); // creator code
```

A reconcile is recognised by a change of confirmed revision. Duplicate, obsolete and
foreign baselines change nothing. Call `observe` around each call. If a reconcile and a
later push share one pair, the push has cleared `correction`. Event deduplication still
confirms, replays and settles. Smoothing cannot know the size of the jump, so it reports a
`missed-correction` discontinuity.

## Correction smoothing (`createPredictionSmoothing`)

**Inputs.** `width` (1..64 numbers), a pure `project(state) => number[]` returning exactly
`width` finite numbers (for example a position), `snapDistance` and `maxRatePerMs` (one
positive number or one per component), `decay` (`{kind: 'half-life', halfLifeMs}` or
`{kind: 'linear'}`), `maxElapsedMs` (at most 60,000) and `settle` (non-negative, below
every snap distance). Every bound is checked at construction; an invalid choice throws.

**Behaviour.** When `observe` sees a changed correction, the offset grows by
`project(previous prediction) - project(corrected prediction)`, so the presented value
`project(state) + offset` does not jump. `advance(elapsedMs)` decays each component
towards zero: half-life decay multiplies it by `2^(-dt / halfLifeMs)`; linear decay moves
it at `maxRatePerMs`. Either way one step moves a component at most
`maxRatePerMs * min(elapsedMs, maxElapsedMs)`. A remaining magnitude at or below `settle`
becomes exactly zero only when that whole move fits within the same step allowance. `present(state)` returns `{values, discontinuity}`.

**Snap and discontinuity.** If any component of the accumulated offset would exceed its
`snapDistance`, the correction snaps: the offset is cleared and the next `present`
reports `discontinuity: true` exactly once. Prediction invalidation or disposal, a
replacement owner (different epoch), a failed projection, `present(null)` and an
explicit `discontinuity(reason)` (for example a teleport) do the same. A renderer can use
the flag to skip interpolation or motion blur for that frame.

**Guarantee.** Between two presentations without a discontinuity, the presented value
differs from the movement of the exact predicted projection by at most the decay
allowance of the `advance` calls in between. The simulation state is never offset or
modified; only the returned values are.

**Owner, clock and loop.** The helper owns only its offset and counters. It has no clock,
timer or loop: call `advance` from the existing frame scheduler with the frame's elapsed
time, and write the presented values to presentation from the same system. Results are
deterministic for the same inputs.

**Overload, reentrancy, cancellation and recovery.** Per-call work is `O(width)`.
Reentrant calls from inside `project` return `busy`; `dispose` from inside `project`
retires the helper and the outer call returns `retired`. An invalid elapsed time returns
`invalid` and changes nothing. Recovery is a discontinuity, not a reconstruction.
`dispose` clears the offset; later calls return `retired`.

## Predicted-event deduplication (`createPredictedEvents`)

**Identity.** An event is a creator `key` (1..`maxKeyLength` characters, at most 256)
plus a non-negative integer `tick`. The same key twice at the same tick is one event; use
distinct keys (for example `"impact:2"`) for repeated effects within one tick. With `observe`, the tick is the prediction's input
sequence and `eventsOf(state)` lists the events a state records. A reducer typically
keeps a short, bounded log of `[tick, key]` entries in its state.

**Decisions.** `predict` emits a new identity once (`origin: 'predicted'`); repeating it
during a re-simulation or a duplicate is suppressed. `confirm` from the authority
suppresses an already predicted identity and emits an unpredicted one once
(`origin: 'authority'`); duplicate or out-of-order confirmations are suppressed.
`beginReplay(fromTick)` and `endReplay()` bracket a re-simulation: each unconfirmed
prediction at or after `fromTick` that was not produced again is cancelled once.
`settle(through)` states that every authority event through `through` has been
confirmed: remaining predictions there are cancelled once, and every entry there
expires. A later call at or below the settled tick is dropped as `late`. `cancelPending()`
cancels every unconfirmed prediction once, for example when prediction becomes
unavailable.

**Composition.** `observe(before, after)` does this for one prediction step. On a push it
predicts events above the confirmed prefix. On a reconcile it confirms events in the
confirmed state up to `processedThrough`, re-predicts events above it as a replay and
settles through `processedThrough`. If the prediction becomes unavailable, it cancels
pending predictions (`discontinuity`). The first observation, and any new owner (a
different epoch), starts a clean ledger at that owner's confirmed prefix: pending
predictions are cancelled, and confirmed entries and watermarks are cleared. A pair
spanning two owners is reported as `discontinuity`. An invalid `eventsOf` result cancels
pending predictions (`events-invalid`). The confirmed state's log must cover every tick since the previous
settled prefix; size the log for the largest gap (at most the prediction's `maxPending`).
Exactly-once applies to events at ticks of this client's input sequence above the settled
prefix. Suppose the authority later adds an event at an already settled tick (a new
revision with the same `processedThrough`). That event is not emitted. It is counted in
`read().dropped.late` and in the update's `dropped` count.

**Bounds and overload.** `maxEntries` (at most 65,536) bounds retained identities;
`maxEventsPerObserve` bounds one `eventsOf` list. When full, a new prediction is dropped
(`capacity`): it is not emitted. Its confirmation emits it later, unless its tick is at or
below `forgottenThrough` or already settled; then the loss is counted as `forgotten` or
`late`. A
confirmation of an unknown identity when full is emitted once without being recorded,
and the tick becomes `forgottenThrough`. Later unknown identities at or below that tick
are dropped (`forgotten`). Overload can therefore lose an effect, which is reported in
`read().dropped` and `unrecorded`, but never emits an identity twice.

**Reentrancy, cancellation and recovery.** Reentrant calls from `eventsOf` return
`busy`; `dispose` from inside retires the helper. Construction validates every limit.
The helper owns no effect, sound, clock or transport: the caller starts and stops
effects from the returned decisions. Results are deterministic for the same call order.

## Evidence

Headless unit tests in `src/kits/network/prediction-smoothing.test.ts` and
`src/kits/network/predicted-events.test.ts` drive the real `createPrediction`
reconciliation path. Seeded randomized runs check that presentation never steps
beyond the configured allowance except at reported discontinuities. Other seeded runs
check that every predicted and confirmed event is emitted exactly once and every
misprediction is cancelled exactly once. These runs include re-simulations, duplicates,
out-of-order confirmations, and reordered or duplicate baselines. Further tests cover
invalid configuration, overload, reentrancy, disposal and determinism.

## Not established

- Visual quality of any rate, half-life or snap distance on a device; tuning is the
  creator's choice and needs device review ([device experience](../policy/DEVICE-EXPERIENCE.md)).
- Smoothing of rotations or other non-Euclidean quantities: offsets are per-component
  sums. Project angles as unwrapped values or as vectors.
- Real network latency, loss or multiplayer acceptance; no transport is exercised.
- Effects whose identity cannot be expressed as a key per tick, and authority logs that
  do not cover the settle gap; both break the exactly-once claim.
- Browser or physical-device performance; per-call work is bounded by count only.
