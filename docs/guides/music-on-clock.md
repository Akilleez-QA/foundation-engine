# Music on the audio clock

`ctx.playMusic(id, options)` plays a song from a file on the audio context's
clock. It is implemented in
[`src/platform/audio/music-clock.ts`](../../src/platform/audio/music-clock.ts) and
owned by the one audio output. Starts, stops, seeks and loop points land at exact
context times. A chart scheduled on the
[audio-clock timeline](audio-timeline.md) therefore lines up with the song. It is
optional and genre-neutral. The [recipe](../recipes/sync-gameplay-to-music.md)
shows a scene using it.

Status (2026-10-03): integrated through batch PR #64 (`main` `3b449fa`; PR #54 merge `0aa5caf`);
earlier an implemented candidate. Evidence is listed under
[Evidence](#evidence).

## Inputs, outputs and owner

| | |
|---|---|
| Inputs | A song id: a `defineAsset({ type: 'audio' })` row, resolved like sound files. `MusicOptions`: `at` (context seconds, default now plus `MUSIC_START_MARGIN`, 20 ms; an earlier time counts as late), `offset` (song seconds), `loop: { start, end? }`, `gain` [0, 1], `late: 'skip-ahead' \| 'drop'`, `onEnded`. |
| Outputs | A `MusicVoice` or null. The voice has `state` (`loading`, `scheduled`, `playing`, `ended`), `ready` (true once scheduled on the clock), `duration`, `songTime(contextTime)`, `seek(offset, at?)`, `stop(at?)` and `setGain`. `ctx.loadMusic(id)` fetches and decodes ahead. `AudioOutput.musicStats` and the `audio` probe's `music` report the counts: `active` (voices held: loading, scheduled or playing), `played`, `skipped`, `dropped` and the store's file stats. |
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
  and a scheduled stop. Before the start it is the start offset minus the
  remaining lead-in, so it is negative for a song started from 0. After the voice
  ends it stays frozen where it ended. Start a song at `timeline.contextTime(0)`
  and, until a loop or seek, song seconds equal timeline seconds.
- **Seeks.** `seek(offset, at)` starts a new source at `at` and stops the
  audible one at the same instant. `songTime` follows the audible source until
  the hand-off. A second seek before the first hand-off replaces that hand-off:
  the audible source keeps playing and now hands over at the new time.
- **Seeks and stops together.** A seek cannot pass a scheduled stop (it throws),
  and a seek before the stop carries the stop to the new source. `stop(at)` that
  lands before a pending start or hand-off releases that never-played source at
  once (the voice does not wait for an `ended` event browsers may not fire for it);
  the audible source stops at `at`, and `songTime` freezes on what was heard.
- **Between a seek and its hand-off** the voice is `playing`, even if the old
  source has already run out (a hand-off after the song's end). `songTime` then
  holds at the song end until the hand-off.
- **Muting.** Muting or a zero music volume sets the music bus to 0. The song
  keeps playing silently, so the run stays in sync. A hidden tab suspends the
  context, so the song and the timeline pause together. A song that finishes
  decoding while the tab is hidden is scheduled on the suspended (frozen) clock
  and plays when the tab returns; only a disposed or silenced output drops it.

## Bounds and overload

| Bound | Default | Overload |
|---|---|---|
| Music voices at once (`maxMusicVoices`) | 2, range 1–16 | `playMusic` returns null; counted as skipped |
| Start horizon | The output's `maxStartAhead`, 10 s | null and reported once; a seek throws |
| File size | `musicBudgets(device).maxFileBytes` = decoded budget ÷ 24: phone 2 MiB, tablet 3, laptop/desktop 4 | Refused while streaming (running cap) |
| Encoded bytes kept | Twice the file budget: phone 4 MiB, tablet 6, laptop/desktop 8 | Least recently used first out |
| Decoded PCM bytes | Phone 48 MiB, tablet 72, laptop/desktop 96 | Refused before decoding, on an estimate |
| Fetch or decode time | `musicTimeoutMs(maxFileBytes)`: 10 s, or 1 s per 128 KiB if longer (phone 16 s, tablet 24, laptop/desktop 32) | The load fails and is reported once |
| Decodes at once | 1 | Further decodes wait in order |
| Files tracked | 16 | An idle entry, then the least recently used held file, is dropped |

The app passes `musicBudgets(brief.devices.minimum)`. A creator may pass their own
bounds through `audioModule(…, { musicFiles })`.

The decoded size is estimated before decoding:

- **PCM WAV** is estimated exactly from its header.
- **Other formats** are estimated as `compressedRatio` × the file size. Music
  uses 24 (`MUSIC_COMPRESSED_RATIO`), which matches 128 kbps stereo decoded to
  float32 at 48 kHz. The ratio is decoded bytes per encoded byte, so a
  lower-bitrate file decodes to more than its estimate: 64 kbps decodes to twice
  as much. For such files set `compressedRatio` higher (48 for 64 kbps). With the
  default, a 64 kbps file can briefly allocate up to twice its estimate before the
  after-decode check refuses it.
- **After decoding** the real size is checked again.

Because the file budget is the decoded budget ÷ 24, a 128 kbps song that
downloads in full also fits when decoded. Real limits per format (48 kHz stereo):

| Minimum device | Compressed, 128 kbps | Compressed, 64 kbps | 16-bit WAV |
|---|---|---|---|
| Phone | about 2 min 11 s | about 2 min 11 s (decoded budget; file 2 MiB holds 4 min 22 s) | about 11 s (file budget) |
| Tablet | about 3 min 16 s | about 3 min 16 s | about 16 s |
| Laptop, desktop | about 4 min 22 s | about 4 min 22 s | about 22 s |

A context running at 44.1 kHz decodes about 8% smaller, so songs can be
correspondingly longer.

A playing voice keeps its own buffer reference. Peak decoded music memory is
therefore at most (1 + maxMusicVoices) × the decoded budget.

## Lateness, cancellation and recovery

- **Late decode.** If the decode finishes after `at`, the song starts at once
  where it should be (`late: 'skip-ahead'`, the default), so `songTime` and the
  chart stay in sync. With `late: 'drop'` the voice ends instead and is counted as
  dropped. `loadMusic` before starting avoids both.
- **Stopping.** `stop(at)` stops at a context time, and `songTime` freezes there.
  `stop()` ends at once. Both are idempotent. A future `stop(at)` asked for while
  the song is still loading applies once it is scheduled; a stop at or before the
  start means nothing plays.
- **Start margin.** An `at` earlier than `currentTime + MUSIC_START_MARGIN`
  counts as late: with `late: 'drop'` an `at` of exactly `currentTime` is
  dropped, and with skip-ahead the song starts 20 ms in.
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
  the decoded budget is refused (see the per-format table above). Gapless
  playback of segmented songs is not implemented.
- **Two stores.** Music has its own store, separate from sound files, so an id
  played both as a sound and as music is fetched and decoded twice.
- **Memory after the end.** An ended voice releases its buffer reference; the
  music store keeps its decoded copy within its budget for the next play.
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
