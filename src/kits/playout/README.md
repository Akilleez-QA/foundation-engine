# Optional remote playout

`@kits/playout` presents remote state smoothly. Snapshots from an authority arrive
irregularly; showing each one as it arrives makes remote subjects stutter. This
kit estimates the authority's clock from round-trip samples and keeps a short,
bounded history per subject, so a client can present the world a little in the
past and interpolate between the snapshots that bracket that moment. It is pure:
no clock, timer, transport, ECS reflection or renderer. It installs nothing and a
game can omit it. Prediction of the local player stays with
[`createPrediction`](../network/README.md#optional-authority-and-prediction-exports).

The composition guide is [remote playout](../../../docs/guides/remote-playout.md);
the decision record is [ADR 0093](../../../docs/adr/0093-remote-playout.md).

```ts
import {createClockOffset, createPlayout} from '@kits/playout';

const clock = createClockOffset({maxSamples: 16, maxRoundTrip: 400, maxSlew: 0.02, snapBeyond: 200});
const playout = createPlayout({
  limits: {width: 3, maxSubjects: 64, maxSnapshots: 16},
  delay: {min: 50, max: 400, jitterFactor: 3, adapt: 0.05}, // example values in authority milliseconds
  maxExtrapolation: 100,
});
// creator ping protocol: on each reply
clock.sample({sent, remote, received});
// after receiver.receive(json) is 'accepted' (complete frames, or frames rebuilt by a view delta decoder):
const now = clock.remoteNow(localNow);
if (now !== null) playout.observe(view.worldRevision, now); // once per frame, stamped with authority time
for (const e of view.entities) playout.push(e.id, view.worldRevision, positionOf(e)); // remove() ids that left
// each presented frame (nothing to present until the first ping reply):
const now = clock.remoteNow(localNow);
if (now !== null) {
  const render = playout.advance(now);
  playout.trim(render);
  const r = playout.sample(id, render, out); // exact | interpolated | extrapolated | held | absent | retired
}
```

## Time units

Authority stamps, ping times and local time must share one unit **and rate**:
`remoteNow` is local time plus an offset; no rate is estimated. If the authority
counts ticks, convert stamps to the local unit (tick × tick length) before calling
`sample`, `observe` and `push`. Slow drift between clocks is followed only through
fresh samples, so keep pinging while connected.

## Clock offset

- **Input.** `sample({sent, remote, received})`: local send and receive times of
  one round trip and the authority's time in its reply. Malformed, negative or
  longer-than-`maxRoundTrip` samples are `refused` and never throw (they are
  network data).
- **Estimate.** `remote - (sent + received) / 2` from the sample with the smallest
  round trip among the last `maxSamples`; its error is at most half that round
  trip. `estimate()` returns `{offset, roundTrip, samples}` or null.
- **Application.** `remoteNow(local)` adds an applied offset that moves toward the
  estimate by at most `maxSlew` per unit of local time, so a better sample does not
  make presentation jump; a difference above `snapBeyond` (and the first estimate)
  applies at once, so `remoteNow` is non-decreasing only while slewing; a snap or
  `reset` can step it back (the playout buffer's render time still never goes
  back). Local time must be finite and must not decrease (throws). Samples whose
  offset exceeds 2^53 are refused, and a non-representable result reads as null.
- **Lifetime.** `reset()` forgets samples (another authority); `dispose()` is
  terminal (`retired`).

## Playout buffer

- **Push.** `push(subject, remoteTime, values, {discontinuity?})` stores `width`
  finite numbers per snapshot in a per-subject ring. Equal time is `duplicate`,
  older time `out-of-order` (counted); a new subject beyond `maxSubjects` is
  `saturated`; a full ring evicts its oldest snapshot (counted). An equal time
  with `discontinuity` is `replaced` (the snapshot takes the new values and is cut
  from its predecessor). A snapshot for a
  time already presented is stored and counted as `late` (the delay was too short).
  Subjects are nonnegative safe integers or nonempty strings up to 256 code units;
  `1` and `'1'` are different subjects (view ids are strings, ECS entities numbers).
- **Delay.** `observe(remoteTime, remoteNow)` once per received frame updates
  smoothed lateness, its mean deviation and the snapshot interval (gain 1/8). The
  target delay is `lateness + interval + jitterFactor * deviation`, clamped to
  `[delay.min, delay.max]`. `advance(remoteNow)` moves the applied delay toward the
  target by at most `delay.adapt` per unit of remote time and returns the render
  time, which never decreases, even if the remote clock estimate steps back. The
  first `advance` after the first observation starts at the target delay.
- **Sample.** Between snapshots: `interpolated` (through the optional `blend`,
  default linear). Past the newest: `extrapolated` from the last two snapshots for
  at most `maxExtrapolation` and at most one snapshot interval beyond it; past
  that the subject is `held` at the furthest extrapolated value. A custom `blend`
  sees `t` above 1 (at most 2) only when extrapolating. Across a
  discontinuity the earlier state is `held` until the jump's time, then the jump
  shows (`exact`); nothing extrapolates off a jump. Before the oldest retained
  snapshot the oldest is `held`. `out` is untouched only for `absent` and `retired`.
- **Trim.** `trim(renderTime)` drops snapshots older than the bracket at
  `renderTime` but always keeps two, so extrapolation remains possible.
- **Lifetime.** `clear()` forgets subjects but keeps the timeline and delay;
  `reset()` also forgets the timeline and delay estimate (a new authority or
  session, together with `clock.reset()`); neither resets the counters.

## Bounds, overload, cancellation and recovery

Memory is fixed by limits: `maxSubjects * maxSnapshots * (width + 1)` numbers at
most 16,777,216 (checked at construction), allocated per subject on first push
and freed by `remove`; the clock keeps `maxSamples` (at most 1,024) pairs. Work
per sample is O(retained snapshots of that subject). Overload is counted, never
queued: eviction, refusal, out-of-order and late snapshots appear in `stats()`,
which also reports the applied and target delay. There is no asynchronous work to
cancel; `remove`, `clear` and `dispose` retire state. The creator's `blend` runs
synchronously inside `sample`; calls back into the same buffer throw and entries
it leaves unwritten take the earlier snapshot. Snapshot values are network data:
a non-finite blend result (for example overflow between extreme values) is
reported as `held` at a stored snapshot instead of throwing. Invalid host input
(non-finite times, wrong widths, bad options) throws before any change.

## Evidence and limits

Eight headless tests: clock estimation, slew, snap and refusal; interpolation,
discontinuity holds and capped extrapolation; ordering, capacity, eviction and
trim; delay adaptation within bounds with non-decreasing render time; blend
reentry; late and replaced snapshots, overflow-safe sampling, delay seeding and
`reset`; and a 20-second composition with the real network view receiver, a client
clock 5 s behind the authority, 30 to 110 ms one-way jitter and 20 views per
second. In that run the presented position matched the authority's motion at the
render time (error below 1e-14 units), the per-frame step deviated from steady
motion by at most 1.1 ms of motion against 84 ms for presenting the newest view as
it arrives, 1,061 of 1,063 measured frames interpolated (2 extrapolated), the delay settled near 170 ms, four snapshots arrived late, and the
clock estimate was within 3 ms (half the best 80 ms round trip bounds it).

Not established: the ping protocol, transport, local-player prediction, physical
devices, browsers, WAN conditions or any game's feel. Composition with the
optional view delta codec is by layering (its decoder feeds the receiver) and is
not exercised by these tests.
