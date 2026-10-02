# Program preparation correctness checkpoint

Public base: `c0e73c9b40975f7ed47c178edf84552742d2396a`.
Runtime implementation: `1d0d3e04067fbba6cc49b0b0dea7b43bd0042666`.
This checkpoint adds an engine-owned fixture, not a runtime change.

The repository-relative fixture is `scripts/play/fixtures/program-validation.ts`.
It was bundled using esbuild (`--bundle --format=iife
--global-name=ProgramValidationOracle`) and executed in an isolated muted Chromium
with ANGLE/OpenGL on RTX 4080. Native results are retained as
[native-program.json](native-program.json) and
[native-context-loss.json](native-context-loss.json).

The valid real draw produced center RGBA `[255,0,0,255]` and zero success program
log reads. Later malformed ShaderMaterial and link-only incompatible varyings
were refused. Full diagnostics invoked the explicit callback. Actual loss and
restoration retired the old handle without a native parameter query; a fresh
program linked and validated. Loss/restore operations ran in separate browser
tasks. Browser closure completed; no application data or external service was used.

These observations satisfy the named shader correctness cases on this backend.
They do not prove timing, display presentation, complete scene restoration,
other hardware or engine-wide residency. The public affected check passed with
60 test files and the 44 focused regressions passed before this fixture extension.
Exact-head multi-template gates and inspected screenshots remain pending.

The submitted-frame extension has a native
[completion/cancellation result](native-frame.json). The diagnostic context uses
`preserveDrawingBuffer: true` so a later-task pixel read remains meaningful. An
initial diagnostic run used the default discardable buffer and failed with
`Submitted clear pixel mismatch`; this was a fixture flaw, not evidence of fence
failure. Production drawing-buffer settings were not changed. The corrected
fixture observed completed work, red `[255,0,0,255]`, and immediate cancellation
reported `retired`. This does not certify display presentation or travel timing.

The first exact-head default gate at `86df82e` failed architecture lint: direct
animation-frame and monotonic-clock reads were outside sanctioned owners. All
2046 tests, snapshot, bundle and 11 software-GL checks passed, but the overall
result remains **FAIL**. [Raw gate](gate-86df82e/gate.txt) is retained. The correction
uses the existing core monotonic clock and cancellable browser tasks rather than
adding an animation loop; no ratchet or threshold changed. A new exact-head gate
is required before acceptance.

## Exact source checkpoint `2cdd442`

All seven template gates passed on
`2cdd442e7be21fbb319a084830db295478aa1179`, with unchanged budgets:

| Template | Gate duration | Result |
| --- | ---: | --- |
| blank (default) | 34 s | PASS |
| arcade | 33 s (wrapper 34 s) | PASS |
| expedition | 52 s | PASS |
| explorer | 52 s | PASS |
| learn | 34 s | PASS |
| mechanics | 34 s (wrapper 35 s) | PASS |
| terrain | 38 s | PASS |

Each gate ran 2046 tests, typechecking, full lint, build, bundle, snapshot and
software-GL budget checks. See [default log](gate-2cdd442/default.txt) and
[six-template log](gate-2cdd442/templates.txt). Terrain retained two heap warnings:
5.3 and 5.7 MiB against nominal 5 MiB; the unchanged checker classified these as
warnings. No over-budget, regression or inconclusive verdict was suppressed.
These are software-GL engineering checks, not physical-device performance proof.

An additional explorer desktop/mobile snapshot passed. Both images were personally
inspected: the player, scene objects, Settings and progress text were visible with
no failure overlay. See [snapshot log](gate-2cdd442/snapshot.txt),
[desktop](gate-2cdd442/garden-desktop.png),
[mobile](gate-2cdd442/garden-mobile.png) and
[probe](gate-2cdd442/probe.json). The probe reported 60 fps, 10 draws and 1306
triangles in this software fixture; this is not a sustained travel guarantee.

This document-only receipt follows the tested source checkpoint. Integration and
submission remain separate. Broader scheduling, resource-vector admission and
residency policies are not completed by this rendering contract.
