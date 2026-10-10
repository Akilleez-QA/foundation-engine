# Rewind history: judging remote commands against what the sender saw

An authoritative host receives a command some time after its sender decided it,
and the sender was itself looking at a slightly old picture of the world (network
delay plus whatever display delay the client adds to smooth remote motion). If the
host tests the command against current positions, moving targets are judged where
they are now, not where the sender saw them. The optional
[`@kits/rewind`](../../src/kits/rewind/README.md) kit keeps a bounded history so
the host can test against the earlier picture, under a cap the creator chooses.

This guide composes the kit with existing owners. It adds no loop, timer or
service; every step below runs inside code the creator already has.

## 1. Record after each authoritative step

Record from the host's own authoritative state, at the end of the fixed step that
produced it (the `fixed` lane in `core/ecs/systems.ts` or the creator's own host).
Use one time unit per history (seconds or ticks), the same one the commands carry.

```ts
const history = createRewindHistory({limits: {width: 3, maxSubjects: 64, maxSamples: 40, maxRewind: 0.5}});
// in the host's fixed-step system, after movement:
for (const [entity, t] of world.query(Transform, Hittable)) history.record(entity, simTime, [t.x, t.y, t.z]);
history.trim(simTime);
```

Size `maxSamples` as at least `ceil(record rate * maxRewind) + 3` when you record
then trim each step (here 60 Hz × 0.5 s + 3 = 33). Too small a ring is reported by `stats().evicted` and older queries then
answer `before-history`.

Mark jumps: the first record after a teleport, respawn or correction passes
`{discontinuity: true}` (at the same time as the pre-jump record it replaces it).
A subject not recorded for `maxRewind` is forgotten by `trim`. Call `remove(entity)` when the subject stops existing.

## 2. Carry the sender's view time in the command

The client includes the time of the world picture it showed when the command was
made (for example the view sequence or simulation time it was presenting). This is
creator protocol; `@kits/network` intake only bounds and authorizes the command.
Treat the field as untrusted.

## 3. Choose a time, query and test

In the command's dispatch (after the intake's authorization), choose a time and
read past state into a scratch buffer. Nothing in the world is moved, so there is
nothing to restore if the hit test throws.

```ts
const when = chooseRewindTime({
  now: simTime,
  claimed: command.viewTime,
  maxRewind: 0.5,          // the creator's fairness cap
  behind: latencyEstimate, // optional host estimate; with maxSkew it overrides an implausible claim
  maxSkew: 0.1,
});
const out = new Float64Array(3);
const targets = [];
for (const id of candidates) {
  const r = history.sample(id, when.time, out);
  if (r.status === 'exact' || r.status === 'interpolated' || r.status === 'current') {
    const p: [number, number, number] = [out[0]!, out[1]!, out[2]!];
    targets.push({id: String(id), from: p, to: p, radius: 0.5});
  }
}
const hit = sweep(command.from, command.to, command.radius, targets); // @kits/combat
```

Use a spatial broad phase (`@kits/spatial`) on current positions widened by the
largest distance a subject can travel in `maxRewind`, so the candidate list stays
small. Commit the consequence through the creator's authority path as usual.

## Choices that stay with the creator

- Whether to rewind at all, and for which commands and subjects (teammates,
  the sender itself and invisible subjects are usually excluded).
- `maxRewind`: larger is fairer to distant senders and harsher to targets who
  moved behind cover after being seen.
- What `discontinuous` and `before-history` mean (usually: not hittable).
- Interpolation (`blend`) for angles or rotations; the default is linear.

## Limits

The kit does not estimate latency, synchronise clocks, rewind poses or physics
that were not recorded, or establish multiplayer, browser or device acceptance.
Its evidence is headless unit tests and one local micro-measurement; see the
[kit contract](../../src/kits/rewind/README.md#evidence-and-limits).
