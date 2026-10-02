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
Other renderer exceptions retain their existing policy. Non-link restoration
preparation failure permits a reported degraded synchronous fallback.

Compile does not submit every generated pass, background or future asset variant.
Three can query uniforms before native `useProgram`; validation is not a promise
that all earlier driver queries are cheap. Initial drawing is not GPU completion
or presentation. No fence policy or broad residency scheduler is delivered here.

## Verification status

Public-base source transfer is under verification. Required evidence is adversarial
unit tests, independently rebuilt native fixtures, explicit full diagnostics,
context restoration, shared ownership, and exact-head template gates/snapshots.
Previous checks from other checkouts are not acceptance of this artifact.

The engine-owned native fixture is
`scripts/play/fixtures/program-validation.ts`. Bundle it with esbuild using
`--bundle --format=iife --global-name=ProgramValidationOracle`, load the result in
an isolated muted browser, and evaluate `ProgramValidationOracle.run()`. Record
the backend and result with the exact source/build identity. This fixture checks
actual Three rendering and failure diagnostics; it does not certify timing or
actual context-loss recovery. The pool tests separately exercise loss ownership.
