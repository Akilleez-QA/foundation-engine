# First-use observation baseline — 2026-10-03

The new `npm run test:first-use-browser` measures the existing explorer consumer through browser-observed shell/program state and real keyboard movement. No runtime implementation, budget or quality threshold changed. Timings are advisory; missing readiness, movement, bounded contexts, or clean completion fails the check.

## Evidence identity

Passed at 2026-10-03T17:37:54.004803+00:00 on base `1be7ba7c7d61e11126d0f6959d68155b67a987fd` with the new script/command/CI changes uncommitted. Exact tested script SHA-256: `2abc2eef9f5b903dd4a77b470579d01d081065303a8d8959aee7aa84e5d36f9f`. The source was committed unchanged in `58532b73d27ab27549b9afeaab6401917c887c52`. This is working-tree evidence, not full-gate acceptance of the final commit.

[All 21 raw visit samples](samples.json) are retained. The local regenerable `playtest/first-use/report.json` additionally includes NavigationTiming and ResourceTiming entries; `first-context.png` was visually inspected (garden, player and Found 0 of 3 HUD visible). No page or cleanup failures occurred. Three contexts each retained 189 resource entries, without buffer truncation.

Environment: Linux, Node 26.8.1, Chromium 152.0.7977.82, muted isolated headless software GL, 1280×800/DPR1, Vite development server, seed1, niceness15. Three fresh browser contexts run serially inside one browser process. This is context/application-cold, not proof of cold disk/network/driver shader caches. Vite transformations and shared-machine scheduling contribute to the figures.

## Observations in milliseconds

| Context | Navigation start → first garden active | Request → first shed active | Request → first return active |
| --- | ---: | ---: | ---: |
| 1 | 969.6 | 94.6 | 95.7 |
| 2 | 813.7 | 194.7 | 79.5 |
| 3 | 457.3 | 96.3 | 79.4 |

Two further round trips per context produced raw arrival intervals from 78.1–97.0ms. Browser keydown handler → observed changed player state ranged 10.1–45.9ms with a 10ms polling observer. These are observed aggregate intervals, not a percentile, latency guarantee, input-to-photon measurement or regression threshold. Each arrival held exactly one live pooled context and zero overflows.

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
