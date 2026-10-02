# Roadmap: bounded framework contracts

Foundation is a skeleton that creators extend within explicit quality, performance,
ownership and maintenance contracts. It is not a checklist of game features to
complete. The [creator contract](CREATOR-CONTRACT.md) defines the responsibilities
of the engine, creator and implementation agent.

Work is selected from an authorized creator requirement or an evidenced weakness
in a reusable contract. The absence of a particular simulation, vehicle model,
economy, curriculum or world is not an engine defect. Existing optional kits and
examples remain available; they do not prescribe the creator's game.

| Contract area | Existing seam | What justifies further engine work |
|---|---|---|
| Simulation and movement | Owned fixed-step systems, force terms, frames and control handoff | A concrete adapter cannot meet its declared work, cancellation or correctness requirements through the existing seam |
| Spatial representation | Canonical finite surfaces, chunk generations, contact and route interfaces | An authored scale/precision/residency requirement exposes a measured boundary; no assumed planetary or world scope |
| Resource use | Shared leases, dependency admission and worker queues | Evidence of unbounded retention, incorrect accounting, ownership loss or undefined overload behavior |
| Presentation and interaction | Renderer/view ownership, action map, layers and optional UI kits | A selected experience cannot preserve its declared visibility, input reach, quality floor or resource limits |
| Persistence and local state | Versioned save sections and application-owned coherent envelopes | A declared migration, failure or atomicity requirement is unsupported or incorrectly represented |
| Authoring and content | Typed definitions, generators, validation and staged publication | A real author workflow needs a bounded, testable extension without editing unrelated engine internals |
| Verification | Brief checks, budget ratchets, browser diagnostics and device evidence records | A claimed guarantee has no reliable check, or a check does not exercise the actual runtime contract |

New adapters and optional integrations require their own bounded consumer and
acceptance record. Native backends, network transports and additional domain kits
are choices a creator may justify, not implied engine completion requirements.
Do not add a competing scheduler, cache or registry merely to host a new example.

The creator-contract milestone makes resolved build requirements versioned,
validated and immutable; malformed scene/startup caps fail brief validation.
Generator documentation records extension ownership, bounds and evidence. See
[ADR 0076](adr/0076-engine-creator-agent-contract.md). These controls validate the
declared contract; they do not certify arbitrary authored code or device behavior.

## Current framework upgrade record

The [framework upgrade capability map and acceptance matrix](guides/framework-upgrade-status.md)
consolidates terrain intake/recipes/jobs, regional terrain, authored documents and
history, truthful save feedback, optional editing, diagnostics, route lifetimes and
dependencies, qualified identity retirement and delayed materialization. It names
actual APIs, owner boundaries, overload/failure behavior and absent integrations.

The runtime and intended-use consumers landed through PRs #80–#94. The record
separates observed feature workflows, configured regression commands and final
revision-specific checks. At that historical baseline, regional normals/coverage did not provide an
ordinary Surface facade or packaged regional worker adapter. PR #109 subsequently
integrated both through the existing Surface and WorkerHost owners; see the
[regional surface guide](guides/regional-terrain.md) and continuing ledger for the
current evidence and remaining scale limits.

This is a finite framework milestone, not a claim that every game requirement is
implemented. Creators retain device/quality choices and may omit every optional
kit. Earlier CI inventories, counts and performance measurements below remain
historical at their named revisions; they are not the final combined acceptance
record and must not be summed or used as a current CI verdict.

## Terrain foundation and earlier evidence

The optional terrain kit and terrain template introduce a bounded fixed-resolution surface, shared render/contact triangles, seeded authored layers, level pads, generic indexed meshes and optional character grounding. See [ADR 0064](adr/0064-canonical-terrain-surface.md), [kit API](../src/kits/terrain/README.md) and [playable template](../templates/terrain/GAME.md). The finite-region implementation now includes shared normals, conservative LOD, local dependency invalidation, bounded seeded scatter, screen-space selection and shared-worker patch generation. Planetary topology is a candidate extension, not a claim of this implementation. Template measurements establish only the documented finite-region limits.

## Upgrade scope

Engine work is selected by reusable contracts and measured constraints. Optional kits do not make their domain rules mandatory. Research suggestions and application scenarios are not automatically scheduled features. Model leases, skeletal presentation, per-view masks, cube resources, prepared dependency handover and navigation lifetimes are engineering mechanisms; worlds, curricula, progression balance and authored economies belong to independent applications.

## Device runtime and callback reliability

Current implementation milestone:

- Bound notification retention during holds and isolate callback-owned data.
- Contain event error reporters and snapshot diagnostic observers per dispatch.
- Expose optional union-footprint and critical-region geometry diagnostics.
- Install authored/saved graphics settings before dependent render allocation;
  preserve explicit query pins and separate graphics from input capabilities.
- Verify geometry with a synthetic browser fixture, and boot settings with actual
  starter renderer evidence. Neither proves physical-device performance.

Application-owned critical-region acceptance and sustained physical-device evidence
remain open. Bounded causal event tracing is implemented; optional compact shell
presentation, creator-defined capture matrices, saved-controls browser checks and
owned touch producers are integrated at this record's baseline (`c4e43b4`).
Neither means every application has adopted the
mechanism. Research is recorded under [research](research/README.md).

### Current optional tooling checks

Source/configuration inventory at `b5933b7`, reviewed 2026-09-30:

- `test:ui-browser`: six serial diagnostics — HUD disclosure, action hints/saved
  controls, compact shell, owned touch, comfort settings and native controls.
- `test:diagnostics-browser`: synchronous event timing, terrain inspection, entity
  metadata and authored-system timing.
- `test:capture-browser`: authored capture steps and retained failure/recovery
  evidence, including the stock Sound journey.

`.github/workflows/ci.yml` invokes these three commands before template gates and
phone smoke. This inventory describes configured coverage, not the result of a
particular CI run. Physical hardware, comprehensive application usability and
external trace-viewer acceptance remain separate. Earlier counts and measurements
below are historical evidence at their named revisions.

### Deferred replay and animation transformation tooling

Source review at `f357f17`: `src/domain/sim/host.ts` provides a fixed-step host and
per-tick input callback, exercised by its tests; no authored-scene integration of
that host was found. The current `src/author/runtime.ts` instead samples actions
for `runner.frame`, then clears press edges each frame. Seeded execution and bounded
event traces do not establish recorded gameplay replay. Defer a new replay API until
there is a real creator-selected consumer and defined input encoding, simulation
state/checkpoint contract and reproducibility scope. Do not replace live input or
create a second simulation owner solely to supply a recorder.

Animation playback already exists: `src/platform/assets/models.ts` loads glTF clips,
`src/author/model-playback.ts` and `scene-model.ts` own instance playback, and
`src/kits/animation` supplies authored pose/marker/root-motion mechanisms. An offline
optimizer/compiler is deferred: `scripts/lib/content-bundle.mjs` publishes prepared
files, and the inspected pipeline has no animation-reduction recipe consumer.
The [tooling research](research/TOOLING-LANDSCAPE.md) remains a candidate investigation,
not a requirement for current native clip playback. A future creator-selected
transformation needs explicit fidelity limits, source/output provenance and a real
consumer before adding that pipeline. Runtime resource-lifetime fixes are separate.

### Optional authored-system timing

The dev/test runtime can capture bounded completed synchronous system intervals
through the existing scene visit and runner. It attributes named authored work
without changing gameplay scheduling; worker timing, asynchronous causality and
replay remain separate. See [system timing](guides/system-timing.md) for bounds,
lifetime and evidence limitations.

### Optional entity metadata inspection

`engine.entities()` now pages unnamed entity IDs and detached component labels
through the existing scene visit. Numeric-ID and component-store checks share an
explicit work budget; partial metadata is labelled. Stale/ended visits cannot
inspect a replacement, and no component values are read. The real authored-scene
browser diagnostic runs in CI. This is not a value editor, generic resource
inspector or replay. The optional dev bridge does not imply all core metadata
primitive bytes are stripped from production. See [entity inspection](guides/entity-inspection.md).

### Optional terrain inspection

`@kits/terrain` now supplies `inspectTerrain` for detached, bounded tile metadata
from the existing generation owner. Expected epochs reject stale reads; optional
consumer-reported displayed variants remain separate from prepared topology.
The finite browser diagnostic exercises pending old contact, coherent publication,
stale display rejection and closure, without adding background work. CI runs it
through `test:diagnostics-browser`. This is an inspection slice, not terrain
painting/export, an editor observer, navigation generation or application GPU
acceptance. See [terrain inspection](../src/kits/terrain/README.md#optional-on-demand-inspection).

### Bounded event diagnostics and install cancellation

Opt-in `engine.eventTrace()` records synchronous bus parentage, listener failures
and depth rejection in a bounded ring with bounded labels and dropped counts.
Export is detached; capture disposal is explicit. The recorder is dev/test-only,
while the generic observer hook remains in core. This is not replay, asynchronous
context propagation or cross-worker tracing. See [event diagnostics](guides/event-trace.md).

Application disposal now cancels pending module-install signals, revokes provisional
services and retires late installation results. It prevents later boot publication;
it cannot forcibly settle an installer that ignores cancellation. The implementation
uses the existing application/module owners in `src/core/app.ts`.

### Optional compact shell

PR #25 in the private development history adds creator-selected
compact presentation for existing registered Sound/Graphics controls through the
existing layer/input owner. Expanded remains the default; compact is not inferred
from device names and does not select graphics quality. The branch includes
viewport-bounded scrolling, safe insets and larger compact targets. Final branch
`fa1db804` passed all seven template gates with 1,225 tests, plus browser checks for
portrait/landscape compact presentation, enlarged text and expanded desktop behavior.
At the earlier `949b32a` milestone, the four UI diagnostics (HUD disclosure,
action hints including saved-controls reloads, compact shell and owned touch)
passed locally; that branch also passed the Expedition gate with 1,251 tests
and 28 performance checks. These checks do not certify all application layouts,
tablet configurations or physical devices. Application migration remains a separate choice. See the
[compact-shell guide](guides/compact-shell.md).

### Creator-defined capture matrix

The optional [capture matrix](guides/capture-matrix.md) accepts a validated version-1
manifest of explicit profiles and scene/task cases. Viewport, DPR, touch capability,
mobile browser emulation and graphics query values are independently authored;
unsupported profiles are skipped. Captures run serially through the existing
browser/server owners and retain revision, environment, screenshot and probe
records. Observed viewport/DPR/touch mismatches fail capture. Every declared task
and criterion remains unverified, even after a successful image. The runner
optionally executes up to 64 authored `click`, `tap`, `key` or locator `waitFor`
steps before capture. It records completed/failed/cancelled operations; a failed
step stops that case, records the error, attempts a failure screenshot and
continues later cases. Scenarios beyond this bounded vocabulary still need their
own scripts. It does not add a mandatory BuildBrief matrix, device preset or
physical acceptance claim.

### Optional independent touch producers

[Owned pointer controls](guides/owned-pointer-controls.md) provide bounded optional
registered-action sources and one captured touch contact per authored control,
including non-primary contacts. The existing dispatcher retains accepted held
state, epochs and delivery; the optional adapter handles raw contact edges and
lifetime. Creators choose actions, mapping and placement or omit the adapter.
The composed browser diagnostic uses two simultaneous CDP contacts for movement
plus an independent action, independent release, modal cancellation, fresh-contact
restart, teardown and keyboard independence. It is included in the current
`test:ui-browser` command. It does not implement a universal joystick layout,
analog control model or physical touchscreen acceptance.

### Owned reading UI

Optional HUD disclosure now has an implementation through a visit-owned child
activity. The author selects inline or disclosed detail; the scene pauses while
reading and resumes through the existing layer/input lifecycle. See
[the kit recipe](kits/ui/disclosure.md) and ADR 0071. Opt-in `hud.layout({ select })` now lets creators select presentation from scene
viewport dimensions through the existing resize owner. There are no built-in device
thresholds or graphics changes; manual `present()` detaches selection. Application-specific
UI migration and physical-device certification remain separate. See the
[UI framework guide](../src/kits/ui/README.md).

### Resource publication and retirement

The asset cache now publishes only under current ownership and retires failed or
canceled allocations. Reentrant loaders and disposal callbacks cannot poison retries
or evict a newly live lease. Texture disposal independently releases the original
decoded image. See [ADR 0072](adr/0072-transactional-resource-retirement.md).

### Renderer startup and live primitive ownership

Shell settlement and renderer probes now use a lightweight accessor to the existing
pool; they do not initialize or statically import its GPU implementation. Render
consumers still initialize that same pool and request synchronous leases. The
[controlled Expedition comparison](verification/optional-renderer-startup/README.md)
measured static HTML-entry JavaScript falling from 711.9 to 236.4 KiB; total emitted
JavaScript grew slightly and the first rendering scene still loads its renderer.
This is not a first-frame latency or physical-device performance result, and other
applications may retain eager GPU imports.

Primitive `Shape` meshes now share geometry by kind and dimensions only while it
is live. Resize acquires and assigns a replacement before release; removal retires
the last reference, and scene exit drains remaining ownership through the existing
scene resource owner. Previously every visited size stayed resident until exit.
Tessellation and quality are unchanged. The integrated branch `430d11f` passed the
Expedition gate (1,264 tests and 28 performance checks), four existing UI browser
diagnostics, and an additional manual composed resizing/sharing/removal/exit check.
The [resource guide](guides/dependency-resources.md#built-in-primitive-geometry-lifetime)
describes that opt-in diagnostic and its limits; it is not default CI or hardware
acceptance. This primitive fix does not claim all representation lifecycles have
been audited.

Binding-derived action hints are available through the existing input owner and
`ctx.input.describe`. See [the guide](guides/action-hints.md) and ADR 0073.
In-session remapping and covered-action context have real browser evidence.
Optional saved overrides compose through the existing input and save owners.
The browser fixture verifies ordinary save completion, reload with actual keyboard
dispatch, fresh-context defaults, player switching, and reset followed by reload.
It uses service commands, not a finished Controls screen; malformed-storage and
write-failure regressions remain composed module tests. See
[saved controls](guides/controls-settings.md). A finished production Controls
screen, axis descriptions and device-family glyph formatting remain separate work.

### Independent review follow-ups

Modal no-op keys preserve native and scoped handling; reading content receives
initial focus. Standard controller polling now feeds the registered dispatcher
through an application-scoped update-only ticker on the existing loop. Scene coverage
and hidden-tab suspension remain enforced. Image decode admission is bounded and
retryable under temporary capacity pressure; model publication and cleanup survive
reentrant callbacks. See [the review record](verification/review-followups-2026-09-30.md)
and ADR 0074 for evidence and explicit limits.

### Opt-in lazy scene bodies

The scene generator supports `--lazy-body` using the existing `SceneBody` callback
and a non-discovered `.body.mts` module. Default inline generation and ordinary
`.ts` definition discovery remain unchanged. The learn day/night scene demonstrates
this boundary; body-only transitive imports must avoid eager discovery too. See
[ADR 0075](adr/0075-opt-in-lazy-scene-bodies.md). Generation/discovery tests and a production build verified this boundary for the
learn scene: its body emitted separately and startup JavaScript fell from 679,706
to 678,584 bytes in that recorded comparison. This is a byte measurement, not a
latency improvement claim or acceptance for every future migration.

The Expedition shelter now uses the same optional body boundary, and scene cube
assembly loads only when a background/reflection requests it. Cube requests snapshot
authored values before awaiting and preserve cancellation, replacement and lease
retirement. The rebased cube branch's Expedition gate passed 1,218 tests and 28
software-rendered performance checks; first-load JS was 710.8 KiB against the 704 KiB
budget with its existing tolerance. Budgets and quality floors were unchanged.
This combined result includes the shelter boundary and does not isolate cube savings
or establish loading latency or hardware performance.

### Composition contracts

See [composition frameworks and remaining work](guides/composition-framework-status.md)
for unique equipment custody, optional action lifetimes, explicit objective stages,
their tested boundaries, and the remaining character, progression, production,
authoring and multiplayer work. These are creator-selectable frameworks, not a
mandatory feature catalog or a declaration that every game capability is complete.

### Framework reliability and creator freedom

The creator contract and subsequent fixes are integrated through `b3aac18`
(PRs #14–#19). Build snapshots accept empty mode lists, zero repetition limits,
nonnegative fractional ages, and concise or multilingual success text. These choices
remain subject to the creator's own acceptance criteria; schema validity is not
proof of good game design.

System diagnostic failures no longer interrupt sibling systems or timestep
accounting. Headless tests still surface failures after the frame completes, with
original causes and system identities. Force identities are unique independently
of execution order. Simulation host construction rejects unrepresentable substep
counts and durations without prescribing an application's equations or timing.

At the earlier `b3aac18` milestone, combined main tests passed 1,194/1,194 and the build passed. Every branch
passed its integration gate before merge. The layout branch also passed all seven
template gates and the browser HUD/resize suite. These results do not establish
physical-device performance; the terrain run retained an advisory heap warning.
Remote CI for that milestone was pending when its record was written; this is
not a statement of current CI status.

### Appearance, timed effects and capability revision

The composition frameworks now include bounded appearance documents, a separate
desktop primitive preview tool, timed modifier contributions and revisioned
capability removal policies. See the [current contracts and remaining work](guides/composition-framework-status.md).
These reuse document, edit-session, save and modifier owners; creators retain
control of compatibility, time, stacking and progression semantics. Browser
acceptance is desktop emulation only; no skeletal editor or network authority is
claimed.

The [continuing acceptance ledger](guides/upgrade-acceptance-ledger.md) tracks
remaining framework and consumer obligations across batches. Unresolved items
remain open until their acceptance is observed or the creator explicitly changes
the scope.

### Optional networking continuation

The [network admission guide](guides/network-admission.md) describes the implemented
integrated NW-01 slice: replaceable bounded intake, explicit browser transport and a
loopback reference host. Focused and native desktop checks are recorded in the
[acceptance ledger](guides/upgrade-acceptance-ledger.md); PR #120 integrated the candidate at `3a97ca6` after all seven template gates
and combined main tests/build passed.

NW-02 now has an integrated [complete scoped-view framework](guides/network-views.md):
explicit creator disclosure, bounded complete replacement, one outstanding
application credit, optional scene activity notifications and a two-peer native
reference consumer. Runner `534c11a` passed the native browser workflow at clean
`f98eb2c`; the earlier dirty `eaaaf2f` exploratory pass is historical evidence. Four declared local load cases passed,
with worst observed publisher p95 0.321 ms; see the
[reference evidence](../tools/replication-workbench/README.md). The subsequent
all-template gate failed during Arcade (1,960/1,961 tests; file-level
`entity-inspection.test.ts` failure despite its inner test passing). The standalone test and full source-suite TAP retry
passed (1,960 tests, zero failures/cancellations); the cause is not established. The completed 18 performance checks
passed. The subsequent exact-head gate passed on `8121257`: all seven templates,
1,960 tests and 129 performance checks, with zero enforced breaches, regressions
or inconclusive results. Four software-GL heap advisories remain (two Mechanics,
two Terrain). NW-02 is now integrated on `main` by merge `ea48539` (work tracked in PR #122 in the private development history).
The rebased clean browser run passed at `508edd9`; final `47a7e6d` passed all seven
template gates with 1,965 tests and 129 performance checks, zero enforced breaches,
regressions or inconclusive results, and four advisory heap warnings. Combined
main tests (1,965) and build passed. Integration here is verified Git ancestry;
the GitHub PR API still reported OPEN immediately after push, so no PR-state
transition is asserted.

Durable authority and optional prediction/reconciliation (NW-03) are integrated as recorded below. Actual supported-device acceptance (DV-01) remains unresolved. No identity service, game
protocol or mandatory network dependency is added to ordinary player builds.


### NW-03 integration checkpoint

[Durable authority](guides/durable-authority.md),
[prediction](guides/prediction.md) and the optional SQLite adapter are integrated. NW-03 is integrated on private `main` by merge `b6fb4a3` (PR #123 in the private development history). Exact head `883f4ad` passed all seven template gates: 2,018 tests, 129 performance checks, zero enforced breaches/regressions/inconclusive results and four advisory heap warnings. Combined main tests (2,018) and build passed. Clean native acceptance passed at `8317c69` with seven observations. Exploratory native correction,
replay, restart and retirement checks passed; Node 22.13 storage/host tests passed.
The [acceptance ledger](guides/upgrade-acceptance-ledger.md) owns the revision and
evidence details; DV-01 remains open, with minimum phone, tablet and laptop/desktop profiles pending creator selection. This is a continuation of the accepted engine
framework work, not a new required game feature or runtime dependency.
