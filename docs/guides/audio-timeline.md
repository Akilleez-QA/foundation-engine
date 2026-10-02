# Audio-clock timeline

`createAudioTimeline` (from `@engine`, implemented in
[`src/platform/audio/audio-timeline.ts`](../../src/platform/audio/audio-timeline.ts))
keeps timed gameplay on the audio clock. It is optional and genre-neutral: use it
when a game's events, sounds or input grading must line up with what the player
hears. The [recipe](../recipes/sync-gameplay-to-music.md) shows a scene using it.

Status: implemented, candidate (PR #31); not integrated. Evidence is listed under
[Evidence](#evidence).

## Why the audio clock is the master

The frame loop runs on `requestAnimationFrame`, and frame times vary. Timers can be
late by tens of milliseconds. The audio context's clock is driven by the output
device, and sound started with `source.start(when)` plays on time even when the main
thread stalls. So the timeline treats context time as the truth. It maps frame and
input timestamps, which are page monotonic milliseconds (`performance.now()`,
`Event.timeStamp`), onto context time.

## Inputs, outputs and owner

| | |
|---|---|
| Inputs | `read()`: one clock sample, usually `() => ctx.audioClock()`. `now()`: the frame timestamp in ms, usually `() => ctx.time.now`. `dispatch(event)` and optional `dropped(event)` callbacks. Events from `schedule(at, payload, signal?)`. Input timestamps from `ctx.input.pressedAt(action)`. A calibration `{ inputMs, visualMs }`. |
| Outputs | `position` (frame-consistent heard position plus the measured display lag, never backwards within a run). `positionAt(ms)` and `inputPosition(ms)` (minus the input calibration). `contextTime(at)`. Dispatched events with `when`, the context time to pass to `ctx.playVoice(cue, { at: when })`. `stats`. |
| Owner | The caller, usually a scene: create it in `enter`, `dispose()` in `exit`. It holds no audio resources and creates no context, timer, worker or loop. The one platform audio output (`AudioOutput`, STD-SYS-16) still owns the only `AudioContext`. The timeline only reads it through `AudioOutput.clock()`, and sound still plays through the scene's owned voices. |

Additions to existing APIs:

- `AudioOutput.clock()` returns `{ currentTime, performanceTime, outputLatency,
  baseLatency, output }`, or null when no running context exists (silent, locked,
  hidden, disposed). It never creates or resumes the context. `output` holds
  `getOutputTimestamp()` when the browser reports a usable non-zero pair.
- `CueVoiceOptions.at` starts a cue voice at a context time. A past time starts it
  now. A time beyond `maxStartAhead` (default 10 s) is skipped and reported once. A
  scheduled voice holds its voice slot from the moment it is scheduled.
- `SceneContext.audioClock()` exposes that clock sample to a scene. `ctx.time.now`
  is the frame timestamp in ms.
- `InputState.pressedAt(action)` returns the first press of the action in the frame,
  using the event's own timestamp. Keyboard presses carry `Event.timeStamp`, pointer
  taps carry the pointer event's timestamp, and gamepads are stamped when they are
  polled.
- `testScene(scene, { audioClock: nowMs => reading })` injects a clock, and
  `press(action, atMs)` stamps a press.
- `FrameLoop.holdFrames(true)` (behind `engine.clock.hold()`) now starts its stepped
  clock at the loop's current time instead of 0, so held frames stay on the page
  timebase of press and audio timestamps.
- A scene's game-action press also asks the audio output to `unlock()`, so a
  keyboard-only player can start a timed run. Before, only a pointer press or the
  mute key unlocked it. Browsers may not count a gamepad press as a gesture, and then
  the call changes nothing. Global key listeners stay with input and the UI shell
  (lint `global-keydown`).

## How the mapping works

- **Clock offset.** Each `pump()` reads one sample and measures
  `currentTime - performanceTime / 1000`. That raw value jitters by a render
  quantum, which is 128 frames (2.7 ms at 48 kHz), and the two clocks drift by
  parts per million. So the offset is smoothed (`smoothing`, default 0.1 per
  sample).
- **Resync.** A change larger than `resyncThreshold` (default 50 ms) re-anchors at
  once and increments `stats.resyncs`. Suspend and resume or a device change cause
  such a change. The rule follows osu!'s interpolating clock, which snaps beyond
  its allowable error and otherwise converges.
- **Heard time.** What the listener hears lags rendering by the output latency.
  Where `getOutputTimestamp()` reports a usable pair, the latency is measured from
  it. Otherwise it is estimated as `baseLatency + outputLatency`, clamped to
  `maxLatency` (default 0.5 s). Browsers report these values unevenly, and wireless
  output adds latency they may not report. That is what the stored player
  calibration is for.
- **Positions.** `position` is computed once per pump and held for the rest of the
  frame. It never runs backwards within a run, so visuals do not judder under
  smoothing corrections. `positionAt` and `inputPosition` are exact, unclamped
  conversions of a timestamp.

## Scheduling, bounds and overload

Events are dispatched once, in time order (equal times in admission order), when
they come within `lookahead` (default 0.1 s) of the render clock. This is the
lookahead scheduler pattern of Chris Wilson's "A Tale of Two Clocks" and Tone.js,
pumped from the existing frame loop rather than a second timer. With a 0.1 s
lookahead, sound stays sample-accurate through frame stalls up to about that
length.

| Bound | Default | Range | Overload behaviour |
|---|---|---|---|
| `maxPending` | 512 | 1–16384 | `schedule` returns null; nothing is evicted |
| `maxDispatch` per pump | 64 | 1–4096 | Counts every resolved event, dispatched or dropped; the remainder waits for the next pump |
| `lateTolerance` | 0.03 s | 0–1 | A later event is dropped and reported to `dropped`, never played late |
| `lookahead` | 0.1 s | (0, 1] | |
| Calibration | 0 | ±500 ms each | Out-of-range values throw |
| Event time | | ±1e7 s, finite | A non-finite or out-of-range time throws |

Costs: `schedule` is O(log n) search plus an O(n) array insert. `pump` is
O(resolved + skipped cancelled records). Cancelled records are removed lazily;
the queue is compacted once they outnumber live ones, so it holds at most
2 × maxPending + 65 records (`stats.retained`). When nothing is due, a pump
allocates nothing itself; the clock sample `AudioOutput.clock()` returns is one
small object per call, and `stats` builds a frozen snapshot per read.

## Cancellation and recovery

- `cancel(id)`, an AbortSignal per event, `stop()` and `dispose()` release pending
  events without callbacks. `stop()` and `dispose()` are idempotent.
- After `dispose()`, `schedule` returns null, `pump()` returns 0 and `start()`
  throws.
- Handlers may schedule, cancel, stop or dispose during dispatch. A reentrant
  `pump()` does nothing. A handler that stops and restarts the run (looping a
  song: `stop(); start(); schedule(…)`) ends the current pump, because its render
  time belonged to the old run; the new run's events dispatch from the next pump.
  `start()` without a `stop()` still throws.
- A throwing handler does not stop its siblings. After the pump, a single error is
  rethrown, or an `AggregateError` when there are several.
- A suspended, hidden or locked context, or an unusable or throwing reading
  (`stats.stalled`), holds the position and dispatches nothing. The next usable
  sample re-anchors.
- If the audio clock paused too, the run resumes where the sound stopped. If the
  context clock leapt ahead, the events it skipped are dropped, not burst-played.
- A non-finite or negative `now()` throws. That is a caller bug, not a device
  condition.
- With no clock sample at `start()` (silent tests, benches, no audio yet), the run
  uses the page clock (`stats.source === 'performance'`) and `when` is null. Its
  steps are clamped to 0.25 s like the frame loop's, so a hidden tab never leaps
  ahead. `fallback: 'none'` makes `start()` return null instead.
- A run keeps its source until it is stopped and started again. It never switches
  clocks mid-run.

## Calibration

Both calibration values are **measured lags** with the same sign: positive means
that path is late by that many milliseconds, and the timeline compensates.
`inputMs` is subtracted from input positions; `visualMs` (the display lag) is added
to the frame position, so content is drawn that much ahead.

`estimateOffset(deltasMs, min = 8)` turns tap-along samples into an offset. Each
sample is the input position minus the target, in ms. Non-finite samples and
samples beyond ±1000 ms are discarded, never fatal. The function takes the median
and drops samples further than max(5 ms, 3 × MAD) from it. It returns null when
fewer than `min` samples survive. Input is bounded to 1024 samples, and the result
is clamped to ±500 ms.

Targets are usually the nearest beat. Once the true lag nears half a beat (for
example 200 ms of wireless output at 150 BPM), taps alias onto the wrong beat and
the estimate flips sign. Calibrate at a slow tempo, with a beat well over twice
the largest lag you expect (60 BPM covers lags up to about 400 ms).

A tap test measures input latency combined with audio latency. It cannot separate
the two, as the Rhythm Quest devlog notes. Store the result in a device-scoped save
section and assign `timeline.calibration`. StepMania's `GlobalOffsetSeconds` and
`VisualDelaySeconds` are the closest equivalents, but their sign conventions
differ; do not copy values across.

## Limitations

- **Music.** A song from a file plays on the context clock with `playMusic`
  ([music on the audio clock](music-on-clock.md), AU-02). The older `music(url)`
  path still streams through an `HTMLAudioElement` and is not on the context clock.
- **Outside replay determinism.** The SIM-01 replay kit logs which actions were
  pressed in each fixed tick, not when, and while it records or replays, fixed
  systems read the logged facts. So `pressedAt` is null in every recorded or
  replayed fixed tick, even with a live player. Timeline positions come from the
  audio and page clocks, which the log does not capture. Any world state derived
  from the timeline (a beat counter, a grade) is therefore outside SIM-01's
  determinism: a replay will not reproduce it. Timing-graded replays need a log
  format change, which is not in this slice.
- **Held test frames.** `engine.clock.hold()/step()` now continues from the loop's
  current time, so stepped `ctx.time.now`, `Event.timeStamp` presses and the audio
  clock share one timebase. Stepped frames advance by script, not by wall time, so
  a press timestamp can still be ahead of a held frame.
- **Custom input sources.** `ctx.input.pressedAt` is always present. A caller-built
  source (`testScene({ input })`, a replay pass-through) is an `InputSource`, where
  `pressedAt` is optional and reads null when absent.
- **Gamepads.** Presses are stamped when polled, so they are quantised to the
  frame (about 16.7 ms at 60 Hz).
- **Coarse timestamps.** Some browsers coarsen `Event.timeStamp` (1 ms in Firefox
  and Safari; 16.7 ms with Firefox `privacy.resistFingerprinting`). The timeline
  cannot recover that precision.
- **Latency estimates.** The output latency is only as good as what the browser
  reports. Bluetooth and some Android or iOS paths need player calibration.
- **Smoothing bias.** The smoothed offset carries a bias of up to half a render
  quantum.
- **Fallback runs.** A `performance` run that later gains audio plays cues at
  dispatch time, up to `lookahead` early, because it has no context time. Restart
  the run to move it onto the audio clock.
- **Press lanes.** Timestamps travel through the press latch (PR #19, STD-SIM-12):
  a fixed tick reports the earliest press it took, including one kept across
  zero-step frames, and a `phase: 'frame'` system the earliest press of its frame.
  The recipe pumps and grades in a frame system, so a press is graded in the frame
  it arrived.
- **What this is not.** The timeline does not judge timing, store charts or
  measure tempo maps. Those are game or kit policy.

## Evidence

Checked:

- Focused unit tests in
  [`audio-timeline.test.ts`](../../src/platform/audio/audio-timeline.test.ts),
  using a simulated device with 120 ppm drift, 128-frame quanta, a variable 7–50 ms
  frame time, and output latency with and without `getOutputTimestamp`. They cover:
  - heard-position error under 3 ms over about 100 s;
  - ordered single dispatch and the context time of each event;
  - input timestamps between frames, with calibration;
  - suspension and resume, a forward clock jump, and a stalled frame with
    `maxDispatch`;
  - admission, cancellation, abort, stop and dispose;
  - reentrant and throwing handlers;
  - the page-clock fallback and hidden-tab clamp;
  - unusable or throwing readings;
  - option validation and tap estimation, including discarded stray taps;
  - bounded retention under 50,000 schedule/cancel pairs around a far-future event;
  - a handler that stops and restarts the run, and drops counted toward `maxDispatch`.
- `loop.test.ts` covers held frames continuing from the loop clock.
- `audio-output.test.ts` covers `clock()` and scheduled starts with a fake context.
- [`scene-audio-timeline.test.ts`](../../src/author/scene-audio-timeline.test.ts)
  runs the recipe's shape through the author API with an injected clock, and
  silently on the fallback.

Not established:

- Real-browser audio output timing on any device, and the cross-browser accuracy
  of `getOutputTimestamp` or `outputLatency`.
- Bluetooth output, physical phones, tablets and laptops.
- Sustained thermal behaviour.
- Test browsers are muted and silent by policy, so no audible verification was
  performed.
