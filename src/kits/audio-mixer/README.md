# Audio mixer

Optional `audioMixer()` kit, `createCueMixer()` scheduler and `createDucking()` gain policy. No systems are installed automatically. The mixer borrows the existing platform `AudioOutput`; it adds no audio context, frame loop or audio element.

`createCueMixer({ output: ctx, maxLogical: 8, maxAudible: 3 })` works directly in a game scene through `ctx.playVoice`; scene exit stops its voice handles. `testScene` records requested cues and stays silent.

`createCueMixer({ output, maxLogical, maxAudible })` admits bounded pending events. Call `request({ cue, priority, expiresAt }, now)` and `pump(now)` from the existing scene update or event boundary; timestamps are monotonic seconds. Null admission means full, expired or disposed. Higher priority starts first; ties are FIFO. Waiting events expire; failed output playback (silent, muted, locked or unknown cue) is dropped. `cancel(id)` removes a pending event or stops its playing voice.

The logical cap bounds pending plus playing records. The audible cap independently bounds voices dispatched **through this mixer**. A real `AudioBufferSourceNode.onended` notification retires a slot, so suspended audio does not falsely free slots based on wall time. Other callers of the shared output are outside this bound. Disposal stops only this mixer's voices and rejects new work; it never closes the borrowed output. The caller owns shared mute, hidden and unlock lifecycle.

Admission remains held while a borrowed output starts a voice. Reentrant pumping
does no additional dispatch; cancellation or disposal during playback retires the
returned voice instead of publishing it. A throwing playback call releases its
request and preserves the error. Disposal attempts every owned voice and duck
cleanup before reporting collected failures as an `AggregateError`.

`mixer.duck(factor, signal?)` returns an idempotent release. The strongest active owner wins. Gain affects both already playing and future mixer voices through their actual gain nodes, multiplied by the user's effects-volume master gain. It does not overwrite user settings or affect unrelated output callers or the music element. Abort releases its owner's request; disposal cleans up all requests. `createDucking(onChange)` exposes the same pure gain policy for other adapters.

Platform `AudioOutput.playVoice(id, { variant?, gain?, onEnded? })` returns a `CueVoice` with `ended`, `setGain()` and `stop()`, or null when skipped. Existing `play()` remains compatible. Natural completion and explicit stop both clean up connected nodes and notify once.

Costs: O(maxLogical log maxLogical) per pump, O(maxLogical) retained records; O(active duck leases) gain recomputation, one gain node per playing cue. No draws or triangles. No spatial attenuation, room occlusion, streaming music, fades or new audio backend is claimed. The platform output now has spatial voices (panning and distance models, cutoff, HRTF limit, filter stage; see docs/guides/spatial-audio.md), but `CueRequest` cannot carry `spatial` or `filter` yet, so mixer voices remain 2D.

## Listener placement, Doppler, retrigger pitch and instance limits

These are optional helpers (`extras.ts`). Each is pure or caller-owned.

- **`blendListener({camera, character, blend, up?})`** returns a listener pose. Its position is blended from the
  camera (`blend` 0) to the character (1); its orientation comes from the camera, so left and right match what the
  player sees. Assign the pose to `ctx.view.listener`, the optional author field the runtime now sends to the audio
  output in place of the camera position. Pass the same position to spatial-audio `pump` so that audibility and
  panning agree. A camera looking straight down still gets a valid frame.
- **`dopplerRate({source, sourceVelocity, listener, listenerVelocity?, speedOfSound?, factor?, min?, max?})`** returns
  `(c + v_l·n) / (c − v_s·n)`.
  - Speeds along the line between source and listener are clamped below `c`.
  - The result is clamped to `[min, max]`, which defaults to 0.5–2 and lies within the platform rate limits.
  - `factor` scales the effect.
  - Apply it with the new platform `voice.setRate(rate, timeConstant?)`, which ramps `playbackRate` with
    `setTargetAtTime`.
- **`createRetrigger({window, semitones, maxSteps, maxKeys?})`** handles pickup and combo pitch escalation. Each
  trigger of a key within `window` seconds of the previous one raises the pitch by `semitones`, up to `maxSteps`
  (at most two octaves in total). A longer gap resets the key. Keys are bounded, and the oldest is forgotten first.
- **`createInstanceLimits({limits, defaultLimit, policy, maxKeys?})`** sets per-sound voice caps.
  - `admit(key)` with policy `oldest` stops that key's oldest live voice to make room. With `refuse`, it declines.
  - `track(key, voice)` records the started voice. An ended voice frees its slot.
  - This is independent of the mixer's global `maxAudible`.

## Adaptive music on a quantized clock

`createMusicClock({bpm, beatsPerBar?, barsPerPhrase?, origin})` is a musical clock in one timebase of your choice:
audio-context seconds or a song's `songTime`. It provides:

- `beatAt(time)` and `timeOfBeat(beat)`;
- `next(time, 'beat' | 'bar' | 'phrase', strict?)`, which returns the next boundary. A boundary within 1e-9 beats of
  the given time counts as that time, so accumulated rounding never skips a bar;
- `position(time)`, which returns the bar, beat and phrase.

`createMusicDirector({clock, stems, states, initial, quantum?, fadeBeats?, hysteresis?})` layers stems by state:

- **States.** Each state names the stems it plays and their gains; stems not listed are silent.
- **Requests.** `request(state, now)` schedules a change for the next boundary (strictly after `now`), at the
  default `quantum` or one given per call. A newer request replaces a pending one. Requesting the current state
  cancels the pending change.
- **Intensity.** `setIntensity(x, now)` picks the state with the highest `minIntensity` not above `x`. A state is
  left downward only once `x` falls below its own `minIntensity` minus `hysteresis`.
- **Pumping.** `pump(now)` starts a pending change once its boundary has passed. It then returns the stem gains to
  apply now, faded linearly over `fadeBeats` from the gains heard at the boundary, together with the `started` and
  `settled` changes.

Start all stems together with one shared start time, for example `ctx.playMusic(stem, {at, loop})`. Then apply the
gains with `voice.setGain(g)` from a frame system.

The director has no voices, clock or timer of its own. It does not crossfade between different songs or beat-match
tempo changes, and it does not schedule gain changes ahead on the audio clock. Gains change when you pump, so pump
every frame.

Evidence: `extras.test.ts` covers listener blending and its degenerate frames, Doppler values and clamps, retrigger
escalation and its bounds, instance caps under both policies, clock boundaries (with no skipped beats after 1,000
accumulated additions), and the director's bar quantisation, fades, phrase quantum, cancellation and intensity
hysteresis. It also runs a `testScene` composition with `ctx.view.listener` and pickups. The platform `setRate` ramp
and validation are tested in `src/platform/audio/spatial.test.ts`. The runtime's use of `view.listener` is
exercised by typecheck and code review only; there is no browser or device listening evidence.
