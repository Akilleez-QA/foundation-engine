# Day and night (learn template)

<!-- The brief (game/build.brief.ts) is the contract; this block mirrors it. Change the brief first, then this block,
     then add a changelog row. Budgets are re-derived from the brief and only fall without a Perf-Budget trailer. -->

## Brief

| | |
|---|---|
| **Goal** | A short interactive lesson that explains why we have day and night. |
| **Pitch** | A chalkboard drawn step by step while a teacher and a classmate speak in named captions (no drawn characters), then a spinning Earth you turn yourself, then three questions. |
| **Audience** | Ages 8–11 (`kids: true`); policy `kid-safe` ([KID-SAFE](../../docs/policy/KID-SAFE.md)) |
| **Genre** | learn |
| **Core loop** | watch and listen to a short board step → answer or try something → kind feedback or a hint → next step |
| **Devices** | targets desktop, laptop, tablet, phone; minimum **tablet**; input keyboard, pointer, touch, gamepad |
| **Performance** | 60 fps; the lesson scene at most 40 draws and 60 000 triangles (the brief; below the tablet ceiling); measured budget 10 draws, 10 000 triangles in `game/budgets.json` |
| **Modes** | learn |
| **Pedagogy** | at most 3 passive steps before the learner acts; hints before answers; kind feedback; objectives stated and checked; scenes sized for ages 8–11 |
| **Constraints** | original words and pictures only; no timers, no scores, nothing lost for a wrong answer; no third-party characters |

### Success criteria

| Id | Check | How |
|---|---|---|
| S1 | every objective is taught by a scene and checked by a question or the sim, and no scene has more than three passive steps in a row | test: `game/day-night.test.ts` |
| S2 | turning the Earth past half a turn in the sim puts the marker in night and meets the second objective | test: `game/day-night.test.ts` |
| S3 | a wrong quiz answer gets kind feedback and a hint before the answer is ever shown | test: `game/day-night.test.ts` |
| S4 | the lesson plays from the first board to the end of the quiz in a browser with keys only | playtest: `game/playtest/lesson.json` |
| S5 | the lesson scene stays inside its budgets.json counts, and the learn runtime is not in the first-load bundle | gate |

## The lesson

Objectives: **o1** the Earth spins around its own axis once a day; **o2** it is day on the side facing the Sun and night on the side facing away.

| Outline item | Type | Objective | What happens |
|---|---|---|---|
| `board-1` | board | o1 | Objectives; the Sun and the Earth drawn; Sam asks "Why doesn't the Sun go around us?"; the teacher answers; the spin arrow |
| `board-2` | board | o2 | Light reaches one side; day side and night side labelled; Sam checks his understanding |
| `turn` | sim | o2 | The learner turns the Earth with a slider (or `[` `]`, the stick) until the flag is in night; tap parts for their names |
| `check` | quiz | o1, o2 | Three questions with hints and kind feedback |

Controls: Next (Enter, Space, N, pad A, the Next button), Back (B), Show again (R), Hint (H), I have a question (Q), Pause (K), answers 1–3 (or the d-pad).

## What is in it

| File | What |
|---|---|
| `game/lesson.ts` | the lesson as data (`defineLesson`) |
| `game/day-night.ts` | the lesson as a scene (`lessonScene`); its body loads lazily |
| `game/day-night.body.mts` | the sim's 3D parts and the `spin-earth` system (lazy, with the lesson) |
| `game/strings.en.json` | every word of the lesson |
| `game/learn-mode.ts` | the `learn` mode (kid-safe) |
| `game/playtest/lesson.json` | S4 in a real browser |

## Milestones

1. **Vertical slice**: one lesson of four scenes, every objective checked, the pacing rules met; tests, playtest and budget pass the gate. *(done)*
2. A second lesson (`npm run new -- lesson <id>`), reusing the cast.
3. Narration audio per line, with captions kept.

## Changelog

| Date | Change | Budgets |
|---|---|---|
| 2026-09-28 | Template created | `day-night` measured on software GL |
| 2026-10-02 | The scripted playtest moved into the game folder (`game/playtest/`), so `npm run new-game` copies it with the game instead of into the engine's root `playtest/`; the success criterion's `by` names the new path. Same script, same check. | Unchanged |
| 2026-10-02 | Polish: the objectives card shows from the start until the first Next and never returns over the board's drawings (it used to reappear over the Sun at every Next gate of step 1); the pitch now says the teacher and classmate speak in named captions (no figures are drawn); the scripted playtest waits for each press to take effect, so `02-sun-drawn` shows the Sun, and holds `]` until the objective is met instead of for a fixed time. Brief: pitch wording only. Evidence: emulated SwiftShader play:script/play:snap at 1280×800 and 390×844, screenshots inspected; tablet and physical devices unverified. | Unchanged |
