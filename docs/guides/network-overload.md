# Network overload and goodput probe (NW-07)

`npm run probe:network` drives the loopback reference hosts past saturation over
real WebSockets and writes a JSON report. It is a **tool**, not an engine
capability: nothing in `src/` changes, nothing is constructed at runtime, and a
creator who ships no network host never runs it. Ledger ID NW-07 (proposal N4 of the
scalability study). Status: implemented, candidate (PR #27); not integrated.

Requirement served: the ledger recorded "measured network load unverified" and a
"physical TCP non-reader untested" for the network kit and its reference hosts. The
probe measures both, on one machine, and says exactly how far that evidence reaches.

## Inputs, outputs and owner

The probe module (`tools/network-probe/probe.mjs`) owns every socket and child
process it starts. Each reference host runs in its own child process
(`tools/network-probe/host.mjs`), so the clients and the host do not share an event
loop. The host answers trusted IPC from its parent only (`read`, a small `sample`,
`changeWorld` for the replication host, `close`).

Configuration is probe fixture policy, not engine schema. Defaults (about 50 s of
wall time) and hard caps are in `DEFAULTS` and `CAPS`; `resolveConfig` rejects
anything outside them. Pass `--config file.json`, `--seed n`, `--scenario a,b` or
`--out report.json`.

| Scenario | Host | What it drives |
|---|---|---|
| `overload` | network workbench | A ramp of offered command rates (default 8, 16 and 24/s per healthy client, 5 clients) against a host with a 50 ms pump: about 80 dispatch attempts/s. One ramp per queue-age variant (default FIFO, 300 ms, 600 ms). Each step also opens a flooder (200 frames/s), a wrong credential and one connection over the 8-connection bound. One physical non-reader sends 8 commands/s and never reads. |
| `non-reader` | replication workbench, 64 entities | Healthy peers read and acknowledge each view while the operator changes the world every 20 ms. One adversarial peer reads only its authentication frame, pauses its socket, and acknowledges every outstanding view unread. |
| `storm` | network workbench | N clients hold sessions; the host is closed (every socket terminated) and restarted on the same port after 400 ms. Each client reconnects through its own `createRetrySchedule` (base 250 ms, cap 2000 ms, 6 attempts, budget 8). Variants: 8 clients with full jitter, 8 clients with a constant random port (no jitter, same helper), 16 clients with jitter (twice the connection bound). |

The report contains, per scenario:

- offered load against goodput (results received per second) and on-time goodput
  (within 500 ms);
- rejections counted by reason and kept apart from latency: refusal frames
  (`queue-limit`, `stale`), client-observed closes (code, reason, close-policy class)
  and the host's own retirement reasons (`closeReasons`);
- p50/p95/p99/max latency of admitted work only (command to result, or world change
  to view adoption);
- sampled high-water marks: intake queued messages/bytes, per-peer `bufferedAmount`,
  host RSS/heap and event-loop lag (RSS is an observation, not a guarantee);
- invariants with `ok: true/false`, plus `finding` rows (measured behaviour reported
  rather than asserted) and `inconclusive` rows (the host process was CPU-starved, so
  the probe cannot attribute a drop).

## Bounds, overload, cancellation and recovery

- **Bounded:** every count, rate and duration is capped; total runtime has a 180 s
  guard that sets `aborted`. The probe stops early when host RSS passes
  `abort.rssMb` or a host read times out.
- **Cleanup:** `finally` terminates every socket the probe opened and closes every
  host it forked: graceful IPC close, then `SIGKILL` to that exact child PID only if
  it has not exited within 2 s. It never kills by name or pattern. A host whose
  parent disappears closes itself on IPC disconnect. The report lists the started
  host PIDs and the owned resources left after cleanup (zero).
- **Priority:** the CLI raises its own niceness to at least 15 (`os.setPriority` on
  its own PID); forked hosts inherit it.
- **Determinism:** client pacing, retry jitter and command identities derive from
  `seed`. Socket and scheduler timing is not deterministic, so numbers vary between
  runs; three runs are recorded.

## Measured results (three runs, loopback, 2026-10-02)

Full reports: [evidence](../verification/network-overload-20261002/README.md).
The machine was heavily loaded by unrelated work (load average 94 to 113 on 32
threads) and the probe ran at niceness 15, so these are conservative observations.

- **FIFO goodput plateaus.** With no queue age, goodput past saturation stayed at the
  host's achieved capacity: 84.1, 83.4 and 67.9 results/s at about 118, 119 and 89/s
  offered (nominal capacity 80/s; run 3 had its host starved to 64 attempts/s). The
  excess was refused `queue-limit` (32 to 53 per step); admitted p99 latency
  533 to 668 ms. The global queue high-water was 31 to 32 of 32 messages, about
  1.3 KB of 16 KB.
- **Flooders and adversaries are limited without harming healthy peers.** All 27
  flooder rounds (achieved 104 to 197 frames/s) were retired by the host for
  `rate-capacity` after 38 to 44 frames; wrong credentials closed
  `1008 auth-rejected` (terminal by the default close policy); the connection over
  the bound closed `1013 connection-capacity`. No healthy peer was closed in any run.
- **Physical non-reader (replication host).** In two of three runs the host retired
  the paused peer for `send-refused` when its buffered-send cap engaged: after 18.9 s
  and 14.8 s, at about 533 views of 5,527 bytes (about 2.95 MB absorbed by loopback
  kernel buffers first), with host `bufferedAmount` at most 127,213 of 131,072
  bytes. In the third run the window ended (20 s, 497 views, about 2.75 MB) before
  the kernel buffers filled; the host buffered nothing. Healthy peers kept receiving
  every view in all runs, at most one credit outstanding per peer, and adoption p99
  stayed within 62.8 to 179 ms under attack (loaded-machine baseline p99 9.4 to 25 ms).
- **Small-reply non-reader (network host).** Replies of about 80 bytes at 8/s never
  reached the host's 8,192-byte buffered cap: the kernel absorbed them and delivered
  all 34 to 36 on resume. The host bound is untested by this case within a run;
  bytes, not message count, decide when it engages.
- **Reconnect storm.** Without jitter, accepted reconnects arrived in one or two
  100 ms bins (peak 6 to 8 of 8 in one bin). With full jitter, the peak was 2 per
  bin, spread over 6 to 7 bins, and all 8 clients reconnected in every run (last
  2.3 to 3.4 s after the restart, versus 0.77 to 1.9 s for the synchronized
  control). With 16 clients and an 8-connection bound, 8 reconnected, 8 exhausted
  their 6 attempts (at most 6 per client, 72 to 81 attempts in total), and the
  excess saw `1013 connection-capacity`; attempts stayed bounded.
- **Host memory.** Host RSS high-water was 82 to 98 MiB in every scenario.

## Findings

1. **Queue age shorter than the real queued wait collapses goodput (NW-06
   interaction).** An aged command is shed when it reaches the head of its turn, and
   each shed costs one pump attempt. Once the real wait exceeds `maxQueuedAgeMs`,
   most attempts are spent shedding commands that are already stale. With a 300 ms
   age, saturated goodput fell to 20.5, 4.0 and 23.3 results/s (final/peak 0.09 to
   0.31) while the host still made 76 to 80 attempts/s. The global-queue drain time
   (32 / 80/s = 400 ms) is not the bound that matters. Under fair per-peer rotation
   a command 8th in its peer's queue waits about 8 x 7 peers / 80/s = 700 ms, and
   host lag lengthens that. A 600 ms age plateaued in all three runs (final/peak 1.0). An earlier
   development run of the same configuration measured 0.71, so the margin is small.
   This is reported, not fixed: it is a property of the optional intake rule, and a
   creator who enables `maxQueuedAgeMs` should keep it above the worst queued wait
   their per-peer queue, peer count and pump budget allow, or shrink the queues.
   Possible engine follow-ups are admission-time shedding or not charging aged
   sheds to the pump budget. Either would be an engine change outside this
   tools-only slice.
2. **Client-visible close reasons can be lost under load.** The network host sends
   a close frame and then terminates the socket immediately, so a slow machine can
   discard the frame. One earlier development run saw a flooder close as `1006` with
   no reason, while the host recorded `rate-capacity`. The retry guide already
   documents this degradation to `transient`. The probe judges limits by the host's
   retirement reason and reports lost frames as a finding.
3. **A non-reader is detected by bytes, not time.** Loopback kernel buffers absorbed
   about 2.9 MB before the replication host's 128 KiB cap engaged. Retirement time
   is that volume divided by the view byte rate. A host with small frames retains a
   silent peer until its idle timeout or a larger backlog.

## Limitations

- One machine, loopback TCP, Node `ws` clients. Not WAN, packet loss, NAT, TLS,
  browsers, physical devices, multiple machines or multiple host processes.
- Kernel buffer sizes (`net.ipv4.tcp_rmem`/`tcp_wmem`) decide when a non-reader
  becomes visible to the host; other kernels and real networks differ.
- High-water marks of queues and buffers are sampled every 50 ms, not exact maxima;
  the replication host's `maxBufferedBytes` is recorded at each send.
- The non-reader's acknowledgements use the trusted operator view of its outstanding
  sequence. That is the worst case: an attacker that guesses sequences perfectly.
- The storm hands each client the restarted host's fresh fixture credential (the
  fixture issues credentials per lifetime), so authentication is not under test.
- The regression test (`tools/network-probe/probe.test.mjs`, tests named `NW07:`)
  runs a short scenario with loose floors; it guards the invariants, not the numbers.
