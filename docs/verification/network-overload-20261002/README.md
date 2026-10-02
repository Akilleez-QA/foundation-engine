# Network overload and goodput probe evidence (NW-07), 2026-10-02

Three full runs of `npm run probe:network -- --out <file>` with the default
configuration (seed 7), recorded at probe commit `0744509` on branch
`feat/nw07-overload-probe`, before it was rebased for PR #27. PR #27 is now based on
`integration/batch-2`. Its rebased commit `44077e1` has byte-identical `tools/network-probe/`
and `tools/replication-workbench/` trees. The network workbench host and the network kit
have since gained NW-08 planned drain (PR #21, off by default in the probe). They have also
gained the NW-06 follow-up (PR #33), which changed the intake's age shedding, so the
queue-age variants below show the earlier behaviour. The probe's own additions to the
network workbench (queue-age option, close-reason tally) are unchanged. Later review fixes in PR #27 changed the probe:
the storm's retries now wait for the restarted host's credentials, and observation
starts at host readiness. Invariants were added (connection bound, retry budget,
per-peer credit, storm outcomes), socket closure is measured, and the ready timeout is
configurable. The tests were split, with the host-driving regression run once in CI.
These runs were not repeated after those changes: the machine was too loaded to give
useful numbers. The measurements stand for the code that produced them. In
particular, the queue-age variants show intake behaviour before the NW-06 follow-up
(PR #33), when each aged shed still cost a pump attempt. Their
`invariants` arrays are the earlier, smaller set. Interpretation, findings and limits are in the
[guide](../../guides/network-overload.md).

| File | Load average at start (1/5/15 min) | Duration | Invariants |
|---|---|---|---|
| [run-1.json](run-1.json) | 111.5 / 106.3 / 73.7 | 50.6 s | 25 ok, 0 failed, 2 findings |
| [run-2.json](run-2.json) | 94.3 / 102.3 / 74.3 | 55.8 s | 25 ok, 0 failed, 2 findings |
| [run-3.json](run-3.json) | 112.9 / 105.7 / 77.3 | 51.9 s | 25 ok, 0 failed, 2 findings |

## Environment (exact)

- Node v22.23.3 (`mise exec node@22`), `ws` 8.22.0, `tsx` via `--import tsx`.
- Linux 7.2.5-3-omarchy x64; 32 x AMD Ryzen 9 7950X; 128,444 MiB RAM.
- Kernel TCP buffers: `tcp_rmem` 4096 131072 33554432, `tcp_wmem` 4096 16384 4194304.
- Probe and forked hosts at niceness 15. The machine was shared with unrelated heavy
  work during all three runs (load average 94 to 113 on 32 threads), so host
  event-loop lag high-water ranged from 11 to 307 ms. Treat the latency and timing numbers as
  conservative observations under contention, not as capacity figures.
- `environment.dirtyTree` is `false` in run 1 and `true` in runs 2 and 3. The only
  differences were the untracked `run-*.json` files written by the earlier runs in
  this directory; the code was commit `0744509`.

## Scope

Evidence class: **loopback / process scope only.** One machine, 127.0.0.1 TCP, Node
`ws` clients against the reference hosts in child processes. This is not WAN,
packet-loss, TLS, browser, physical-device, multi-machine or multi-process-host
evidence, and it certifies no player experience. Host RSS is an observation, not a
guarantee. Runtime-enforced limits (intake queues, per-peer token buckets, buffered
send caps, connection bound, retry attempts and budget) are what the invariants
check; the numbers themselves are measurements, not budgets.

## Ledger statements addressed

- "Measured network load unverified": now measured on loopback for the network and
  replication reference hosts, with the scope above.
- "Non-reading peer untested": a physical paused-socket peer was retired by the
  replication host's buffered-send cap (`send-refused`) in two of three runs, and
  stayed bounded with nothing host-buffered in the third. Healthy peers were
  unaffected. On the network host, small replies never reached the cap within a run,
  which is recorded as a limitation rather than a pass.
