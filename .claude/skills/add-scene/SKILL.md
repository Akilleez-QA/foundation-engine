---
name: add-scene
description: Add a scene (a level, a menu, an area, a board) to the author's game, with its test, budget row and changelog entry, then show it. Use when the author asks for a new level, room, area, screen or stage.
---

# Add a scene

1. Read `game/build.brief.ts` and `GAME.md`: does the scene serve the current milestone? If not, say so and ask.
2. Generate it (defaults come from the brief):
   - a plain scene: `npm run new -- scene <id> [--type level]`
   - a scene to move around in (explore kit): `npm run new -- area <id>`
3. Fill it with the smallest content that shows the idea (docs/recipes/add-a-scene.md). Reuse prefabs and systems from other scenes; keep ids kebab-case.
4. Connect it: `ctx.scene.goto('<id>')`, or a door (`npm run new -- interactable <id> --door <scene>`).
5. `npm run check`, then `npm run play:snap -- --scene <id> [--mobile]`. Look at the pictures yourself before showing them: framing, overlap, text size on the phone view.
6. Its budget row starts at the brief's ceiling. Before the milestone closes, measure it (docs/recipes/add-a-budget.md) and lower the numbers.
