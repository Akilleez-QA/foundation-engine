# Seeded fault schedules for the composed authority path (NW-09)

`tools/authority-workbench/fault-harness.mjs` is an optional, tool-only harness
(ledger NW-09). It replays a seeded schedule of combined faults against the
existing [authority workbench](../../tools/authority-workbench/README.md) host and
checks invariants after every step. Nothing in the engine runtime constructs or
depends on it, and no player build contains it.

**Evidence scope: process-level, loopback only.** A passing run shows that one
Node process, one SQLite file and two scripted clients on `127.0.0.1` keep the
stated invariants under the injected faults. It does **not** establish WAN
behaviour, physical power-loss or filesystem durability, other storage adapters,
multiplayer scale, browser behaviour or physical devices.

Requirement served: hand-picked fault tests cover the cases someone thought of.
This harness explores reproducible random combinations of faults on the composed
path (intake, rate admission, durable authority, SQLite adapter, prediction,
retry schedule and close policy), and a failing seed replays exactly.

## Running it

```sh
npm run faults:network                            # CI-sized default: seeds 1-12, 300 steps each
npm run faults:network -- --seeds 200 --steps 1000 # longer local exploration
npm run faults:network -- --seed 42 --steps 300   # one seed
npm run faults:network -- --seed 42 --shrink      # shrink a failure and save it
npm run faults:network -- --replay playtest/network-faults/seed-42.json
```

The CLI lowers its own process priority and exits explicitly with status 1 on any
failure, including a leaked handle. It requires Node 22.13 or newer
(`node:sqlite`), like the SQLite adapter. The same fixed seeds also run in
`npm test` through `tools/authority-workbench/fault-harness.test.mjs`; on older
Node versions those tests skip with a stated reason, and a skip is not evidence.

Each passing seed prints its trace fingerprint and fault counts. A failing seed
prints the minimal reproduction: the seed, the step count and the failing step
index, the invariant name and a detail line, for example

```text
seed 42: FAIL at step 57 [baseline-coherence] b baseline r8 p0 s9 vs durable s8 p0
  repro: npm run faults:network -- --seed 42 --steps 300 (fails at step index 57)
```

With `--shrink`, the harness removes chunks of the schedule while the same
invariant still fails (at most 200 reruns), prints the remaining steps and writes
`playtest/network-faults/seed-<n>.json` (git-ignored) for `--replay`.

## Inputs, owner and determinism

- **Inputs:** a nonnegative integer seed and a step count. `fault-schedule.mjs`
  turns them into a frozen list of steps; each step carries one action and a
  virtual time advance of 20–120 ms. Separate seeded streams drive each client's
  link faults and retry jitter, so they do not share draws.
- **Owner:** `runFaultSchedule({seed, schedule})` owns one temporary directory,
  one host generation at a time, two client sockets plus orphans, a read-only
  SQLite connection and nothing else. It installs no timer, listener or global
  hook, and returns `{ok, failure, fingerprint, trace, stats}`.
- **Determinism:** host and client clocks are virtual and injected. Each step
  waits for loopback quiescence: every frame the harness forwards has been
  processed by the host, every frame the host sent has reached its client, and
  every close is observed at both ends. Session tokens and ports differ between
  runs but never enter the trace. The test suite runs one seed twice and requires
  identical traces and fingerprints.

## Fault vocabulary

| Step | Fault |
|---|---|
| `net` | Per-connection, per-direction link faults for the next 1–4 frames: delay (1–4 steps), reorder, duplicate or drop. Applied between client and host, so they reach the host's framing, auth and command checks. |
| `disconnect` | Connection loss, including while a command is queued or in flight. |
| `replace` | The same principal authenticates again while the old socket is still open (controller replacement). |
| `hold-commit` | Holds the response after a durable commit (slow storage), then either releases it, drops the requesting client, or crashes the host before the reply. |
| `restart` | Host restart with 0–3 steps of downtime; clients reconnect with the retry schedule. |
| `storage` | The SQLite adapter's `beforeCommit` or `afterCommit` test hook fails once. Recovery is the operator's `recoverAuthority()` or a restart after 1–5 steps. |
| `clock` | Host or client clock skew: backwards up to 2 s, or a 16 s forward jump past the host idle timeout. Backwards readings are held at the last value (see Limits). |
| `slow` | A client stops reading for 2–12 steps; past 16 buffered frames it closes its own connection. |
| `revoke` | The host revokes a principal for its lifetime. |
| `input`, `operator`, `idle` | Ordinary predicted commands, operator commands and quiet steps. |

The crash is in-process: the host closes while a committed write's reply is
held, which is the same client-visible outcome as the existing SIGKILL-after-COMMIT
storage and host tests. Those tests remain the evidence for real process death.

## Invariants (after every step)

Facts come from an independent read-only SQLite connection, not from the host:

- The world revision equals the sum of consumed stream prefixes. Revisions and
  prefixes never roll back, and the lineage never changes.
- Retained receipts are contiguous up to each prefix, stay within the bounds, and
  each revision belongs to exactly one stream and sequence. No commit is skipped
  between observations.
- A receipt never changes once observed. Durable state equals the sum of every
  committed input. Each committed input is exactly what that client issued for
  that sequence.
- `committed` and `duplicate` results match the durable receipt's revision and
  result. `result-unavailable` refers to a consumed sequence. A `gap` never names
  a consumed sequence, and `conflict` never occurs, because clients resend exact
  payloads only.
- A before-commit failure leaves storage at the authority's compare-and-swap base
  revision and the authority `unavailable`. An after-commit failure leaves exactly
  one new revision in storage and the authority `unknown` until recovery. The
  expected revision comes from the authority's last confirmed checkpoint, never
  from storage itself. A ready authority equals storage. The authority is unavailable
  only for an injected cause.
- Every baseline a client adopts matches durable state and that stream's prefix
  at its revision. A fresh connection never forgets a confirmed prefix. Predicted
  state equals confirmed state plus a replay of pending inputs.
- Host frames go only to the current controller of a principal, and never to a
  revoked principal. A revoked stream does not advance.
- Bounds hold: host connections, intake queue count and bytes, pending
  authentication and controllers stay within the reference limits. Peer records
  match intake membership. Client pending inputs and harness link queues stay
  within theirs.

After the schedule, a heal phase clears every fault, recovers storage, releases
holds and gives each client that gave up one explicit reconnect. It then runs up
to 500 quiet steps. Every non-revoked client must converge: online, no pending
input, confirmed revision and prefix equal to storage, all issued sequences
committed, and predicted state equal to authority. A client still revoked by the
current host must end retired. The run then closes everything, and every socket,
server and timer it opened must be released (`process.getActiveResourcesInfo()`).
A loopback wait longer than 4 s is a `stuck` failure.

## Host seams used (tool-only)

`startAuthorityWorkbench` gains optional, backwards-compatible options. Defaults
keep the reference behaviour:

- `clock` (default `performance.now`): host time for intake, rate admission and
  idle checks. A backwards or invalid reading holds the last value, because the
  kit helpers require nondecreasing time.
- `storageHooks`: passed to the SQLite adapter's existing synchronous fault hooks.
- `observe(event)`: a trusted diagnostic callback for `open`, `refused`, `frame`,
  `sent` and `close` events, labelled by an untrusted `?label=` query string that
  is used only for observation. It never receives credentials.
- `openStorage` (default `openAuthorityStorage`): lets the test suite substitute a
  deliberately defective adapter to prove the checker notices it.
- `recoverAuthority()`: explicit operator recovery after a storage conflict or
  unknown commit; also the IPC method `recoverAuthority`. Without it, the
  reference host stayed fail-stop until restart, which remains a valid choice.
- `read()` additionally reports `connections` and `intake` statistics.

## Checking the checker

Before integration the invariants were checked against deliberate, temporary
defects (reverted, not committed), each over 30 seeds:

- Baselines off by one: caught as `baseline-coherence`.
- Predicted state replaying a confirmed input: caught as `prediction-replay`.
- After-commit failures misreported as `rejected`: caught as `authority-unavailable`.
- Retained-receipt lookup removed: caught as `gap-for-consumed`.
- A revoked controller left open: caught as `no-convergence` (stuck peer).
- Fault hook moved after COMMIT, so a reported before-commit failure had written:
  caught as `storage-outcome`. The suite keeps this one as a regression test,
  using the test-only `defect: 'hooks-after-commit-rejected'` adapter, which
  commits and then reports `rejected`.

The suite also injects durable corruption on purpose (`sabotage` steps, accepted
only with `allowSabotage`). It requires the failure at the exact step, the same
failure and fingerprint on replay, and a shrunk schedule of fewer than ten steps.

Two defects were not observable through this host. Re-executing a consumed
sequence is refused earlier by envelope validation. Skipping the authority's
final authorization recheck has no window, because nothing in the reference host
can revoke between the two checks. Both stay covered by focused authority tests.

## Limits

- One process, loopback TCP and two principals plus an operator stream. The
  slow consumer is application-level buffering; TCP/OS backpressure and the
  host's 16 KiB outgoing-buffer limit are not reached on loopback.
- The scoped-view publisher and receiver (replication workbench) are not driven
  here; their fault coverage remains their own unit and loopback tests.
- Process death is simulated in-process. Durability against power loss, disk-full
  or filesystem faults is not tested; SQLite FULL synchronous mode is configured,
  not certified.
- Clock skew is bounded by design. The host and the scripted clients both hold
  time at the last reading when it goes backwards, because the kit's intake and
  retry schedule require nondecreasing time. So a backwards step only freezes
  time until real time catches up; it never runs those helpers backwards. Raw
  non-monotonic time is covered by the kit's own unit tests, not by this harness.
- Heap growth is reported per run as advisory data, not asserted.
- Passing seeds are evidence for the schedules run, not a proof over all
  interleavings. Report the seeds and step counts with any result.
