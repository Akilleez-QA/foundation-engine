# Stock template device acceptance

Source audit of integrated `b6fb4a3`, 2026-10-01. This matrix records the seven
stock templates' existing declarations and executable workflows. It is not a new
support policy or a claim that a declaration passed device acceptance. No browser
or hardware measurements were made for that source audit. The subsequent
[candidate touch-control evidence](../verification/stock-device-20261001/README.md)
is recorded separately: 16 target/tap checks pass in a dirty working copy, and the
lesson content overlap found there is repaired in a later
[layout receipt](../verification/stock-device-20261002/README.md). Both are emulated
evidence; both were integrated in v0.2.0 through public PR #9. The commits named in this
matrix are in the private development history.

The [device policy](../policy/DEVICE-EXPERIENCE.md) and
[application annex](../APPLICATION.md) define acceptance. Independent creators may
configure, replace or omit these templates and frameworks. Stock acceptance keeps
existing declared targets; it must not silently remove phone support or reduce
desktop quality to make a check pass.

For the current nine templates on release candidate `ffa8c6a`, see its
[support matrix](../releases/candidate-ffa8c6a/support-matrix.md) (the earlier `7c26db7` matrix covered eight).

## Declarations versus evidence

Every stock `build.brief.ts` declares **desktop, laptop, tablet and phone**, with
**keyboard, pointer, touch and gamepad** inputs. Six declare minimum `phone`;
Learn declares minimum `tablet` while still listing phone as a target. That
combination remains as authored: minimum-derived budgets do not remove phone from
the declared experience. Phone acceptance for Learn still needs evidence.

Quality views below are authored capture names/modes, not measured minimum
hardware or device-specific quality floors. None of the seven briefs supplies
named physical minimum devices, sustained frame/input latency thresholds or a
complete essential-view footprint matrix. The application annex retains
unverified device rows. No template has complete DX-19 acceptance here.

| Template and source | Minimum and quality views | Actual scene interaction and UI |
|---|---|---|
| [Blank](../../templates/blank/game/build.brief.ts) | Phone; `main-start`, main/near | [main](../../templates/blank/game/main.ts) turns the named cube; [turn](../../templates/blank/game/turn.ts) binds Space, pad A and scene tap. Stock Settings remains separate native UI. |
| [Arcade](../../templates/arcade/game/build.brief.ts) | Phone; `play-start`, play/near | [play](../../templates/arcade/game/play.ts) uses arrows/A-D or stick/d-pad axes, and held world pointer to steer toward its horizontal position. HUD shows score/best, initial steering prompt and game-over/restart prompt. Space/Enter/pad A/tap restarts after failure. |
| [Explorer](../../templates/explorer/game/build.brief.ts) | Phone; `garden-start` and `shed-start`, near | [shared systems](../../templates/explorer/game/world.ts) compose character movement, proximity interaction, orbit camera and found-count HUD. Character supports held ground pointer and keyboard/pad axes; explore interaction uses E/Enter/Space/pad A/tap. Garden and shed have separate geometry and door destinations. |
| [Learn](../../templates/learn/game/build.brief.ts) | Tablet; `day-night-start`, near; explicit scene caps 40 draws / 60,000 triangles | [lesson](../../templates/learn/game/lesson.ts) runs board instructions, parameter-controlled Earth and quiz. [learn inputs](../../src/kits/learn/index.ts) declare next/back/replay/hint/question/pause/options and parameter axis; the learn UI also supplies native controls. No sound is required by the brief. |
| [Expedition](../../templates/expedition/game/build.brief.ts) | Phone; `field-start`, reviewed | [field](../../templates/expedition/game/field.ts) has a persistent bottom progress/message panel and Begin/Assisted/Stop actions, then resource and shelter actions. Enter/Space/pad A advance; Escape/pad B stop. DOM buttons drive the same session functions. Movement follows planned station routes. |
| [Mechanics](../../templates/mechanics/game/build.brief.ts) | Phone; `lab-start`, reviewed | [lab](../../templates/mechanics/game/lab.ts) has persistent status/next button, E/pad A action and a guided session. Character movement is gated by session ownership and explicitly sets `pointer:false`; the scene does not add a touch locomotion producer. A native next button is not evidence that optional free movement is touch-accessible. |
| [Terrain](../../templates/terrain/game/build.brief.ts) | Phone; `yard-start`, reviewed | [yard](../../templates/terrain/game/yard.ts) uses keyboard/pad character movement or held pointer raycast against terrain triangles. Named player and pad marker share the surface snapshot. [revision action](../../templates/terrain/game/revise.ts) binds R/pad Y; no dedicated touch revision button is declared there. |

All targets need separate accepted evidence even when sharing components. Layout,
input capability and graphics selection remain independent. A mode name such as
`reviewed` does not establish that phone UI was reviewed.

## Existing evidence and its limits

The [upgrade ledger](../guides/upgrade-acceptance-ledger.md) records exact `883f4ad` passing
all seven template gates: 2,018 tests, 129 performance checks, zero enforced breaches,
regressions or inconclusive results, and four advisory heap warnings. Combined
main tests/build passed after integration at `b6fb4a3`. These establish the reported
software-rendered/resource regressions, not supported-device timing or task UX.

| Template | Existing executable/evidence surface | Missing acceptance that the next workflow must establish |
|---|---|---|
| Blank | [turn script](../../templates/blank/game/playtest/turn.json) uses Space and checks a quarter turn. [resize receipt](../verification/input-resize-20261001/README.md) includes inspected blank desktop/390×844 smoke, separate Node contact-retirement tests and historical gates. [capture settings](../../scripts/play/examples/capture-settings.json) authors experimental phone/tablet/desktop Sound journeys. | Touch turn and Settings do not trigger each other; quarter turn remains observable with panel open/closed; focus, resize, text/zoom and reload remain usable. Capture criteria are not automatically passed. |
| Arcade | [restart script](../../templates/arcade/game/playtest/restart.json) uses keyboard steering/failure/restart. [native controls runner](../../scripts/play/native-controls-check.mjs) checks focused Sound Space/Enter versus scene Space ownership at 1280×800. | Held touch steering while notifications/settings appear; safe pause/cover behavior, lane/hazard visibility, pointer loss, failure and touch restart, best-score reload. A focused Sound test does not accept the whole play loop. |
| Explorer | [door script](../../templates/explorer/game/playtest/door.json) teleports to interaction sites and uses E, then checks door arrival. Module tests cover movement, proximity and persistence. | Traverse the route with actual supported input rather than teleport; show/read/use each prompt; distinguish pointer movement from tap interaction; inspect orbit camera and doors in both scene sizes; reload found progress. |
| Learn | [lesson script](../../templates/learn/game/playtest/lesson.json) drives a full keyboard lesson, parameter change, question interrupt and wrong-answer hint. Module tests cover pedagogy and sim outcomes. | Complete the same flow through native touch controls and advertised gamepad; inspect board/caption/answer and Earth visibility during every phase, at 200% text and zoom; muted completion and interruption recovery. |
| Expedition | Field and resource-station module tests cover route cancellation, actual arrival, saved progress, assistance and finite-resource recovery; seven-template gates cover resource counts. | Touch Begin/Assisted/Stop, cancel during motion/work, resume through all stations/resources, shelter/return/reload; panel must not obscure the current player/station or disable Stop during active work. |
| Mechanics | Lab module tests exercise rider/equipment/action ownership and scene gates cover counts. | Native button progression through ride/exit/equip/target; physical action versus visual feedback; touch movement scope must be resolved from the promised workflow, not inferred from a button. Inspect target and player visibility behind the persistent panel. |
| Terrain | Yard module tests cover surface contact, terrain picking and coherent revisions; separate terrain diagnostic runners test optional terrain mechanisms. | Traverse ridge/basin/pad using actual held touch; camera framing, contact/pad readability and release on interruption; if surface revision is part of supported touch workflow, supply and test its reachable action path. Diagnostic worker/region tools do not accept this yard's UI. |

Script existence is not a fresh execution result. Historical results retain their
own revision and environment. The source audit ran none of those scripts. Subsequent candidate runs are scoped
in the evidence receipt above. Shared
[UI regressions](../guides/ui-browser-regressions.md) cover selected HUD disclosure, compact
shell, comfort, action hints, native controls and simultaneous CDP contacts. They
are framework evidence, not all seven templates' profile acceptance. The
[capture matrix](../guides/capture-matrix.md) records completed operations/captures while
leaving described task criteria unverified.

## Essential regions and concrete acceptance ownership

The template maintainer owns each row's task definition and annotation. The existing
scene/view owner supplies projection; the existing HUD/layer/input owners supply
controls and cancellation. Use [visibility diagnostics](../guides/ui-visibility-diagnostics.md)
for clipped union footprints, then independently verify pointer interception and
actual task completion. These are task subjects identified from source, **not yet
measured rectangles or newly invented numeric thresholds**:

| Template | Annotate these essential subjects/feedback and input regions | Next executable acceptance case |
|---|---|---|
| Blank | Projected cube; turn feedback; world tap area; Settings and confirmation/Back | Tap once, observe quarter turn, open/toggle/close Settings without another turn, resize while held, verify neutral release and fresh action. |
| Arcade | Player ball, incoming lane hazards, score/failure feedback; steering and restart hit regions | Hold a real emulated pointer across lane limits, interrupt with UI, release/cancel, resume, fail and restart. Measure overlap with ball/hazard path during active play, not just startup. |
| Explorer | Player, current usable object/door, prompt and found feedback; ground navigation and interaction regions | Walk to bench/lamp/door/crate, operate them, return through door and reload. Measure each object's projected region and prompt while camera follows. |
| Learn | Current board explanation/labels or Earth/flag, captions/question/hint/answers; navigation and parameter controls | Replay complete keyboard journey with touch equivalents; inspect longest visible text and wrong-answer feedback at each step, including sim parameter crossing 180 degrees. |
| Expedition | Moving player, current station/crossing, arrival/work feedback; Go/Assist/Stop and shelter routes | Complete assisted/unassisted entry, stop mid-route, resume and complete survey/resource/shelter loop; verify Stop reachability and essential regions through every panel state. |
| Mechanics | Rider/platform during ride, safe exit, equipment/target/tag feedback; next and any declared movement control | Complete guided phases through native button, then verify declared independent movement paths and action feedback. Measure panel obstruction separately in ride and target phases. |
| Terrain | Player contact point, destination landform/pad marker and surface-change feedback; pick/move/revise controls | Hold pointer over ridge/basin/pad, release on cover/resize, reenter, and test any exposed revision action without stale contact/picking. |

Before marking a case passed, record declared minimum/maximum usable viewports,
orientation/split-view scope, both sides of layout transitions, persistent/transient
footprint limits and per-task target readability criteria. Those values are not
filled by this audit. Add actual measured rectangles, target hit results, rendered
state and screenshots to each result. Preserve desktop's chosen presentation; use
optional disclosure or layout configuration for compact needs rather than shrinking
all interfaces.

## Concrete source gaps to verify and repair

- Integrated baseline `b6fb4a3` used 14px primary panel text and 44px button
  minimum height in Expedition field and Mechanics lab, and 44px button minimums
  in Learn. PR #9 (integrated in v0.2.0) raises those minimums to 16px / 48px, wraps the
  field row and fixes shelter button font inheritance. Sixteen emulated target/tap
  checks passed. Do not infer
  complete usability from these sizing checks.
- Screenshot inspection found Learn's wrapped navigation covering the board/caption
  region at 320×568: the fixed board inset did not reserve the wrapped bar's actual
  height. Scene-owned cleanup and a measured layout seam now repair this; emulated
  separation checks pass at four profiles across board, sim and quiz
  ([receipt](../verification/stock-device-20261002/README.md)). Full lesson touch,
  in-panel touch scrolling, text scaling and physical-device acceptance must follow.
- Expedition/Mechanics custom panels are persistent and do not select the optional
  compact disclosure owner. Their position/max-width alone does not establish
  essential-view acceptance. Test changing messages and translated/large text.
- Explorer's teleport-based script intentionally bypasses navigation. Add actual
  input traversal for acceptance without weakening its existing transition test.
- Shared emulated multitouch tests do not make every template a two-action touch
  implementation. Test required concurrent actions in the consumer that uses them.

## Physical evidence remains required

For each advertised profile, the acceptance owner must identify actual minimum
phone/tablet/laptop/desktop hardware, OS/browser, rendering resolution/DPR/refresh,
input and graphics settings. No model or timing threshold is invented here.
Run the policy's sustained representative workload after warm-up, recording
conditions, early/late frame tails, stalls/loading, memory and input feedback.
Laptop evidence cannot be substituted by a desktop machine.

Native touch/hand obstruction, virtual keyboard/browser chrome, actual supported
controllers and assistive paths require those devices. Browser emulation and
render-return timing do not certify physical touch, thermal behavior or photon
latency. Record unavailable measurements as unverified and retain DV-01 open;
continue the automated task cases above without changing promised requirements.

## 2026-10-02 template polish (emulated evidence only)

Integrated in v0.2.0 (PR #40; batch PR #45). Evidence is emulated SwiftShader `play:snap` at 1280×800 and 390×844, plus the learn
`play:script`; every screenshot was inspected. No physical phone, tablet, landscape, 200% text or zoom evidence is
claimed; each row's open acceptance above remains open.

| Template | Change | Profiles affected | Evidence |
|---|---|---|---|
| Arcade, Explorer (ui kit) | HUD lines and the prompt sit on a translucent plate; banner and prompt start hidden | Phone, tablet, laptop, desktop (layout and readability only; input unchanged) | Emulated desktop and 390×844: "Found 0 of 3" readable over the light sky; Score/Best plates inside the HUD region. `test:ui-browser` HUD lifecycle passes |
| Learn | Objectives card shown from the start until the first Next, never over step 1's drawings; scripted playtest waits for each press | Tablet (minimum), phone, laptop, desktop | Emulated desktop and 390×844 snaps; script 9/9 snaps including `02-sun-drawn` with the Sun drawn. The card is wider than the board at 390×844 (unchanged, recorded) |
| Mechanics | 64×64 seamless gradient sky with small orientation glyph (was 16×16) | All targets (graphics quality) | Emulated desktop and 390×844: no magnified glyph blur; draws/triangles unchanged (7 / 1,208); texture about 0.1 MiB within the 8 MiB cap |

