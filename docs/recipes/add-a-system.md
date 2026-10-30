# Recipe: add a system

Systems are the logic of a scene. They run on the one frame loop (STD-RUN-2): `fixed` systems (the default) at a fixed 60 Hz step, identical on every machine; `frame` systems once per displayed frame (cameras, cosmetic motion).

```ts
import { defineSystem, Transform } from '@engine';
import { Velocity } from './components';

export const move = defineSystem({
  id: 'move',
  run(ctx, dt) {
    const player = ctx.named('player');
    const tr = player === undefined ? undefined : ctx.world.get(player, Transform);
    if (!tr) return;
    tr.x += ctx.input.axis('steer') * 6 * dt;       // an axis input: -1…1
    if (ctx.input.pressed('jump')) ctx.play('ui.click');
  },
});
```

- **Step time** is the second argument, `run(ctx, dt)`, in seconds: the fixed step for `fixed` systems, the frame's time for `frame` systems. There is no `ctx.time.dt`; `ctx.time.t` is the seconds since the visit began.
- **Read input as actions** (`pressed`, `held`, `axis`, `pointer`), never keys or devices ([add-an-input-action](add-an-input-action.md)).
- **Talk through the world**: `ctx.world.emit('coin-taken', { id })` and `ctx.world.read('coin-taken')` in a later system of the same step; events clear after each step.
- **World-wide state** (score, lives, phase) goes in `ctx.state`; play:snap and the test API report it.
- **Randomness**: `ctx.random()` only. With `?seed=<n>` (and in `testScene`) runs are reproducible.
- **Saved state**: `ctx.save(section).update(d => { … })` ([add-a-save-section](add-a-save-section.md)).
- List the system in its scene's `systems`, in the order they should run.

## Test it without a browser

```ts
import { testScene } from '@engine';
const t = await testScene(level, { seed: 1 });
t.hold('steer', 1); t.run(0.5);           // half a second of real fixed steps
t.press('jump'); t.run(1 / 60);
assert.ok(t.world.get(t.ctx.named('player')!, Transform)!.x > 2);
assert.deepEqual(t.cues, ['ui.click']);
```

Every option and result field of `testScene` (`went`, `plays`, `voices`, `music`, `particles`, …) is in [test a scene](test-a-scene.md).

## Core runner numeric boundary

The internal fixed-step runner accepts finite positive step sizes and a nonnegative
safe-integer step budget. A zero budget drops due whole steps while still running
presentation. Fixed time retains the existing clamp to zero through one second per
frame; presentation receives the original finite delta, including a negative value.
Nonfinite deltas, unsafe whole-step counts, and overflowing frame/step/drop counters
are refused before callbacks or accumulator/counter changes, so a later admissible
frame can continue from the retained phase.

Accumulation carries rounding compensation across frames. Whole-step boundary tolerance is 64 machine epsilons in step units, not an
absolute number of seconds. Zero accumulated time never creates a fixed tick, even
with subnormal step sizes. Completed frames retain an interpolation fraction in
`[0, 1)`. This is JavaScript Number accounting, not exact elapsed-time arithmetic;
extreme ratios that exceed safe-integer counts are refused even with a zero budget.
This does not add a scheduler, change the scene's default60Hz step, or impose a
minimum creator tick interval. Callback failures retain the existing runner policy;
numeric admission is not rollback of arbitrary callback side effects.
