# Template: learn

A short lesson (day and night): a teacher and a classmate at a chalkboard, a sim the learner turns, and a three-question quiz. It turns on the kid-safe profile (`kids: true`) and the teaching rules in AGENTS.md.

```
npm run new-game -- --template learn --id my-lesson --title "My lesson"
```

This README stays with the template; your copy lives in `game/` and `GAME.md`. Read [learn mode](../../docs/guides/learn-mode.md) before changing it.

## What is in it

| File | What |
|---|---|
| `game/lesson.ts` | the lesson as data: objectives, cast, outline, timelines, questions |
| `game/day-night.ts`, `game/day-night.body.mts` | the lesson scene and its lazily loaded sim |
| `game/strings.en.json` | every word of the lesson |
| `game/learn-mode.ts` | the `learn` mode (kid-safe policy) |
| `game/day-night.test.ts` | the criteria's tests (pacing, coverage, kind feedback) |
| `game/playtest/lesson.json` | the whole lesson played with keys in a browser |

## Controls

Next: Enter, Space, N, gamepad A, or the Next button. Back: B. Show again: R. Hint: H. I have a question: Q. Pause: K. Answers: 1–3 or the d-pad. In the sim, `[` and `]` or the left stick change the value.

## First steps

Draws are per rendered frame from `npm run play:snap -- --scene <id>` (software rendering, 1280×800) at 986d06b. Each visible `Shape` is about one draw.

| | |
|---|---|
| Scenes | `day-night` (the only scene; the sim inside it loads lazily) |
| Tests | `node --import tsx --test game/day-night.test.ts`: 3 tests |
| Playtest | `npm run play:script -- game/playtest/lesson.json` |
| Draws (budget 10) | `day-night`: 0 on the first board (it is page text); the sim draws about 3 |

**First edit.** In `game/strings.en.json`, change `lesson.o1` from `The Earth spins around its own axis, once every day.` to `The Earth turns on its own axis, once a day.` You should see the new sentence as the first item under "Today you will learn" on the first board. `npm run check` still passes, including the kid-safe and teaching rules, and so do the 3 tests.

## What to change first

1. `game/strings.en.json`: the words, to get a feel for the lesson's shape.
2. `game/lesson.ts`: objectives first, then the outline; `npm run check` enforces pacing (a learner action at least every three steps), hints before answers and coverage of every objective.
3. A second lesson: `npm run new -- lesson <id>` (the new-lesson skill walks through it).
