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
