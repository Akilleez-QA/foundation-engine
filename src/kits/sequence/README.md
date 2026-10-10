# kits/sequence

Optional bounded multi-track cue sequences for scripted scenes, staged events, guided
moments and set pieces. Pure data and functions: no system, timer, renderer, audio or
persistence owner. Guide: [sequences](../../../docs/guides/sequences.md).

```ts
import { createSequence, defineSequence, defineSequenceSection } from '@kits/sequence';

const intro = defineSequence({
  id: 'gate-intro',
  tracks: [
    { id: 'camera', cues: [{ id: 'pan', ticks: 120 }] },
    { id: 'story', cues: [
      { id: 'line', ticks: 0, after: ['pan'], hold: true },      // waits for release()
      { id: 'open', ticks: 30, effect: 'gate-open' },            // lands once, also on skip
      { id: 'sting', ticks: 0, effect: 'sting', onSkip: 'drop' }, // presentation only
    ] },
  ],
});
// A run keeps its session across reloads: reuse the saved one, mint a new one only for a new run.
const run = createSequence(intro, saved.run?.session ?? newRunId(), saved.run); // saved from defineSequenceSection
// In a fixed-step system: apply effects before the next save, then store run.snapshot() with them.
for (const e of run.advance(1).events) if (e.kind === 'effect') applyEffect(e.effect, e.id);
```

| Contract | Definition |
|---|---|
| Inputs | A definition (`defineSequence`): 1–16 tracks, each 1–256 ordered cues, at most 1,024 cues. A cue has a unique `id`, `ticks` in `[0, 2^31-1]`, optional `after` (up to 8 cue ids on any track, a barrier), `hold` (waits for `release`), `effect` (a creator identity) and `onSkip` (`land`, default, or `drop`). Barriers that could deadlock with track order are refused. The runner takes whole ticks from the caller's fixed step, `release(cue)`, `skip()` and `cancel()`. |
| Outputs | `advance` returns frozen events: `start`/`end` per cue (presentation), `effect` (`{effect, cue, id}` with `id = JSON.stringify([definition, session, cue])`, unambiguous across definitions and sessions) when an effect cue completes, `finished`. `active(track)` gives the current cue with `elapsed` and `alpha` for interpolating a camera, actor or fade; `completed(cue)`, `status`, `tick`, `owed`. Same-tick events follow one canonical order: always the first eligible transition in track declaration order. |
| Owner | The caller: its fixed-step system advances the runner, its own code applies effect intents, the camera, audio-mixer and dialogue kits stay the owners of what they do (see `compose.test.ts`). Persistence borrows a save section (`defineSequenceSection`). |
| Exactly once | Use a session unique per run of a definition. An effect is returned by exactly one `advance` or `skip` of a run, and never again after restoring a snapshot taken after that call. Apply returned effects synchronously and store the snapshot in the same save as their consequences (or key a claim record by `e.id`); the kit cannot make two save sections atomic. |
| Skip | Completes all remaining cues at once at the current tick (ticks still owed by a budget-stopped call are discarded, so a `drop` effect they would have reached is dropped): `land` effects are returned in canonical order, `drop` effects are recorded as dropped, no `start`/`end` events. `skippable: false` refuses. Confirmation windows and fades are creator UI. |
| Bounds and overload | At most `maxTransitions` (default 256, max 4,096) cue starts/completions per `advance`. When the budget is spent the call returns `status: 'partial'`, stops at a consistent point and keeps the remaining ticks as `owed`, consumed first by the next advance; the event order is identical however the budget splits the work. A caller should call `advance(0)` until `settled` is true before acting on what it observes (`owed` can be 0 while transitions are still due at the current tick; a `release` for a cue that has not started yet returns `not-active`). `skip` is bounded by the definition size. |
| Cancellation | `cancel()` lands nothing further and returns the effect cues that never will; later calls are inert. Held cues can only be released while active; `release` of an unknown or non-held cue throws. |
| Save/restore | `snapshot()` is plain frozen data with the definition fingerprint and session. `parseSequenceState` copies arrays with one length read and refuses an edited definition, unknown fields, out-of-range or inconsistent positions (a cue past its barrier, a release of a non-active cue, drops outside a skip, owed time on a stopped run). The section quarantines such a record and play continues from `{run: null}`. `createSequence` additionally refuses a state of another session. Validation catches corruption, not tampering: a hand-edited save can mark a cue complete whose effect never landed. |
| Cost | `advance` is O(transitions × tracks + barriers); allocation is limited to returned events and small per-call closures. No draws. |
| Limits | Ticks only: map seconds to ticks in your fixed step. No conditions or loops inside one definition: branch between definitions with a sequence graph (below) or compose with the dialogue kit. No camera splines or interpolation curves. Freezing non-participants is the cast's gate (below); systems must consult it. Headless evidence only. |

## Cast, branching and event arbitration

**Cast** (`defineCast`, `createCast`). Roles (1–32) each declare the channels the
sequence drives (1–16 creator names such as `position`, `clip`, `ai`) and whether
they are `required` or `optional`. `start(resolve, {exempt, busy})` binds roles to
entities, or returns `missing`/`conflict` and binds nothing. Gameplay systems ask
`drives(entity, channel)` and skip writing what the sequence owns. `gate(entity)` is
`freeze` for everyone outside the cast, except exempt entities and busy entities that
have not yet called `settled(entity)`. `ready()` turns true once nobody is still
settling, so a sequence can hold its first cue until the stage is quiet. `release()`
returns each member with its channels so gameplay can re-sync, and after that every
query answers as if no cast were active. The cast is not saved: re-bind roles when a
saved run is restored.

**Branching** (`defineSequenceGraph`, `createSequenceGraph`). A graph of 1–64 nodes,
each a sequence definition, joined at held branch cues. A branch has 1–16 choices,
each leading to a node or `null` (end), plus a `default`. `offered()` lists the
choices once the branch cue is active and waiting and the run is settled.
`choose(choice)` cancels the rest of the node at that moment: its incomplete cues,
including parallel ones and the branch cue's own effect, never land. It then starts
the chosen node as a new run with session `<session>#<step>`. A branch cue released
directly instead finishes the node and follows the default. `skip()` follows
defaults. On a branch node it lands only the skip effects of the incomplete cues the
branch cue depends on (track predecessors and barriers, transitively) and abandons
parallel cues, even ones that time alone would have completed first. A node without a
branch is skipped whole, and `skip` stops with `partial` at a node that is not
skippable. `maxSteps` (default 64, max 1,024) bounds loops: reaching it ends the graph
and sets `limited`, never throwing with effects in hand. Ticks left over when a node
changes are not carried into the next node. Snapshots (`parseSequenceGraphState`)
hold the node, step and current run; step 0 must be the start node.

**Event arbitration** (`createEventArbiter`). Sources (1–64) are declared in priority
order, each with an optional cooldown in ticks. Each tick the caller calls `tick()`
and then, at a safe point only (for example when the player has settled and no claim
is running), `offer(source, payload)`, at most one per source per tick. `resolve()`
claims the stage for the first offered source in declaration order. While a claim is
held every offer returns `held`. `release(claim)` refuses stale claims, and offers from
that source are then refused for its `cooldown` ticks after the release tick. Claims
and cooldowns are not saved.
