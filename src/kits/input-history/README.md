# Optional input history

`@kits/input-history` keeps a frame-exact history of up to 32 actions. It supports
buffered inputs, release-triggered ("negative edge") inputs, opposite-direction
cleaning (SOCD), and timed command sequences such as motion inputs. It gives the
same answers when a rollback simulation replays a frame. The kit is generic: it
knows actions and frames, not moves or genres. It owns no device reader, clock,
timer or scheduler and installs no definitions. A game can omit it.

The recipe is [add input history](../../../docs/recipes/add-input-history.md).

## Creator requirement and seam

The creator needs inputs addressed to simulation ticks (STD-SIM-12), not to
render frames. The game asks questions such as:

- "was P pressed in the last 5 frames and not used yet?"
- "was K released this frame?"
- "did the player roll down, down-right, right and press P within 11 frames?"

The kit reuses the action layer (`ctx.input` through `sampleActions`), the fixed
lane, and for rollback the `@kits/rollback` save/load ports. For random state that
must roll back with it, see `createSaveableRng` in `@engine`.

## Inputs and outputs

```ts
import { createInputHistory, sampleActions } from '@kits/input-history';

const history = createInputHistory({
  actions: ['up', 'down', 'left', 'right', 'light', 'heavy'],
  capacity: 64,                       // frames retained
  opposites: [{ a: 'left', b: 'right', policy: 'neutral' }, { a: 'up', b: 'down', policy: 'neutral' }],
});
let tick = 0;
defineSystem({ id: 'my-game-input', run(ctx) {
  const { held, taps } = sampleActions(ctx.input, history);   // this tick, via actions
  history.record(tick++, held, taps);
} });
```

These are example values, not engine defaults.

| Call | Meaning |
|---|---|
| `record(frame, held, taps?)` | Records the next frame and returns its cleaned `held`, `pressed` and `released` masks. Other results: `stale` if the frame is not after the latest one, `gap` if a frame was skipped, `invalid` for a bad frame or mask. A refused frame changes nothing. |
| `held` / `pressed` / `released(action, frame?)` | State and edges at a retained frame; the default is the latest frame. |
| `lastEdge(action, 'press' \| 'release', within, at?, includeConsumed?)` | The latest edge in the last `within` frames, or -1. This is the input buffer. |
| `consume(action, frame)` | Marks a press as used, so a buffered press fires once. |
| `sequence(steps)` then `match(seq, {within, maxGap?, at?})` | The latest match `{start, end}` or `null`. A step's conditions all hold on one frame (`all`, `none`, `pressed`, `released`). Steps match on increasing frames, at most `maxGap` frames apart, inside the window. |
| `save()` / `load(snapshot)` | Plain, detached data for a simulation's saved state. `load` validates the snapshot and replaces the whole history. |
| `mask(names)` / `names(mask)` / `reset(baseline?)` / `latest()` / `oldest()` / `heldAt(frame)` | Helpers |

**Edges** come from the cleaned held mask of consecutive frames. `taps` adds
actions pressed during the tick, so a press released before the tick ended still
appears as held for one frame (press, then release on the next frame).

The first recorded frame compares against the baseline given to `reset`
(default: nothing held). Pass the currently held mask as the baseline when input
held before a scene entry must not count as a press.

**Opposites:**

| Policy | Result when both are held |
|---|---|
| `neutral` | Neither |
| `last` | The more recently pressed one |
| `first` | The earlier one |
| `a` / `b` | A fixed priority |

`last` and `first` resolve a same-frame press to neutral. Cleaning happens before
edges, so the losing action shows a release.

## Bounds and overload

| Bound | Limit |
|---|---|
| Actions | 1–32 |
| `capacity` | 1–3600 frames |
| Opposite pairs | At most 16, disjoint |
| Sequence steps | 1–16 |
| `within` | At most `capacity` |
| `maxGap` | At most `within` |

Memory is four `Uint32Array(capacity)` rings plus two scratch arrays, allocated
once. `record` and edge queries allocate only their result object. The work for
`match` is at most `steps × within` predicate checks; for `lastEdge` it is at most
`within`.

A snapshot holds up to `4 × capacity` numbers. Keep `capacity` near the longest
window the game uses: a rollback simulation saves it every frame.

**Overload behavior:**
- A configuration error, an unknown action name, a window larger than capacity, a future frame, or a window reaching into **evicted** frames throws `RangeError`. The kit never answers from a partial view.
- Frames before the first recorded frame count as "no input", deterministically.

## Cancellation and recovery

The history is a plain owned value with no listeners or timers; drop it with its
owner. After a pause or a scene change that skips ticks, `record` returns `gap`.
Call `reset(currentHeldMask)` to start again without inventing frames. Under
rollback, keep the history inside the simulation state: `save()` it in the save
port and `load()` it in the load port. A history kept outside the saved state
refuses replayed frames as `stale`.

## Determinism

Every answer is a pure function of the recorded masks, the consumption marks and
the options. A seeded oracle test checks `match` against exhaustive search. The
rollback consumer test runs a buffered motion with a `createSaveableRng` damage
roll through `createRollbackSyncTest`, and passes only while both are in the saved
state.

## Evidence (this candidate)

**Checked (`src/kits/input-history/*.test.ts`, 14 tests):**
- Option bounds.
- Contiguity refusals, exact edges, taps and baselines.
- Buffer windows: consumption, the start-of-history rule and refusal of evicted windows.
- All five opposite policies, including ties.
- Sequences:
  - lenient motions, `maxGap` and consumption;
  - a case where the earliest choice is wrong;
  - agreement with an exhaustive oracle on 300 seeded random histories.
- Snapshots:
  - an exact JSON round trip after wrap-around, with identical continuation;
  - 13 tampered or foreign snapshots refused, with the history left unchanged.
- Rollback sync-test integration, with negative controls for an unsaved history and an unsaved random word.
- A `testScene` fixed-lane consumer showing a one-tick tap recorded once.
- Mutation checks each fail the suite: a greedy predecessor, a gap off by one, sequences ignoring consumption, and `last` behaving as `first`.

**Not established:**
- Per-game window values (for example SF6-like 11/12/32-frame motions are creator data, not defaults).
- Charge inputs (expressible as `all` over many frames or by the caller's own counter, but not supplied).
- Ordering inside one tick. Inputs are sampled once per fixed tick; `ctx.input.pressedAt` timestamps exist but this kit does not consume them.
- Physical controllers and arcade sticks.
