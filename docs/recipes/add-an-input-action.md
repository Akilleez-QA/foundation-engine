# Recipe: add an input action

Every control is a named action (ADR 0044, STD-RUN-25). Keys, gamepad, pointer and touch resolve to actions; systems read actions, never devices. Remaps and help text follow the row.

## 1. Define it

```ts
// game/jump.ts
import { defineInput } from '@engine';
export default defineInput({ id: 'jump', label: 'Jump', keys: ['Space'], pad: ['a'], tap: true });
```

```ts
// game/steer.ts: an axis, -1…1
import { defineInput } from '@engine';
export default defineInput({ id: 'steer', label: 'Steer', axis: {
  negative: { keys: ['code:KeyA', 'code:ArrowLeft'], pad: ['ls-left'] },
  positive: { keys: ['code:KeyD', 'code:ArrowRight'], pad: ['ls-right'] },
} });
```

- **Hold** (`hold: true`, buttons only): `ctx.input.held(id)` reports the button while it is down, for mechanics that react to its release. The press edge, remaps and cancellation are unchanged; a cancel releases it and it must be released before it presses again. A `tap` presses without holding.
- **Reach** (STD-RUN-30): every action needs a key and a pad input (`defineInput` refuses one without), so every player can reach it. `tap: true` also presses it on a tap or click on the view.
- **Keys**: printable keys by `key` in lower case (`'f'`), named keys by name (`'Space'`, `'Enter'`), physical keys by code (`'code:KeyW'`, so AZERTY players steer with the same fingers). Pad inputs are named by position (`a`, `b`, `x`, `y`, `lb`, `rb`, `lt`, `rt`, `dpad-*`, `ls-*`, `rs-*`).
- The row becomes `game.<id>` in the `inputActions` registry. Boot fails when a default binding clashes with another row; the engine's own rows are `core.back` (Escape, B), `core.pause` (P, Menu), `core.mute` (M), focus (Tab, Shift+Tab, d-pad up/down), confirm (Enter, A), paging (PageUp/PageDown, LB/RB) in panels, and the shell menu (pad X). Panel-only rows (back, focus, confirm, paging) may share an input with a game action; a global or always row may not.
- **Generate it**: `npm run new -- input <id>` (or `--axis`) picks a key and a pad input that no engine, kit or game row already holds, using the same table the boot validates. It says so when nothing is free.
- **Check it**: `npm run check` (its `lint:brief` step) builds the boot's `inputActions` table (engine rows, then the game's and its kits' inputs) and runs the same validation, so a clash fails check with the boot's message (for example `inputActions: pad x: shell.menu (global) and game.jump (global) overlap`) instead of a dead page. Limit: as at boot, `'f'` (matched by key) and `'code:KeyF'` (matched by code) are different chords to the check.

## 2. Read it

In a system: `ctx.input.pressed('jump')`, `ctx.input.held('jump')` (a `hold: true` button), `ctx.input.axis('steer')`, `ctx.input.pointer`.

`pressed` (and `pointer.pressed`) is true in exactly one fixed tick, the first after the press, even when a short
frame (120 Hz and faster displays) or a resumed `dt = 0` frame ran no tick; a `phase: 'frame'` system sees it in the
frame it arrived. Cancellation (an overlay or pause, a hidden tab, lost input ownership, leaving the scene) releases a
press no tick has seen yet (STD-SIM-12).

## 3. Test

`testScene`: `t.press('jump')`, `t.hold('steer', -1)`, `t.release('steer')`. `npm run check` (lint:brief) fails if a new row clashes or is unreachable; `src/app/registries.test.ts` checks the engine's own rows.
