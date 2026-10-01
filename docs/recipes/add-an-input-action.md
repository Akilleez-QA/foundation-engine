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

- **Reach** (STD-RUN-30): every action needs a key and a pad input (`defineInput` refuses one without), so every player can reach it. `tap: true` also presses it on a tap or click on the view.
- **Keys**: printable keys by `key` in lower case (`'f'`), named keys by name (`'Space'`, `'Enter'`), physical keys by code (`'code:KeyW'`, so AZERTY players steer with the same fingers). Pad inputs are named by position (`a`, `b`, `x`, `y`, `lb`, `rb`, `lt`, `rt`, `dpad-*`, `ls-*`, `rs-*`).
- The row becomes `game.<id>` in the `inputActions` registry. Boot fails when a default binding clashes with another row; the engine's own rows are only `core.back` (Escape, B), `core.pause` (P, Menu), `core.mute` (M), focus (Tab) and the shell menu (X).

## 2. Read it

In a system: `ctx.input.pressed('jump')` (this frame), `ctx.input.held('jump')`, `ctx.input.axis('steer')`, `ctx.input.pointer`.

## 3. Test

`testScene`: `t.press('jump')`, `t.hold('steer', -1)`, `t.release('steer')`. `src/app/registries.test.ts` fails if a new row clashes or is unreachable.
