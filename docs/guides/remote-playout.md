# Remote playout: smooth presentation of authoritative views

A client that shows each authoritative view the moment it arrives presents remote
subjects in jerks: views arrive irregularly, some late, some lost. The optional
[`@kits/playout`](../../src/kits/playout/README.md) kit lets the client present the
world a short, adaptive delay in the past, on the authority's clock, and
interpolate between the views that bracket that moment. This guide composes it with
existing owners; it adds no loop, timer, service or transport.

## 1. Stamp views with authority time

Put the authority's simulation time (or tick) in each complete view. The view's
`worldRevision` is a nonnegative integer and works when the authority advances it
with time (for example simulation milliseconds or ticks); otherwise put a time in a
field. One unit throughout.

## 2. Estimate the authority's clock

Add a ping to the creator protocol: the client sends its local time, the authority
replies with that value and its own time, and the client calls
`clock.sample({sent, remote, received})`. A few per second while connected is
typical. `clock.remoteNow(local)` then gives the estimated authority time, slewed
so better samples do not cause visible jumps.

## 3. Feed accepted views into the buffer

After `receiver.receive(json)` reports `accepted` (from the
[complete scoped-view guide](network-views.md)), call `playout.observe(stamp,
clock.remoteNow(local))` once, then `push` each entity's presented numbers with the
same stamp. `remove` ids that left the view. Pass `{discontinuity: true}` when an
entity's incarnation changes or the authority reports a jump. If the client uses an
optional view delta decoder, it feeds the receiver as before; the playout buffer
only sees adopted complete views.

## 4. Present

In the presentation (frame) lane, not the fixed simulation lane:

```ts
const now = clock.remoteNow(localNow);
if (now !== null) {
  const render = playout.advance(now);
  playout.trim(render);
  for (const [entity, t, remote] of world.query(Transform, Remote)) {
    const r = playout.sample(remote.id, render, out);
    if (r.status !== 'absent' && r.status !== 'retired') {
      t.x = out[0]!;
      t.z = out[1]!;
    }
  }
  world.touch();
}
```

The local player's own subject is presented from prediction, not from this
buffer.

## Choices that stay with the creator

- `delay.min` and `delay.max`: smoothness against how far in the past remote
  subjects are shown. A server that judges commands against past state (see
  [rewind history](rewind-history.md) where available) should use a matching
  look-back.
- `jitterFactor` and `adapt`: how much margin to keep and how quickly to react.
- `maxExtrapolation`: how long to guess past the newest view before holding.
- `blend`: rotation or angle interpolation (the default is linear).
- What to show for `held` (a frozen subject) and when to treat a subject as gone.

## Limits

The kit does not carry pings, choose a transport, predict the local player or
establish browser, device or WAN acceptance. Its evidence is headless tests,
including a 20-second jittered composition with the real view receiver; see the
[kit contract](../../src/kits/playout/README.md#evidence-and-limits).
