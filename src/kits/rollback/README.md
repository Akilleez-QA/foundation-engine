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
- The existing browser transport, or any reliable, ordered link, to carry the facts the session returns.
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
| `remote(player, frame, input)` | A peer's input | `accepted {rollbackFrom}` or `duplicate`. Frames must arrive in order for each player. |
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

The recipe shows the simplest version. The tests cover a 20-tick late start:

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

**Not established:**

- Real WAN, packet loss or reordering. The session requires a reliable, ordered link and does not resend inputs.
- WebRTC unreliable channels and redundant input sends.
- Built-in time synchronization. `frameAdvantage` is exposed and pacing is the host's job; the recipe shows how. Advantage exchange and frame stretching are not supplied.
- Disconnect timeouts (use the transport's close and retry policy).
- Spectators.
- Cross-browser floating-point determinism.
- An ECS-world snapshot adapter.
- Physical-device timing and multiplayer acceptance.
