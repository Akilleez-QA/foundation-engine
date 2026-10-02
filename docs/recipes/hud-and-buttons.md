# Recipe: HUD text and buttons

Show a score, a message and a hint over the scene, take a tap anywhere as an action, and add one real on-screen button.

## 1. Add the ui kit and your words

Text is never written in systems; it lives in string keys in `game/game.ts`. Add `ui()` to `kits` and the strings this recipe uses:

```ts
// game/game.ts (excerpt)
import { defineGame } from '@engine';
import { ui } from '@kits/ui';

export default defineGame({
  id: 'my-game', title: 'My game', version: '0.1.0', firstScene: 'main',
  kits: [ui()],
  strings: {
    en: {
      'game.hud.taps': 'Taps {n}',
      'game.hud.goal': 'Reach {n} to win',
      'game.won': 'You did it!',
      'game.tap-hint': 'Press Enter, C, pad Y, or tap anywhere',
      'game.reset': 'Reset',
    },
  },
});
```

`{n}` is a hole that `ctx.text('game.hud.taps', { n: 3 })` fills.

## 2. An action that a tap also presses

An input action needs a key and a pad button. `tap: true` makes a tap or click on the view press it too, which is how touch players reach it:

```ts
// game/count.ts
// A button every player can reach: a key, a pad button, and (tap: true) a tap or click anywhere on the view.
import { defineInput } from '@engine';

export default defineInput({ id: 'count', label: 'Count', keys: ['Enter', 'code:KeyC'], pad: ['y'], tap: true });
```

Each key and pad button may belong to only one action. The engine itself uses `P` and pad *Menu* (pause), `M` (mute) and pad *X* (the shell menu), and the blank template's `turn` action uses `Space` and pad *A*. An overlap stops the game at boot with `inputActions: … overlap`; `npm run check` does not see it, `npm run play:snap` does. If two actions have `tap: true`, one tap presses both.

## 3. The scene

Generate it (`npm run new -- scene counter`), then:

```ts
// game/counter.ts
// HUD text from the ui kit, a tap-anywhere action, and one on-screen button.
import { defineScene, defineSystem, type SceneContext } from '@engine';
import { hud } from '@kits/ui';

const GOAL = 10;

export const count = defineSystem({
  id: 'count-taps',
  run(ctx) {
    if (ctx.input.pressed('count') && (ctx.state.taps as number) < GOAL) {
      ctx.state.taps = (ctx.state.taps as number) + 1;
      ctx.play('ui.click');
    }
  },
});

// A frame system: it only sets text, and the HUD touches the page only when the text changes.
export const showHud = defineSystem({
  id: 'counter-hud', phase: 'frame',
  run(ctx) {
    const n = ctx.state.taps as number, h = hud(ctx);
    h.line('taps', ctx.text('game.hud.taps', { n }));
    h.line('goal', ctx.text('game.hud.goal', { n: GOAL }));
    h.banner(n >= GOAL ? ctx.text('game.won') : null);
    h.prompt(n === 0 ? ctx.text('game.tap-hint') : null);
  },
});

// One real button over the view. The scene creates it on enter and removes it on exit.
const buttons = new WeakMap<object, HTMLButtonElement>();
function addResetButton(ctx: SceneContext) {
  const overlay = ctx.view.overlay;
  if (!overlay) return;                       // null in node tests
  const button = overlay.ownerDocument.createElement('button');
  button.type = 'button';
  button.textContent = ctx.text('game.reset');
  button.style.cssText = 'position:absolute;right:16px;top:56px;min-width:48px;min-height:48px;padding:8px 16px;'
    + 'pointer-events:auto;border:0;border-radius:var(--engine-radius-md);font:600 var(--engine-text-lg) var(--engine-font);'
    + 'background:var(--engine-accent);color:var(--engine-ink)';
  button.addEventListener('click', () => { ctx.state.taps = 0; });
  overlay.append(button);
  buttons.set(ctx.world, button);
}

export default defineScene({
  id: 'counter', title: 'Counter', type: 'scene',
  view: { camera: { position: [0, 8, 10], target: [0, 0, 0], minWidthFov: 50 }, background: 0x141a24 },
  entities: [],
  systems: [count, showHud],
  enter(ctx) { ctx.state.taps = 0; addResetButton(ctx); },
  exit(ctx) { buttons.get(ctx.world)?.remove(); buttons.delete(ctx.world); },
});
```

- `hud(ctx).line(id, text)` adds or updates one line at the top left; `null` removes it.
- `hud(ctx).banner(text)` is a large centred message, announced to screen readers; `null` hides it.
- `hud(ctx).prompt(text)` is a hint near the bottom; `null` hides it.
- Calling these every frame is cheap: the page is only touched when the text changes.
- The button lives in `ctx.view.overlay`, the layer over the 3D view, and must turn `pointer-events` back on. It sits at the top right, clear of the HUD lines (top left) and the prompt (bottom centre). Make it at least 48 × 48 px for touch, and remove it in `exit`. A click on it does not count as a tap on the view. `ctx.view.overlay` is `null` in node tests, so tests drive the action instead.

Each press reaches exactly one fixed step, even when a slow frame runs several steps or a fast frame runs none, so a toggle in a fixed system flips once per press (the press latch, STD-SIM-12, since v0.2.0). Frame-phase systems see a press in the frame it arrives.

Colours and fonts come from the engine's `--engine-*` CSS tokens (`src/platform/ui/tokens.css`), so the button matches the shell and the large-text setting.

## 4. Test it

```ts
// game/counter.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testScene } from '@engine';
import { hud } from '@kits/ui';
import game from './game';
import counter from './counter';

test('pressing count ten times shows the win banner', async () => {
  const t = await testScene(counter, { game });
  t.run(1 / 60);
  assert.equal(hud(t.ctx).read().prompt, 'Press Enter, C, pad Y, or tap anywhere');
  for (let i = 0; i < 10; i++) { t.press('count'); t.run(1 / 60); }
  assert.equal(t.ctx.state.taps, 10);
  assert.equal(hud(t.ctx).read().lines.taps, 'Taps 10');
  assert.equal(hud(t.ctx).read().banner, 'You did it!');
  assert.equal(t.cues.length, 10);
});
```

`hud(ctx).read()` returns `{ lines, banner, prompt }` with the resolved text.

## 5. Look at it

```
npm run check
npm run play:snap -- --scene counter --mobile
```

Check the phone screenshot: the lines and the button must not cover what the player needs to see, and the text must be readable.

More: the [ui kit README](../../src/kits/ui/README.md) (detail lines and a details sheet for small screens), the `arcade` template (score, best score, game-over banner) and the `mechanics` template (a contextual action button).
