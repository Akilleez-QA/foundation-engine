# Applying the Standard: <Game name>

> **Template.** Copy this file when you start a game on the engine, and replace every `<…>`. The rows marked *(engine)* describe what the engine already provides; keep them unless you replace the mechanism. This repository's copy is filled in for the blank template (`templates/blank/game`).

This annex applies each clause of [STANDARD.md](STANDARD.md) to one game. It holds everything the Standard must not: specific scenes, measured numbers, library calls, file paths and exceptions. Every item is linked to the clause it applies (STD-GOV-20). An item with no clause behind it is a defect: raise it against the Standard (STD-PRI-13).

| | |
|---|---|
| **Game** | Blank (`defineGame({ id: 'blank' })` in `templates/blank/game/game.ts`; the brief is `build.brief.ts`) |
| **Reference machine** (STD-PRI-3) | `<CPU, RAM, GPU, display resolution @ refresh>`. Until one is named, the software-GL gate is the only enforced harness. |
| **Player protection profile** (STD-PRI-7) | Engine defaults. A brief with `audience.kids: true` opts in to [policy/KID-SAFE.md](policy/KID-SAFE.md). |
| **Save namespace** (STD-SAV-10) | the game id, `blank` (keys `blank|…`, quarantine `blank-q|…`, backup `blank-bak|…`) |

---

## 1. Module kernel, layers and owned capabilities

| Clause | Application |
|---|---|
| STD-LAY-1, STD-LAY-9 | `npm run lint:layers` (`scripts/lint/layers.mjs`) enforces direction, cycles and test-support isolation *(engine)* |
| STD-LAY-10 | `npm run lint:arch` (`scripts/lint/architecture.mjs`): each owned capability is a regex rule with the owning folder allowed. Shards live in `lint-baseline/<rule>/<folder>.json` *(engine)* |
| STD-MOD-7 | `scripts/lint/manifests.mjs`: a manifest (`features/<x>/index.ts`) may statically reach only `src/core/`, `src/content/` and its own `content.ts` *(engine)* |
| STD-MOD-11 | `src/app/modules.ts` discovers `features/*/index.ts` and `packs/*/index.ts`; `src/app/layer-modules.ts` lists the core and platform modules; the game (`@game`) is compiled into `feature.game` and one `feature.<scene>` module per scene by `src/author/compile.ts`, plus its kits' modules *(engine)* |
| STD-MOD-12, STD-TST-9 | `src/app/registries.test.ts` boots every module in node, with installs left out, and checks every registry *(engine)* |

Kernel modules the composition root installs:

| Module | Owns | Services | Event areas |
|---|---|---|---|
| `core.save` | `saveSections` | `save` | `player` |
| `core.settings` | `settings.values` section | `settings` | `settings` |
| `core.features` | `features` | `features` | none |
| `core.router` | `scenes`, `redirects` | `router` | none |
| `platform.input` | `inputActions` | `input` | none |
| `platform.audio` | `cues` | `audio` | none |
| `platform.shell` | the scene shell, header menu | `shell` | `scene` |
| `feature.game` | `modes`, `assets`; the game's save sections and input actions | `play` | none |

## 2. Registries, content and packs

| Clause | Application |
|---|---|
| STD-REG-6 | The open registries are `scenes`, `redirects`, `saveSections`, `features`, `inputActions`, `cues`, `modes` and `assets`, plus any a kit defines. A game's own registries: `<list>` |
| STD-REG-12 | Ids are lowercase kebab-case. Exceptions stored as save data: `<none>` |
| STD-REG-19 | Pack fact verbs: `<none yet>` |

## 3. Save store

| Clause | Application |
|---|---|
| STD-SAV-1 | The sections of this game: `<id, owner, scope, version>` for each. The blank template has none |
| STD-SAV-12 | The debounce and the maximum delay are the store's defaults (`core/save/store.ts`) *(engine)* |
| STD-SAV-16 | Coupled state stays in one envelope: `<list any coupled state>` |

## 4. Settings and the graphics screen

| Clause | Application |
|---|---|
| STD-SET-1 | The engine's rows are in `core/settings/settings.ts`. Game rows: `<list>` |
| STD-SET-10 | Content floors: `<per knob>` |
| STD-SET-12 | Governor: off *(engine)* |

## 5. Time and simulation

| Clause | Application |
|---|---|
| STD-SIM-1 | The game timeline is Unix seconds (`gameSeconds(unixMs)`); a new player starts at the real date *(engine)* |
| STD-SIM-13 | Simulations and their clocks: `<list, or "none">` |

## 7. Rendering

| Clause | Application |
|---|---|
| STD-REN-1 | The render backend is `<webgl2 (default) or webgpu>` (`defineBuild({ render: { backend } })`), created through the renderer pool (`platform/render/renderer-pool.ts`) *(engine)* |
| STD-REN-11 | The light rigs of this game's scenes: `<per scene>`. A scene with `view.lights: 'default'` gets one hemisphere and one directional light (`src/author/runtime.ts`) |

## 9. Scenes and handover

| Scene | Route | Type | Budget row | Notes |
|---|---|---|---|---|
| `scene.main` | `#scene/main` | scene | `main` | The first scene: unknown addresses land here |

| Clause | Application |
|---|---|
| STD-RUN-17 | Loading card after 150 ms; failure card with Try again and Go back (`platform/ui/scene-shell.ts`) *(engine)* |
| STD-RUN-9 | The scene runtime draws only when a transform, shape, the camera or the world's version changed: a still scene renders nothing *(engine)* |

## 10. UI shell, input and accessibility

| Clause | Application |
|---|---|
| STD-RUN-25 | Core actions: `core.back`, `core.pause`, `core.mute`, `core.focus-next`, `core.focus-prev`, `shell.menu`. Game actions are `defineInput` rows (`game.<id>`): `<list>`; the blank template has `turn` (Space, pad A, tap) |
| STD-RUN-24 | Tokens: `platform/ui/tokens.css`. The game's palette: `<sheet>` |

## 12. Strings

| Clause | Application |
|---|---|
| STD-STR-2 | Shards: `src/**/strings/<area>/<locale>.json`, merged by `scripts/strings.mjs` into `src/generated/` and `core/i18n/keys.gen.ts` (gitignored) *(engine)* |
| STD-STR-3 | Reading levels: the default key is `standard`, and `<key>@detailed` is the detailed variant *(engine)* |

## 13. Performance budgets and the gate

| Clause | Application |
|---|---|
| STD-PRF-1 | Budgets live in the game's `budgets.json` (`templates/blank/game/budgets.json` here), read by `perf/budgets.ts` |
| STD-PRF-3 | Measured with `npm run bench` in software GL at 1280×800 and derived by `npm run perf:derive` (worst window + 10 %, rounded up; exact for contexts, postDraws and shadowPasses) |
| STD-PRF-5 | `scripts/perf/budget-ratchet.mjs` (in `npm run lint`) fails a raise without a matching `Perf-Budget:` trailer |
| STD-PRF-11 | `npm run gate` *(engine)* |
| STD-PRF-14 | Reference run: `npm run bench:ref` on a GPU machine (on Linux the harness points ANGLE at a hardware backend, `ENGINE_GPU_ANGLE`; elsewhere, or for another browser, `ENGINE_CHROMIUM` at a GPU-enabled Chromium); a run that renders in software fails |

Measured starting budgets: see the game's `budgets.json`. Each row's `provenance` names the commit and harness.

## 14. Verification

| Clause | Application |
|---|---|
| STD-TST-1 | Views: `perf/quality/views.mjs`. Sign-offs: `perf/quality/reviewed.json`. Command: `npm run quality:guard -- --base <build> --head <build> --out <new dir>` |
| STD-TST-4 | `window.engine` (`src/dev/test-api.ts`), in development and test builds only |
| STD-TST-8 | The bench browser always passes `--mute-audio`; pages run with `?flags=dev.silent`; the audio output creates no AudioContext under automation |

## 15. Staged areas and exceptions

| Area | Clauses not yet met | Plan |
|---|---|---|
| `<none>` | | |

## 16. Recipes

See [recipes/](recipes/): add a scene, an entity and component, a system, an input action, a save section with a migration, a budget, a kit or a template.


## Device experience acceptance (ADR 0068)

This table is an application-specific contract, not an implemented build
schema. Populate only the targets and modes the author chooses to support; mark
other combinations unsupported rather than requiring them to pass. Duplicate rows for supported orientations, narrow windows, split views and
hybrid inputs. Record unsupported combinations explicitly with their recovery flow.
Existing device ceilings remain unchanged. Until populated and tested, the template
has no complete device-experience certification.

| Profile | Layout/state | CSS viewport / DPR / safe areas | Inputs | Graphics preset / quality floor | Hardware / OS / browser | Frame/load/input/memory thresholds | Evidence revision / result |
|---|---|---|---|---|---|---|---|
| Phone (if selected) | <compact active / reading / interruption> | <portrait and landscape> | <touch + relevant assistive path> | <explicit> | <named minimum and representative devices> | <declared values> | Unverified |
| Tablet (if selected) | <touch / hybrid / split view> | <both orientations and split view> | <touch; keyboard/pointer when attached> | <explicit> | <named devices> | <declared values> | Unverified |
| Laptop (if selected) | <windowed compact / expanded> | <minimum supported window; scaling> | <keyboard + trackpad; hybrid if supported> | <explicit> | <integrated-GPU reference> | <declared values> | Unverified |
| Desktop (if selected) | <windowed / expanded> | <minimum window through large display> | <keyboard + pointer; controller if supported> | <explicit> | <named reference> | <declared values> | Unverified |

For each scene and active-play state, record the usable viewport, protected world
region/subjects, union UI obstruction area, maximum allowed obstruction, open-panel
behavior, controls and text sizes. Include failure captures, not only ideal views.
Record continuous control plus secondary action, rotation/resize, virtual keyboard,
focus loss, menu return, long localized text and text scaling. Provide cold and
sustained performance evidence under the policy. Missing evidence remains a gap;
software-rendered timing is not hardware timing.

Evidence rows link to [DEVICE-EXPERIENCE.md](policy/DEVICE-EXPERIENCE.md) requirements,
commands/manual steps, commit, timestamps, artifacts and named reviewer. Existing
`play:snap --mobile` supplies a limited smoke capture, not this full matrix.


### Selected distribution scope

Record the chosen strategy (single target, shared cross-platform artifact, or
separate editions), included/excluded devices and modes, each edition's brief,
quality floor, measured budget and artifact identity. Describe deliberate feature
or visual differences and save compatibility. Unsupported targets do not constrain
a supported edition. Product support choices and evidence status are separate:
`unsupported` is a valid choice, while `unverified` is missing evidence for a claim.
