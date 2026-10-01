---
name: new-lesson
description: Author a lesson in learn mode with the author, outline first, then one scene at a time with a play:snap after each. Use when the author asks for a lesson, a tutorial that teaches a concept, or anything in a learn-mode game.
---

# New lesson

Read docs/guides/learn-mode.md and the "Teaching" rules in AGENTS.md first.

1. **Ask** (short): who learns it (age band, from the brief), what they should be able to do afterwards (1 to 3 objectives, each checkable), what they might already believe (the classmate's question comes from this), and whether a hands-on part fits (a sim to turn, parts to find).
2. **Generate**: `npm run new -- lesson <id>`. It writes `<id>-lesson.ts` (data), `<id>.ts` (the scene), a test, a budget row and the lesson's words.
3. **Outline first**: write the objectives and the ordered outline (scene type + objective per item). Show the outline to the author and agree it before writing any scene.
4. **One scene at a time**: write its timeline and data, then `npm run check` (pacing, hints, kind feedback, coverage) and `npm run play:snap -- --scene <id>` (and `--mobile` when phones are targets). Look at the capture: board legible, captions short, nothing covered. Show it; ask.
5. **Check it**: a playtest script (`playtest/<id>.json`, with `pressUntil` and `waitUntil` steps) that plays the lesson with keys only, named as a criterion in the brief. `npm run play:criteria`.
6. Ask the pedagogy-reviewer agent for a review before the milestone closes.
