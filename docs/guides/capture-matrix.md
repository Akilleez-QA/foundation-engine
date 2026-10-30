# Optional creator-defined capture matrix

`scripts/play/capture-matrix.mjs` captures each explicitly declared profile/case
serially through the existing play server, scene-opening helper and isolated muted
browser owner. It adds no runtime service or device preset. Use this optional
manifest alongside the application's evidence records; no existing brief or gate
requires adopting it.

```sh
node scripts/generate.mjs
node -r ./scripts/silent-browser.cjs scripts/play/capture-matrix.mjs \
  scripts/play/examples/capture-matrix.json playtest/latest/matrix
```

The example targets the default blank template's `main` scene. Change scene IDs,
viewports, declared inputs, tasks and criteria for the selected `GAME_DIR`. The
example's two experimental profiles are illustrative, not supported-device claims.

A version-1 manifest has `profiles` and explicitly listed `cases`; the runner does
not invent a Cartesian product or require phone, tablet or desktop targets.

- A profile has a unique path-safe `id`, positive integer viewport width/height,
  declared `inputs` (keyboard, pointer, touch, gamepad), and `support` (supported,
  experimental, unsupported). Support is a creator declaration, not test evidence.
- `isMobile`, `hasTouch` and `deviceScaleFactor` are independent browser options,
  defaulting to false, false and 1. Declaring touch/gamepad in `inputs` does not
  inject interactions or detect a physical device. A hybrid browser may have touch
  enabled without mobile layout emulation. Explicit touch requests are applied via
  the existing CDP session, without changing legacy launch setup. Observed viewport,
  DPR or touch mismatches fail capture while retaining available artifacts. This
  emulates browser capability, not physical input hardware.
- Optional `graphicsQuery` is a string-valued query map, for example
  `{"quality":"reference"}`. The runner passes it explicitly; it neither infers
  graphics settings nor checks whether an application honors a custom parameter.
  Inspect the captured probes for effective settings. `flags` and `seed` are
  reserved to preserve the muted deterministic opening path.
- A case has a unique path-safe `id`, an existing `profile` reference, a scene ID,
  a `task` description and nonempty `criteria` descriptions. It captures the
  initial active scene unless optional `steps` select an intermediate state. Steps
  run in order before the final screenshot and probes.

## Optional interaction steps

Each case may declare up to 64 steps. Each step has exactly one operation:

```json
{"tap":"details.shell-menu > summary"}
{"click":"#graphics-button","timeoutMs":3000}
{"key":"Escape"}
{"waitFor":{"selector":"dialog[open]","state":"visible"},"timeoutMs":5000}
```

These are separate step examples, not a touch-only sequence. `click` requires
`pointer` in the profile's declared inputs; `tap` requires `touch` and explicit
`hasTouch: true`; `key` requires `keyboard`. Declaring an input alone never injects
it. The runner uses the browser's distinct click/tap/keyboard operations; it does
not implement gamepad snapshots or multi-contact gestures.

Selectors are nonempty strings of at most 512 characters. Keys are nonempty
browser key/chord strings of at most 80 characters. Locator operations have a
5,000 ms default timeout, optionally an integer `timeoutMs` from 1 to 10,000.
Keyboard steps do not accept `timeoutMs`. `waitFor` accepts only `visible` or
`hidden`. Unknown operations/properties, multiple operations in one step and
invalid bounds fail manifest validation before launch. Invalid selector/key
syntax fails the case at execution. Arbitrary script/evaluation is not supported.

The optional `scripts/play/examples/capture-settings.json` demonstrates the stock
blank starter's Settings → Sound toggle → menu closes → reopen journey at explicitly chosen
phone, tablet and desktop viewport sizes. The touch examples use real emulated
`tap` operations; the desktop example uses clicks. The final wait observes the
changed English Sound label; adapt selectors for other catalogs. The browser stays
muted regardless of the selected sound setting.
Run it with the same command above, substituting the manifest path. All profiles
are experimental. It neither selects compact shell layout nor certifies the
expanded stock shell as usable on these sizes. Change the selected cases for the
application; no profile is compulsory.

Reports retain each attempted step's `completed`, `failed` or `cancelled` status.
A failed step stops that case's sequence, attempts a bounded failure screenshot at
`artifacts/<case>.failure.png`, closes that browser and continues later cases.
Screenshot failures are recorded separately without replacing the original error.
Cancelled cases do not request a new failure screenshot. Completing a sequence
only establishes that those browser operations completed, not that the described
task or its criteria passed.

The output contains `artifacts/<case>.png`, `artifacts/<case>.json` (state/probes, observed viewport,
touch points and console/errors), and `report.json`. The report records revision,
working-tree dirty status, seed, authored profile/case, browser executable/version
and launch arguments. Dirty source is explicitly identified; a commit alone does
not reproduce uncommitted changes. The library entry accepts caller-supplied revision
and optional dirty status; omitted dirty status means unknown, not clean.

Capture statuses are `captured`, `failed`, `cancelled` or `skipped`. Counts are explicit, including
zero captures for empty or entirely unsupported matrices. Unsupported profiles are
explicit skips. Every task and criterion remains **unverified**, including after a
successful screenshot. A captured image is not automatically a readability,
occlusion, interaction or performance pass. Emulated viewport/DPR/touch capability
is not physical touch, browser chrome, safe-inset, thermal or sustained hardware
acceptance.

Validation fails before launching anything. Runtime case failures are retained,
remaining cases continue serially, and the CLI exits nonzero if any capture or
owner cleanup failed. Each launched browser closes in a `finally` block and the
server closes after the matrix. Matrix captures opt into strict browser-close
reporting; legacy browser callers retain their prior best-effort cleanup behavior. Initialization failures in the shared browser owner
also close its launched process while preserving the original error. The library's
optional AbortSignal is checked between stages; it cannot interrupt an in-progress
browser operation, which retains the existing tool's timeouts. Aborted cases are
reported as cancelled, including remaining cases without launching more browsers;
the run exits nonzero. Post-await checks prevent a late screenshot from claiming
capture success after cancellation. The runner installs no second scheduler or cancellation listener.

Output directories are not recursively deleted. Use a fresh directory per evidence
run; only artifacts referenced by the current report belong to that run. Filesystem
write failures may prevent a complete report and surface as command failures.
Bounds are the finite authored case list, at most 64 steps per case, one active
browser at a time, and bounded locator/existing browser operation timeouts; this is not a disk quota or admission budget.

Legacy browser `mobile` options and default DPR retain their behavior. The launcher
file participates in the performance experiment hash, so this extension requires
fresh evidence even though default measurement semantics and budgets are unchanged.

## Repository browser regression

`npm run test:capture-browser` explicitly generates the blank starter and exercises
the stock Sound journey at the example's three selected viewports, followed by an
intentional missing selector and a valid subsequent case. It checks step completion,
failure evidence, continuation, absence of browser/cleanup errors and retention of
unverified criteria. CI runs this command serially alongside the other optional
framework diagnostics. Evidence goes to `playtest/ui/capture-matrix`; its top-level
`report.json` links the success and expected-failure matrix reports. The expected
case failure passes the regression only when the failure and recovery assertions
match. Unexpected outcomes make the command fail.

These fixtures do not require independent games to support these profiles or adopt
this tool. A configured CI job is not a completed run; inspect the exact revision's
result. Reports/screenshots are retained locally; CI does not upload them.
