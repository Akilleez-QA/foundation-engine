# Recipe: sync gameplay to music

Use this recipe when a game's events, sounds or grading must line up with what the
player hears: a beat to tap on, a cue on a downbeat, an animation on a bar. It is
optional. Most games never need it. The mechanism is the audio-clock timeline
([guide](../guides/audio-timeline.md)). The windows, charts and scoring below are
example game policy, chosen by the creator.

## 1. Own a timeline in the scene

```ts
// game/scenes/beat.ts
import { createAudioTimeline, defineScene, defineSystem, type AudioTimeline } from '@engine';
import calibration from '../calibration';          // a device-scoped save section, step 4
import { grade } from '../grade';

const BEAT = 60 / 120;                             // 120 beats per minute
let timeline: AudioTimeline<string> | null = null;

const clock = defineSystem({ id: 'beat-clock', phase: 'frame', run(ctx) {
  timeline!.pump();                                // once per frame, before reading positions
  const at = ctx.input.pressedAt('hit');          // the press's own timestamp, not the frame's
  if (at !== null) grade(ctx, timeline!.inputPosition(at));
  ctx.state.beat = Math.floor(timeline!.position / BEAT);   // visuals read `position`
} });

export default defineScene({
  id: 'beat', title: 'scene.beat.title', systems: [clock],
  enter(ctx) {
    timeline = createAudioTimeline<string>({
      read: () => ctx.audioClock(), now: () => ctx.time.now,
      calibration: ctx.save(calibration).get(),
      dispatch: e => { ctx.playVoice(e.payload, { at: e.when ?? undefined }); },
    });
    for (let i = 0; i < 32; i++) timeline.schedule(i * BEAT, i % 4 ? 'ui.count' : 'ui.arrive');
    timeline.start();                              // begins lookahead + 0.05 s from now
  },
  exit() { timeline?.dispose(); timeline = null; },
});
```

- **Pump in a `phase: 'frame'` system.** It runs once per displayed frame and sees a
  press in the frame it arrived.
- **Sound starts at `e.when`**, the exact context time. On the silent page-clock
  fallback (tests, benches, before audio unlocks) `when` is null and the cue plays
  at once, which `testScene` records silently.
- **Feed long charts gradually.** `schedule` returns null when `maxPending` (default
  512) is full; schedule the next bar from `dispatch` instead of the whole song.
- **Looping a song.** In `dispatch`, `stop()`, `start()` and schedule the next
  pass; the current pump ends there and the new run dispatches from the next frame.
- **Not replayed.** `ctx.state.beat` and grades come from the audio and page clocks,
  which the SIM-01 replay log does not record (it logs presses per tick, not their
  times, so `pressedAt` is null in recorded or replayed ticks). State derived from
  the timeline is outside replay determinism.
- **Audio unlocks on a gesture.** Start the run after the player presses to begin.
  If `timeline.stats.source` is `'performance'` while the game wants sound, `stop()`
  and `start()` again once `ctx.audioClock()` is non-null.

## 2. Grade a press: example game policy

```ts
// game/grade.ts: windows in seconds, chosen by the creator (these are examples)
import type { SceneContext } from '@engine';
const BEAT = 60 / 120;
const WINDOWS = [{ id: 'great', s: .045 }, { id: 'good', s: .09 }, { id: 'ok', s: .135 }] as const;

export function grade(ctx: SceneContext, heard: number) {
  const nearest = Math.round(heard / BEAT) * BEAT, error = heard - nearest;
  const hit = WINDOWS.find(w => Math.abs(error) <= w.s);
  ctx.world.emit('graded', { result: hit?.id ?? 'miss', errorMs: Math.round(error * 1000) });
}
```

Common references for the size of these windows are osu!'s OD formula and
StepMania's Judge 4 values: about ±22.5, 45, 90, 135 and 180 ms. Wide, forgiving
windows suit casual play, as in Crypt of the NecroDancer. Show early and late
feedback with the string keys and `ctx.text`, never literal text. A wrong press
should cost nothing in a learn-mode game.

## 3. Draw from `position`

`timeline.position` is the heard position in seconds, the same for every system in
a frame and never backwards within a run. A note due at `t` sits `(t - position) *
speed` from its target. Do not accumulate `dt`. Frame times vary, and the audio
clock is the truth. Mark the view dirty only when something moved: the frame loop
draws on change (STD-RUN-2).

## 4. Calibrate and store it

```ts
// game/calibration.ts
import { defineSaveSection } from '@engine';
export default defineSaveSection({ id: 'audio.calibration', scope: 'device', initial: { inputMs: 0, visualMs: 0 } });
```

1. Calibration scene: schedule eight to sixteen clicks one beat apart at a slow
   tempo (60 BPM), and ask the player to tap with what they hear. At fast tempos a
   large lag (wireless headphones) aliases onto the neighbouring beat.
2. Collect `(timeline.inputPosition(at) - nearestBeat) * 1000` for each tap. The
   timeline's calibration is zero during this test.
3. Call `estimateOffset(deltas)`. On a non-null result, save
   `{ inputMs: result.offsetMs, visualMs }`. On null, ask the player to tap again.
4. Offer a separate visual offset with a slider, judged by eye. A tap test mixes
   input latency with audio latency and cannot separate them.

Both values are measured lags with the same sign: positive `inputMs` means presses
register late, positive `visualMs` means the display shows frames late; the
timeline compensates for both.

Use `scope: 'device'`: latency belongs to the device and its headphones, not to
the player.

## 5. Test it without a browser

```ts
const clock = (nowMs: number) => ({ currentTime: 3 + nowMs / 1000, performanceTime: nowMs, outputLatency: .02, baseLatency: .005, output: null });
const t = await testScene(beat, { audioClock: clock });
t.run(1);                                  // cues within the lookahead were dispatched
t.press('hit', 1525 + 40); t.run(1 / 60);  // a press 40 ms after the 1.5 s beat was heard
```

Without `audioClock`, the same scene runs on the silent page-clock fallback. If a
success criterion depends on timing, name its test after the criterion id
(`test('S3: …')`).

## Limits

- Streamed music (`ctx` music URLs) is not on the context clock. Build the beat
  track from cues for now.
- Gamepad presses are quantised to the frame.
- Timeline-derived state is outside SIM-01 replay determinism.
- Device latency is only as good as what the browser reports, plus the player's
  calibration.

The guide lists the bounds and the evidence.
