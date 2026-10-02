# Owned program preparation

The renderer pool can prepare submitted programs before author-scene activation.
This is an engine contract for independent scene consumers, not a guarantee that
arbitrary future rendering is inexpensive. Quality settings and budgets are unchanged.

## Public boundaries

A world lease exposes `programsReady(signal)` after the consumer has called
`renderer.compile(scene, camera)` with its actual environment and lighting.
The operation captures at most 1024 live native programs, waits up to 15 seconds
for `KHR_parallel_shader_compile` completion when available, and validates linkage
for that same captured set. The lower-level helper permits explicit bounds up to
4096 programs and 60 seconds. Capacity, timeout and driver errors reject.
`ready` means captured live programs completed and linked; `unsupported` means
completion polling is unavailable but synchronous link validation ran; `retired`
means the request or context lost ownership. No-KHR checks can block.

One request may wait per world lease. A successor retires the earlier wait.
Release/loss cancels polling before disposal; restored contexts receive fresh
lifetimes. Deleted handles are skipped. Later programs are outside that snapshot
and are checked by the context's use boundary. Stage views do not expose world
readiness; their shared-context lifetime remains separately owned.

`installProgramValidation(gl)` installs once per context before program creation.
It observes create, link, delete and use calls. Link verdicts are cached until
relink, deletion or context retirement. `clear()` retires an epoch; old handles
cannot be revived by relinking. Weak records do not retain program objects.
Only failed links read logs, retaining at most 4096 characters from one program
and two shader logs. Native allocation of those logs remains driver-owned.
A `ProgramLinkError` distinguishes a failed link from unrelated renderer faults.

`RendererPoolOptions.programDiagnostics` selects `full` or `failure-only` for
world renderers. Development/test builds default to full Three diagnostics;
production defaults to failure-only. Explicit full mode retains Three's error
callback and warnings. Stage renderers retain their existing full diagnostics.
Closing a stage peer does not invalidate other live peers; context loss and final
retirement clear their shared validation epoch.

## Consumer and recovery

The author runtime synchronizes initial entities/environment, compiles, awaits
program readiness and submits a real initial draw before resolving `ready`.
Initial errors therefore use router failure/retry. A later typed shader error
suspends update/render and shows a visit-owned Retry surface. Synchronous restore
errors enter the same owned boundary. Superseded owners cannot publish recovery.
Other renderer exceptions retain their existing policy. A non-link preparation
failure (capacity, timeout or a driver query error), initially or on restoration,
is logged, marks `data-program-readiness="degraded"` and falls back to the
pre-existing first-draw compilation, which still validates links. A scene is
therefore never refused only because bounded preparation was unavailable; a typed
link or fence failure still uses router failure (initial) or the owned Retry surface.

Compile does not submit every generated pass, background or future asset variant.
Three can query uniforms before native `useProgram`; validation is not a promise
that all earlier driver queries are cheap. Initial drawing is not GPU completion
or presentation. No fence policy or broad residency scheduler is delivered here.

## Verification status

Public source checkpoint `2cdd442` passed all seven template gates and inspected
desktop/mobile snapshots. Engine-owned native fixtures verify malformed shaders,
link-only incompatibility, full diagnostics, a real pixel result and context
restoration. See [retained evidence](../verification/program-preparation/README.md).
This does not certify all hardware or sustained traversal performance; integration
and submission remain separate.

The engine-owned native fixture is
`scripts/play/fixtures/program-validation.ts`. Bundle it with esbuild using
`--bundle --format=iife --global-name=ProgramValidationOracle`, load the result in
an isolated muted browser, and evaluate `ProgramValidationOracle.run()`. Record
the backend and result with the exact source/build identity. This fixture checks
actual Three rendering, a red center-pixel readback, late shader failures and link-only
incompatibility. The readback is diagnostic, not a performance measurement.
For actual context loss, retain `contextLossFixture()` in the browser and invoke
`lose()`, then `restore()`, then `verify()` in separate browser tasks after the
corresponding events appear in `read()`. Always `dispose()` or close the isolated
browser. This proves the named context lifecycle, not whole-scene restoration or
performance.

## Submitted frame completion

World leases also expose `frameReady(signal)` after a real draw. One pending fence
per lease observes preceding commands through public `fenceSync`, `flush` and
`clientWaitSync` with flags and timeout zero. Polling starts in a later browser
task and yields between checks. The default deadline is 15 seconds; the helper
permits explicit deadlines up to 60 seconds. It never calls `finish` or blocks on
a nonzero wait. This is GPU completion, not presentation or future scene readiness.

Loss, release, abort and replacement retire the wait; a live sync is deleted once.
Cleanup failures reject without skipping other owned cleanup. Injected scheduling
must enqueue a later task; synchronous callbacks reject. `FrameReadinessError`
timeouts/failures use author recovery. The author awaits this boundary after its
initial draw, including restoration, rather than adding a wait to every frame.

`ProgramValidationOracle.frameCompletion()` tests this boundary natively. Its
isolated context preserves the drawing buffer only for a post-task pixel oracle;
that diagnostic flag does not change production renderer configuration.
