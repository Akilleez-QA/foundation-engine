# Device experience policy

| Field | Value |
|---|---|
| Status | Normative requirements for supported-device acceptance; automation coverage is explicitly listed below |
| Applies to | Stock Foundation contributions and applications explicitly adopting this device-conformance baseline, within their declared support scope |
| Contract | [Architecture standard](../STANDARD.md), especially input, quality, performance and conformance |

A supported device must let the player see, understand and complete the intended
interaction. A fast renderer behind obstructive controls does not pass. Neither
does a readable interface whose sustained performance prevents reliable input.
Each advertised phone, tablet, laptop or desktop experience requires its own acceptance evidence.

The numeric defaults below are **Foundation product policy**, not claims of
conformance with an external accessibility standard. Under the
[creator contract](../CREATOR-CONTRACT.md), independent games and forks may adopt,
configure or replace this baseline, including its layouts, thresholds and workflow.
Record the selected requirements and evidence in the application specification;
do not present a changed requirement as unchanged Foundation conformance. Stock
contributions and applications claiming this baseline use the
[application annex](../APPLICATION.md) and the scoped exception process below.
This document changes no runtime budget or validator.

## Author-selected scope and optionality

**DX-0 — Device support is a product choice.** No application is required to support
phone, tablet, laptop and desktop together. Desktop-only maximum quality,
tablet-first, phone-first and cross-platform builds are equally valid. The author
chooses target devices, supported modes/content, quality floors and performance
tradeoffs before acceptance. Requirements below apply only to that declared scope.
An unsupported phone imposes no UI, asset, geometry, memory or rendering ceiling on
a tablet or desktop release. A narrow desktop window may need responsive UI, but
that does not make it a supported mobile device.

| Valid choice | Contract |
|---|---|
| Maximum-quality desktop build | Declare desktop hardware and usable window bounds; no phone or tablet acceptance is required unless advertised |
| Tablet-focused build | Accept the selected tablet/touch/hybrid experience; phone support is optional |
| Phone-focused build | Optimize the declared phone experience; desktop expansion is optional |
| Shared cross-platform release | Explicitly accept shared artifact costs and per-device presentation/quality tradeoffs; verify every advertised combination |
| Separate device editions | Different artifacts, mode/content scopes and quality floors are permitted; identify each edition's compatibility, progress and save-data rules |

Record each device/mode combination as **supported**, **experimental** or
**unsupported**, and record evidence separately as passed, failed or unverified.
An experimental build is not a verified support claim. Unsupported combinations
need a clear explanation/recovery route when reached; they do not require a
playable downgraded game. Do not silently remove promised support to pass a gate.

Content and interaction parity apply within a declared shared experience, not as
a requirement that every edition contain identical features. Authors may choose
explicit mobile subsets or richer desktop editions. Communicate those differences
before entry and protect persisted data; an unsupported feature must not erase its
saved state. A graphics setting or automatic governor cannot secretly change the
edition, simulation rules or supported content.

Budgets are scoped to the build and experience they measure. The current
`defineBuild` schema has one minimum device per build; its derived ceilings apply
to that build, not all independent builds in a product family. Separate distributions
may use separate briefs and measured budgets. This policy does not claim a
multi-edition packaging/selection system already exists. Changing an existing
brief or increasing an existing budget retains its explicit author decision and
review requirements. No existing limit is raised by this policy.

## Independent axes, one interaction contract

- **DX-1 — Layout is independent of graphics quality.** Resolve layout from usable
  CSS viewport dimensions, safe insets, text size and available interaction space.
  Resolve input from actual available capabilities and effective bindings. Resolve
  rendering cost from the selected quality profile and measured resource limits.
  A narrow desktop window can require compact layout; a phone advertised for touch still
  needs usable touch controls in its creator-selected layout. A tablet with a keyboard does not
  automatically become a desktop. User-agent strings MUST NOT decide layout.
- **DX-2 — Explicit profile definitions.** Define the configurations needed by the
  selected targets, inputs and modes. Compact, intermediate and expanded are stock
  layout conventions, not required names or a fixed device-to-layout mapping.
  Shared components and actions can support creator-selected configurations;
  a single suitable layout is valid. Content fit informs authored transition thresholds. Viewport
  width alone MUST NOT hide required functionality. Avoid copied UI implementations
  with independent behavior, hard-coded device branches, or per-screen fixes.
  Laptop and desktop may share expanded components, but MUST have separate device
  evidence: a small integrated-GPU laptop is not certified by a large desktop.
- **DX-3 — Stable interaction.** Common actions retain names, symbols, relative
  grouping, ownership and predictable access paths across profiles. Density and
  disclosure change; action meaning and simulation rules do not. Preserve user
  choices, focus and unfinished input when resizing or changing peripherals.
  Do not move a held control or switch layouts mid-gesture; cancel safely before
  applying a necessary geometry change.

## Stock profile defaults

The table describes Foundation starting conventions. Apply interaction and test
cases only to declared supported inputs, orientations and window modes. It does
not require controller support on desktop, keyboard support on tablet, split view,
or multiple orientations when those are outside the declared experience. Creators
may choose other layouts with evidence against their recorded visibility,
reachability and quality requirements.

| Aspect | Compact: phone | Intermediate: tablet | Expanded: laptop/desktop |
|---|---|---|---|
| Persistent UI | Only immediate control, essential state and a stable route to additional actions; secondary instructions and detail collapse by default | Compact defaults plus secondary information only when essential-view tests still pass | Additional persistent detail permitted within the declared visibility and density limits |
| Navigation | One secondary panel at a time; explicit close/Back; retain location and context | Touch-first panels with bounded widths; side-by-side content only with proven remaining interaction space | Keyboard/focus and pointer navigation; docked panels may be used while the essential world remains usable |
| Continuous control | Touch-native drag/joystick or a tested equivalent; simultaneous movement and another required action must work | Same touch guarantees, including two-handed use; stylus/keyboard/controller may supplement touch | Declared pointer, keyboard or controller paths; supported small windows must still expose required actions |
| Help | Short contextual prompts; detailed instructions on demand; dismissible nonessential tips | Same behavior, with optional richer detail | Same meanings and dismissibility; shortcuts generated from current bindings |
| Layout changes | Test supported portrait and landscape; browser bars and keyboard must not strand controls | Test supported rotation, split view, touch and keyboard/trackpad combinations and changing available space | Test window resizing, display scaling and browser zoom; fullscreen is optional |
| Quality | Declared content floor at sustained performance on named minimum phone hardware | Independently measured tablet profile; neither phone nor desktop evidence substitutes | Independently measured minimum laptop/desktop profile, including the intended integrated/discrete GPU class |

- **DX-4 — Progressive disclosure.** Secondary menus, verbose instructions, history
  and optional diagnostics MUST NOT occupy the persistent compact play view.
  Every action required by the declared experience still needs a documented, discoverable route. A transient
  notification MUST NOT obscure a required target or dismiss/confirm control.
  Notifications need bounded queues and aggregation, not accumulating stacks.
- **DX-5 — Panels declare interaction behavior.** Each sheet or modal states whether
  the underlying simulation pauses, continues safely, or remains interactive.
  A covering panel MUST NOT leave an unseen time-critical interaction active
  without an application-defined safe behavior. The layer manager owns focus,
  inertness and Back; closing restores the prior meaningful focus.
- **DX-6 — Touch is real input.** For an experience advertising touch support,
  required operations on its touch path MUST NOT depend on hover,
  right-click, a physical keyboard, or precise desktop dragging. Continuous touch
  controls suppress selection and callouts only within their interaction surface;
  scrolling and zoom accessibility elsewhere remain available. Pointer loss,
  focus loss, hiding, orientation change and ownership changes release held input.
  Multitouch must keep independently held actions independent.

## Measurable visibility and usability

- **DX-7 — Essential-view contract.** Each interactive mode MUST define its essential
  world regions or tracked targets, required target size/readability, and input
  region in normalized usable-viewport coordinates or by a documented projection
  rule. A spatial view must keep its controlled subject, immediate intended action
  target and required feedback visible when those are needed to act. Other genres
  define equivalent task-specific regions. Do not prescribe a universal central
  rectangle that misrepresents the application.
- **DX-8 — Count actual obstruction.** Record persistent and transient UI footprints
  in CSS pixels. Occlusion is the area of the **union** of intersecting footprints
  divided by the usable viewport area; overlapping panels count once. Also report
  intersection with each essential region and input region, since a low total
  ratio can still hide the only actionable target. Transparent or translucent UI
  counts wherever text, decoration or its hit region impairs observation or
  intercepts input; lowering opacity is not a pass. Include controls, notifications,
  captions and expected finger/thumb coverage during touch tasks. Record the
  posture assumptions and assess actual hand obstruction on hardware separately.
- **DX-9 — Declare and test limits.** Each profile MUST declare a maximum persistent
  footprint and transient footprint, plus per-task essential-region limits and
  target readability criteria. There is no universal percentage that proves
  usability. Required actionable targets MUST have zero unintended UI interception
  and remain legible during the task. Any intentional overlay in an essential
  region needs explicit task evidence showing that the interaction remains
  possible. Layout selection and camera framing must cooperate through documented
  usable-view bounds, without UI code directly modifying simulation state.
- **DX-10 — Foundation size defaults.** For touch, effective hit targets MUST be at
  least **48 × 48 CSS px** with **8 CSS px** between neighboring unrelated targets.
  A smaller visual icon may sit inside the target; invisible targets must not
  overlap or intercept the world beyond their declared footprint. Primary reading
  text defaults to at least **16 CSS px**; nonessential metadata at least **14 CSS
  px**. Enlarging UI or text must reflow/collapse content before hiding actions.
  Do not shrink the entire desktop UI to satisfy a narrow viewport.
- **DX-11 — Legibility and scaling.** Text and critical control/state indicators need
  adequate measured contrast against the actual changing scene; backgrounds or
  outlines may provide separation. Color alone cannot carry required state.
  Reading/menu flows MUST work at **200% text size** and browser zoom without loss
  of actions, content or focus. Test long translated labels and multiline text.
  A camera image need not reflow like text, but its controls and readable feedback
  must still fit and remain reachable.
- **DX-12 — Viewport integrity.** Insets, browser chrome, display cutouts and the
  on-screen keyboard reduce usable space. Overlay positioning MUST respect the
  current visual viewport; the keyboard must not hide active input, confirmation
  or Back. No essential control may require native fullscreen or orientation lock.
  An unsupported orientation or size needs an accessible recovery view with an
  explanation and preserved state, not clipped controls or a blank canvas. The
  application must declare that limitation before claiming support.
- **DX-13 — Accessibility preferences.** Preserve reduced motion, captions, text
  sizing, accessible names and visible focus across every layout. Focus order must
  follow the presented UI rather than hidden desktop markup. Enlarged text and
  touch alternatives must not silently select a lower simulation fidelity.

## Quality and performance acceptance

- **DX-14 — Independent quality floors.** For each supported profile, specify the
  minimum visible target/indicator sizes, label readability, essential motion and
  feedback, and permitted rendering differences. Geometry/texture/effect scaling
  may reduce cost only inside these authored floors. The declared profile's required content, input
  timing and simulation rules remain intact. Higher-capability editions may define
  richer quality/content floors without imposing those costs on other editions. A small screen is not permission to
  obscure detail that the task requires or substitute unreadable indicators.
- **DX-15 — Real hardware is required.** Name minimum physical devices by model,
  CPU/GPU, memory, OS/browser, rendering resolution, pixel ratio and refresh rate.
  Record selected graphics and UI profiles separately. Phone, tablet, laptop and
  desktop each need their own representative minimum device when advertised; a desktop browser resized to
  a phone rectangle only proves that browser's layout behavior.
- **DX-16 — Sustained scenarios.** Foundation's default hardware run is at least
  **15 minutes of representative active interaction**, after a recorded warm-up,
  covering the heaviest supported mode, repeated panels/transitions and typical
  concurrent input. Longer expected sustained workloads need longer runs. Record
  ambient conditions, power/charging state, battery level, background workload and
  any observable throttling. Compare early and late windows; an initially fast
  cold device is not sufficient evidence.
- **DX-17 — Explicit timing and resource targets.** The application declares target
  frame interval, p95/p99 frame-time ceilings, input-to-visible-feedback ceiling,
  allowable stalls, loading latency, retained memory and resource budgets for each
  named device/profile. Measure tails and worst intervals, not only average FPS.
  Do not invent hardware measurements from draw counts or assume a universal FPS
  guarantee. Unsupported measurements must be marked unmeasured. Repeated cycles
  must remain within retention limits; static/covered/hidden views follow the
  engine's idle and lifecycle rules.
- **DX-18 — Adaptive quality is bounded.** A runtime governor uses explicit cost knobs,
  hysteresis and recovery rules, respects user choices and cannot cross content
  floors. Layout MUST NOT oscillate with frame rate. Test degradation and recovery
  independently of the pinned-profile gate, including effects on text, targeting
  and input. Battery-saving configurations require the same interaction evidence.

## Acceptance matrix and evidence

**DX-19.** Before claiming a profile is supported, record the following for every
representative mode. New UI and camera changes rerun affected rows; changes to
shared layout/input tokens rerun all affected declared supported profiles.

| Evidence | Required cases |
|---|---|
| Viewport/layout | Declared minimum and maximum usable sizes; both sides of each layout transition; phone orientations where supported; tablet split view where supported; declared narrow and expanded computer windows |
| Interaction | Initial use, normal active task, combined held actions, open/close secondary UI, notification during action, cancellation and focus recovery, reload/return |
| Accessibility | 200% text and zoom, longest supported labels, keyboard focus and touch-only use where supported, controller where supported, reduced motion and captions where provided |
| View integrity | Essential regions, union footprint measurements, visible actionable targets, virtual keyboard, safe insets, browser chrome changes and actual hand obstruction |
| Performance | Pinned-profile automated resource evidence plus sustained physical-device timing/memory evidence; adaptive mode separately if present |

Each result MUST identify the exact revision, scenario and inputs, viewport,
layout/input/graphics profiles, hardware/browser or emulator, thresholds, raw
measurements, annotated screenshots or recording, tester and pass/fail. Passing
screenshots alone do not prove input behavior, thermal performance or readability
while moving. State evidence limitations explicitly.

## Enforcement status and exceptions

**DX-20 — No implied automation.** This policy adds acceptance obligations, not
already-implemented runtime services. Current tools include type/layer/CSS checks,
input and ownership tests, resource-count and bundle gates, screenshot capture,
and the existing image quality guard. The standard snapshot command currently
uses a **1280 × 800 desktop** view and, with `--mobile`, a **390 × 844 phone** view.
These do not cover the complete matrix above. Existing screenshot and perf passes
MUST NOT be described as full phone/tablet acceptance.

The optional `measureUiOcclusion` author API now computes clipped union areas
from supplied rectangles; [its guide](../guides/ui-visibility-diagnostics.md) explains
the limits. The synthetic `scripts/play/ui-occlusion-check.mjs` fixture exercises
DOM geometry and pointer interception at three viewport sizes. Neither discovers
application critical regions nor certifies an application layout. Application
annotation remains creator-owned. The optional [capture matrix](../guides/capture-matrix.md)
executes explicit viewport/input cases and bounded interaction steps; all its task
criteria remain unverified. The composed HUD fixture checks one projected region's
obstruction and recovery, and selected shell/occlusion fixtures exercise enlarged
CSS text. CI invokes these scoped regressions; a configured job is not evidence of
a completed run. None supplies complete application zoom/localization, virtual
keyboard, browser chrome, hand-obstruction or sustained physical-device evidence.
Attach application-specific automated or manual evidence and mark absent evidence
**not verified**. Do not claim an automatic quality gate for a requirement that is
only documented.

**DX-21 — Exceptions remain reviewable.** For stock repository contributions or
claims of this Foundation baseline, a proposed deviation records the clause,
profile, affected tasks, accessibility impact, alternative considered, evidence,
named approver, scope and review/expiry condition in the application annex. It
follows STD-CNF-10 and requires an ADR where that clause requires one. Performance
budget increases also require their existing approval and trailer. Approval of an
intentional UI redesign does not waive performance, visibility or input evidence.
Independent creators replacing the baseline choose their own change-review process;
these repository approval and trailer rules are not imposed on their games or forks.
They still identify changed guarantees and evidence against their chosen requirements.
A profile that cannot complete required tasks or exposes unreachable essential
controls is unsupported until corrected; no conformance wording can override that.


## External accessibility references

Foundation's 48 CSS pixel touch target default is a product choice. WCAG 2.2's
[minimum target-size criterion](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
uses 24 CSS pixels with stated exceptions; meeting Foundation's size default alone
does not establish WCAG conformance. Also consult
[text resizing](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html),
[orientation](https://www.w3.org/WAI/WCAG22/Understanding/orientation.html), and
[dragging alternatives](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html).
Where dragging is not essential, provide an equivalent single-pointer operation
without dragging. An orientation restriction needs an essential-task justification,
not merely a layout that has not been adapted. These references supplement the
application's declared accessibility acceptance; this policy is not a complete
external-conformance checklist.
