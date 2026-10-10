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
const run = createSequence(intro, `${slot}:${visit}`, saved.run); // saved from defineSequenceSection
// In a fixed-step system: apply effects before the next save, then store run.snapshot() with them.
for (const e of run.advance(1).events) if (e.kind === 'effect') applyEffect(e.effect, e.id);
```

| Contract | Definition |
|---|---|
| Inputs | A definition (`defineSequence`): 1–16 tracks, each 1–256 ordered cues, at most 1,024 cues. A cue has a unique `id`, `ticks` in `[0, 2^31-1]`, optional `after` (up to 8 cue ids on any track, a barrier), `hold` (waits for `release`), `effect` (a creator identity) and `onSkip` (`land`, default, or `drop`). Barriers that could deadlock with track order are refused. The runner takes whole ticks from the caller's fixed step, `release(cue)`, `skip()` and `cancel()`. |
| Outputs | `advance` returns frozen events: `start`/`end` per cue (presentation), `effect` (`{effect, cue, id: '<session>/<cue>'}`) when an effect cue completes, `finished`. `active(track)` gives the current cue with `elapsed` and `alpha` for interpolating a camera, actor or fade; `completed(cue)`, `status`, `tick`, `owed`. Same-tick events follow one canonical order: always the first eligible transition in track declaration order. |
| Owner | The caller: its fixed-step system advances the runner, its own code applies effect intents, the camera, audio-mixer and dialogue kits stay the owners of what they do (see `compose.test.ts`). Persistence borrows a save section (`defineSequenceSection`). |
| Exactly once | An effect is returned by exactly one `advance` or `skip` of a run, and never again after restoring a snapshot taken after that call. Apply returned effects synchronously and store the snapshot in the same save as their consequences (or key a claim record by `e.id`); the kit cannot make two save sections atomic. |
| Skip | Completes all remaining cues at once: `land` effects are returned in canonical order, `drop` effects are recorded as dropped, no `start`/`end` events. `skippable: false` refuses. Confirmation windows and fades are creator UI. |
| Bounds and overload | At most `maxTransitions` (default 256, max 4,096) cue starts/completions per `advance`. When the budget is spent the call returns `status: 'partial'`, stops at a consistent point and keeps the remaining ticks as `owed`, consumed first by the next advance; the event order is identical however the budget splits the work. A caller should drain `owed` before acting on what it observes (a `release` for a cue that has not started yet returns `not-active`). `skip` is bounded by the definition size. |
| Cancellation | `cancel()` lands nothing further and returns the effect cues that never will; later calls are inert. Held cues can only be released while active. |
| Save/restore | `snapshot()` is plain frozen data with the definition fingerprint and session. `parseSequenceState` reads each field once and refuses an edited definition, another session, unknown fields, out-of-range or inconsistent positions (a cue past its barrier, a release of a non-active cue, drops outside a skip, owed time on a stopped run). The section quarantines such a record and play continues from `{run: null}`. |
| Cost | `advance` is O(transitions × tracks + barriers); no allocation besides returned events. No draws. |
| Limits | Ticks only: map seconds to ticks in your fixed step. No branching, conditions or loops inside a definition (compose with the dialogue kit or choose another definition); no camera splines, interpolation curves or participation freezing of other entities. Headless evidence only. |
