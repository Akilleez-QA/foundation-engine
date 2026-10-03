# First-use observation baseline — 2026-10-03

The new `npm run test:first-use-browser` measures the existing explorer consumer through browser-observed shell/program state and real keyboard movement. No runtime implementation, budget or quality threshold changed. Timings are advisory; missing readiness, movement, bounded contexts, or clean completion fails the check.

## Production build and warm visit

`npm run test:first-use-browser:production` runs the same diagnostic against a static production build: it builds the explorer template with `--base /first-use/` into a scratch directory and serves it from a loopback static host only under that prefix. Hashed files under `assets/` are served `Cache-Control: public, max-age=31536000, immutable`; every other file is `no-cache` with an ETag, answered 304 on revalidation. Both modes now end each context with a **warm entry**: after the cold entry and six transitions, the page navigates to `about:blank` and then opens the same URL again in the same context, with that context's HTTP cache primed. The default development run therefore records 24 samples (8 per context) instead of 21.

Production builds contain no `window.engine`. The production mode observes only the DOM shell attributes (`data-scene`, `data-scene-state`, `data-program-readiness`), like the onboarding subpath probe. It requests transitions through the hash route (`location.hash = '#scene/<id>'`) and asserts that the test API is absent. Input-to-movement time and renderer-pool counts cannot be observed there and are recorded as null. Both modes still record fetch, decode, upload, compile, first-draw and presentation durations as null.

It fails, with no timing threshold, on:

- a request outside `/first-use/`;
- a 4xx/5xx response;
- a missing arrival or readiness mark;
- more than one live browser context during a sample group, or one remaining after it;
- a page or console error retained through context cleanup.

The report now records the environment: Node, Chromium version and launch flags, CPU model, logical CPUs, RAM, niceness and load average.

### Observations — 2026-10-03, branch head `06fedec`

The retained runs are from a clean worktree (`dirtyWorktree: false`), script SHA-256 `82135a9938d5c7ce759cb9b348387e1d79c7dc00599b116cb51b68b68ddfe5e7`. Raw samples: [production](samples-production.json), [development with warm entry](samples-development-warm.json). Each check ran twice; both runs passed.

Environment: Linux 7.2.5-3-omarchy, AMD Ryzen 9 7950X (32 logical CPUs), 125.4 GiB RAM, Node v22.23.3, Chromium 152.0.7977.82 (muted, isolated, headless, SwiftShader software GL), 1280×800/DPR1, seed 1, niceness 15. The machine was **heavily shared**: the 1-minute load average was 27–67 during these runs, against 32 logical CPUs. Timings vary widely because of this, and the second runs' outliers (for example, >1s arrivals in one context) reflect contention rather than the build. Both cold and warm figures are advisory raw intervals, not a baseline to compare against.

Navigation start → garden active, in ms (cold = first visit in a fresh context; warm = second visit in the same context):

| Mode | Run | Cold ctx 1 / 2 / 3 | Warm ctx 1 / 2 / 3 | First shed transition ctx 1 / 2 / 3 |
| --- | --- | ---: | ---: | ---: |
| Production | 1 | 883.5 / 263.6 / 179.8 | 118.4 / 113.0 / 112.9 | 125.0 / 179.7 / 277.5 |
| Production | 2 (retained) | 774.7 / 1489.5 / 1018.6 | 109.6 / 373.1 / 982.8 | 92.8 / 565.6 / 238.2 |
| Development | 1 | 918.2 / 548.3 / 514.5 | 345.5 / 358.3 / 351.7 | 77.2 / 93.5 / 77.7 |
| Development | 2 (retained) | 3086.6 / 588.0 / 527.0 | 1354.5 / 344.1 / 1165.5 | 430.5 / 88.8 / 94.1 |

The production build took 447–572 ms to generate and build. In the retained development run, keydown → observed movement ranged from 10.2 to 204.9 ms under that load, with a 10 ms polling observer.

What the cache did (identical in every context of both runs):

| Mode | Visit | Entries (navigation + resources) | Served from HTTP cache (transferSize 0) | Transferred bytes | Server requests |
| --- | --- | ---: | ---: | ---: | --- |
| Production | cold | 11 | 0 | 906,141 | 11 × 200 |
| Production | warm | 11 | 10 | 300 | 1 × 304 (index.html) |
| Development | cold | 188 | 0 | 10,017,602 | not logged |
| Development | warm | 188 | 4 | 55,200 | not logged (Vite revalidates source modules) |

The production transitions made no server request: the shed scene's code arrived with the entry bundle. Each production context transferred about 0.9 MB on its cold visit and 300 bytes (one revalidated `index.html`) on its warm visit. When the machine was less contended (production run 1), the warm entry was about 110–120 ms, against 180–880 ms cold.

Limits of this evidence: the host is local loopback with no CDN, network latency, compression or real Pages/itch.io hosting. On a warm entry, renderer processes, compiled scripts and GPU/driver shader caches may also be warm, so it is not a cross-session repeat-visit claim. Both modes report `unsupported` program readiness under SwiftShader. There is still no physical-device, thermal, sustained-interaction or cancellation evidence. The CI browser job runs the production mode as an advisory step; this receipt makes no claim about its CI timings.

## Earlier evidence: standalone public-main branch (development only, before the warm entry)

Passed at **2026-10-03T18:06:57.789589+00:00** on a clean checkout (`dirtyWorktree: false`) of this pull request's branch, based directly on public main `2fb6e69`. The run is identified by the diagnostic script it executed: `scripts/play/first-use-check.mjs` SHA-256 `1e8d8f21f781c21451e6ceae9f1b0f2d8bba4688073209c20bfcfc4ac4d9c6f9`, unchanged at this branch's head. The report's and `samples.json`'s `revision` field names branch commit `9bf1e29`; that commit stays reachable from public history only if this pull request is merge-committed rather than squashed, so the script hash, not the commit, is the durable reference. This was a focused browser run, not full-gate acceptance. This receipt update changes documentation and samples only.

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

A pre-navigation MutationObserver records `data-program-readiness` and shell scene/state changes using browser `performance.now()`. The first shell mark in each context can read `undefined:undefined`: the observer saw the shell before its scene attributes were set. It is not an error and is never used as an arrival. Its times observe batched DOM mutations. Program readiness covers an aggregate path (compile request, program cohort readiness, initial render and submitted-command fence), not separate stage durations. Shell active follows the engine's submitted-picture/arrival contract; it does not establish display presentation.

The input observer starts inside the browser keydown event handler and ends when a bounded 10ms timer sees changed player coordinates. It excludes the preceding dispatch IPC but includes polling delay. NavigationTiming/ResourceTiming report browser resource/network intervals; they cannot be relabeled decode, texture upload or shader compilation time.

`fetchMs`, `decodeMs`, `uploadMs`, `programCompileMs`, `gpuFirstDrawMs` and `presentationMs` are explicitly null/unmeasured. Full asset readiness, cancellation after unsettled decode, heap/listener retention and physical-device performance remain unverified. No extra cancellation fixture was added in this slice. Model cancellation after a completed decode later gained separate browser evidence: [decode-cancellation-20261003.md](../decode-cancellation-20261003.md).

## Commands

```sh
nice -n 15 npm run test:first-use-browser
nice -n 15 npm run test:first-use-browser:production
node --import tsx --test scripts/gate-ci.test.mjs scripts/play/diagnostic-report.test.mjs
node scripts/lint/genericity.mjs
```

Browser:21 samples passed; workflow parser and diagnostic cleanup:10 tests passed. Syntax, final-document genericity and diff checks passed. CI is registered to repeat the diagnostic, but no remote CI, full integration gate or production-build comparison was performed for this slice.

## Historical development evidence

Earlier samples came from an unpublished local integration candidate and its diagnostic branches. They are not the current public-main baseline, are not published, and are summarized here only. The first development run retained its initial context during subsequent sample groups, creating asymmetric background workload; review corrected this by closing every context and asserting one live context during each group and zero before the next. The corrected candidate run passed at 2026-10-03T17:41:45Z. Both sets of candidate timings are superseded here by the exact-head public-main-based run above. No claim that the candidate's additional runtime changes were needed for this diagnostic is made.

## Review follow-up

The latest 21 retained samples reported `unsupported` program readiness; they do not exercise the parallel-compilation extension path. The updated diagnostic retains per-context browser errors and checks them through context retirement and final cleanup. All three error arrays are empty in the new exact-head report above. The default evidence directory is ignored so repeat runs do not mark unchanged source dirty. An earlier public-main-based sample set, recorded with the script before this error-retention change, was replaced by the samples above and is not attributed to the updated script (its commit exists only on this pull request's branch and is not needed to read this record). Numeric samples are retained here; the full resource report remains regenerable locally rather than introducing an additional CI artifact action in this change.
