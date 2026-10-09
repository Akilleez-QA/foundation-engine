# Optional rewind history

`@kits/rewind` keeps a bounded history of numeric samples per subject and answers
"what did this subject look like at time t?" without moving, restoring or owning
live state. An authoritative host uses it to test a remote party's command against
the picture that party was actually shown (often called lag compensation), instead
of against positions that have moved on while the command travelled. The kit is a
pure data structure: no clock, timer, scheduler, transport, ECS reflection, hit
test, renderer or save data. It installs nothing and a game can omit it.

The composition guide is [rewind history](../../../docs/guides/rewind-history.md);
the decision record is [ADR 0087](../../../docs/adr/0087-rewind-history.md).

## Creator requirement and seam

A server-authoritative game wants remote commands that depend on what the sender
saw (aiming, touching a moving target, catching, blocking) judged fairly despite
latency, with a creator-chosen cap on how far back a sender may reach. Foundation
already owns command intake and authority (`@kits/network`), swept hit tests
(`@kits/combat`) and the fixed-step lane. This kit adds only the missing piece:
bounded retained state and a time choice that the creator caps.

```ts
import {createRewindHistory, chooseRewindTime} from '@kits/rewind';

const history = createRewindHistory({
  limits: {width: 3, maxSubjects: 64, maxSamples: 64, maxRewind: 0.5}, // example values, not required ones
  // blend: optional creator interpolation for angles or quaternions; default is componentwise linear
});

// After each authoritative fixed step (the host's own state, its own time unit):
for (const [id, p] of movers) history.record(id, simTime, p);
history.trim(simTime);
// On spawn after a jump, a respawn or a new life: record(id, t, p, {discontinuity: true}). On despawn: remove(id).

// When a command arrives (claimedTime is untrusted data from the command):
const when = chooseRewindTime({now: simTime, claimed: claimedTime, maxRewind: 0.5, behind: estimate, maxSkew: 0.1});
const out = new Float64Array(3);
const r = history.sample(targetId, when.time, out); // exact | interpolated | current | absent | before-history | discontinuous
```

## Inputs, outputs and owner

- **Owner.** The creator's host constructs one history per coordinate space and
  time unit, records from its own authoritative state, and disposes it with the
  session or scene. Subjects are creator IDs: a nonnegative safe integer or a
  nonempty string of at most 256 UTF-16 code units. `1` and `'1'` are different.
- **`record(subject, time, values, {discontinuity?})`** stores `width` finite
  numbers. Per subject, time must increase: an equal time is `unchanged` (the
  stored sample is kept), an older one is `out-of-order`; neither stores anything.
  A new subject beyond `maxSubjects` is `saturated` and counted in `stats().refused`.
  Invalid subject, time or values throw before any change (they are host bugs).
- **`sample(subject, time, out)`** writes into `out` only for `exact`,
  `interpolated` (between the bracketing samples, through `blend`) and `current`
  (time at or after the newest sample: the newest sample, never extrapolated).
  Otherwise `out` is untouched and the status says why: `absent` (no history),
  `before-history` (older than anything retained), `discontinuous` (a discontinuity
  lies between the time and the present) or `retired`.
- **`chooseRewindTime({now, claimed, maxRewind, behind?, maxSkew?})`** is pure.
  A finite numeric claim is used unless `behind`/`maxSkew` are supplied and the
  claim differs from `now - behind` by more than `maxSkew`; then the host estimate
  is used. A missing or malformed claim falls back to the estimate, else to `now`.
  The result is always clamped to `[now - maxRewind, now]` and reports its `basis`
  and whether clamping applied. Host values (`now`, `maxRewind`, `behind`,
  `maxSkew`) must be valid or it throws; the claim never throws.
- **`trim(now)`** drops samples older than `now - maxRewind`, keeping the newest
  older sample as a bracket so a query exactly at the window edge interpolates,
  unless a discontinuity separates that bracket from the window. It returns the
  number dropped. `remove`, `clear`, `dispose` and `stats` complete the surface.

## Bounds and overload

Memory is fixed by limits: per subject, `maxSamples * (width + 1)` doubles plus
`maxSamples` bytes, allocated on the subject's first record and freed by `remove`.
`width` is 1–64, `maxSamples` at least 2, and
`maxSubjects * maxSamples * (width + 1)` at most 16,777,216 numbers (construction
throws above it). A full ring overwrites its oldest sample and counts
`stats().evicted`: if the record rate times `maxRewind` exceeds `maxSamples`,
older queries become `before-history`. Size `maxSamples` from the record rate.
A query walks back from the newest sample: O(samples newer than the target).
`trim` is O(subjects + dropped samples). Nothing grows with session length.

## Discontinuity, cancellation and recovery

A subject that jumps (teleport, respawn, a new life, a server correction) records
its first sample after the jump with `{discontinuity: true}`. Queries never blend
across it and never look past it; the creator decides what a `discontinuous` or
`before-history` answer means (usually: treat as not hittable, or test the
current state). A subject's first sample, and the oldest sample after `trim` or
eviction, behave as discontinuities toward older time.

There is no asynchronous work to cancel. `remove` retires one subject, `clear`
all, `dispose` the whole history (later records report `retired`). The creator's
`blend` is trusted code run synchronously inside `sample`; calls back into the
same history from it throw, and a non-finite blend result throws without writing
`out`. After an exception the history's stored samples are unchanged.

## Determinism and security

The kit is deterministic for the same calls: no clock, randomness or iteration
over unordered data affects a result. The claim is untrusted: `chooseRewindTime`
caps how far back a sender may reach (`maxRewind`) and how far its claim may
disagree with the host's own estimate (`maxSkew`). Rewinding favours the sender:
a target that has moved behind cover can still be judged by where the sender saw
it. That trade-off, the cap and whether to rewind at all are creator decisions.

## Evidence and limits

Thirteen headless unit tests cover exact, interpolated and current answers, no
extrapolation, ordering, discontinuities, ring eviction, trim brackets, subject
capacity, removal and re-addition, creator blend (including reentry and
non-finite results), limit validation, disposal, time choice and a composition
with `@kits/combat` `sweep` in which a live-state test misses and the rewound test
hits while live state is unchanged. A local micro-measurement (Node 26, x86_64,
one run, not a gate): 64 subjects of width 8 at 60 records per second with
`trim` each step cost about 2.5 µs per step, and a query about 0.1 µs.

Not established: latency estimation, clock synchronisation between parties,
network delivery, any particular game's fairness, browser or device performance,
and multiplayer acceptance. The kit does not rewind animation poses, physics or
derived geometry unless the creator records them as samples.
