# Optional HUD detail disclosure

Existing HUD calls remain inline. Explicitly choose disclosure when secondary text
would occupy too much of the play view:

```ts
import { hud } from '@kits/ui';

const display = hud(ctx);
display.line('status', ctx.text('game.hud.status'));
display.line('instructions', ctx.text('game.hud.instructions'), { importance: 'detail' });
display.present({
  mode: 'disclose',
  label: ctx.text('game.hud.details'),
  closeLabel: ctx.text('game.hud.close-details'),
});
```

The trigger appears only when detail lines exist. The sheet pauses the scene,
uses the existing Back/focus ownership and restores play when closed. Keep
immediate state essential; required secondary information remains available by
opening Details. Text stays in the ordinary localization catalogue.

Authors choose modes explicitly. `display.present({ mode: 'inline' })` restores
all lines in the play view. Desktop, tablet and phone builds may choose different
modes or keep the same one, subject to their own accepted tasks. This API never
infers a product edition from viewport, touch capability or quality preset.
Two-argument `line(id, text)` calls are essential, so continue supplying the detail
option when updating secondary text. `line(id, null)` removes the line.

A declared keyboard/controller input action can call `display.details(true)` in
its usual system. The visible trigger uses the same operation. Close and Back
work through the child layer while scene systems are paused; do not add a global
Escape listener. `display.details(false)` closes programmatically. Switching to
inline, deleting the last detail, or leaving the scene retires the sheet.

For custom read-only presentation, `ctx.view.openReadingSheet` exposes the same
owned capability; it is null in headless scene tests. Its returned signal marks
retirement, `ready` reports entry or cancellation, and `close()` is idempotent.
The capability adopts the supplied element into the scene overlay and removes it
on retirement; supply a dedicated subtree, not a shared application root.
Only open from a live scene that owns input. This capability does not promise a
safe interactive world behind arbitrary covering panels.

Run `node -r ./scripts/silent-browser.cjs scripts/play/hud-check.mjs` for the
isolated muted diagnostic composition. It is browser evidence, not physical-phone,
tablet or controller hardware acceptance. Use the visibility diagnostics and your
own critical regions to accept actual authored HUD content.
