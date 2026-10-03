# Stock explorer creator journey: failure paths, 2026-10-03

This receipt adds to [creator-journey-20261003.md](creator-journey-20261003.md). The earlier receipt
still holds for the success path.

## Scope and revision

`npm run test:creator-journey-browser` (`scripts/play/creator-journey-check.mjs`) now adds three failure
paths to the stock explorer journey: a refused save followed by a retry, interrupted scene changes, and
application disposal. Before this change, these paths were shown only in other consumers:

- `weighted-appearance-check.mjs` (#76, [save-recovery](save-recovery-20261003.md)) showed refusal and retry.
- `model-preview-check.mjs` (#78, [model-retirement](model-retirement-20261003.md)) showed disposal.

Two passing runs were made at **2026-10-03T20:06:37Z** and **20:06:49Z**. Both ran on the exact clean head
`854d26a8424c5e331788b57bdeab43c02352e5a6`, based on public main `40b9c70`, and both reports record
`dirtyWorktree: false`. The script's SHA-256 is
`adce7f86dfdc04f11691697147ed4ead7e3a4755d059f354edc836d4ea9348dc`. Adding this receipt changed
documentation only.

The runs used Linux, Node 22.23.3 and Chromium 152.0.7977.82 at 1280×800, in an isolated headless
software-GL context. Browser output was muted by the standard launcher and `dev.silent`. The seed was 1 and
the niceness was 15, and the runs held the shared browser lock. Each report records 14 states. The
artifacts can be regenerated and are not committed: `playtest/creator-journey/report.json` and the
screenshots `start`, `save-refused`, `discovered`, `reloaded` and `disposed`. Two screenshots were
inspected. `save-refused` shows "Found 1 of 3" with the garden rendered. `disposed` shows an empty
application area under the top bar.

## Decision: dispose hook

The existing teardown path is the kernel's `App.dispose()`. It runs module disposers in reverse install
order, and the save store makes its final flush during that step. Production has no page-level trigger
that calls it, and the page cannot reach the app object. For that reason, a minimal **dev/test-only**
`engine.dispose()` was added in `src/dev/test-api.ts`:

- It calls `App.dispose()` once and is idempotent.
- It reports any scene handle that is still attached, the remaining probe getters and the page renderer
  pool's statistics, including whether disposal recorded a new release audit.

The test API is injected only by the dev server and by `vite build --mode test`, so production bundles
do not contain this hook. No production runtime code changed.

The first run showed that the page frame loop outlives the app. When `engine.clock.step()` was called on a
retired app, it stepped the loop's calm-scenes read, which uses the disposed save store, and it threw
`SaveStore is disposed`. No real frames run after disposal; the check shows this below. This means the
failure could only be reached through the test clock, so `engine.clock.step()` now refuses with a clear
message after `engine.dispose()`. This receipt does not claim that a page-level app shutdown is supported
in production.

## Acceptance established

### Refused save, then retry

This is labelled emulation. A test-owned switch installed by `page.addInitScript` makes
`Storage.prototype.setItem` throw `QuotaExceededError` for `localStorage`. It is not real quota
exhaustion.

1. Baseline: the durable `explore.progress` envelope records the garden visit, and nothing is pending.
2. With writes refused, the bench is used with a real E press, and the HUD shows "Found 1 of 3". The check
   waits for two refused writes (the first write and one scheduled retry).
3. The durable bytes stay byte-identical to the baseline.
4. The save probe reports `pending.dirty > 0` and `scheduled: true`, so the refusal is not counted as saved.
5. Writes are allowed again with no reload. The store's own scheduled retry writes `garden/bench` and
   pending returns to 0.
6. The journey's later reload shows "Found 3 of 3", which includes the retried discovery.

The stock explorer shows no save-failure message. The player sees that progress is kept for the session
through the HUD. The refusal itself is read from the durable bytes and the save probe.

### Interrupted transitions

**Superseding `goto`.** The frame clock is held so the shed visit cannot present. `engine.goto('shed')`
is requested, and the check waits until the scene probe shows `scene.shed` / `entering` and
`scene.entering` to shed has been emitted. A newer `engine.goto('garden')` is then requested and frames
resume. The results:

- The stale shed `goto` never arrives.
- `scene.entered` is never emitted for shed.
- The final scene is garden, `active`, with a later epoch and a fresh arrival position (0, 2).
- The pool reports one live context and 0 overflows.
- The HUD still shows "Found 1 of 3", and there are no page errors.

**Window blur during a door change.** ArrowLeft is held, E is pressed at the shed door and one 100 ms
step runs. The window is then blurred (emulated) while the probe shows `scene.shed` / `entering`, and
focus returns. The player arrives at (0, 2.2) and does not move over a further 300 ms of steps while the
key stays physically down. This shows that held input is not carried across the interrupted change.

### Disposal

Disposal is the final step, after the reload. The world had entities before it. `engine.dispose()`
returned:

- `running: false` and no remaining probe getters.
- `poolReleased: true`. The running scene's lease was returned, with a release audit of 0 textures,
  0 geometries, 0 programs and 0 GL objects swept.
- Pool overflows were 0, and only the parked page context remained (`contexts: 1`, `created: 1`).

After disposal, the checks found:

- `.scene-view` and the shell sound row are gone from the page, and no world is readable.
- Real frames were resumed and keys pressed. The loop counters stayed unchanged over 300 ms, so no frame
  runs.
- `clock.step` is refused, and a second `dispose()` reports `disposed: false`.
- The durable progress is intact, and there are no page errors.

The existing success path is still covered: real keys, blur/focus, the settings menu, four round trips,
the durable wait and the reload.

## Validation

All of these passed:

```sh
ENGINE_CHROMIUM=$HOME/.local/bin/chromium-automation flock ~/.cache/foundation-browser.lock \
  nice -n 15 npm run test:creator-journey-browser    # twice, at 854d26a
npm run check      # 34 focused tests
npm run lint
npm test           # 2865 tests, 0 failures
```

`src/dev/test-api.test.ts` adds a unit test covering these points:

- `engine.dispose()` uses `App.dispose()` exactly once.
- A second call is a no-op.
- The test clock refuses to step afterwards.

## Remaining acceptance

- **Not covered:** physical devices, OS suspension, tab discard, a network-delayed chunk, real quota
  exhaustion, a production-bundle shutdown, and heap or listener leak certification.
- **Missing player feedback:** there is no rendered save-failure message for the player, because the stock
  explorer has none. Adding one would be a template change.
- **Renderer pool:** the pool outlives the app by design, and one parked context remains.
