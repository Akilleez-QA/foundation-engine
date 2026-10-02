# Spatial audio: panning, distance, cutoff, HRTF limit, filter and smoothing

The platform audio output (`src/platform/audio/audio-output.ts`, STD-SYS-16) plays
spatial voices through one `PannerNode` each. This guide covers the per-voice
spatial options, the HRTF voice limit, the optional filter stage, smoothed updates,
and the creator and player controls. Every option is optional: a game that passes
none sounds as it did before (equal-power, inverse distance, instant updates).

Status: implemented, candidate (public PR #28, branch `feat/audio-spatial-hrtf`); not
integrated. See [Evidence](#evidence) for what is and is not established.

## Owner and lifecycle

- **Owner:** the one `AudioOutput` (`platform.audio` module). It owns the context,
  every node, the HRTF slots and the cutoff checks. Nothing here adds a context,
  timer, frame loop or audio element.
- **Scene use:** `ctx.playVoice(cue, options)` returns a `CueVoice` owned by the
  scene; scene exit stops it (`src/author/scene-audio.ts`). The listener follows the
  camera through the runtime's existing `syncListener`.
- **Release:** natural end, `stop()`, scene exit and `dispose()` all run the same
  `finish()`: the voice's nodes are disconnected and its HRTF slot and cutoff check
  are released exactly once.

## Inputs

`playVoice(id, { spatial, filter, gain, variant, onEnded })`:

| Field | Range / default | Meaning |
|---|---|---|
| `spatial.position` | finite `[x, y, z]` | World position (the listener's frame is the camera's) |
| `spatial.panning` | `'equalpower'` (default) \| `'HRTF'` | Panner algorithm, granted subject to the HRTF limit |
| `spatial.distanceModel` | `'inverse'` (default) \| `'linear'` \| `'exponential'` | Distance law (Web Audio spec formulas) |
| `spatial.refDistance` | (0, 1e6], default 1 | Distance where attenuation starts |
| `spatial.maxDistance` | [refDistance, 1e6], default 100 | Read **only** by `'linear'` |
| `spatial.rolloffFactor` | [0, 100], default 1 | `'linear'` clamps it to [0, 1] (spec) |
| `spatial.cutoffDistance` | [refDistance, 1e6], default none | Audible cutoff for any model |
| `spatial.smoothing` | [0, 1] s, default the output's | Time constant for `setPosition` ramps |
| `filter` | `{ cutoffHz: [10, 24000], gain?: [0, 1] }` | Adds the low-pass + gain stage at these values |

Invalid values throw before any node is allocated. The handle adds
`voice.panning` (the model in effect) and `voice.setFilter(filter, timeConstant?)`.
Positions may be arrays or typed arrays of three finite numbers; the output copies them.

Validation is tighter than before: `refDistance`, `maxDistance` and `cutoffDistance`
are capped at 1e6 and `rolloffFactor` at 100 (previously only finite, non-negative and
`maxDistance >= refDistance` were checked). A game passing larger values now gets an
`invalid spatial cue` error.

### Distance models and `maxDistance`

The gain formulas are the Web Audio spec's; `distanceGain(model, d, spatial)` and
`audibleGain(spatial, listener)` (exported from `@engine`) compute them in pure
code for tools, tests and future host-side audibility rules.

- `inverse`: `ref / (ref + f·(max(d, ref) − ref))`. Never reaches 0; ignores `maxDistance`.
- `exponential`: `(max(d, ref) / ref)^−f`. Never reaches 0; ignores `maxDistance`.
- `linear`: `1 − f·(clamp(d, ref, max) − ref) / (max − ref)` with `f` clamped to [0, 1].
  Reaches `1 − f` at `maxDistance` and stays there.

Before this change the output always used `inverse`, so a caller's `maxDistance`
had no effect: the mechanics template's probe cue (`refDistance: 4, rolloffFactor:
.5, maxDistance: 60`) still played at 12.5% gain at 60 m and never fell silent.

### Audible cutoff

`cutoffDistance` is an explicit, model-independent bound:

- A start whose source is farther than `cutoffDistance` from the listener is refused:
  `playVoice` returns null and `stats.culled` counts it (not `stats.skipped`).
- A playing voice whose source or listener moves beyond the cutoff fades to silence
  through a gain stage (`setTargetAtTime`, time constant 10 ms: silent within ~50 ms),
  and fades back when it returns within range. It is not stopped, so a moving
  source can come back.
- At exactly the cutoff the model's gain still applies. Distances use the latest
  requested positions (targets), not the ramped values.

The mechanics template now passes `cutoffDistance: 60` instead of `maxDistance: 60`;
gain within 60 m is unchanged.

## HRTF voice limit (overload)

`'HRTF'` panning gives front/back and elevation cues that `'equalpower'` cannot
(equal-power folds the azimuth and ignores elevation). It is also the most expensive
Web Audio node, so it has its own bound:

- `maxHrtfVoices` (output option; default `min(8, maxVoices)`; 0 disables HRTF).
- A request beyond the limit plays with `'equalpower'` and counts in
  `stats.downgraded`. HRTF never refuses playback; the output-wide `maxVoices` is
  still the only refusal bound for voice count.
- When the limit is full, a new HRTF request first reclaims the slot of a voice that
  its cutoff has kept silent for at least 50 ms (five fade time constants). That voice
  switches to `'equalpower'` while inaudible, counts in `stats.downgraded`, and stays
  equal-power if it returns in range. A voice silenced by its cutoff otherwise keeps
  its slot (and its HRTF processing cost) until it ends or is reclaimed.
- `setHrtfLimit(n)` changes it live. Lowering it moves the newest HRTF voices beyond
  the new limit to `'equalpower'` (also counted); raising it affects later starts only.
  Changing a live panner's model may produce an audible discontinuity on that voice.
- `stats` (and the `audio` probe) report `active`, `hrtfActive`, `hrtfLimit`,
  `downgraded` and `culled`.

Choose HRTF per sound: localisation-critical sounds (footsteps, nearby shots,
reloads) benefit most; ambience and interface cues do not need it.

## Filter stage (muffle)

`filter` adds `BiquadFilter(lowpass)` and a gain node between the voice level and
the panner, for occlusion, air absorption or effects. It exists only on voices that
ask for it. `voice.setFilter({ cutoffHz, gain }, timeConstant = 0.03)` ramps both
values with `setTargetAtTime` (~95% after three time constants). The time constant
is bounded to [0.005, 2] s; there is no instant path, so updates do not click or
zipper. Arguments are always validated. On an ended voice `setFilter` does nothing;
on a playing voice started without the stage it throws. The engine does not decide *when* a sound is occluded: that is a
caller (or a later kit) decision.

## Smoothed position and listener updates

`smoothing` (output option, default 0) and `spatial.smoothing` (per voice) set a
time constant in seconds. With a positive value, each listener or `setPosition`
update cancels later automation on the parameters that changed and ramps them with
`setTargetAtTime` from the current value. The first write on a context or voice is
instant (no sweep from the origin). Cost per update is constant: one cancel and one
ramp per changed parameter (at most 3 for a position, 9 for the listener); unchanged
parameters are not written. The runtime updates the listener only when the camera
changes.

Smoothing is for small per-update moves (a source or camera moving a little each
frame). It does not hide discontinuities: a camera cut, a 180-degree snap or a path
through the listener still flips the image, only spread over the ramp.

Browsers without listener `AudioParam`s (Firefox) and panners without position
`AudioParam`s use the instant `setPosition`/`setOrientation` fallback: no ramps there.
With `'HRTF'` the spec samples panner and listener parameters once per 128-frame
render quantum (~2.7 ms at 48 kHz).

## Creator and player controls

Creators choose through `defineGame({ audio })`:

```ts
defineGame({
  id: 'arena', title: 'Arena', version: '0.1.0', firstScene: 'match',
  audio: {
    hrtf: { maxVoices: 8, ports: { medium: { maxVoices: 2 }, low: { maxVoices: 0 } } },
    smoothing: .03,
    headphoneSetting: true,
  },
});
```

- `hrtf` is a `Ported<{ maxVoices }>`: the flat value is the reference preset; `ports`
  override lighter quality presets, falling back like budgets (`budgetFor`): low →
  medium → high → reference, so `ports: { medium: { maxVoices: 2 } }` also gives low 2. The limit follows `quality.setPreset` live.
  These numbers are creator choices; no per-device audio cost has been measured.
- `smoothing` sets the output's default time constant.
- `headphoneSetting: true` registers the `sound.headphone-3d` setting (device scope,
  default on, label "Headphone 3D audio"), so the settings panel shows it. While it is
  off the effective HRTF limit is 0. Without it, no setting exists and the preset
  value applies. Headphone use cannot be detected reliably on the web, so the choice
  is the player's.

Without `audio`, the HRTF limit is 8 and smoothing is 0. Because voices default to
`'equalpower'`, the limit matters only for voices that ask for `'HRTF'`.

## Cancellation and recovery

- `stop()`, natural end, scene exit and `dispose()` release nodes and slots once;
  a throwing `onEnded` is reported and does not strand other voices (unchanged).
- Silent mode (`dev.silent`, automation) still creates no context; spatial options are
  validated but nothing plays.
- A hidden tab suspends the context as before; voices keep their state and
  automation resumes with the context clock.
- No retries: a refused start (limit, cutoff, locked context) is reported through
  `null` and the counters, never queued.

## Limitations

- **Generic HRTF.** Browsers ship one non-individual HRTF set (Chromium and Firefox
  share a composite IRCAM set; Safari uses its own). Front/back and up/down confusions
  persist for some listeners, and players adapt over time. No human listening test
  has been run.
- **No cost measurement.** CPU, battery and thermal cost of HRTF voices on phones,
  tablets and laptops are unmeasured; the default limit of 8 is a starting point, not
  a budget. Bench and test browsers are silent and cannot measure audio cost.
- **iOS silent switch.** iOS routes Web Audio to the ambient session, which the silent
  switch mutes on the speaker. This change does not alter that; opting into a playback
  session is a separate creator decision.
- **Not included:** occlusion raycasts, sound propagation, reverb, Doppler, cones,
  priority or virtual voices, networked sound, sampled-sound decoding. The audio mixer
  kit's `CueRequest` still cannot carry `spatial`.
- Firefox listener updates are not ramped. Safari HRTF quality and behaviour while
  parameters change are unverified.
- The cutoff uses straight-line distance from the listener; it does not know about
  geometry.
- Chromium loads its HRTF data on the first HRTF panner; a real-time context may output
  silence from that voice until the data is loaded. The output does not pre-load it
  (that would cost memory for games that never use HRTF). The offline harness renders
  HRTF signal after loading but does not measure this delay.

## Evidence

| Kind | What | Proves |
|---|---|---|
| Node unit tests | `src/platform/audio/spatial.test.ts` (fake context) | Defaults unchanged; model selection and validation bounds; HRTF limit, fallback, live lowering and slot release; cutoff refusal and gate fade/restore for every model; filter creation, ramps, bounds; smoothing wiring and Firefox fallback; `distanceGain` against the spec formulas |
| Node boot test | `src/platform/audio/module.test.ts` | The headphone setting and quality preset drive the effective HRTF limit live |
| Preset fallback | `spatial.test.ts` | HRTF limits follow the engine's `budgetFor` order: a preset without its own port uses the next heavier port (low → medium → high → reference) |
| Muted browser, offline render | `npm run test:audio-browser` (`scripts/play/spatial-audio-check.mjs`) | With the real output rendering into `OfflineAudioContext` in the muted test browser: panning model on the real nodes; equal-power renders front = back and level = above, HRTF renders them differently, and the limit's fallback renders as equal-power; measured distance gain within 1% of the formula for all three models; silence beyond the cutoff and return at the model's gain; filter frequency after the ramp, >30 dB attenuation, no 128-frame step of 4 dB or more; on an off-axis pass in front of the listener (z = -3, x +5 to -5) an instant move changes the stereo balance by >15 dB in one block, a smoothed one (0.02 s) by <4 dB per block |
| Not established | — | Perceived localisation (needs headphone trials with listeners), Firefox/WebKit rendering, any device's CPU, battery or latency, iOS behaviour, real-time HRTF load delay |

`OfflineAudioContext` renders into memory and never reaches an audio device, so it
is compatible with STD-TST-8; the harness still runs in the muted, isolated browser
and creates no real-time context. This evidence proves configuration and rendered
signal behaviour in one Chromium build, not that players localise sounds correctly.
