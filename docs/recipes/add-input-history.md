# Recipe: add input history (buffers, release edges, sequences)

Use the optional `@kits/input-history` kit when a rule depends on *when* actions
happened, not only whether they are held now. Examples:

- accept a press made a few frames early (an input buffer);
- trigger on a release (negative edge);
- recognise a timed sequence of directions and buttons;
- decide what two opposite directions held together mean.

The [kit README](../../src/kits/input-history/README.md) has the full contract.

## 1. Record the requirement

In GAME.md, name the success criterion and the creator's numbers: buffer length,
each sequence's window and largest gap, the opposite-direction policy, and
whether a release can trigger. They are design data. The engine supplies no
defaults for them.

## 2. Record one mask per fixed tick, through actions

```ts
import { createInputHistory, sampleActions } from '@kits/input-history';

const history = createInputHistory({
  actions: ['up', 'down', 'left', 'right', 'light', 'heavy'],
  capacity: 32,
  opposites: [{ a: 'left', b: 'right', policy: 'neutral' }, { a: 'up', b: 'down', policy: 'neutral' }],
});
let tick = 0;
export const input = defineSystem({ id: 'my-game-input', run(ctx) {
  const { held, taps } = sampleActions(ctx.input, history);
  const r = history.record(tick++, held, taps);
  if (r.status === 'gap') history.reset(held);   // after a pause: start again, never invent frames
} });
```

- Read actions through `ctx.input` only. Every action keeps its key and pad binding (and a touch control where touch is supported).
- `taps` keeps a press that was released within the same tick.
- Use one tick counter for the history. `ctx.time.frame` counts rendered frames, not fixed ticks.

## 3. Ask buffered and sequence questions in the same fixed lane

```ts
const motion = history.sequence([
  { all: ['down'], none: ['left', 'right'] },
  { all: ['down', 'right'] },
  { all: ['right'], none: ['down'], pressed: ['light'] },
]);
export const act = defineSystem({ id: 'my-game-act', run() {
  const found = history.match(motion, { within: 11, maxGap: 4 });
  if (found && history.consume('light', found.end)) startMove('special');
  else {
    const at = history.lastEdge('light', 'press', 5);   // pressed in the last 5 frames, unused
    if (at >= 0 && canAct() && history.consume('light', at)) startMove('light');
  }
  if (history.released('heavy')) releaseCharge();      // negative edge
} });
```

`consume` stops one press from firing two moves, or the same buffered move twice.

## 4. With rollback

Make the history part of the simulation state:

1. The rollback input text is the held mask, for example `String(held | taps)`.
2. In `step`, record the frame's mask.
3. Include `history.save()` in the save port and call `history.load(...)` in the load port.
4. Do the same for randomness with `createSaveableRng` from `@engine`: save `rng.state()` and call `rng.restore(word)`.

Check it with `createRollbackSyncTest` from `@kits/rollback`. It reports a history
or random word left outside the saved state.

## 5. Check

Run `npm run check`. Name a test after the success criterion. Cover:

- the motion inside and just outside its window;
- a buffered press that fires once;
- the opposite-direction policy.

These are finite headless checks. Physical controllers and feel need their own
recorded evidence.
