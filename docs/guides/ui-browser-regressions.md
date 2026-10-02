# Optional UI browser regressions

Run `npm run test:ui-browser` to generate the existing runtime inputs and execute
six isolated browser diagnostics serially. CI invokes the same command after
installing Chromium, before the full template gates. The checks exercise optional
framework compositions, without enabling them in every game or changing creator
requirements.

| Diagnostic | Regression coverage | Local output |
| --- | --- | --- |
| HUD disclosure | Owned reading sheets, pause/resume, focus and scrolling, input routing, presentation changes and teardown | `playtest/ui/hud` |
| Action hints | Current keyboard/pad bindings, in-session remapping and layer context on phone, tablet and desktop viewports | `playtest/ui/action-hints` |
| Compact shell | Opt-in compact portrait/landscape controls and the expanded desktop presentation | `playtest/ui/compact-shell` |
| Comfort settings | Actual large-text/Calm settings, computed CSS, browser storage/reload/reset, legacy attributes and OS reduced motion | `playtest/ui/comfort` |
| Owned touch sources | Two simultaneous CDP contacts, held movement plus a separate action, independent release, modal cancellation and neutral restart, owner teardown, keyboard independence | `playtest/ui/touch-sources` |
| Native controls | Arcade focused Sound buttons keep native Space/Enter activation while scene focus retains its declared Space action | `playtest/ui/native-controls` |

Each script owns its temporary Vite server and isolated, muted Chromium sessions.
The command stops at the first failed diagnostic and returns a failing exit code.
Reports and screenshots are written to the listed directories, including the
reports produced by each script's failure cleanup. CI logs show assertions; this
workflow does not upload the image/report directories as artifacts. Running this
command locally reproduces the same invocation and retains its evidence files.

These checks complement unit tests, template gates and phone snapshots. They do
not certify physical touch/controller hardware, thermal performance, every game's
layout or universal device support. The HUD fixture intentionally includes an
overflowing inline layout to exercise lifecycle behavior, not to endorse that
layout. Action-hint checks cover in-session remaps and an explicitly composed
player-scoped controls-settings scenario: ordinary browser save completion, reload,
a fresh isolated context, player switching, and reset followed by reload. These
checks use service commands rather than a finished Controls screen. Corrupt-storage
and write-failure coverage remains in composed module tests using the existing
in-memory backend; browser storage-failure recovery and physical hardware behavior
are not certified by the reload scenario.

A configured CI check is not evidence of a completed run. Check the relevant
commit's CI result and generated diagnostic report before claiming verification.

The separate `npm run test:capture-browser` CI command checks the optional capture
matrix against the explicitly selected blank starter: stock Sound toggling in
three example viewports, and a deliberately missing selector followed by a valid
case. Its assertions cover tooling completion/failure recovery, not application
acceptance. Output: `playtest/ui/capture-matrix`. See [capture matrix](capture-matrix.md).

Action-hints, compact-shell, quality-boot and synthetic occlusion diagnostics share
terminal report handling. Scenario failures and browser/server cleanup failures are
retained separately in `failures`; each acquired owner is attempted independently.
A cleanup error forces `passed: false` even after successful assertions. The current
report overwrites prior evidence when its filesystem write succeeds; write failure
still exits nonzero and cannot promise a refreshed artifact. These diagnostics opt
into strict browser-close error reporting. Cleanup failures are not physical-device
or application acceptance results.

Comfort tokens consume the existing settings-owned `body.large-type` and
`body.still-mode` classes. Legacy root comfort/calm attributes still work. This
repairs preference wiring; it does not change expanded defaults, select a layout,
or establish full 200% zoom/localization or motion-comfort acceptance.

The native-controls regression explicitly selects the Arcade starter and checks
that focused stock Sound buttons retain native Space/Enter activation while the
scene still consumes its declared Space binding when focused. It does not change
modal confirm ownership or modified authored shortcuts. Evidence is written to
`playtest/ui/native-controls`.

Settings observer failures do not roll back an already changed preference. The
settings owner attempts independent subscriber delivery and current body-class
projection before rethrowing the original failure (or an aggregate for multiple
failures). A nested change to the same setting invalidates remaining stale outer
delivery; unrelated setting changes do not suppress valid subscribers. Real
SaveStore unit regressions cover this callback boundary separately from browser
comfort styling and physical-device acceptance.

## Stock consumer acceptance is separate

The stock touch-control runner (`scripts/play/stock-touch-check.mjs`) is not part of
this six-diagnostic command or CI; run it manually. Its
[first receipt](../verification/stock-device-20261001/README.md) records 16 target/tap
checks and a lesson content overlap that those checks did not detect. The runner now
also asserts lesson content/control separation while stepping through the board, sim and
quiz, and fails on the unrepaired layout; the
[layout repair receipt](../verification/stock-device-20261002/README.md) records a
clean-commit pass. Keep that narrower evidence separate from framework regressions
and from full stock-template device acceptance.
