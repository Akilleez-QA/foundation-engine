# Optional input history

`@kits/input-history` keeps a frame-exact history of up to 32 actions. It supports
buffered inputs, release-triggered ("negative edge") inputs, opposite-direction
cleaning (SOCD), and timed command sequences such as motion inputs. It gives the
same answers when a rollback simulation replays a frame. The kit is generic: it
knows actions and frames, not moves or genres. It owns no device reader, clock,
timer or scheduler and installs no definitions. A game can omit it. It also plays
scripted action timelines (and converted recordings) back as normal input for tests
and attract mode: see [scripted playback](#scripted-playback).

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
(default: nothing held). The baseline is raw input, so it is cleaned with the
opposite policies like any recorded frame. Pass the currently held mask as the baseline when input
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
| Action id length | 1–64 characters |
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
- Frames before the first recorded frame are outside every window, deterministically. They hold no edges for `lastEdge` (-1), and `match` never places a step on them; a `none` step cannot match an unrecorded frame. They are never an error.

## Cancellation and recovery

The history is a plain owned value with no listeners or timers; drop it with its
owner. Own one history per scene visit. Call `reset(currentHeldMask)` on enter
(a restart is a new visit) and on resume after a pause or overlay, so a key held
across the change is not a new press. Driven by a counter that advances only when
the fixed lane runs, `record` never sees a skipped frame. A `gap` or `stale`
result means a caller bug, and the frame is refused rather than invented. Under
rollback, keep the history inside the simulation state: `save()` it in the save
port and `load()` it in the load port. A history kept outside the saved state
refuses replayed frames as `stale`.

## Determinism

Every answer is a pure function of the recorded masks, the consumption marks and
the options. A seeded oracle test checks `match` against exhaustive search. The
rollback consumer test runs a buffered motion with a `createSaveableRng` damage
roll through `createRollbackSyncTest`, and passes only while both are in the saved
state.

## Scripted playback

`createInputPlayback` plays a timeline of action events into an `InputSource`, the
shape `ctx.input` has. Systems read scripted actions exactly as they read a player's.
It serves tests, demos and attract mode. `timelineFromHistory(history, {from?, to?})`
converts recorded frames into a timeline.

```ts
import { createInputPlayback, inputPlaybackSystem, timelineFromHistory } from '@kits/input-history';

// A test: the scene's systems see the timeline as ctx.input.
const playback = createInputPlayback({ events: [
  { tick: 0, action: 'move', kind: 'axis', value: 1 },
  { tick: 30, action: 'jump', kind: 'tap' },
  { t: 1.5, action: 'move', kind: 'axis', value: 0 },     // seconds, rounded to the tick
] });
// inputPlaybackSystem steps it once per fixed tick; list it before every system that reads input.
const t = await testScene(
  defineScene({ id: 'demo', title: 'Demo', systems: [inputPlaybackSystem(playback), ...mySystems] }),
  { input: playback.source },
);

// Attract mode: loop, and stop when the user touches anything.
const demo = createInputPlayback({ ...timelineFromHistory(recorded), loop: true, watch: ['move', 'jump', 'menu'] });
defineSystem({ id: 'my-game-attract', run(ctx) {
  if (demo.step(ctx.input).status === 'cancelled') ctx.scene.goto('title'); // the raw ctx.input, never a view
  const input = demo.over(ctx.input);  // scripted while playing, live afterwards
  // ... the game's normal logic reads `input`
} });
```

| Event | Meaning |
|---|---|
| `press` | Pressed on its tick, held until `release`. |
| `release` | Released. In the same tick as its press, the action is a tap. |
| `tap` | Pressed for its tick and never held: `pressed` true, `held` false, exactly as a real press released within one tick reads (checked against `testScene`'s `press`). |
| `axis` | `value` in [−1, 1] from its tick until changed. |

An action is either a button or an axis. Events may come in any order; within one
tick they apply in the given order. `step(live?)` makes the next tick current. Given
`live`, it first checks the watched actions (default: the timeline's own) for held,
pressed, or |axis| > `deadzone` (default 0.2), and the pointer (`watchPointer`,
default true). Any of these cancels with reason `'input'`.

`live` must be the raw live input (`ctx.input`). Passing the playback's own `source` or
an `over()` view throws `RangeError`: it would read the script as user input and cancel
itself.

**Stepping:**
- Call `step` once per fixed tick, before any system reads the scripted input.
- `inputPlaybackSystem(playback, {id?, watchLive?})` is that system: list it first in the
  scene's `systems`, which run in list order in the fixed lane.
- `watchLive: true` passes `ctx.input` as the live input to watch. Leave it false in a
  test where `ctx.input` is the playback itself.
- `over(live)` caches one view per live source, so it does not allocate per call.

**Ending:**
- Cancelling or finishing releases every scripted action.
- `over(live)` switches to the live input on the same tick, so the touch that ended
  the demo is not lost.
- After the last tick, `loop: true` takes one rest step (tick −1, everything released)
  and then plays tick 0 again. A loop of `length` ticks therefore takes `length + 1`
  steps, and an action held across the wrap shows a release and a fresh press, as a
  recording of the same session would. Otherwise the status is `'finished'`.
- `cancel(reason)` ends playback (idempotent); `restart()` returns to `'ready'`.
- Scripted presses have no `pressedAt` timestamp (null), as in the replay kit.
- The scripted pointer is idle.

**Converter:**
- Played one tick per recorded frame and sampled with `sampleActions`, a converted
  history records the same cleaned held masks and press/release edges again. This is
  tested under all five opposite policies and in a `testScene` round trip. Raw-input
  bookkeeping (such as the latest raw press of an action that lost an opposite pair)
  can differ, because the timeline holds cleaned input.
- Actions held at `from` become presses at tick 0.
- Consumption marks are game decisions and are not part of the timeline.
- The result carries `maxEvents` (its event count), so
  `createInputPlayback(timelineFromHistory(h))` accepts more than the default 4096. A
  range with more than 65,536 edges throws `RangeError`; convert a shorter range.

**Bounds and overload:**
- `maxEvents` is 1–65,536 (default 4096). A timeline is at most 216,000 ticks (an hour
  at 60 Hz), with at most 64 distinct actions and 64 distinct watched ids (duplicates count once).
- Event fields are read once into locals, and the list is walked by index over its
  captured length.
- A malformed or oversized timeline throws `RangeError` at construction, never mid-play.
- A step applies only that tick's events, so per-tick work is that tick's events plus
  the watched actions.

**Placement:** playback lives here because this kit owns action-level recording; the
two formats convert directly. The replay kit is a different owner with a different
job: it verifies a scene against logged ticks and digests, and its dev-only tick tap
can replace `ctx.input` in a visit. Playback is for authored timelines and attract
mode, so it never replaces `ctx.input` in a live visit. A scene opts in by reading
`over(ctx.input)`.

## Evidence (this candidate)

**Checked (`src/kits/input-history/*.test.ts`, 28 tests):**
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
- Scripted playback (`playback.test.ts`, 11 tests):
  - option bounds;
  - press, release, tap, same-tick tap, axis and seconds-to-tick semantics, tick by tick;
  - a scripted tap reading exactly like a real `testScene` press;
  - deterministic loops with a rest step, recorded as a release and a fresh press at the wrap;
  - cancellation by held, pressed, axis and pointer input, with the deadzone and unwatched actions;
  - a recorded `testScene` session (opposites, taps) converted and played back through `testScene({input})` with `inputPlaybackSystem`, giving identical cleaned masks and edges;
  - seeded round trips under all five opposite policies;
  - the conversion bound and the carried `maxEvents`;
  - refusal of its own source or view as live input, a cached view, and deduplicated watch ids;
  - each event field read once, and indexed walking of the event list;
  - an attract-mode scene ended by a real press, after which live input drives it.
- Review regressions: opposites held across `reset` report no false edges under all five policies; frames before the first record are outside every window; an explicit frame on an empty history throws.
- An independent review of the first playback candidate (`92665854`) found these issues, each now fixed with a regression test:
  - taps read as held;
  - a looping held action was re-pressed without a release;
  - event fields were read twice;
  - conversions could exceed `maxEvents`;
  - the round-trip claim went beyond what was tested;
  - the stepping order was undocumented;
  - stepping with its own view cancelled the playback;
  - the watch bound counted duplicates.
- Mutation checks each fail the suite: a greedy predecessor, a gap off by one, sequences ignoring consumption, and `last` behaving as `first`.

**Not established:**
- Per-game window values (for example SF6-like 11/12/32-frame motions are creator data, not defaults).
- Charge inputs (expressible as `all` over many frames or by the caller's own counter, but not supplied).
- Ordering inside one tick. Inputs are sampled once per fixed tick; `ctx.input.pressedAt` timestamps exist but this kit does not consume them.
- Physical controllers and arcade sticks.
