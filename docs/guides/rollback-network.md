# Rollback over lossy links: delay, departures, spectators and evidence

`@kits/rollback` sessions (see the [kit README](../../src/kits/rollback/README.md)) assume a reliable, ordered link,
a fixed input delay and a fixed set of players. This guide covers the optional extensions (ADR 0140). Each one is
opt-in: without it, a session behaves exactly as before.

They are transport-neutral and caller-driven. You pass your own clock value and move plain-object messages over your
own transport. Nothing here starts a timer or opens a socket.

## Choose what you need

| Need | Use |
|---|---|
| Inputs or packets may be lost, duplicated or reordered | `createRollbackExchange` (redundant resend with acknowledgements) |
| Latency varies during a match | `adaptiveDelay` on every session, `recommendInputDelay` on the authority |
| One peer runs ahead | `exchange.read().pacing` (skip a tick when `skip` is true) |
| A player can leave without ending the match | `departure: {input}` on every session, `timeout` on the exchange |
| Viewers who never send input | `createRollbackSpectator`, served with `exchange.toSpectator` |
| Restart from an agreed state, or let a viewer join late | `start` (sessions) or `join` (spectators) |
| Understand a desync after the fact | `evidence` on sessions, `createDesyncEvidenceStore` |
| Test any of this without a network | `createLossyLink` (a seeded test link) |

## A peer's tick

```ts
import {createRollbackExchange, createRollbackSession, recommendInputDelay} from '@kits/rollback';

const session = createRollbackSession({
  local, neutralInput: '0', limits, ports,
  adaptiveDelay: {minDelay: 1, maxDelay: 6, maxStep: 2, minSpacing: 30, authority: 0},
  departure: {input: 'repeat'},
  retainInputFrames: 2 * limits.maxPredictionFrames + 2 * 6 + 4,
  evidence: {frames: 4, maxBytes: 16384, chunkBytes: 1024},
  signal: visitSignal,
});
const exchange = createRollbackExchange({
  session,
  limits: {maxInputsPerMessage: 64, maxChecksumsPerMessage: 4, roundTripSamples: 16},
  pacingThreshold: 1,
  timeout: 3000, // in your clock's units
});

// Once per fixed tick:
for (const message of transport.drain()) exchange.receive(message, now);
exchange.expire(now);                       // silence longer than timeout starts a departure
if (!exchange.read().pacing.skip) {         // pacing: the ahead peer skips the tick
  session.local(readInput());
  session.advance();
}
for (const peer of peers) transport.send(peer, exchange.outgoing(peer, now));
```

The delay authority also proposes a delay now and then. The values here are examples, not recommendations.

```ts
const rtt = Math.max(...exchange.read().roundTrip.filter((v): v is number => v !== null));
const current = session.read().delayChanges.at(-1)?.delay ?? session.read().delay;
const next = recommendInputDelay({roundTrip: rtt, frameTime: 1000 / 60, current, policy: adaptiveDelay});
if (next !== current) session.proposeDelay(next);
```

## What each guarantee rests on

- **Delay changes** take effect at a frame every peer knows in time. The decision rides on the authority's input
  frame `X`. It applies from `X + maxPredictionFrames + maxDelay + 1`, which no peer's queued input can have reached
  before it confirms `X`. A late decision is a protocol fault, never a quiet difference.
- **Departures** settle on the largest frame any survivor holds, so nothing already confirmed changes. Survivors
  relay the missing inputs; after that frame the player's input follows your rule. A peer decides only while at
  least `quorum` players remain (default: a strict majority), so the isolated side of a partition stalls instead of
  deciding. Keep sending `outgoing(peer)` to departed peers for a while: it then carries only the departure notice,
  and a voted-out peer that hears it fails with `local-departed`. Two players need `quorum: 1`, which is not
  partition-safe. Two departures whose agreements overlap could disagree in principle; a difference that reaches a
  peer fails it closed.
- **Spectators** step only fully confirmed frames, served only once every remaining peer holds them, and compare
  checksums with the peers.
- **Resume** requires the start state's checksum, and the start is part of `read().config` for your handshake.

## Bounds, overload and recovery

Every count is checked when the session or helper is built (see the kit README's table). Under overload the
extensions degrade, they do not grow:

- A message carries at most `maxInputsPerMessage` inputs.
- A spectator buffers at most `maxBufferedFrames` frames; the sender repeats the rest later.
- Evidence is truncated to `maxBytes`, and the store refuses chunks beyond its budget.

Structurally malformed messages are rejected without touching the session. Protocol faults (an invalid input, an
out-of-policy delay, a conflicting departure, a peer voted out) fail the session closed, as before. Below the
departure quorum the session stalls rather than deciding. Recovery is the creator's: build new sessions from an agreed `confirmedState()` with `start`.

Cancellation: the session's `signal`, a spectator's `signal`, or `dispose()`. The exchange and the evidence store hold
no resources beyond their bounded maps.

## Testing with the lossy link

```ts
import {createLossyLink} from '@kits/rollback';
const link = createLossyLink<string>({seed: 7, loss: 0.25, duplicate: 0.1, reorder: 0.2, latency: [1, 5], bandwidth: 4000});
link.send(from, to, JSON.stringify(message), now, bytes);
for (const text of link.receive(to, now)) exchange.receive(JSON.parse(text), now);
```

The same seed replays the same losses, duplicates, reorders and timings. It is a model for tests, not a measurement
of any real network.

## Evidence and limits

Checked: seeded randomized runs with 3 and 4 peers and two spectators, one of them joining late, over lossy links.
The runs include delay increases and decreases and a departure. Every checksum agrees with a no-network reference
replay, and every survivor holds the same departure and delay schedule. Unit tests cover each refusal and bound, and
a scene system drives the exchange from the fixed lane.

Not established:

- real transports or WAN;
- a new player joining a running match;
- delay decisions after the authority leaves;
- partition safety without a strict-majority quorum (and so for two players);
- frame stretching;
- message authentication;
- cross-browser floating point;
- physical devices or multiplayer acceptance.

The kit README lists these limits in full.
