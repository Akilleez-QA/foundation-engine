# Learn mode

Learn mode turns a game into a short, interactive lesson: a teacher and one or two classmates at a chalkboard, things the learner turns and taps, and questions with hints and kind feedback. It is built from three kits on the ordinary author API, and a game pays nothing for it until a lesson opens (the learn runtime loads lazily; `scripts/perf/learn-isolation.test.ts` proves it stays out of the first-load bundle).

Design inspired by THU-MAIC OpenMAIC.

## The parts

| Kit | What |
|---|---|
| `learn` | The lesson model (`defineLesson`), the timeline, the director, the controls, `lessonScene`, the `learn.progress` save section, the lesson inputs |
| `chalkboard` | The board: chalk strokes that draw on, written text and labels, arrows, axes, shapes, number lines; spotlight and pointer; captions |
| `concept-explorer` | Orbit a 3D model, tap parts for their names, show and hide layers, scrub a parameter with a slider, a mini quiz panel |

## A lesson

A lesson is plain, versioned data (`templates/learn/game/lesson.ts` is the worked example):

- **objectives**: what the learner will be able to do, each with a stable id;
- **cast**: one teacher, an optional helper, one or two classmates (names are string keys);
- **outline**: ordered items, each a scene type and the objective it serves;
- **scenes**: one per outline item, keyed by its id, with a **timeline** of actions and the type's data.

Scene types are an open registry (`defineLessonSceneType`): `board`, `explore` (find parts), `sim` (turn a parameter), `quiz` (questions with hints and feedback), `project` (2 to 4 milestones) and `discuss` (the learner picks a prompt; a provider answers).

### The timeline

Actions: `say` (who, text), `objectives`, `draw`, `write`, `reveal`, `hide`, `spotlight`, `point`, `camera`, `wait-for` (next, answer, param, part, milestone, discuss) and `branch` (on an answer or a parameter). Targets are stable ids of board items or parts. The timeline is deterministic: it can be paused, scrubbed back, replayed ("show again") and skipped to the next point where the learner acts; drawings and camera moves are instant under reduced motion; nothing redraws while nothing changes.

### The director

It plays each scene's timeline, pauses it while the learner interacts or an interrupt plays, and resumes after. The learner can always say **I have a question** (the scene's authored answer), **Show again** and **Hint**. Answers get kind feedback; a wrong answer gets the next hint, and the answer is shown only after every hint. Progress (scene, answers, objectives met) is saved in `learn.progress`.

A `discuss` scene asks a `DiscussProvider`. Only the scripted provider ships (`scriptedProvider(responses)`); a game may supply its own, and in a kid-safe game every response must pass `kidSafeProblems` (no links, no requests for personal data, no violence, short) or an authored fallback plays instead. There is no runtime language model by default.

## Teaching rules (checked)

`npm run check` (the brief lint) and each lesson's test apply `lessonProblems` with the brief's numbers:

| Rule | Check |
|---|---|
| The learner acts often | at most `brief.pedagogy.maxPassiveActions` (default 3) passive actions in a row, along every branch |
| Hints before answers | every quiz question has at least one hint; the director reveals answers only after every hint |
| Multimodal | a board scene both says and shows (a say and a draw, write or reveal) |
| Kind feedback | feedback and hints avoid harsh words (a word list; reword anything it flags) |
| Objectives stated and checked | the first scene has `{ do: 'objectives' }`; every objective is taught by a scene and checked by a question, a sim check, an explore check or a milestone |
| Short scenes | steps to watch per scene: 10 up to age 8, 14 up to 11, 20 otherwise |

## Make a lesson

```
npm run new-game -- --template learn        # a game with one lesson, kid-safe by default
npm run new -- lesson seasons               # a second lesson: data, scene, test, words
```

Then, with your agent (the new-lesson skill): outline first (objectives, then the ordered items), then one scene at a time, each followed by `npm run play:snap -- --scene <lesson>` to see it and `npm run play:criteria` to check it.

## Visit ownership and cleanup

`lessonScene(...)` loads the runtime lazily and disposes its visit from the existing
scene exit hook. Each visit owns its controls, board, quiz, current parameter slider,
caption and pending UI commands. Changing lesson sections destroys the old slider
instead of retaining hidden inputs. Leaving clears pending commands, retires callbacks
and removes owned DOM; reentry creates a fresh visit and uses the existing saved
lesson progress. Cleanup is idempotent and attempts the independent views even if
one destroy operation throws, then reports aggregate errors.

Consumers composing `lessonBody` or `directorSystem` directly from
`src/kits/learn/runtime.ts` must compose `disposeLesson(ctx)` into their scene's
`exit` callback. This is synchronous UI ownership, not cancellation of an external
provider request. The standalone slider and quiz helpers now expose `destroy()`;
retired controls ignore setters and callback registration, and retained DOM references
cannot deliver a new callback. Creators may replace this presentation and retain
the same lesson data and lifecycle contract.

Focused visit/reentry tests and real Chromium retained-node callback checks cover
this lifecycle. They do not establish complete touch lesson acceptance. See the
[device evidence](../verification/stock-device-20261001/README.md).

## Layout on narrow screens

The control bar wraps onto two or three rows on phones, and the progress line takes
the top-left corner. The controls (`src/kits/learn/ui.ts`) own one `ResizeObserver`
over the bar, the progress line, the overlay and lesson content registered with
`controls.arrange({ line, panel, floor })`. It runs only when one of those changes
size (wrapping, rotation, text or visibility changes), never per frame, and it
publishes on the overlay:

| Property | Value | Used by |
|---|---|---|
| `--learn-controls-reserve` | bar bottom offset + bar height + 8px gap | `aboveControls(min)`: the board (76px authored inset) and the slider (84px) |
| `--learn-top-clear`, `--learn-top-side` | set only when a centred top line would touch the progress line | `topLine()`: the caption line on sim and quiz scenes drops below the progress line with 16px gutters |

The objectives and finished cards, and the panel passed to `arrange` (the quiz),
keep their authored centre unless they would cover the progress or caption line,
reach the bar, or (cards only) cover the board's caption. Then they start below the
top content and scroll within the space left (`max-height`, `overflow-y: auto`).

Every value keeps its authored geometry wherever there is space, so desktop and
tablet layouts with a one-row bar do not change; nothing here imposes a phone layout
on larger screens. When the space is too small for a panel (phone landscape), the
panel scrolls rather than covering the caption or the controls. The observer
disconnects and the properties are cleared when the controls are destroyed (scene
exit through `disposeLesson`). Without `ResizeObserver` (non-browser hosts) the
authored insets apply unchanged.

A creator who replaces the lesson UI can keep these helpers, use their own owner,
or omit them. Regressions: `src/kits/learn/layout.test.ts` (fake DOM geometry: what
moves, by how much, what stays) and the Learn route of
`scripts/play/stock-touch-check.mjs` (Chromium touch emulation at four profiles,
stepping through board, sim and quiz). Neither is physical-device acceptance; see the
[layout repair receipt](../verification/stock-device-20261002/README.md).
