# First-use observation baseline — 2026-10-03

The new `npm run test:first-use-browser` measures the existing explorer consumer through browser-observed shell/program state and real keyboard movement. No runtime implementation, budget or quality threshold changed. Timings are advisory; missing readiness, movement, bounded contexts, or clean completion fails the check.

## Evidence identity

Passed at 2026-10-03T17:41:45.446668+00:00 on base `5ef916e` with the context-lifetime fix uncommitted. Exact tested script SHA-256: `2cb0f41c909a3c1b6db6b37813bcd1f5ec0b366bd64512f13431f28c277a40e0`. The source was committed unchanged in `46949946a6a7ad7d4b40b3cd454704f2caa5d1ca`. This is working-tree evidence, not full-gate acceptance of the final commit.

[All 21 raw visit samples](samples.json) are retained. The local regenerable `playtest/first-use/report.json` additionally includes NavigationTiming and ResourceTiming entries; `first-context.png` was visually inspected (garden, player and Found 0 of 3 HUD visible). No page or cleanup failures occurred. Three contexts each retained 189 resource entries, without buffer truncation.

Environment: Linux, Node 26.8.1, Chromium 152.0.7977.82, muted isolated headless software GL, 1280×800/DPR1, Vite development server, seed1, niceness15. Three fresh browser contexts run serially inside one browser process. This is context/application-cold, not proof of cold disk/network/driver shader caches. Vite transformations and shared-machine scheduling contribute to the figures.

## Observations in milliseconds

| Context | Navigation start → first garden active | Request → first shed active | Request → first return active |
| --- | ---: | ---: | ---: |
| 1 | 868.9 | 94.2 | 95.5 |
| 2 | 458.4 | 79.9 | 94.7 |
| 3 | 481.3 | 80.5 | 96.4 |

Two further round trips per context produced raw arrival intervals from 75.4–80.5ms. Browser keydown handler → observed changed player state ranged 10.1–12.0ms with a 10ms polling observer. These are observed aggregate intervals, not a percentile, latency guarantee, input-to-photon measurement or regression threshold. Each arrival held exactly one live pooled context and zero overflows.

The first-use sample size is deliberately small. The variation in context-cold entries is a reason to retain cache/environment context, not evidence of an optimization. Same-page repeats can still recreate program objects as the renderer lease changes.

## What the marks mean

A pre-navigation MutationObserver records `data-program-readiness` and shell scene/state changes using browser `performance.now()`. Its times observe batched DOM mutations. Program readiness covers an aggregate path (compile request, program cohort readiness, initial render and submitted-command fence), not separate stage durations. Shell active follows the engine's submitted-picture/arrival contract; it does not establish display presentation.

The input observer starts inside the browser keydown event handler and ends when a bounded 10ms timer sees changed player coordinates. It excludes the preceding dispatch IPC but includes polling delay. NavigationTiming/ResourceTiming report browser resource/network intervals; they cannot be relabeled decode, texture upload or shader compilation time.

`fetchMs`, `decodeMs`, `uploadMs`, `programCompileMs`, `gpuFirstDrawMs` and `presentationMs` are explicitly null/unmeasured. Full asset readiness, cancellation after unsettled decode, heap/listener retention and physical-device performance remain unverified. No extra cancellation fixture was added in this slice.

## Commands

```sh
nice -n 15 npm run test:first-use-browser
node --import tsx --test scripts/gate-ci.test.mjs
```

Browser:21 samples passed; workflow parser:6 tests passed. Syntax and diff checks passed. CI is registered to repeat the diagnostic, but no remote CI, full integration gate or production-build comparison was performed for this slice.


## Review correction

The first run accidentally retained its initial browser context during subsequent context groups. Its numerical baseline is superseded by the samples above; the original receipt remains in Git history. The corrected script closes every context, including the initial context, and asserts exactly one live context during each sample group and zero before the next. All 21 refreshed samples passed. This removes background application workload from earlier groups without claiming browser/driver caches were cleared. Final documentation passed `node scripts/lint/genericity.mjs`; no full gate was run.
