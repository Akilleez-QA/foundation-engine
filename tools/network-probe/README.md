# Network overload and goodput probe (NW-07)

A headless, loopback-only probe that drives the reference network hosts past
saturation over real WebSockets and reports offered load against goodput, rejections
by reason, admitted-work latency, high-water marks, a physical non-reading peer and a
reconnect storm. Tools only: it changes no engine runtime. See the
[guide](../../docs/guides/network-overload.md) for scenarios, results and limits.

```sh
npm run probe:network                                   # full report on stdout (about 50 s)
npm run probe:network -- --out report.json              # write the report, print a summary
npm run probe:network -- --scenario storm --seed 3      # one scenario, another seed
npm run probe:network -- --config my-probe.json         # override DEFAULTS within CAPS
```

- `probe.mjs` exports `runNetworkProbe(options)`, `resolveConfig`, `DEFAULTS`,
  `CAPS`, `invariants` and `summarize`. The exit code is 1 when the run aborted or an
  invariant failed; `finding` and `inconclusive` rows do not fail it.
- `host.mjs` is the child-process wrapper: one reference host per process, trusted
  IPC from the parent only (`read`, `sample`, `changeWorld`, `close`), self-close on
  parent disconnect.
- `probe.test.mjs` (run by `npm test`) has fast, host-free checks: configuration caps
  and invariant classification.
- `probe.regression.mjs` (`npm run test:network-probe`, run once in CI) is the
  regression-sized scenario (`NW07:` tests). It checks a healthy goodput floor past
  saturation while flooders are rate-limited, and a physical non-reader retired by
  the buffered-send cap with one credit per peer. It checks a reconnect storm in which
  every client either reconnects after the host is ready or stops by its own bound.
  Every started host PID must be gone and every socket closed.

Requires Node 22 and the repository's `ws` and `tsx` dev dependencies. The CLI lowers
its own priority (niceness at least 15); hosts inherit it. Every socket and process it
starts is closed in `finally`; only those child PIDs are ever signalled.

Evidence scope: one machine, loopback TCP. Not WAN, not physical devices, not
browsers. Host RSS is an observation, not a guarantee.
