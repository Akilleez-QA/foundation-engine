# Spatial audio

Optional `spatialAudio()` kit and `createSpatialAudio()` source manager for games where players locate sounds: opponents' steps, shots, engines. It borrows the platform output (`ctx.playVoice`, [spatial voice guide](../../../docs/guides/spatial-audio.md)) and adds no audio context, timer, frame loop, system or save data. Recipe: [3D sound for shooters](../../../docs/recipes/3d-sound-for-shooters.md).

Creator requirement it serves: "the sounds that matter stay audible and locatable in a busy scene, sounds beyond earshot never play, and a wall between player and source muffles it", within explicit per-frame bounds.

## Use

```ts
import { createSpatialAudio, segmentQueryFromRaycast } from '@kits/spatial-audio';

const sound = createSpatialAudio({
  output: ctx,                                        // ctx.playVoice: scene exit stops the voices
  classes: {
    step: { refDistance: 2, cutoffDistance: 25, localise: true, importance: 2, air: { nearHz: 16000, farHz: 3000 } },
    shot: { refDistance: 6, cutoffDistance: 140, localise: true, importance: 4 },
  },
  limits: { maxSources: 128, maxVoices: 24, maxHrtfVoices: 6, raysPerPump: 8, maxLateness: .15 },
  occlusion: { query: (from, to) => level.firstHit(from, to), blocked: { cutoffHz: 1000, gain: .5 }, maxAge: .5 },
});
const id = sound.emit({ cue: 'enemy.step', class: 'step', position: () => enemy.feet, every: .45, importance: () => threat(enemy) }, ctx.time.t);
// once per frame, in an existing system:
sound.pump(ctx.time.t, ctx.camera.position);
// later: sound.cancel(id); on scene exit: sound.dispose();
```

## Inputs and outputs

- **Classes** (`SoundClass`): `refDistance`, `cutoffDistance` (hard audible bound), optional `distanceModel`, `rolloffFactor`, `maxDistance` (linear only; default the cutoff), `localise` (HRTF-eligible), `importance` (base weight) and `air` (distance low-pass from `nearHz` at `refDistance` to `farHz` at the cutoff, log-interpolated). Validated at creation; classes are copied.
- **Sources** (`emit`): a cue, a class, a fixed position or a position function, optional `importance()` (multiplier), `every` (repeat interval ≥ 0.05 s; omit for one emission), `variant`, `gain`, `signal`. Returns an id, or null when full or disposed.
- **Occlusion port** (`SegmentQuery`): `(from, to) => distance | null`, the same shape as the camera kit's `obstruction`. A hit closer than the source means blocked. Back it with the game's collision, a coarse occluder set, or a terrain surface through `segmentQueryFromRaycast(surface.raycast)` (at low rates: the terrain ray cast is not a per-frame general solver).
- **Pump** (`pump(now, listener)`): monotonic seconds and the listener position (normally the camera's; the output pans from the camera). Returns `{ realised, waiting, rays, dropped }`.
- **Output to the platform:** each realised emission is `playVoice(cue, { spatial: { position, class curve, cutoffDistance, panning }, filter })`. Playing voices get `setPosition` and `setFilter` (the output's smoothed ramps) only when the change matters (1 mm; 2% frequency; 0.01 gain).
- **Pure helpers:** `classGain(class, distance)` (the spec distance gain, 0 beyond the cutoff) and `airCutoff(class, distance)`. A host can use `classGain` to decide audibility before disclosing a sound event.

## Behaviour

Each pump:

1. Every source is tracked: position read once, distance to the listener, class gain. Repeating sources become due on schedule; a source that missed its slot by more than `maxLateness` (a long frame, a hidden tab) emits once now instead of a burst.
2. A due emission beyond the class cutoff is **culled** (`stats.culled`); the source stays tracked without a voice (virtual) and plays when it comes within range.
3. **Occlusion:** at most `raysPerPump` queries, stalest path first, then highest score. Results older than `maxAge` fall back to `unknown` (default open). Uncovered candidates count in `stats.raysDeferred`.
4. **Ranking:** score = class gain × class importance × `importance()` × (blocked gain when occluded). Waiting emissions start best first while voices are free. When full, an emission steals the weakest playing voice only if its score is `stealRatio` (default 1.5) times higher; the stolen voice fades over ~50 ms (its filter gain ramps to 0) and is stopped on a later pump, so the new emission starts after the fade. Emissions waiting longer than `maxLateness` are **dropped**; a late gunshot never plays seconds afterwards.
5. **HRTF** goes to `localise` classes in score order while fewer than `maxHrtfVoices` of this kit's voices use it; the output's own HRTF limit and the player's headphone setting still apply (`voice.panning` is what counts). The panning model is chosen at start; a playing voice is not upgraded.
6. Playing voices follow their source: position, and a filter of min(air cutoff, blocked cutoff) and blocked gain, ramped with `filterSmoothing` (default 0.08 s).

A source can have one playing voice; a repeat that starts while the previous voice still plays fades the previous one out.

## Bounds, overload, cancellation and recovery

| Bound | Default (ceiling) | Overload |
|---|---|---|
| `maxSources` | 128 (1024) | `emit` returns null |
| `maxVoices` | 24 (64), fading voices included | Waits virtually, steals with hysteresis, or drops after `maxLateness` |
| `maxHrtfVoices` | min(6, maxVoices) | Equal-power for the rest |
| `raysPerPump` | 8 (256) | Stalest-first rotation; old results age out to `unknown` |
| `maxLateness` | 0.15 s (2 s) | Dropped and counted |

- **Cost:** per pump O(sources log sources) for sorting plus at most `raysPerPump` creator queries; per voice one panner, one biquad filter and two extra gain nodes (filter and cutoff) in the output. No draws or triangles. The query's own cost is the creator's; a work count is not a CPU deadline.
- **Cancellation:** `cancel(id)` and an aborted `signal` stop tracking and fade the voice. `dispose()` stops this kit's voices (including fading ones) once, rejects new work and never closes the borrowed output. Scene exit also stops voices started through `ctx.playVoice`.
- **Recovery:** a throwing position function retires that source; a throwing `importance()` falls back to the class importance; a throwing or invalid query keeps the previous result. Each kind of failure is reported once per source (`report`) and counted in `stats.errors`; the pump continues. A refused start (muted, silent test browser, output voice limit) is counted as dropped.
- **Stats:** `sources`, `voices`, `hrtf`, `waiting`, `dropped`, `culled`, `stolen`, `rays`, `raysDeferred`, `errors`.

## Evidence

- `spatial-audio.test.ts` (Node, recording fake output): class curves and validation; culling and virtual tracking; ranking, lateness and dropping; stealing with hysteresis and fade; HRTF assignment within the kit and output limits; occlusion budget, rotation, filter ramps, staleness and creator default; failure reporting; repeat scheduling without bursts; write-on-change; cancellation, abort and idempotent disposal; the ray cast adapter.
- `npm run test:audio-browser` (the real output rendering into `OfflineAudioContext` in the muted test browser): occlusion appearing mid-render lowers a 3 kHz source by >15 dB (measured ~24 dB) with no 128-frame step of 4 dB or more; a clear path is unchanged; a stolen voice fades by >30 dB without a step of 6 dB or more and the stronger emission then plays.
- **Not established:** perceived clarity or localisation (needs listening tests), behaviour with a real level's geometry and its query cost, propagation around corners, any device's CPU cost. No template uses the kit yet.

## Not included

Sound propagation or diffraction (paths around corners), transmission per material, reverb zones, Doppler, listener placement policies other than the caller's position, mixer ducking integration, and networked sound events. Genre vocabulary (opponents, shots) stays in this kit and its docs.
