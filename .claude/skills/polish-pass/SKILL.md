---
name: polish-pass
description: Make a playable slice feel finished (feedback, readability, framing, phone layout, calm motion) without adding features or cost. Use when the core loop works and the author asks for polish, juice or feel.
---

# Polish pass

Work in small rounds; each ends with `npm run check`, `npm run play:snap -- --mobile`, and a look at the pictures.

1. **Readability**: HUD text large enough on the phone view; prompts say what to press on every device (keyboard, pad, touch); nothing overlaps the play area's action.
2. **Framing**: the camera shows what matters on desktop and phone (`minWidthFov` keeps a portrait phone's width).
3. **Feedback**: every player action gets an immediate response (a cue `ctx.play('ui.click')`, a colour change, a small motion). Keep it inside the budget; prefer changing existing entities over adding new ones.
4. **Calm**: motion that is decoration respects reduced motion; no flashing. Check it with `npm run play:snap -- --calm`: it says whether motion and emitters stopped with Calm on.
5. **Words**: all text in string keys (`defineGame({ strings })`), short and friendly.
6. **Look**: colour, light, haze, framing and forms follow the [art-direction skill](../art-direction/SKILL.md); run its look checklist on the screenshots.
7. Report what changed with before/after screenshots and confirm no budget moved up.
