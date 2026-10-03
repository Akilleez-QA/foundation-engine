# Recipe: 3D sound for shooters

Players of a first-person or third-person shooter locate unseen opponents by sound:
left/right, front/back, above/below and distance. This recipe uses the platform's
spatial voice options ([guide](../guides/spatial-audio.md)) and, for many sources,
the optional [spatial-audio kit](../../src/kits/spatial-audio/README.md). It needs no
engine change.

## 1. Choose the creator settings

In `game/game.ts`:

```ts
export default defineGame({
  id: 'arena', title: 'Arena', version: '0.1.0', firstScene: 'match',
  audio: {
    // HRTF voices at once, per quality preset. These are starting points, not measured budgets.
    hrtf: { maxVoices: 8, ports: { medium: { maxVoices: 2 }, low: { maxVoices: 0 } } },
    smoothing: .03,          // ramp small per-frame moves (no zipper noise); cuts and 180° snaps still flip
    headphoneSetting: true,  // players get "Headphone 3D audio" (default on)
  },
});
```

Record the choice in GAME.md (a brief or milestone row). Phone speakers gain nothing
from HRTF; whether phones get it is the creator's call per preset.

## 2. Give each sound class a distance rule

Keep the numbers together so the same rule can later decide network audibility:

```ts
const SOUND = {
  step: { refDistance: 2, rolloffFactor: 1, cutoffDistance: 25, panning: 'HRTF' },
  shot: { refDistance: 6, rolloffFactor: 1, cutoffDistance: 140, panning: 'HRTF' },
  ambience: { refDistance: 4, distanceModel: 'linear', maxDistance: 40 },
} as const;
```

- `cutoffDistance` is the audible bound for every model. `maxDistance` only matters
  with `distanceModel: 'linear'`; the default `inverse` model never reaches silence.
- Use `panning: 'HRTF'` for localisation-critical classes (opponent steps, nearby
  shots, reloads). Requests beyond the limit play equal-power; they are never refused.

## 3. Play and move voices from a system

```ts
const voice = ctx.playVoice('enemy.step', { spatial: { ...SOUND.step, position: [x, y, z] }, filter: { cutoffHz: 16000 } });
// each frame the source moves:
voice?.setPosition?.([x, y, z]);
// when the creator's own rule says the path is blocked (a wall between listener and source):
voice?.setFilter?.({ cutoffHz: blocked ? 900 : 16000, gain: blocked ? .6 : 1 });
```

`null` means not played (muted, silent test browser, voice limit, or beyond the
cutoff). Scene exit stops the voices. Deciding *whether* a path is blocked is game
code here; the engine supplies only the smoothed filter.

## 3b. Or let the spatial-audio kit manage many sources

With many opponents, let the kit rank sources, keep the rest silent, cull beyond
earshot and query occlusion under a per-frame budget. Add `spatialAudio()` to
`defineGame({ kits })`, then in a scene:

```ts
import { createSpatialAudio } from '@kits/spatial-audio';

const sound = createSpatialAudio({
  output: ctx,
  classes: {
    step: { refDistance: 2, cutoffDistance: 25, localise: true, importance: 2, air: { nearHz: 16000, farHz: 3000 } },
    shot: { refDistance: 6, cutoffDistance: 140, localise: true, importance: 4 },
  },
  limits: { maxVoices: 24, maxHrtfVoices: 6, raysPerPump: 8 },
  occlusion: { query: (from, to) => level.firstHit(from, to) },   // the camera kit's obstruction shape
});
sound.emit({ cue: 'enemy.step', class: 'step', position: () => enemy.feet, every: .45, importance: () => threat(enemy) }, ctx.time.t);
// every frame, from an existing system:
sound.pump(ctx.time.t, ctx.camera.position);
```

- The classes replace the `SOUND` table above; `classGain(class, distance)` is the
  same rule as a pure function, for tests and host-side audibility. A host must measure
  distance from the same listener position the client's output uses (the camera, not
  the player character in third person).
- `importance()` is your threat rule (aiming at the player, recently fired, on
  screen). The kit only ranks; it does not decide what is a threat.
- `level.firstHit` is your geometry query; exclude the source's and the listener's own
  colliders from it. Keep `raysPerPump` small: queries rotate stalest first and old
  results expire to `unknown`. If `sound.stats.stale` stays above 0, the budget cannot
  refresh every playing voice within `maxAge`.
- Dispose the kit with the scene (`sound.dispose()`); `sound.stats` shows `voices`,
  `waiting`, `dropped`, `late`, `skipped`, `culled`, `stolen`, `rotated`, `rays`, `raysDeferred` and `stale`.
  Equal sounds take turns through free slots. For a shooter's short, frequent cues, opt in to
  `limits.rotateAfter` (0.25 to 1 s) so newer equal shots get turns against older voices; leave it
  off for ambience and loops. By default a sound that cannot start within `maxLateness` is dropped
  (`stats.dropped`), never played late; for long equal loops that should take turns, set
  `carryLate: true` on those sources (they may start up to one interval late, `stats.late`).
  Keep `raysPerPump` at 2 or more when sounds start every frame.

## 4. Check it

- `npm run check`. Then, with `npm run play` open, `engine.probe('audio')` in the
  browser console shows `active`, `hrtfActive`, `hrtfLimit`, `downgraded` and
  `culled` (`play:snap`'s `probe.json` does not include it). Test browsers are
  silent, so counts stay zero there; use a unit test with `distanceGain` or
  `audibleGain(spatial, [lx, ly, lz])` (the listener is a bare position) for your
  class rules.
- `npm run test:audio-browser` is the engine's offline-render evidence for the
  mechanism.
- Listening is manual: on headphones, have several people point to sources placed
  front, back, left, right, above and below, with the setting on and off. Record
  results as manual evidence; mark phones, tablets and Bluetooth latency unverified
  until tried.

## Not covered yet

Sound propagation around corners (paths through doorways), material transmission,
reverb and networked sound events are later work. Recorded sound files work with
these voice options: declare them as shown in
[play your own sounds](play-your-own-sounds.md) and pass the file's id to
`ctx.playVoice`. Do not send sound events a player could not hear: decide
audibility on the host with the same class rule (`classGain`) before disclosure.
