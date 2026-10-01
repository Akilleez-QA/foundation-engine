# Game UI/UX research and implementation priorities

Status: research and proposed acceptance, not device certification. Initial source
inspection: `34a9c91a39f065ceba70b4d703d5800b2efa7ff2`, 2026-09-30. Findings describe
that revision; subsequent changes need their own evidence. No external implementation
or assets were copied, and no new dependency is proposed.

This dedicated lane studies game interaction quality independently of the broader
open-source tooling lane. It combines primary guidance, actual engine code and
representative interaction journeys. A researched convention is a candidate, not a
universal design requirement. [Device experience policy](../policy/DEVICE-EXPERIENCE.md)
and [engine goals](../GOALS.md) remain the contract.

## Current implementation reconciliation

Reviewed against `f357f17` on 2026-09-30. The findings below retain their original
revision and proposed acceptance; this ledger identifies what has since shipped.
Code and configured regressions are not a claim that a particular CI run passed.

| Original finding | Current mechanism and evidence boundary |
| --- | --- |
| Essential-view diagnostics | Optional [rectangle diagnostics](../guides/ui-visibility-diagnostics.md) and the composed HUD browser fixture measure supplied DOM footprints and one projected required region, including intentional obstruction and disclosure recovery. Applications still choose their regions and acceptable limits. |
| Text and hit areas | Optional compact shell provides 48 CSS-pixel targets and selected enlarged-text regressions. Expanded defaults remain separate; this does not establish comprehensive zoom, translation or accessible reading acceptance. |
| Binding-aware prompts | `ctx.input.describe` exposes effective named press-action hints; the browser fixture covers remapping and saved controls. It does not automatically replace application copy, supply every controller glyph or provide a finished Controls screen. |
| Notification backlog | `src/platform/ui/notify.ts` bounds pending entries per channel during holds and callbacks, with reentrancy tests. Visible-toast concurrency, persistent recovery routes and application comprehension remain separate. |
| Menu journeys | Owned HUD disclosure, creator-selected `hud.layout`, compact shell and saved-controls fixtures exercise selected focus/input/recovery journeys. The stock Sound capture example adds real emulated taps/clicks; neither certifies every application menu. |
| Evidence-led review | Optional capture matrices execute bounded creator-selected steps and retain unverified criteria. CI invokes UI, diagnostic and capture browser commands; each run has its own result. Physical-device acceptance remains separate. |

See [current acceptance gaps](../guides/device-acceptance-gaps.md) and
[browser regression coverage](../guides/ui-browser-regressions.md). Camera comfort,
assistance design and application-specific accessibility still require creator
choices and relevant human/device evidence; this ledger adds no mandatory platform.

## Scope and author choice

Authors choose supported devices, inputs, modes and editions. Desktop-only maximum
quality, tablet-first, phone-first and separate editions are valid. Unsupported
phones impose no limitations on supported computer builds. Within each advertised
experience, readability, reachability, feedback and world visibility must survive
its chosen layout and quality changes. Layout, input and graphics are separate axes.

Assistance is also multidimensional: reading ability, subject knowledge, control
familiarity, motor demands and desired guidance are not interchangeable. Do not infer
skill from age or force educational mechanics into general-purpose infrastructure.

## Prioritized findings

### 1. Essential-view diagnostics — build, priority 1

**Observed:** [HUD implementation](../../src/kits/ui/index.ts) positions lines, a banner
and a prompt at fixed absolute offsets. Its API has no declared occupied regions or
task-critical targets. This is missing capability, not proof every consumer is
obstructed. DX-7–9 defines the requirement; DX-20 acknowledges absent automation.

**Proposal:** Add optional, bounded region diagnostics to existing overlay ownership.
Differentiate essential state, contextual help and secondary detail. Let camera
adapters consume usable-view bounds without UI mutating simulation state. Apple's
[touch design presentation](https://developer.apple.com/videos/play/wwdc2024/10085/)
treats placement, movement/camera control and feedback as deliberate adaptation.

**Acceptance:** Union footprints and per-target intersections are measured in one
coordinate space. Required actions have zero unintended interception. Include open
panels, notifications, enlarged text and combined touch. Actual hand obstruction
needs physical-device evidence; rectangle geometry cannot certify it. No universal
occlusion percentage substitutes for a declared task limit.

### 2. Text and hit-area defaults — reuse and reconcile, priority 1

**Observed:** [tokens](../../src/platform/ui/tokens.css) include 11/12/14 px sizes;
[shell CSS](../../src/platform/ui/shell.css) uses the 14 px default for body text and
40 px minimum button heights. [Recovery CSS](../../src/platform/ui/scene-chrome.css)
sets 44 px minimum button heights. These declarations do not guarantee DX-10's
reading and touch defaults; actual dimensions require browser measurement.

**Proposal:** Reuse semantic tokens and registered settings, auditing actual consumers.
Do not inflate all desktop information indiscriminately. [XAG 101](https://learn.microsoft.com/en-us/xbox/accessibility/xbox-accessibility-guidelines/101)
covers configurable readable text, including HUD and errors; its raster/physical
measurements are not interchangeable with CSS pixels.

**Acceptance:** Measure effective hit areas, spacing and reading sizes; verify 200%
text/zoom, expanded translations and bidirectional reading. Focus, labels and recovery
actions remain reachable. A large-text setting must cover critical overlays too.

### 3. Binding-aware prompts and recoverable help — reuse, priority 1

**Observed:** [arcade strings](../../templates/arcade/game/game.ts) hard-code Space,
A and directional bindings; [HUD system](../../templates/arcade/game/play.ts) removes
steering help after three seconds. [Action infrastructure](../../src/platform/input/actions.ts)
already exposes effective bindings and cancels held state during remapping.

**Proposal:** Generate visible and accessible prompts from existing action metadata.
Offer dismiss/reopen and optional task-based instruction progression. The
[Game Accessibility Guidelines](https://gameaccessibilityguidelines.com/basic/)
support player-paced prompts, interactive instruction and configurable input.

**Acceptance:** Remaps change help; mixed-input use avoids prompt flicker; instruction
can be recovered after dismissal or return. Novice users can discover the next
required action; experienced users can suppress instruction without losing access.

### 4. Notification backlog and presentation — harden, priority 1

**Observed:** At the inspected revision, [notification service](../../src/platform/ui/notify.ts)
limits queued entries only when their channel has no renderer. Holding delivery with
a registered renderer allows backlog growth. Release sends all ready groups; priority
and TTL metadata are not consumed there. Individual renderers may impose other limits.

**Proposal:** Bound held retention as well as history, define overflow/aggregation,
and distinguish required recovery messages from disposable feedback. Reuse the
existing owner. [XAG 117](https://learn.microsoft.com/en-us/xbox/accessibility/xbox-accessibility-guidelines/117)
addresses distracting updates and readable presentation; DX-4 requires bounded queues.

**Acceptance:** A 10,000-event held burst remains bounded. Release cannot flood the
view. Required errors have a persistent recovery route. Test reentrant posting,
renderer exceptions, cancellation, late registration and repeated use. Queue bounds
alone do not prove bounded visible toasts or fair delivery.

### 5. Complete menu journeys — reuse, priority 2

**Observed:** [UI navigation](../../src/platform/input/ui-nav.ts), its tests,
[modal ownership](../../src/platform/ui/modal-dialog.ts) and
[generated settings](../../src/platform/ui/settings-panel.ts) already provide useful
focus and ownership infrastructure. There is no evidence-based reason to replace it.

**Proposal:** Verify menu → settings → remap → cancel → gameplay with each promised
input, reflow and a deleted opener. [XAG 112](https://learn.microsoft.com/en-us/xbox/accessibility/xbox-accessibility-guidelines/112)
supports predictable navigation, consistent Back/confirm and accessible initial settings.

**Acceptance:** Focus follows displayed order and restores meaningfully; hidden panels
receive no focus; one press causes one action. Declare linear versus spatial navigation
instead of introducing unconditional wrapping. No mouse-only step blocks a supported
keyboard/controller journey.

### 6. Camera comfort — extend selectively, priority 2

**Observed:** [camera kit](../../src/kits/camera/index.ts) suggests zero smoothing as
an optional calm-mode choice. [Touch camera](../../src/platform/input/touch-camera.ts)
provides pan/rotate with a rotation-speed parameter. CSS honors reduced motion, but
removing interpolation is not a demonstrated comfort guarantee.

**Proposal:** Reuse settings for appropriate sensitivity, inversion, recentering and
optional additive effects. [XAG 117](https://learn.microsoft.com/en-us/xbox/accessibility/xbox-accessibility-guidelines/117)
motivates independent motion controls. Alternate camera genres are an author decision.

**Acceptance:** Preferences persist; extremes preserve necessary targets; collision,
reset and teleport paths remain correct. Human motion-comfort evaluation cannot be
replaced by unit tests or an OS preference flag.

### 7. Assistance without audience stereotypes — reuse/defer, priority 2

**Observed:** [learning UI](../../src/kits/learn/ui.ts) provides replay, hint and pacing
controls. Its learning template is an explicit application profile, not the engine's
universal audience. General applicability remains an engine goal.

**Proposal:** Keep help/replay/checkpoint mechanisms optional; expose understandable
presets with independent overrides. Defer automatic player profiling. The
[Game Accessibility Guidelines](https://gameaccessibilityguidelines.com/basic/)
distinguish multiple kinds of access barriers rather than an age-to-difficulty scale.

**Acceptance:** Promised novice and experienced journeys work; assistance is reversible;
help can reopen without losing progress. No unnecessary age collection or mandatory
teaching rules enter the runtime.

### 8. Evidence-led UX review — extend diagnostics, priority 2

**Observed:** DX-19–20 distinguishes layout emulation from physical and sustained
performance evidence. STD-TST-16 permits DOM geometry/accessibility inspection while
simulation assertions use typed probes. Policy exists; complete automation does not.

**Proposal:** Extend existing diagnostics with declared profile/state cases and raw
findings. Observe discovery, execution, interruption and recovery as separate tasks.

**Acceptance:** Reports identify revision, edition, support scope, layout/input/quality,
scenario, threshold and evidence type. Obstructive UI fails even with high frame rate.
Unsupported profiles are not failed supported-build gates. Geometry is not a proxy
for comprehension, comfort, sustained performance or human usability.

## Continuing study

Next work should examine real browser journeys and original open-source implementations
chosen for specific gaps: localized layout, remappable prompts, information-heavy
menus and controller navigation. Record revision, license, code paths, costs and
rejection reasons before recommending reuse. This initial pass inspected engine code
and guidance, not external UI implementations. Include strategy/editor conventions
alongside continuous-action experiences so one genre does not define the engine.
Research runs during assigned active work; this document does not promise unattended
monitoring. Recommendations become implementation claims only after verification.

## Review of the device-runtime implementation slice

Source review of this slice finds the notification change bounds pending entries
for registered channels during holds, separates registration identity from renderer
identity and tests callback reentrancy. At that review this closed the retention gap pending integration validation; the
current ledger above records the integrated mechanism. It does not provide visible-toast concurrency, delivery
fairness across frames or guaranteed retention of critical errors; authors still need
persistent recovery information where dropping an old notice would lose a required task.

The optional `measureUiOcclusion` diagnostic computes clipped rectangle unions with
finite input limits and immutable output. Tests include duplicate/order invariance
and an independent integer-grid oracle. These are geometry tests, not device UX evidence.
A partly offscreen required target can have zero obstruction over its remaining
fragment: consumers must separately verify containment or the authored visible
fraction, as well as positive area and obstruction limits.

The historical next step was real DOM and projected-target evidence. The synthetic
occlusion and composed HUD fixtures now cover those selected cases, including
obstruction/recovery and viewport changes. Application-specific notification arrival,
expanded labels and combined interaction still need their own evidence. Record
input hit testing independently of visual area. Keep those
checks scoped to promised editions and supported profiles; do not infer physical
hand visibility, comfort or sustained performance from the resulting rectangles.
