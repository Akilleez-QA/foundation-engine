# Recipe: play your own sound files

`ctx.play` plays the built-in interface cues (`'ui.click'`, `'ui.success'`, …) and, with this recipe, your game's own
recordings, with a volume, a pitch and an optional position in the world.

```ts
// game/door.asset.ts: the file, under public/, with its provenance (mp3, m4a, ogg or wav)
import { defineAsset } from '@engine';
export default defineAsset({ id: 'door-open', type: 'audio', url: '/sounds/door-open.ogg',
  licence: 'CC0-1.0', author: 'You', source: 'recorded for this game' });
```

```ts
// the scene that plays it lists it, so it is fetched while the scene loads
export default defineScene({ id: 'hall', title: 'Hall', sounds: ['door-open'], systems: [doors], /* … */ });

// in a system
ctx.play('door-open');                                          // flat, full volume
ctx.play('door-open', { volume: .6, pitch: 1.2 });              // quieter, a little higher (and shorter)
ctx.play('door-open', { position: [tr.x, tr.y, tr.z] });         // from the door: pans and fades with the camera
const voice = ctx.playVoice('door-open', { gain: .5, rate: .8 }); // a handle you can stop; ends with the scene
```

| Option | Range | Meaning |
|---|---|---|
| `volume` | 0…1 (default 1) | Multiplied by the player's effects volume. |
| `pitch` | 0.25…4 (default 1) | Playback rate: 2 is an octave up and twice as fast. |
| `position` | `[x, y, z]` | World position; the listener is the scene camera. Distance model: inverse, reference 1 m, max 100 m. |

Bad options throw (in `testScene` too), naming the field. In tests, `t.plays` lists every play with its options.

## What the engine does

- **Owner:** the one audio output (`platform.audio`, `platform/audio/audio-output.ts`); the files are kept by
  `platform/audio/sound-files.ts`. Sounds use the same voices, master gain, mute key, effects volume, hidden-tab
  suspension and listener as the cues. The URL is resolved under the build's public base, so hosting in a folder works.
- **Loading:** a scene's `sounds` are fetched while it loads (never blocking it). The first play decodes the file on
  the audio context; a `ctx.play` may start up to 250 ms late while that happens, and is dropped (counted as skipped)
  if the file is still not ready. A sound not listed in `sounds` is fetched on its first play.
- **Autoplay and silence:** browsers allow audio only after the player's first tap, click or key; until then plays are
  dropped. Muted, an effects volume of 0, a hidden tab and every test or automated browser (`?flags=dev.silent`,
  `navigator.webdriver`) play nothing and create no audio context; a scene's `sounds` may still be fetched.
- **Bounds:** a file up to 4 MiB; 16 MiB of encoded files and 32 MiB of decoded sound kept (least recently used
  dropped first, re-decoded from the kept file when needed); 4 fetches at once, the rest queued; 256 files; 10 s per
  load; 64 voices at once, including plays waiting for their file. Past a bound a play is skipped, never queued
  without limit.
- **Failure and recovery:** a missing, oversized or undecodable file (including a host's HTML "not found" page) is
  reported once in the console; plays of it are skipped without asking the network again until a scene that lists
  it in `sounds` is entered again. Leaving a scene stops its voices, including ones still waiting for their file.
- **Kid-safe games:** the same rules apply (K10: audio is gentle and optional). The engine does not measure loudness:
  keep recordings quiet and short, and check them by ear.

## Limits

- No streaming (load whole, short files; music has its own channel), no looping, no effects (reverb, filters), no
  HRTF or occlusion: positional sound is equal-power panning with distance fade.
- Audible playback cannot be checked automatically (test browsers are silent by policy): `npm run test:sound-browser`
  checks loading, reporting and silence; the decode and voice logic is unit-tested with a stand-in audio context.
  Listen on each supported device.
