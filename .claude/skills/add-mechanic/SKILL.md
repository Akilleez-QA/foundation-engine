---
name: add-mechanic
description: Add a gameplay mechanic (a rule, an interaction, a score, a power-up) as components and systems with tests, the smallest version first. Use when the author describes something the player should be able to do or something that should happen in the game.
---

# Add a mechanic

1. Restate the mechanic in one sentence and name the success criterion it serves (or propose a new one for the brief; a brief change is recorded in GAME.md's changelog).
2. Model it as data plus logic:
   - state on entities: `npm run new -- component <id>`
   - logic: `npm run new -- system <id>` (fixed step for rules; `--frame` only for presentation)
   - a control: `npm run new -- input <id>` (every action needs a key and a pad input; the brief decides tap)
   - state that must survive a reload: `npm run new -- save-section <id>`
3. Systems read actions (`ctx.input`), never keys; talk through world events; use `ctx.random()` for chance. Text goes through string keys (`ctx.text`).
4. Write the test first in the scene's test file with `testScene`: press, hold, run seconds, assert. Name it after the criterion (`test('S3: …')`) when it checks one.
5. `npm run check`, then `npm run play:snap`, show, ask.
6. Genre machinery that more than one game would want belongs in a kit, but only when the author asks to extend the engine (docs/recipes/add-a-kit.md).
