# Creator choices and framework contracts

Foundation is a malleable engine skeleton with reusable, configurable frameworks. It owns
infrastructure needed by independently authored games. It does not decide which game
to make, and adding another game's feature catalog is not the definition of engine
completion. Optional kits are replaceable helpers, not mandatory design decisions.
[STANDARD.md](STANDARD.md) describes the stock repository engineering baseline.
Creators can select, configure, extend, replace or omit frameworks and choose their
own game constraints and workflows. This document explains framework behavior and
what evidence establishes, rather than prescribing how a game must be built.

## Creator direction and implementation responsibilities

| Party | Owns | Does not assume |
|---|---|---|
| Engine | Public extension APIs; module/service boundaries; resource ownership; scheduling; action dispatch; rendering and asset contracts; persistence mechanisms; validators and diagnostics | That arbitrary application code is correct, bounded, secure, scientifically accurate or performant because it imports the engine |
| Human creator | Simulation assumptions; mechanics; rules; content and rights; aesthetics; audience; assistance; supported devices and editions; quality floors; success criteria; acceptable product tradeoffs | That a working kit supplies the intended game design, or that a passing software gate certifies every supported device |
| Implementation agent | Implement creator direction, including framework replacements and changed defaults; reuse or deliberately adapt owners; investigate failures; maintain docs and evidence | That its preferred roadmap, audience, platforms or quality settings override creator direction, or that unperformed checks are passing evidence |

These roles describe collaboration and process, not runtime privileges. The
same APIs, bounds and validation apply regardless of whether a human or agent wrote
the code. There is no agent-specific execution branch or security sandbox implied
by this contract (ADR 0061 / STD-GOV-18).

The creator can direct changes to any framework or delegate implementation choices broadly. An agent should then make
routine reversible choices and complete the requested work, without repeatedly
asking about details already settled. Follow creator-directed changes to the product, defaults, frameworks and workflow.
Keep the current requirements clear in the work record; do not substitute inferred
preferences for explicit direction. Previously supplied direction remains usable.

Existing owners and extension seams provide a useful starting point, not a demand
that every game retain the stock architecture. A creator may replace a scheduler,
renderer, input model, persistence adapter or optional kit when that fits the game.
Explain the dependencies, guarantees and evidence affected by the replacement;
this is deliberate engineering, not a forbidden design choice. Such changes may
require development and a rebuild: this document promises no runtime hot-swap API.

For contributions to this repository, its stock review and gate workflow applies.
It is not a universal workflow imposed on independent games or forks. An agent
should not silently weaken a check just to make a failure pass. Creator-directed
changes to defaults, budgets or checks are valid; explain what changed and validate
against the new requirement rather than presenting the old guarantee as preserved.

## Record the intended game with the existing API

`game/build.brief.ts` uses `defineBuild`; `GAME.md` mirrors the product intent.
This example uses current fields. Paths and checks illustrate an application the
creator would implement; they are not evidence that those checks already exist.

```ts
import { defineBuild } from '@engine';

export default defineBuild({
  goal: 'Let players explore and compare an authored mechanical model.',
  pitch: 'Adjust one parameter, run the model, and inspect the result.',
  genre: 'blank',
  coreLoop: ['choose a parameter', 'run the model', 'compare the result'],
  devices: {
    targets: ['desktop', 'laptop'],
    minimum: 'laptop',
    input: ['keyboard', 'pointer'],
  },
  quality: { tier: 'high' },
  modes: ['play'],
  constraints: {
    content: ['Preserve readable labels and the complete authored model.'],
    ip: ['Ship only assets with recorded reuse rights.'],
  },
  success: [
    { id: 'S1', check: 'The model reproduces its authored reference cases.',
      how: 'test', by: 'game/model.test.ts' },
    { id: 'S2', check: 'Every control is reachable with the declared inputs.',
      how: 'manual' },
    { id: 'S3', check: 'Supported laptop hardware meets the declared sustained targets.',
      how: 'manual' },
    { id: 'S4', check: 'Scene resource counts stay within the recorded budgets.',
      how: 'gate' },
  ],
});
```

The output-only `contractVersion: 1` identifies the build-brief schema; acceptance
evidence is recorded separately. Validation and a detached,
frozen result protect a declaration from accidental mutation, not arbitrary
application behavior. Creators can change their requirements and produce a new
`defineBuild` snapshot; immutability does not lock their design choices. This field is not supplied in the example's `BuildInput`.

The brief also supports audience, performance, visual comparison views, pedagogy and
kid-safe options. Defaults are real choices to inspect, not evidence of suitability.
The selected minimum device influences derived budgets. Actual simulation equations,
units, numerical tolerances, asset lists, interaction layouts and physical hardware
models belong in the application specification and implementation; they are not
invented `defineBuild` fields. Record their links and acceptance evidence in GAME.md
and the application annex.

## Platforms and editions remain creator choices

A maximum-quality desktop release, tablet-first release, phone-first release or
shared cross-platform release is valid. Separate editions may choose different
content, controls and quality floors, with explicit compatibility/save rules. An
unsupported phone does not constrain a desktop edition. Conversely, advertising
phone support creates a phone acceptance obligation; desktop UI compressed into a
phone viewport does not fulfill it.

Keep layout, input capability and graphics policy distinct. Touch does not imply a
weak GPU; screen width does not establish a supported device. An agent must not infer
an automatic quality downgrade or feature removal from either signal. The build brief
declares broad targets; detailed supported/experimental/unsupported device and mode
combinations and their evidence belong in the application record. See the
[device policy](policy/DEVICE-EXPERIENCE.md) and
[known enforcement gaps](guides/device-acceptance-gaps.md).

## What enforcement proves

| Level | Examples of existing enforcement | Limits of that evidence |
|---|---|---|
| Runtime contracts | Module dependency/install boundaries; owned cancellation; layer/input routing; resource admission; typed save parsing and quarantine; individual kit argument checks | Only the relevant installed path and validated values are covered. An arbitrary callback can allocate memory, block the thread or violate its own model assumptions. TypeScript types alone do not constrain runtime behavior. |
| Build and gate checks | Type/layer/genericity checks; registered definition checks; focused regressions; bundle/scene budgets; configured visual comparisons | Applies to the checked candidate, configuration, harness and scenarios. A finite test suite does not prove all inputs or validate scientific/game-design intent. An emulated device is not physical hardware. |
| Manual/application acceptance | Physical controllers and touch behavior; assistive technology; sustained hardware timing; thermal behavior; readability, comfort, comprehension and desired play | Must be performed and recorded on the declared scope. A written standard or a planned test is not passing evidence. |

These levels complement one another. Report implemented, exercised, passed, failed
and unverified separately. Keep revision, configuration, device/browser, scenario,
limits and raw evidence together. Do not turn a successful synthetic controller test
into a claim about real hardware, or pinned graphics measurements into automatic
quality-policy validation. No engine contract certifies arbitrary extension code. Retaining or replacing a
framework changes which of its documented guarantees apply; report that plainly.

## Extension checklist

For each new simulation, mechanic, adapter or reusable kit, record:

1. **Owner and scope:** which game/kit/module owns it, the creator requirement it serves, and which
   lifecycle begins and retires it. Name existing services it borrows.
2. **Input:** schema, units, coordinate frame, identity/revision, source of accepted state and
   validation point. Distinguish user intent from an accepted action.
3. **Output:** what changes, what remains immutable, and when the result becomes
   visible. Name transaction boundaries for coupled state.
4. **Bounds:** admitted records, retained memory, work per step, queue/history limits,
   retry limits and explicit overload outcome. A work-count limit is not a CPU deadline.
5. **Cancellation and replacement:** how owner loss, stale completion, focus changes,
   route changes and shutdown release or quarantine work exactly once.
6. **Failure and recovery:** validation errors, unavailable dependencies, partial work,
   publication failure, cleanup exceptions and the player's recoverable state.
7. **Evidence:** reference cases, adversarial lifetime tests, representative consumer,
   configured gates and manual supported-device checks. Identify remaining unknowns.

For example, a parameterized simulation can use the existing fixed-step host while
the creator supplies equations and reference cases. The extension record names its
state units, step size, admission limit and scene owner; specifies that late results
cannot replace a newer run; and separates numerical-reference tests from readability
and hardware measurements. This is a documentation record, not a new engine API.

## Completion and handoff

A finite extension is complete when its current agreed acceptance criteria are met and
its evidence and limitations are reviewable. The whole engine is not “100% of all
possible games.” Hand off the implemented contract, verification performed, unresolved
risks and explicit follow-ups. Research suggests candidates; the creator decides whether they belong in the game.
