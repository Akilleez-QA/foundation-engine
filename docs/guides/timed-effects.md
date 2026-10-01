# Optional timed contributions

`createTimedEffects` extends the capabilities kit's existing `createModifiers`
seam with bounded, scene-owned contribution lifetimes. Creators supply statistic
names and base values, contribution amounts, deadlines, simulation time, and the
conflict policy on every admission. No class, damage, duration, stacking limit per
category, device profile or game rule is selected by the framework.

```ts
const effects = createTimedEffects({ base: { speed: 2 }, now: 0 });
const accepted = effects.apply({
  key: 'calibration', expiresAt: 5,
  modifiers: [{ stat: 'speed', add: 1, multiply: 1 }],
}, 'replace');
// Existing scene system: effects.advance(ctx.time.t); consume effects.values().
// Scene exit: effects.cancelAll().
```

Import from `@kits/capabilities` when the kit entrypoint export is installed.
The creator chooses whether `speed` controls movement, animation or another model.
The kit never mutates an actor or invokes an outcome callback. Equipment and other
permanent changes require a creator-defined combined base/projection contract;
this owner does not mutate another modifier owner's sources.

## Ownership and semantics

An owner captures its base once. `apply(input, policy)` captures and freezes fields
and contributes until `expiresAt`. `reject` reports `conflict` if that key already
has live entries; `stack` adds an independent entry; `replace` replaces **all** live
entries with that key. Every successful admission returns a fresh opaque handle.
Identical stack requests intentionally add another contribution: admission is not
an idempotent network operation.

`cancel(handle)` accepts only the exact handle object from this owner. Copies,
serialized handles, handles from another owner, and retired handles return false.
Replacing a key makes all its previous handles stale. The owner retains no terminal
history. Handles have increasing safe-integer serials; exhaustion throws without
changing state. `snapshot()` exposes frozen live facts and handles for inspection;
it is not a durable checkpoint format or a restore contract.

`advance(time)` accepts finite monotonic caller time. Expiry is inclusive at the
exact deadline. A new effect with deadline at or before the current time reports
`expired`. The creator chooses the time domain; no interval, clock, scheduler or
offline-time accounting is installed. Always advance before admitting or consuming
at a new simulation instant. Call `cancelAll()` on scene disposal; retaining the
owner after disposal is application ownership, not automatic framework cleanup.

## Bounds, arithmetic and recovery

Defaults: 256 live effects, 64 **total live modifier records**, at most 256 base
statistics. Configurable limits are 1–4096 effects and 1–64 total modifier records.
Identifiers contain 1–256 characters. Each input has at most the configured modifier
count. Invalid input throws; an otherwise valid candidate beyond either live bound
reports `capacity`. Replacement checks bounds after removing replaced entries.
There is no queue or hidden eviction. Cancelled/expired capacity is immediately reusable.

All effects are ordered by key, then admission serial; modifier order inside an
effect is preserved. Contributions are flattened into one atomic transaction in
`createModifiers`, retaining its `(base + sum(add)) * product(multiply)` arithmetic
and finite-result validation. Negative additions and zero multipliers are valid;
negative multipliers and unknown statistics reject. The 64-record total bound
reuses that owner's existing transaction limit. It is a bounded initial framework,
not a promise of arbitrarily large effect sets. A mutation costs at most a bounded
sort plus the modifier owner's scan across configured records and base statistics.
A work bound is not a measured CPU-time guarantee.

Addition, replacement, cancellation and batch expiry validate the whole candidate
before publication. Removal can overflow when a remaining multiplier or addition
was previously offset by another contribution. Such failure throws and preserves
all effects, handles, values **and time**. The caller can cancel another contribution,
replace a key with a safe candidate, clear all contributions, or advance to a later
time that expires the whole problematic group. `cancelAll()` restores the validated
base together. No inverse arithmetic, partially removed batch or external callback
rollback is claimed. Arbitrary caller getter side effects are outside the owner;
reentrant owner mutations during input capture throw.

## Evidence and limitations

`src/kits/capabilities/timed-effects.test.ts` exercises policies, stale handles,
foreign sessions, deadlines, bounds, caller mutation, reentry and arithmetic failure.
Its headless scene consumes temporary speed through the existing frame system,
observes exact-deadline expiry and retires state on exit. This establishes local
composition behavior; it does not certify rendered feedback, device performance,
network authority, saved effect restoration or arbitrary creator formulas.
