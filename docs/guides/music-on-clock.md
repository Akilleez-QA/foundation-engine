# Music on the audio clock

`ctx.playMusic(id, options)` plays a song from a file on the audio context's
clock. It is implemented in
[`src/platform/audio/music-clock.ts`](../../src/platform/audio/music-clock.ts) and
owned by the one audio output. Starts, stops, seeks and loop points land at exact
context times. A chart scheduled on the
[audio-clock timeline](audio-timeline.md) therefore lines up with the song. It is
optional and genre-neutral. The [recipe](../recipes/sync-gameplay-to-music.md)
shows a scene using it.

Status: implemented, candidate (PR #54); not integrated. Evidence is listed under
[Evidence](#evidence).

## Inputs, outputs and owner

| | |
|---|---|
| Inputs | A song id: a `defineAsset({ type: 'audio' })` row, resolved like sound files. `MusicOptions`: `at` (context seconds, default now plus a 20 ms start margin), `offset` (song seconds), `loop: { start, end? }`, `gain` [0, 1], `late: 'skip-ahead' \| 'drop'`, `onEnded`. |
| Outputs | A `MusicVoice` or null. The voice has `state` (`loading`, `scheduled`, `playing`, `ended`), `ready` (true once scheduled on the clock), `duration`, `songTime(contextTime)`, `seek(offset, at?)`, `stop(at?)` and `setGain`. `ctx.loadMusic(id)` fetches and decodes ahead. `AudioOutput.musicStats` and the `audio` probe's `music` report the counts. |
| Owner | `AudioOutput` owns the only context. It has a music bus that follows the `sound.music` volume and mute, and its own `sound-files.ts` store for music. A scene owns its voices, and leaving the scene stops them. `testScene` records `scene.music` and stays silent. |

The older `music(url)` path is unchanged. It still streams background music
through an `HTMLAudioElement`, which is not on the context clock. A game may use
either path, or both.

## How it works

- **Decoding.** The song is fetched once and decoded whole into an `AudioBuffer`
  by the music store. That store has the same fetch, estimate, admission and
  failure rules as sound files, with music-sized budgets and one decode at a time.
- **Playback.** An `AudioBufferSourceNode` plays the buffer with
  `start(at, offset)`. Loops use the node's native `loop`, `loopStart` and
  `loopEnd`, so they repeat sample-accurately.
- **`songTime(t)`.** It maps a context time to song seconds, through loops, seeks
  and a scheduled stop. Before the start it is negative (the lead-in). Start a
  song at `timeline.contextTime(0)` and, until a loop or seek, song seconds equal
  timeline seconds.
- **Seeks.** `seek(offset, at)` starts a new source at `at` and stops the old one
  at the same instant. `songTime` follows the old source until the hand-off. A
  seek while an earlier hand-off is still pending cuts that hand-off short.
- **Muting.** Muting or a zero music volume sets the music bus to 0. The song
  keeps playing silently, so the run stays in sync. A hidden tab suspends the
  context, so the song and the timeline pause together.

## Bounds and overload

| Bound | Default | Overload |
|---|---|---|
| Music voices at once (`maxMusicVoices`) | 2, range 1–16 | `playMusic` returns null; counted as skipped |
| Start horizon | The output's `maxStartAhead`, 10 s | null and reported once; a seek throws |
| File size | `musicBudgets(device).maxFileBytes`: phone 4 MiB, tablet 6, laptop/desktop 10 | Refused while streaming (running cap) |
| Encoded bytes kept | phone 8 MiB, tablet 12, laptop/desktop 20 | Least recently used first out |
| Decoded PCM bytes | phone 48 MiB (about 2 min 11 s of 48 kHz stereo), tablet 64, laptop/desktop 96 | Refused before decoding, on an estimate |
| Decodes at once | 1 | Further decodes wait in order |
| Files tracked | 16 | An idle entry, then the least recently used held file, is dropped |

The app passes `musicBudgets(brief.devices.minimum)`. A creator may pass their own
bounds through `audioModule(…, { musicFiles })`.

The decoded size is estimated before decoding:

- **PCM WAV** is estimated exactly from its header.
- **Other formats** are estimated as 48 × the file size, which matches 64 kbps
  stereo. A 128 kbps file is over-estimated by about 2×, so it is refused
  conservatively; raise `compressedRatio` deliberately if needed.
- **After decoding** the real size is checked again.

A playing voice keeps its own buffer reference. Peak decoded music memory is
therefore at most (1 + maxMusicVoices) × the decoded budget.

## Lateness, cancellation and recovery

- **Late decode.** If the decode finishes after `at`, the song starts at once
  where it should be (`late: 'skip-ahead'`, the default), so `songTime` and the
  chart stay in sync. With `late: 'drop'` the voice ends instead and is counted as
  dropped. `loadMusic` before starting avoids both.
- **Stopping.** `stop(at)` stops at a context time, and `songTime` freezes there.
  `stop()` ends at once. Both are idempotent.
- **Scene exit and disposal.** Leaving the scene and the output's `dispose()`
  stop every voice.
- **Failures.** A failed fetch or decode is reported once and remembered; that
  voice ends with `ready` false. `loadMusic` forgets the failure and tries again.
- **Bad positions.** An offset or loop point outside the decoded song ends the
  voice and is reported. Invalid options throw.
- **Silent, locked or hidden output.** `playMusic` returns null, and `loadMusic`
  is false when no context has ever existed. Test browsers stay silent: the
  `dev.silent` and automation rules create no context.

## Limitations

- **Whole-song decode.** There is no segmented streaming, so a song longer than
  the decoded budget is refused. A phone budget holds about two minutes of 48 kHz
  stereo. Gapless playback of segmented songs is not implemented.
- **Seamless loop points.** These need sample-exact audio. Compressed formats add
  encoder padding (MP3 especially), so use WAV, or check the loop by ear.
- **Playback rate.** Only rate 1 is supported, so tempo changes and time stretching
  are not available.
- **No crossfades.** `setGain` writes the gain instantly.
- **Replay.** Song position, like the timeline, is outside SIM-01 replay
  determinism.
- **Not verified here.** Real-browser timing, device decode cost, memory pressure
  on phones, and anything audible.

## Evidence

- [`music-clock.test.ts`](../../src/platform/audio/music-clock.test.ts) runs
  against a fake context and store. It covers:
  - exact start and offset, and the lead-in;
  - native loop points and the `songTime` wrap;
  - skip-ahead and drop for a late decode;
  - a sample-accurate seek hand-off;
  - a scheduled stop and an immediate stop;
  - the voice limit, the start horizon, invalid options and out-of-range offsets
    or loops;
  - silent, locked, unknown, broken and failed songs;
  - `load`;
  - a chart on an audio timeline equal to song seconds over 300 frames;
  - the output's music bus following volume and mute, and dispose.
- Mutation spot checks: removing the skip-ahead, the seek's stop of the old
  source, or the stop freeze each fails a test.
- `scene-audio.test.ts` covers scene ownership and `testScene` recording.
