# PERF-01 emulated session sample (2026-10-02)

**Scope.** This is an emulated browser run. It tests the recorder's mechanics and its evidence format. It is not
evidence from a physical device, it measured no thermal behaviour, and DV-01 remains open. The frame times describe
headless Chromium with software GL (SwiftShader) on the build machine, an x86_64 Linux host with 32 logical CPUs,
not any supported device. Each file labels itself `evidence: emulated`.

| Item | Value |
|---|---|
| Revision | `abe977e`, the recorder code commit on a clean tree. Documentation was added afterwards. Later rebases onto `main` kept the same patch-id (the code commit is the first commit of PR #15), and the recorder, loop, dev and script files are unchanged since the run |
| Command | `GAME_DIR=templates/expedition/game node -r ./scripts/silent-browser.cjs scripts/play/session-recorder-check.mjs <out> --minutes 10 --window-ms 30000` |
| Browser | Driven by playwright-core 1.56.1, muted, with a throwaway context, `?flags=dev.silent`, 1280×800 at DPR 1 and software GL. `ENGINE_CHROMIUM` was not set and Playwright's bundled build is not installed, so `bench-browser.mjs` resolved the executable to the system `/usr/bin/chromium`. Its version was not recorded in this report, and that system launcher may also apply the host user's Chromium flags file. Later runs record the executable, version and launch arguments in `report.json` and use an isolated automation launcher via `ENGINE_CHROMIUM` |
| Workload | The Expedition `field` scene. The script teleports the named player every 100 ms (a test-page driver) so frames render. It then makes a deliberate 120 ms main-thread stall, a synthetic 3 s hidden period (`document.hidden` overridden), and a route to `shelter` and back. |
| Result | The script passed. No page errors occurred, and no request left the local dev server. |

Review fixes made after this run add a `steppedFrames` count. They also keep a recorder `truncated` when a pause or
segment change fills the ring, and keep the active recorder reachable after a hot reload. This sample predates those
fixes, so it has no `steppedFrames` field. The run held no frames, filled no ring and had no hot reload, so its other
values are unaffected. The 30-second browser check in CI exercises the fixed code.

Files:

- `session-perf.json`: the `foundation.session-perf` v1 evidence from the 10-minute run.
- `auto-start.json`: the `?session-record` auto-start evidence, saved through the recorder's local `download()`. It
  includes the cold-start segment (`scene: null`) before `scene.field`.
- `report.json`: the script's report, with revision, view, workload, loop counters and limitations.

Observed values on this host only:

- The run lasted 600 s and produced 35,391 recorded frames, of which 5,970 rendered and 29,421 were idle.
- Over the session, frame interval was p50 16.7 ms, p95 16.8 ms, p99 16.9 ms and max 116.7 ms (the deliberate
  stall). Work time was p95 0.6 ms with a maximum of 50.7 ms.
- The recorder counted 276 long frames and 60 severe frames.
- It closed 21 windows: 17 complete, one `hidden`, two `paused` around the route change and one `stopped`.
- Means per rendered frame were about 8 draws and about 1,272 triangles.
- For `scene.field|reference`, the drift estimate was a frame p95 slope of −0.34 ms/min and a work p95 slope of
  −0.018 ms/min, with a late/early ratio of 0.84.

The early windows were slower than the later ones. On this host that reflects warm-up and shared-host scheduling
under software rendering, not device throttling. The short `shelter` visit (about 10 s) produced no complete 30 s
window, so it has no drift group. These numbers are not budgets or baselines, and they say nothing about any device.

## Production bundle check

Expedition production builds were made with `vite build` at base `7d57880` (origin/main) and head `abe977e`. Each
emitted 29 JavaScript files. Total JavaScript was 1,101,752 bytes at base and 1,102,571 bytes at head: +819 bytes,
which comes from the loop's sampler slot (`attachSampler` and its detach and report path). The markers
`foundation.session-perf`, `sessionRecorder`, `currentSession`, `session-record` and `SESSION_EVIDENCE` were absent
from all emitted JavaScript. This is a record of those two builds, not a permanent automated guarantee. Per-scene
budgets are checked by the gates, and none were raised.

## What this does not establish

- Behaviour on any physical phone, tablet, laptop or desktop.
- Sustained thermal behaviour, GPU timing, or behaviour after a real tab switch or screen lock.
- Acceptance of any creator-selected profile. DV-01 still needs operator-labelled physical runs, with declared
  thresholds and reproducible workloads.
