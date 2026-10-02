# Recipe: add and tune a jump

Use this when the creator wants an actor to jump. The locomotion kit supplies a
mechanism with creator-chosen values (MV-01, integrated in v0.2.0); it does not choose the feel.
Full contract: [locomotion kit](../../src/kits/locomotion/README.md#tunable-jump-feel-mv-01).

## 1. Record the requirement

State the creator's target in GAME.md first: apex height, time to apex, whether a
release shortens the jump, grace windows, and how it should feel on each supported
device. Turn it into a checkable success criterion (for example "the held jump
peaks at 2 m within 0.4 s").

## 2. A hold-aware action

```ts
// game/jump.ts
import { defineInput } from '@engine';
export default defineInput({ id: 'jump', label: 'Jump', keys: ['Space'], pad: ['a'], tap: true, hold: true });
```

`hold: true` lets `ctx.input.held('jump')` observe the release. A tap presses
without holding, so it produces the shortest jump; give touch players a held
on-screen control if the creator wants full height on touch.

## 3. The system

```ts
import { jumpSystem } from '@kits/locomotion';
import { characterSystem } from '@kits/character';

const floor = (x: number, z: number, below: number) => below >= 0 ? 0 : null;

systems: [
  characterSystem(),             // horizontal motion only: no `ground` option here
  jumpSystem({
    action: 'jump',
    ground: floor,               // highest surface at or below `below`, or null
    config: { height: 2, timeToApex: 0.4, releaseGravityScale: 2.5, coyoteTime: 0.1, bufferTime: 0.12 },
    snapDistance: 0.05, stepHeight: 0.2,
  }),
]
```

The `ground` query receives the start-of-tick foot height, so a surface above the
feet never catches a rising actor (one-way platforms) and a fast fall cannot pass
through one. Lateral blocking stays with `Walls` and `Solid`s.

## 4. Tune with numbers, not frames

| Want | Change |
|---|---|
| Higher or quicker jump | `height`, `timeToApex` (both stay exact) |
| Shorter jump on a quick tap | raise `releaseGravityScale` (1 disables) |
| Snappier landing | raise `fallGravityScale`; cap with `maxFallSpeed` |
| Hang near the top while held | `apexBand` 0.1–0.3 and `apexGravityScale` 0.4–0.7 |
| More forgiving ledges and landings | `coyoteTime`, `bufferTime` (seconds, not frames) |

`deriveJump(config)` prints the launch speed and gravities for a tuning panel.
Every value is in seconds or metres, so the feel holds at any fixed-step rate.

## 5. Reset on discontinuities

Call `resetJump(ctx.world, entity)` after a teleport, a respawn or a control change
(for example from the control kit's `resetMotion` port). `when: ctx => …` pauses
the system and drops a pending press.

## 6. Test it

```ts
test('S1: the held jump peaks at 2 m', async () => {
  const t = await testScene(scene, { systems: [jumpSystem({ action: 'jump', config, ground: floor })] });
  t.press('jump'); t.hold('jump'); t.run(0.4);
  // assert on the player's Transform.y
});
```

Then `npm run play:snap` and play it on each supported device: unit tests prove
the arithmetic and frame-rate independence, not that the jump feels right.
