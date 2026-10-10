# Optional rollback sessions

`@kits/rollback` lets 2–8 peers share a deterministic fixed-step simulation.
Each peer simulates ahead on predicted remote input, then rolls back and
resimulates when a confirmed input differs from the prediction. It is the
GGPO-style "speculative execution" model, written from published descriptions of
the mechanism (no GGPO, GGRS or NetplayJS code is used). The kit also includes a
local **sync test**: it checks that a creator's save/load/step ports are
deterministic before any network is involved.

The kit is a mechanism, not a game. It owns no transport, clock, timer,
matchmaking, ECS world or game rules. It installs no definitions, and a game can
omit it. For offline replay and first-divergence comparison of recorded runs, use
`@kits/replay` (SIM-01); this kit compares checksums between live peers instead.
It does not replace the server-authoritative
[prediction helper](../../../docs/guides/prediction.md): use one or the other for
a given state, never both. The recipe is
[add rollback sessions](../../../docs/recipes/add-rollback-sessions.md).

## Creator requirement and seam

The creator needs peers to see their own input with no added delay while still
ending each match in identical state. The kit reuses existing seams:

- The fixed-step lane (`core/ecs/systems.ts`): call `advance()` once per fixed tick from a system.
- Seeded randomness: `createSaveableRng` (`@engine`, `core/rng.ts`) exposes its whole state as one word, so `save` stores `rng.state()` and `load` calls `rng.restore(word)` (RNG-01). `ctx.random()` cannot be rolled back. For buffered and sequence inputs inside the simulation, see `@kits/input-history`.
- The engine FNV-1a hash (`core/rng.ts` `hashSeed`) for checksums.
- The existing browser transport, or any reliable, ordered link, to carry the facts the session returns. Over a lossy or
  unordered link, use the optional exchange (below).
- A scene visit's `AbortSignal` for cancellation.

## Inputs and outputs

```ts
import { createRollbackSession } from '@kits/rollback';

const session = createRollbackSession({
  local: 0,                    // this peer's player index
  neutralInput: '0',           // input for frames below inputDelay, and the first prediction
  limits: {
    players: 2, maxPredictionFrames: 8, inputDelay: 2,
    maxInputBytes: 16, maxStateBytes: 65536,
    checksumInterval: 10, maxChecksumHistory: 64, maxPendingChecksums: 64,
  },
  ports: {
    save: () => encode(sim),                      // the complete simulation state as text
    load: text => { sim = decode(text); },        // restore exactly
    step: (inputs, frame) => stepSim(sim, inputs, frame), // one frame; inputs[i] is player i's
    validateInput: text => /^[0-9]{1,3}$/.test(text),
  },
  signal: visitSignal,         // abort disposes
});
```

These values are configuration, not recommended game settings.

| Call | Input | Output |
|---|---|---|
| `local(input)` | This tick's input text | `queued {frame, input}`: send `{frame, input}` to every peer. `full`: this tick already has an input (for example while stalled), so the input is not queued. `invalid`: the input is too long or fails the validator; nothing is queued. |
| `remote(player, frame, input, delay?)` | A peer's input | `accepted {rollbackFrom}` or `duplicate` (`ignored` only for a departing player). Frames must arrive in order for each player. |
| `remoteChecksum(player, frame, checksum)` | A peer's confirmed checksum | `match`, `pending` (we have not confirmed that frame yet), `inconclusive` (evicted or off-interval: never a pass), or `desynced` |
| `advance()` | none; call once per fixed tick | `advanced {frame, resimulated, predicted, checksums}`, `stalled {waitingFor}`, `needs-local-input`, or `desynced {desync, checksums}`. Send `checksums` to peers. |
| `read()` | none | A frozen status, `config` (handshake text), frame, confirmed frames, predicted frame count, `frameAdvantage` per player, desync and stats |
| `confirmedState()` | none | `{frame, checksum, state}`: the newest state built only from confirmed inputs |

Ordering inside `advance()`:

1. If a confirmed input contradicted a prediction, `load` the snapshot from the earliest wrong frame, then `save`/`step` forward to the current frame.
2. Refuse to step if this peer's own input is missing (`needs-local-input`), or if stepping would exceed `maxPredictionFrames` past the confirmed frame (`stalled`).
3. Otherwise `save` the current frame, record confirmed checksums every `checksumInterval` frames, and `step`.

Remote inputs are predicted as "the same as the last confirmed input".

## Bounds and overload

| Limit | Range | Effect |
|---|---|---|
| `players` | 2–8 | Inputs per frame |
| `maxPredictionFrames` | 0–60 | Rollback depth and snapshot ring size (`+1`). 0 is lockstep. |
| `inputDelay` | 0–30 | Local input applies `inputDelay` frames later. Frames below it use `neutralInput` for every player. |
| `maxInputBytes` | 1–4096 | UTF-8 bytes per input |
| `maxStateBytes` | 1 B–16 MiB | UTF-8 bytes per saved state. Retained memory is at most `(maxPredictionFrames + 2) × maxStateBytes` plus one confirmed state. |
| `checksumInterval` | 1–3600 | Checksum cadence over confirmed frames |
| `maxChecksumHistory` / `maxPendingChecksums` | 1–4096 | Retained local checksums and held remote reports |

Work per `advance()` is at most one `load`, `maxPredictionFrames + 1` `step` calls
and `maxPredictionFrames + 1` `save` calls, plus one checksum per recorded
interval frame. A count limit is not a CPU deadline. The creator's `step` and
`save` decide the actual time. Each rollback also allocates up to
`maxPredictionFrames + 1` transient state strings (one per `save`). The snapshot
they replace becomes garbage, so a large state with deep rollbacks every tick
puts pressure on the garbage collector.

A remote input can be at most `maxPredictionFrames + 2 × inputDelay + 2` frames
ahead of the local frame. That is the most a peer with identical limits can
legitimately send. Every peer must use identical limits and the same neutral
input; compare `read().config` in the handshake.

Overload and protocol faults fail closed: the session status becomes `failed` with
a reason, buffers are released and later calls refuse. The reasons are:

- `remote-gap`, `remote-conflict`, `remote-lead`, `remote-frame`, `remote-player`, `remote-input-invalid`
- `checksum-overflow`, `checksum-conflict`, `remote-checksum`
- `state-bytes`, `save-failed`, `load-failed`, `step-failed`, `validate-failed`, `rollback-window`

A desync makes the status `desynced` and records the first differing frame, the
player and both checksums.

## Pacing: a late or hitched peer (the creator's responsibility)

The session has no time synchronization. Suppose one peer starts late, or
hitches and loses ticks. The fixed-step runner drops ticks beyond `maxSteps`
(5) and clamps a frame's `dt` to 1 s. The other peer then stays ahead for good.
It runs at the edge of the prediction window, so every late input forces a
rollback of almost the full window, and it stalls whenever the link wobbles.
Nothing re-converges by itself.

`read().frameAdvantage[p]` is this peer's frame minus peer `p`'s estimated
frame (`confirmedInputs[p] - inputDelay`). Positive means this peer is ahead.
The estimate lags by the one-way link delay. A threshold on it therefore includes
latency. The GGPO approach removes the latency term:

1. Exchange advantages between peers.
2. Pace on half the difference: `(mine - theirs) / 2`.
3. When it exceeds a creator-chosen threshold, the peer that is ahead skips
   ticks. On a skipped tick it calls neither `local` nor `advance`.

The recipe shows the simplest version; the optional exchange (below) exchanges the advantages and reports
`read().pacing`. The tests cover a 20-tick late start:

- Unpaced, the early peer stays a full window ahead.
- Skipping ticks while the advantage exceeds 3 re-converges and cuts resimulated frames by more than three times.

## Input during a stall

`local()` queues one input per frame. While the session is stalled (or after any
tick on which `local()` already queued), it returns `full` and does **not** keep
the input. An edge-style action (a press seen exactly once by a fixed tick, as with
the zero-step press latch) would then be lost. Encode held state (buttons
currently down, directions) rather than edges, so the next queued frame still
carries it. Or carry an unqueued press forward and merge it into the next input
that `local()` accepts (the recipe shows this).

## State codec hazards

The checksum is computed over the text `save` returns, so the codec defines
what "the same state" means. `JSON.stringify` turns `-0` into `0`, and `NaN`
and `±Infinity` into `null`. A value that does not survive the codec
round trip makes a live peer differ from a peer that loaded a snapshot. Prefer
integer or fixed-point simulation state. The sync test reports such a loss once it
changes a later result.

## Cancellation and recovery

`dispose()` and an aborted `signal` take effect at once and are idempotent, even
inside a port callback. The running `advance` returns `retired` after that
callback, and every later call refuses. A port that calls back into the session
gets `busy`.

Recovery means building a new session from a state both peers agree on. For
example, one peer sends `confirmedState()` over the creator's authority path and
both start again at frame 0 of a new session with it loaded. The kit does not
choose who is right after a desync.

## Determinism contract (the creator's responsibility)

`step` must depend only on the state that `save` captures and the inputs it is
given. That rules out the following:

- wall-clock reads;
- unseeded randomness, or random state outside the saved text;
- iteration order that differs between runs;
- external writes, sounds or effects inside `step`.

Floating-point results must be identical across the browsers being played; prefer
integer or fixed-point simulation state. Presentation (particles, sounds, camera)
reads the state after `advance()` and must tolerate a corrected state: keep it
outside the saved state, or recreate it keyed by frame.

Run `createRollbackSyncTest({checkDistance, players, maxStateBytes, maxInputBytes, ports})`
in tests. After every live step it saves the live result. It then rolls back
`checkDistance` frames (1–60) and compares every resimulated state's checksum
with the **live** checksum of the same frame, as GGPO's sync test does. It reports
the first differing frame for:

- hidden state outside `save`;
- an incomplete `load`;
- unseeded or wall-clock reads;
- a one-shot value the live step consumes but a replay cannot see (for example a press read outside `inputs`);
- a value lost by the codec, once it changes a later result;
- a change made outside `step`.

A pass covers only the frames and inputs exercised. A checksum compares the
saved text, so a difference the codec erases and that never affects a later
result is invisible.

## Optional network extensions (ADR 0140)

Every extension below is off unless the creator passes its option or builds its helper. With none of them, a
session behaves, refuses and reports exactly as described above (same `config` text, same results). All of them are
caller-driven: the host passes its own clock value (`now`, any unit) and moves plain-object messages over its own
transport. Nothing here owns a timer, socket, scheduler or game rule. [Guide](../../../docs/guides/rollback-network.md).

| Option or helper | Creator choice | Bounds (checked at construction) | Overload or fault |
|---|---|---|---|
| `createRollbackExchange({session, limits, pacingThreshold?, timeout?})` | Message budget, repeated checksums, round-trip window, pacing threshold, silence timeout | `maxInputsPerMessage` 1–4096, `maxChecksumsPerMessage` 0–64, `roundTripSamples` 1–64, threshold 0–60 | Oldest unacknowledged inputs go first; the rest wait for a later message. A malformed message is `rejected` and the session is untouched. |
| `adaptiveDelay: {minDelay, maxDelay, maxStep, minSpacing, authority}` | Delay range, largest step, spacing, deciding player | Delays 0–30 with `inputDelay` inside; `maxStep` 1–30; `minSpacing` from `maxStep + 1` to 3600 | Out-of-policy decisions from a peer fail the session (`remote-delay`, `delay-late`). |
| `departure: {input: 'neutral' \| 'repeat'}` | The departed player's input after its agreed last frame | – | Contradictory reports or decisions fail closed (`departure-conflict`); a peer that the others voted out fails with `local-departed`. |
| `retainInputFrames` | Input history kept for relays and spectators | 0–3600 frames (memory: players × frames × `maxInputBytes`) | A relay or spectator older than the window gets `pruned` / `behind`. |
| `start: {frame, state, checksum}` | Resume or join from an agreed state | Frame 0–2³¹−1, state within `maxStateBytes`, checksum must equal `rollbackChecksum(state)` | A mismatch or a `load` that throws refuses construction. |
| `evidence: {frames, maxBytes, chunkBytes, describe?}` | Retained frames and the digest or trace text | `frames` 1–64 (memory: frames × `maxStateBytes`), `maxBytes` 64 B–1 MiB, `chunkBytes` 64 B–64 KiB | Longer text is truncated and marked; a throwing `describe` gives `describe-failed`. |
| `createRollbackSpectator({...})` | Buffer depth and catch-up rate | `maxBufferedFrames` 1–3600, `catchUpThreshold` 0–3600, `catchUpFrames` 1–60 | Inputs beyond the buffer are not acknowledged, so the sender repeats them later. |
| `createDesyncEvidenceStore({maxBytes, maxChunks, maxTexts})` | Evidence memory | 64 B–64 MiB, 1–65536 chunks, 1–1024 texts | Over a bound, or a conflicting chunk: `refused`. |
| `createLossyLink({seed, loss, duplicate, reorder, latency, bandwidth?, maxInFlight?})` | A test network | Probabilities 0–1, latency 0–100000, in flight 1–10⁶ | Over the bandwidth cap or in-flight bound: `dropped`. Test utility only. |

### Lossy links: redundant resend

`createRollbackExchange` turns the reliable, ordered requirement into "some messages eventually arrive". Each
`outgoing(to, now)` message carries:

- every local input the destination has not acknowledged;
- the inputs of any departing player that the destination still lacks (a relay);
- the sender's `confirmedInputs` as an acknowledgement vector;
- the newest checksums and the departure reports;
- the sender's frame advantage and a round-trip echo.

`receive(message, now)` admits only the next contiguous frame of each player. It counts and skips duplicates and gaps
instead of failing. A stale acknowledgement from a reordered message never moves an acknowledgement backwards. Send a
message to every peer every tick (or on any schedule the host chooses). The exchange needs `retainInputFrames` of at
least `2 × maxPredictionFrames + 2 × maxDelay + 4` for relays to be complete.

### Adaptive input delay

Only the configured `authority` decides. `proposeDelay(d)` attaches a decision `{delay, from}` to its next queued
input frame `X`, with `from = max(X + maxPredictionFrames + maxDelay + 1, previous from + minSpacing)`. Every peer
learns the decision with that input. A peer that has not confirmed `X` cannot have simulated past
`X + maxPredictionFrames`, nor queued input past that plus `maxDelay`. So it knows the decision before its own input
frontier reaches `from`, and every peer switches at the same input frame. Arriving later than that is a protocol
fault, never a silent difference.

From frame `from`:

- An increase of `k` queues the input for `from` on `k + 1` frames (`local` returns `through`).
- A decrease of `k` makes `local` return `full` for `k` ticks (carry a press forward, as during a stall).

Inputs stay one contiguous stream per player, so the simulation never depends on how a player's delay was reached.

`recommendInputDelay({roundTrip, frameTime, current, policy, margin?, hysteresis?})` sizes the delay to hide half
the measured round trip. It steps at most `maxStep` and lowers the delay only past the hysteresis. The exchange
measures the round trip from echoes: the largest sample in its window, in the caller's units. Its `read().pacing`
adds the time-synchronization recommendation on top of `frameAdvantage`. It exchanges advantages and takes half the
difference; `skip` is true above the threshold. `recommendPacing(mine, theirs, threshold)` is the same rule without
the exchange. If the authority departs, the delay stays where it was last decided.

### Departure agreement

`disconnect(player)` (the host's transport closed or timed out; `exchange.expire(now)` does it after `timeout` of
silence) starts the agreement. A report from another survivor has the same effect. The steps:

1. Each survivor reports the last frame of that player it holds. From then on it accepts the player's inputs only up
   to its own report.
2. Reports are gossiped, so every survivor eventually holds all of them. When every survivor (every player that is
   neither leaving nor departed) has reported, the agreed last frame is the **largest** report. No survivor has
   confirmed beyond it, so nothing already confirmed changes.
3. Survivors that hold fewer frames receive the missing ones by relay, up to the agreed frame.
4. From the next frame the player's input is fixed by the creator's rule (`neutral`, or `repeat` the input at the
   agreed frame). Predicted frames that differ are rolled back.

The decision travels with the reports. A peer that receives a different decision fails closed
(`departure-conflict`) rather than diverging.

### Spectators

`createRollbackSpectator` steps only frames whose every input is confirmed: no prediction, snapshots or rollback. A
peer serves it with `exchange.toSpectator(ack, now)`, which returns every player's inputs the spectator lacks
(round-robin under the message budget) plus final departures and recent checksums. It returns `behind` when the
spectator is older than the retained window; join again from a snapshot.

`advance()` runs one ready frame, or up to `catchUpFrames` when more than `catchUpThreshold` frames are ready. It
checksums confirmed frames like a peer. A report that differs makes it `desynced`.

### Join or resume from a snapshot

`start: {frame, state, checksum}` builds a session at frame `F` from an agreed state, for example after a desync or
to restart survivors. Frames `F` to `F + inputDelay − 1` are neutral, and checksum reports below `F` are
inconclusive. `read().config` includes the start, so a handshake that compares `config` refuses a peer resuming from
a different state.

A spectator joins mid-session with `join: {frame, state, checksum}` (a peer's `confirmedState()`) and `sessionStart`.
It then needs that peer to retain inputs from `frame`.

### Desync evidence

With `evidence`, the session keeps the state text of the newest `frames` checksum frames. They survive a desync.
`evidence(frame?)` (default: the desync frame) returns the creator's `describe(state, frame)` text, or the state
itself. The text is capped to `maxBytes` and cut into chunks of at most `chunkBytes`; send the chunks over the same
transport. `createDesyncEvidenceStore` reassembles them in any order. `compare(frame, a, b)` reports the first
differing line, plus the replay kit's `explainDivergence` path when both texts are JSON.

## Evidence (this candidate)

**Checked (unit and consumer tests, `src/kits/rollback/*.test.ts`):**

- Seeded peers on delayed, ordered in-memory links match a no-network reference replay of the inputs actually queued:
  - delay 0, 2 and 3;
  - prediction windows 2 and 8, plus lockstep (0);
  - links slower than the window, which stall;
  - three players.
- Exact rollback depth and resimulation results.
- The work bound per `advance`.
- Stall, then resume.
- Desync at the first checksum frame after an injected divergence.
- Pending, evicted and off-interval checksum reports.
- Every protocol fault.
- Port exceptions, oversized state, reentrancy, dispose inside a callback and abort.
- Sync-test detection at distances 1, 3 and 8 of:
  - hidden state;
  - unseeded randomness;
  - an incomplete load;
  - a one-shot live value;
  - `-0` lost by JSON;
  - an outside mutation.

  Each of the three live-versus-replay regressions fails if the live check is removed.
- A late-start peer stays a full window ahead unless the ahead peer paces on `frameAdvantage`.
- A representative consumer: `testScene` drives two sessions from a fixed-lane system, and they retire with the visit.

**Manual measurement (not a budget or a device result):** Node 22 on an AMD Ryzen 9 7950X under `nice -n 15`, on a shared machine. A worst-case 8-frame rollback on every tick, using a JSON codec, measured:

| State size | p50 | p95 |
|---|---|---|
| About 336 B | 0.028 ms | 0.048 ms |
| About 2.5 KB | 0.154 ms | 0.190 ms |
| About 10 KB | 0.59 ms | 2.9 ms |

Isolated outliers reached 42 ms; garbage collection is likely but not established.

**Checked for the network extensions (`network.test.ts`, `extensions.test.ts`, `lossy-link.test.ts`, local):**

- Seeded randomized runs: 3 and 4 peers × 6 seeds, two spectators (one from frame 0, one joining late from a
  confirmed state).
  - The links lose 25–35 %, duplicate 10–20 % and reorder 20–30 %, with 0–8 ticks of latency and a bandwidth cap.
  - The delay authority raises and lowers the delay during the run.
  - One peer stops mid-run and is detected by timeout.
  - Every checksum published by every peer and spectator agrees, frame by frame, with a no-network replay of the
    agreed inputs.
  - All survivors hold the same departure decision and the same delay schedule.
  - Some seeds exercise relays, where survivors held different amounts of the leaver's input.
- Two departures a few ticks apart (4 peers): both survivors agree. The race described below did not occur in these
  seeds; it is detected, not prevented.
- Without the exchange, the same lossy link makes a plain session fail with `remote-gap`.
- Unit tests:
  - delay proposal and decision validation, increase fills and decrease skips;
  - recommendations;
  - departures with 2 and 3 players, both rules, relays, caps, conflicts and `local-departed`;
  - resume validation and agreement;
  - evidence retention, truncation, chunking, reassembly and JSON explanation;
  - the spectator's buffer, catch-up, desync, join refusal and abort;
  - exchange rejection, acknowledgement order, gaps, the round trip, pacing and timeouts;
  - reentrancy and disposal of the new calls.
- A scene system on the stock fixed lane drives two sessions and exchanges over the seeded lossy link, and they retire
  with the visit.

**Manual measurement (local, unofficial; Node 26 on a shared 32-thread machine under `nice -n 15`):**

- A 3-peer, 600-tick run with one spectator took about 70–80 ms for the whole run: about 0.02–0.04 ms per peer tick,
  including JSON encoding. That held at 0 %, 25 % and 50 % loss.
- Exchange messages for the toy simulation were about 300–600 bytes of JSON.
- Not a budget, a device result or a network measurement.

**Not established:**

- Real WAN, WebRTC unreliable channels or any real transport. The lossy link is a seeded model, not a measurement.
- Two departures whose agreements overlap can, in principle, reach different decisions. This happens if one survivor
  counts a report from a peer that leaves before the others see it. The decision is gossiped, and a difference fails
  closed (`departure-conflict`); it is not resolved.
- A departure whose survivors never hear from one another stays undecided, so the session stalls. The host's timeout
  and recovery (a new session from `confirmedState()`) handle it.
- A new **player** joining a running session (only spectators join mid-session; peers resume together).
- Delay decisions after the delay authority departs.
- Adaptive delay driven by real round-trip measurements: the tests use synthetic round trips.
- Frame stretching (pacing is skip-a-tick only).
- Message integrity or authentication: a peer that lies about inputs or reports is a protocol fault at best. The
  transport owns integrity.
- Cross-browser floating-point determinism. The kit does not enforce it. A `step` that uses only basic arithmetic,
  `Math.sqrt` and `dmath` from `@engine` (see [deterministic maths](../../../docs/guides/deterministic-math.md))
  gives identical bits in every engine. Physical cross-browser rollback sessions remain unrun.
- An ECS-world snapshot adapter.
- Physical-device timing and multiplayer acceptance.
