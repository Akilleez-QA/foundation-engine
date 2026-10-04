# Device acceptance: current enforcement gaps

Historical source and CI configuration review: `f357f17`, 2026-09-30, including
composed HUD obstruction and acknowledged resize regressions, capture steps and
their CI command, saved controls and owned touch producers. This source review
does not certify an uninspected CI run. The
[device policy](../policy/DEVICE-EXPERIENCE.md) is normative; the following runtime
and automation limitations remain unverified or require implementation. This
inventory prevents a standards change from being mistaken for device certification.

## Current candidate update — 2026-10-01

The [stock template matrix](../kits/stock-device-acceptance-matrix.md) inventories all seven
briefs at integrated `b6fb4a3`. It preserves their declared targets and separates
existing tests from complete consumer workflows. The subsequent
[exploratory touch receipt](../verification/stock-device-20261001/README.md) records
16 target/tap checks on a dirty candidate: minimum sizing passes after a shelter
font correction, but compact lesson controls visibly cover content. Layout/cleanup
repairs, full task workflows and physical-device evidence remain open. This does
not refresh historical CI results or establish an exact-head gate pass.

## Lesson layout repair — 2026-10-02, integrated in v0.2.0 (PR #9)

The compact lesson overlap is repaired in the learn kit's layout seam: the board,
caption, slider, cards and quiz stay clear of the wrapped control bar and the
progress line, and keep their authored geometry where there is space (desktop
unchanged). `src/kits/learn/layout.test.ts` and the runner's new separation checks
fail on the old layout. The [layout repair receipt](../verification/stock-device-20261002/README.md)
records a clean-commit emulated pass at 320×568, 390×844, 844×390 and 820×1180 and
the inspected screenshots. Still open: touch scrolling in the fitted quiz (phone
landscape), the small compact board, 200% text/zoom, the full touch lesson, other
template workflows and all physical-device evidence. Minimum phone, tablet and
laptop/desktop profiles are pending creator selection; DV-01 remains unresolved.

## Existing mechanisms

| Existing mechanism | Limitation | Required follow-up evidence |
|---|---|---|
| `src/author/build.ts`, `scripts/lint/brief.ts`, optional capture manifest | Device targets and minimum-derived ceilings exist; a separate version-1 capture schema validates explicit profiles/cases, but it is not a mandatory typed BuildBrief UX/evidence matrix | Author relevant cases and acceptance records; do not treat profile declarations or captured images as passed criteria |
| `scripts/play/lib.mjs`, `snap.mjs`, `capture-matrix.mjs` | Legacy phone smoke still moves with keyboard events. The optional matrix supports authored viewport/DPR/touch/mobile configurations with optional bounded click/tap/key/visibility steps | Author landscape, tablet or split-view cases where supported; select intermediate UI states with optional steps and verify declared tasks separately |
| `scripts/perf/bench-browser.mjs` | Explicit DPR, touch and mobile emulation are configurable; legacy defaults remain. Browser emulation is not hardware | Label layout evidence as emulation and collect separate physical-device performance records |
| Expanded shell and optional compact shell | Expanded remains default. Compact adds owned disclosure, viewport scrolling, safe insets and 48 CSS-pixel targets; no automatic migration or device inference | Maintain the CI browser suite and accept application-specific visibility, targets, clipping and tablet configurations |
| `src/platform/render/quality.ts` `detectPreset`, `deviceClassCap` | Pointer-independent selection has regression coverage. A constrained mobile GPU (renderer string, memory, cores) starts on `medium` or `low` unless the brief declares a tier (ADR 0079); iPhone-class `Apple GPU` is not classified. Unit-tested on representative signals only | Measure authored presets on each supported minimum device; confirm real renderer strings and first-run presets on physical phones; do not infer capability from touch |
| `perf/budgets.ts`, reference bench | Reference counts are checked; software timing is advisory | Each advertised device/preset has cold and sustained measured acceptance; no hardware claims from software rendering |
| Optional `measureUiOcclusion`, synthetic DOM fixture and composed HUD regression | Synthetic checks cover clipped union geometry and pointer interception; the composed HUD checks one authored projected region, including an overcrowded negative case and disclosure recovery. Neither discovers application critical regions automatically | Application-owned region annotations and task-specific containment, readability, contrast and interaction evidence |
| Optional PERF-01 [session recorder](session-performance.md) (`engine.sessionRecorder`, `?session-record`) | Integrated in v0.2.0 (PR #15 on the public repository, merged at `ae69a38`). Provides a bounded local evidence format: rolling frame/work percentiles, long frames and drift. Its only runs so far are in emulated headless Chromium | Operator-labelled physical runs, cold and sustained, for each creator-selected profile and preset, with declared thresholds. The recorder output alone is not acceptance |

## Implemented mechanisms and remaining acceptance

- Visit-owned HUD disclosure and opt-in `hud.layout({ select })` already exist.
  Selection uses scene viewport dimensions, not a device name or graphics preset.
  The composed HUD fixture now waits for the scene's `observeSize` notification
  to acknowledge actual dimensions before asserting six resize transitions. It
  verifies that an unchanged selection preserves the sheet/focus/pause, changing
  to inline closes the sheet and resumes, held input does not revive, manual
  selection survives later resizes, and route exit leaves no sheet. These are
  fixture choices, not prescribed breakpoints or proof of every application layout.
  See PR #42 in the private development history.
- The composed HUD regression measures a 64×64 CSS-pixel region around one projected
  scene point in phone, tablet and desktop browser viewports. It requires the
  intentionally overcrowded inline presentation to violate the fixture's zero
  obstruction criterion, then requires disclosure to restore a fully in-view,
  unobstructed region. This negative regression is implemented, not remaining work;
  a pass means the bad layout was detected, not accepted. See
  PR #33 in the private development history and
  [visibility diagnostics](ui-visibility-diagnostics.md#composed-hud-regression).
  Conservative rectangles do not establish glyph visibility, contrast, pointer
  routing or accessibility, and creators still choose their own subjects and limits.
- Input-independent graphics selection and authored/saved startup quality wiring
  already exist. The remaining task is supported-device measurement, not removing
  a coupling that the current implementation has already removed.
- Optional saved controls use the existing input/save owners. Browser evidence now
  includes ordinary save completion, actual reload and keyboard dispatch,
  fresh-context defaults, player switching, and reset then reload. It uses service
  commands, not a finished Controls screen. Malformed-storage and write-failure
  checks remain composed module tests; browser recovery and hardware-specific
  reachability remain separate. See [saved controls](controls-settings.md).
- The optional [capture matrix](capture-matrix.md) validates versioned profiles and
  cases, captures serially, records environment/revision and checks observed
  viewport/DPR/touch configuration. Unsupported profiles are skipped. Every task
  and criterion remains unverified. Optional explicit steps inject click, tap or
  keyboard interactions; declaring inputs alone does not. Completed steps do not
  certify a screenshot's readability, visibility or task acceptance. The repository
  also runs `test:capture-browser` in CI for the stock Sound journeys and an
  intentional failure followed by successful capture; inspect each run's result.
- [Owned touch controls](owned-pointer-controls.md) support independent per-control
  capture, including non-primary contacts, through the existing action dispatcher.
  A composed browser fixture exercises two simultaneous CDP contacts, independent
  release, modal cancellation, fresh-contact restart, cleanup and keyboard
  independence. This is framework regression evidence, not a complete joystick
  layout or physical touchscreen acceptance.
- [Bounded event diagnostics](event-trace.md) provide synchronous causal capture;
  they do not prove usability, asynchronous causality or physical-device performance.
- Pending-install cancellation and request-time shelter/cube loading are integrated
  ownership/startup mechanisms. Their tests and software-rendered gates do not
  certify mobile visibility, latency, thermal behavior or sustained frame rates.

Historical evidence at branch `949b32a`: `npm run test:ui-browser` passed all four diagnostics: HUD
disclosure, action hints with saved controls, compact shell and owned touch sources.
The Expedition exact-head gate passed 1,251 tests and 28 performance checks. CI
invokes that serial browser suite, now including the composed obstruction and
resize-acknowledgement regressions described above. Each remote run has its own result, rather
than inheriting a local pass. These are automated viewport/interaction and
software-rendered performance records; physical-device acceptance remains
unverified. See [browser regression coverage](ui-browser-regressions.md).

## Remaining work

1. Apply the existing optional capture matrix to creator-selected profiles and
   cases, optionally including bounded interaction steps; retain explicit unverified
   criteria and supplement captures with application acceptance records.
2. Apply existing union-footprint diagnostics to authored critical regions and
   extend the simultaneous-contact regression to application-specific interactions.
   Reuse the implemented overcrowded HUD negative regression as an example, then
   author application-specific failure/recovery cases. Clipped geometry alone does
   not prove visibility, readability or reachability.
3. Maintain the CI browser suite and separately accept creator-selected application
   layouts. Preserve expanded desktop behavior; do not assume compact
   automatically certifies phones or tablets.
4. Collect application-specific zoom, longest-label/bidirectional layout, virtual
   keyboard/browser chrome, hand-obstruction, comprehension and camera-comfort
   evidence where relevant to the selected experience. Existing CSS text-scaling
   checks are not full browser zoom or localization acceptance.
5. Collect actual-device quality/performance evidence with declared thresholds,
   reproducible workloads and sustained runs for each supported configuration.

Existing tests and budget ratchets continue unchanged. Browser viewport checks and
software-rendered count gates are automated evidence, not physical-device evidence.
No current template is declared fully compliant with the device policy by this
document, and no all-application UI migration is claimed. Applications retain their APPLICATION.md acceptance matrix; optional capture
reports can supplement it without converting unverified criteria into passes.
