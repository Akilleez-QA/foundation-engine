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
  limits: { maxSources: 128, maxVoices: 24, maxHrtfVoices: 6, raysPerPump: 8, maxLateness: .15, rotateAfter: .25 },
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
- **Occlusion port** (`SegmentQuery`): `(from, to) => distance | null`, the same shape as the camera kit's `obstruction`. A hit between the ends means blocked; hits within `margin` (default 0.05) of either end are ignored. The query should exclude the source's and the listener's own colliders (a character capsule, the camera's own body); the margin only covers contacts at the very ends. Back it with the game's collision, a coarse occluder set, or a terrain surface through `segmentQueryFromRaycast(surface.raycast)` (at low rates: the terrain ray cast is not a per-frame general solver).
- **Pump** (`pump(now, listener)`): monotonic seconds and the listener position (normally the camera's; the output pans from the camera). Returns `{ realised, waiting, rays, dropped }`.
- **Output to the platform:** each realised emission is `playVoice(cue, { spatial: { position, class curve, cutoffDistance, panning }, filter })`. Playing voices get `setPosition` and `setFilter` (the output's smoothed ramps) only when the change matters (1 mm; 2% frequency; 0.01 gain).
- **Pure helpers:** `classGain(class, distance)` (the spec distance gain, 0 beyond the cutoff) and `airCutoff(class, distance)`. A host can use `classGain` to decide audibility before disclosing a sound event; it must measure the distance from the same listener position the client's output uses (the camera, not the player character, in a third-person game), or the host and the client disagree about what is audible.

## Behaviour

Each pump:

1. Every source is tracked: position read once, distance to the listener, class gain. Repeating sources become due on schedule; a source that missed its slot by more than `maxLateness` (a long frame, a hidden tab) emits once now and restarts its rhythm from now (next beat at now + `every`), instead of a burst.
2. A due emission beyond the class cutoff is **culled** (`stats.culled`). A repeating source stays tracked without a voice (virtual) and plays when it comes within range; a culled one-shot source is removed.
3. **Occlusion:** at most `raysPerPump` queries. Waiting emissions without a fresh result are guaranteed half the budget (rounded down, at least one), so a new emission starts with its own result even at `raysPerPump: 1`. Playing voices get up to half the budget (rounded up) of what is left, the one with the oldest information first (time since its last result, or since it started), so with a budget of 2 or more a stream of new emissions cannot starve a long-playing voice. Leftover rays go to the remaining candidates, never-queried first, then by score. Results older than `maxAge` fall back to `unknown` (default open). `stats.stale` counts playing voices that use `unknown` now: a result older than `maxAge`, or none at all (`stats.unqueried` of them started without a result and have not had one since). `stats.oldestRayAge` is the oldest result age among playing voices that have one. If `stale` stays above 0, the budget cannot keep every playing voice informed within `maxAge`; at `raysPerPump: 1` with a new emission every pump, playing voices are not refreshed at all and show as stale. Uncovered candidates count in `stats.raysDeferred`.
4. **Ranking and admission:** score = class gain × class importance × `importance()` × (blocked gain when occluded). Due emissions are ordered by score in tiers (a run of scores within 1% of its strongest member is one tier, so sources that are equal in practice are treated as equal), then inside a tier by **starvation credit**: when the source first waited for a voice without getting one. The credit survives dropped emissions and clears when the source plays, so equal sources take turns across repeats instead of the same ones winning every beat.
   - Every voice this kit holds counts against `maxVoices`, **fading ones included**: the kit never has more than `maxVoices` voices on the output (`stats.voices`, of which `stats.fading` are fading).
   - A due source whose own voice still plays holds that slot. It crossfades into a free slot when there is one; with none left, its old voice fades first and the repeat starts when that slot frees (about 60 ms plus a frame later, within `maxLateness`). A source repeating faster than that when the kit is full plays shortened voices; it does not exceed the cap.
   - The due set fills the free slots plus the slots its playing members hold, in order. Waiting emissions inside take free slots first; a playing source that ranks outside yields: its voice fades and its slot is reserved for a waiting emission that ranked inside (counted in `stats.rotated`).
   - Further emissions may take voices that are not due, scanning from the weakest tier, and inside a tier from the source that has played most, then the longest-playing voice. A **steal** needs `stealRatio` (default 1.5) times the victim's score (`stats.stolen`). A **rotation** needs an equal score (within 1%) and a voice that has played at least `rotateAfter` (default 0.25 s), so newer equal one-shots get turns against older long voices without equal newcomers cutting each other (`stats.rotated`). The pass stops at the first emission that can take no voice. A stolen or rotated voice fades over ~50 ms (its filter gain ramps to 0 at its current cutoff, so it does not brighten) and is stopped on a later pump. The emission it was taken for holds a reservation and never takes another; it starts when the slot frees.
   - Emissions waiting longer than `maxLateness` are **dropped**; a late gunshot never plays seconds afterwards.
   - Rotation means a long sound (an engine loop, ambience) of the same score as frequent one-shots will be cut after `rotateAfter`; give sounds that must not be cut a higher `importance`.
5. **HRTF** with hysteresis: at most `maxHrtfVoices` sources hold an HRTF **claim**, kept across their emissions, so short cues with near-equal scores do not alternate between HRTF and equal-power. A `localise` source without a claim takes a free one; when all are held, it takes one only from a claimant that is not playing an HRTF voice now, and only with 1.25 times that claimant's score at its last start. An idle claim (no voice, nothing due) lapses after max(1 s, 2 × `every`). The output's own HRTF limit and the player's headphone setting still apply (`voice.panning` is what counts). The panning model is chosen at start; a playing voice is not upgraded.
6. Playing voices follow their source: position, and a filter of min(air cutoff, blocked cutoff) and blocked gain, ramped with `filterSmoothing` (default 0.08 s).

## Bounds, overload, cancellation and recovery

| Bound | Default (ceiling) | Overload |
|---|---|---|
| `maxSources` | 128 (1024) | `emit` returns null |
| `maxVoices` | 24 (64); every voice counts, fading ones included | Waits virtually, rotates equal sources, steals with hysteresis, or drops after `maxLateness` |
| `maxHrtfVoices` | min(6, maxVoices) claims | Equal-power for the rest; claims move with 1.25× hysteresis |
| `raysPerPump` | 8 (256) | Stalest-first rotation; old results age out to `unknown` |
| `maxLateness` | 0.15 s (2 s) | Dropped and counted |
| `rotateAfter` | 0.25 s (10 s) | An equal-score emission waits (or drops) until a voice has played this long |

- **Cost:** per pump O(sources log sources) for sorting (no per-waiting scan of voices) plus at most `raysPerPump` creator queries; measured about 0.5 ms per pump in Node with 1024 sources, 64 voices and 960 waiting, on the development machine (not a device budget); per voice one panner, one biquad filter and two extra gain nodes (filter and cutoff) in the output. No draws or triangles. The query's own cost is the creator's; a work count is not a CPU deadline.
- **Cancellation:** `cancel(id)` and an aborted `signal` stop tracking and fade the voice. `dispose()` stops this kit's voices (including fading ones) once, rejects new work and never closes the borrowed output. Scene exit also stops voices started through `ctx.playVoice`.
- **Recovery:** a throwing position function retires that source; a throwing `importance()` falls back to the class importance; a throwing or invalid query keeps the previous result; a throwing voice method (`setPosition`, `setFilter`, `stop`) is reported and skipped for that pump. Each kind of failure is reported once per source (`report`) and counted in `stats.errors`; the pump continues. A refused start (muted, silent test browser, output voice limit) is counted as dropped.
- **Stats:** `sources`, `voices` (real voices on the output, fading included), `fading`, `hrtf`, `waiting`, `dropped`, `culled`, `stolen` (stealRatio steals only), `rotated` (yields and equal-score rotations), `rays`, `raysDeferred`, `stale`, `unqueried`, `oldestRayAge`, `errors`.

## Evidence

- `spatial-audio.test.ts` (Node, recording fake output): class curves and validation; culling and virtual tracking; ranking, lateness and dropping; stealing with hysteresis and fade; HRTF assignment within the kit and output limits; occlusion budget, rotation, filter ramps, staleness and creator default; failure reporting; repeat scheduling without bursts; write-on-change; cancellation, abort and idempotent disposal; the ray cast adapter. Review regressions: one steal per emission across pumps inside the fade; equal sources rotate (no starvation); own-voice replacement stays within the cap (waits for its own fade when full) and steals nothing; HRTF kept on repeats; bounded admission with 1024 sources and 960 waiting; playing voices keep fresh occlusion under a stream of new one-shots, and an insufficient budget shows in `stale`; voice method failures; rhythm after a long gap; occlusion margin. Re-verification regressions (each fails on the previous head `a95497e`): 8 equal repeaters on 4 voices started together play 9 to 11 of 20 beats each (were 20/20/20/20/0/0/0/0); out of phase, 12 or more each within 3 of each other (measured 14 to 17); nine newer equal one-shots each play against two older long voices (were all dropped), and nine at once do not cut each other; a repeater among 21 equal ones plays at least 3 times in 10 s (was 0); real voices never exceed `maxVoices` with 64 sources every 0.05 s (were up to 3×); at `raysPerPump: 1` every new emission starts with its own result, and a voice started without one counts in `stale` and `unqueried`; near-equal in-phase HRTF sources flip 0 times in 10 s (were 44).
- `npm run test:audio-browser` (the real output rendering into `OfflineAudioContext` in the muted test browser): occlusion appearing mid-render lowers a 3 kHz source by >15 dB (measured ~24 dB) with no 128-frame step of 4 dB or more; a clear path is unchanged; a stolen voice fades by >30 dB without a step of 6 dB or more and the stronger emission then plays.
- **Not established:** perceived clarity or localisation (needs listening tests), whether 0.25 s rotation and the 1% tier sound right for a given game, behaviour with a real level's geometry and its query cost, propagation around corners, any device's CPU cost. No template uses the kit yet.

## Not included

Sound propagation or diffraction (paths around corners), transmission per material, reverb zones, Doppler, listener placement policies other than the caller's position, mixer ducking integration, and networked sound events. Genre vocabulary (opponents, shots) stays in this kit and its docs.
