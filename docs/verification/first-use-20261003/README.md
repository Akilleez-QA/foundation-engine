# First-use observation baseline — 2026-10-03

The new `npm run test:first-use-browser` measures the existing explorer consumer through browser-observed shell/program state and real keyboard movement. No runtime implementation, budget or quality threshold changed. Timings are advisory; missing readiness, movement, bounded contexts, or clean completion fails the check.

## Latest evidence: standalone public-main branch

Passed at **2026-10-03T18:06:57.789589+00:00** on exact head `9bf1e2905827f505ee7ac839319221e18ce0a820`, based directly on public main `2fb6e69`. Script SHA-256: `1e8d8f21f781c21451e6ceae9f1b0f2d8bba4688073209c20bfcfc4ac4d9c6f9`. The report records `dirtyWorktree: false`. This was a focused browser run, not full-gate acceptance. This receipt update changes documentation and samples only.

The focused branch contains only the diagnostic, its npm/CI registration and evidence. No broader local integration candidate is included. The observed test APIs (`engine.goto`, `engine.state`, pool probe), browser launcher, explorer consumer and shell readiness markers already exist on public main.

[All 21 raw visit samples](samples.json) are retained from this public-main-based run. The local regenerable `playtest/first-use/report.json` additionally includes NavigationTiming and ResourceTiming entries; `first-context.png` was visually inspected (garden, player and Found 0 of 3 HUD visible). No page or cleanup failures occurred. Each context retained 185 resource entries, without buffer truncation.

Environment: Linux, Node v26.8.1, Chromium 152.0.7977.82, muted isolated headless software GL, 1280×800/DPR1, Vite development server, seed1, niceness15. Three fresh browser contexts run serially inside one browser process. Exactly one context is asserted during each sample group and zero after each group closes. This is context/application-cold, not proof of cold disk/network/driver shader caches. Vite transformations and shared-machine scheduling contribute to the figures.

## Observations in milliseconds

| Context | Navigation start → first garden active | Request → first shed active | Request → first return active |
| --- | ---: | ---: | ---: |
| 1 | 895.7 | 94.7 | 78.2 |
| 2 | 475.6 | 78.7 | 94.6 |
| 3 | 460.9 | 80.5 | 79.2 |

Two further round trips per context produced raw arrival intervals from 77.7–96.3ms. Browser keydown handler → observed changed player state ranged 10.1–34.5ms with a 10ms polling observer. These are observed aggregate intervals, not a percentile, latency guarantee, input-to-photon measurement or regression threshold. Each arrival held exactly one live pooled context and zero overflows.

The first-use sample size is deliberately small. The variation in context-cold entries is a reason to retain cache/environment context, not evidence of an optimization. Same-page repeats can still recreate program objects as the renderer lease changes.

## What the marks mean

A pre-navigation MutationObserver records `data-program-readiness` and shell scene/state changes using browser `performance.now()`. Its times observe batched DOM mutations. Program readiness covers an aggregate path (compile request, program cohort readiness, initial render and submitted-command fence), not separate stage durations. Shell active follows the engine's submitted-picture/arrival contract; it does not establish display presentation.

The input observer starts inside the browser keydown event handler and ends when a bounded 10ms timer sees changed player coordinates. It excludes the preceding dispatch IPC but includes polling delay. NavigationTiming/ResourceTiming report browser resource/network intervals; they cannot be relabeled decode, texture upload or shader compilation time.

`fetchMs`, `decodeMs`, `uploadMs`, `programCompileMs`, `gpuFirstDrawMs` and `presentationMs` are explicitly null/unmeasured. Full asset readiness, cancellation after unsettled decode, heap/listener retention and physical-device performance remain unverified. No extra cancellation fixture was added in this slice.

## Commands

```sh
nice -n 15 npm run test:first-use-browser
node --import tsx --test scripts/gate-ci.test.mjs scripts/play/diagnostic-report.test.mjs
node scripts/lint/genericity.mjs
```

Browser:21 samples passed; workflow parser and diagnostic cleanup:10 tests passed. Syntax, final-document genericity and diff checks passed. CI is registered to repeat the diagnostic, but no remote CI, full integration gate or production-build comparison was performed for this slice.

## Historical development evidence

The earlier samples recorded on local candidate `1be7ba7` and its diagnostic branches are historical and are not the current public-main baseline. They remain in Git history. The first development run retained its initial context during subsequent sample groups, creating asymmetric background workload; review corrected this by closing every context and asserting one live context during each group and zero before the next. The corrected candidate run passed at 2026-10-03T17:41:45Z. Both sets of candidate timings are superseded here by the exact-head public-main-based run above. No claim that the candidate's additional runtime changes were needed for this diagnostic is made.

## Review follow-up

The latest 21 retained samples reported `unsupported` program readiness; they do not exercise the parallel-compilation extension path. The updated diagnostic retains per-context browser errors and checks them through context retirement and final cleanup. All three error arrays are empty in the new exact-head report above. The default evidence directory is ignored so repeat runs do not mark unchanged source dirty. The earlier public-main samples at `93cd618` remain historical in Git history and are not attributed to the updated script. Numeric samples are retained here; the full resource report remains regenerable locally rather than introducing an additional CI artifact action in this change.
