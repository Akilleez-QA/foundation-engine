/**
 * kits/spatial-audio/sources.ts: logical sound sources over the platform's one audio output.
 *
 * A source is a position the game owns (a footstep emitter, a weapon, a vehicle), a cue and a sound class. The kit
 * tracks every source every pump, but only the most important audible emissions get real voices; the rest stay
 * virtual (no nodes) until they rank high enough or become stale and are dropped. Classes give distance curves with a
 * hard cutoff, so an emission beyond earshot never becomes a voice. A creator-supplied segment query (the camera kit's
 * `obstruction` shape) decides occlusion under a per-pump ray budget, and drives the voice's low-pass/gain filter
 * through the output's smoothed `setFilter`.
 *
 * It owns no context, timer, frame loop or node: `pump(now, listener)` runs from the scene's existing update, and every
 * voice comes from `output.playVoice` (`ctx.playVoice` stops them on scene exit). `dispose()` stops only this kit's voices.
 */
import { distanceGain, type CueVoice, type CueVoiceOptions, type DistanceModel } from '../../author';

/** A world position; mutable `Point` arrays are accepted too. */
export type Point = readonly [number, number, number];

/** A distance curve per kind of sound. Units are world units (metres in most games). */
export interface SoundClass {
  /** Distance where attenuation starts, > 0. */
  refDistance: number;
  /** Hard audible bound, >= refDistance: emissions beyond it never get a voice; playing voices fade out beyond it. */
  cutoffDistance: number;
  /** Default 'inverse'. */
  distanceModel?: DistanceModel;
  /** Default 1. */
  rolloffFactor?: number;
  /** Only the 'linear' model reads it. Default cutoffDistance. */
  maxDistance?: number;
  /** Eligible for HRTF panning (localisation-critical sounds). Default false. */
  localise?: boolean;
  /** Base importance multiplier, >= 0. Default 1. */
  importance?: number;
  /** Distance low-pass ("air"): cutoff at refDistance and at cutoffDistance, interpolated in log frequency. */
  air?: { nearHz: number; farHz: number };
}

/** Return the distance to the first hit along the segment, or null when clear (the camera kit's `obstruction` shape). */
export type SegmentQuery = (from: Point, to: Point) => number | null;

export interface OcclusionOptions {
  query: SegmentQuery;
  /** Filter for a blocked path. Default { cutoffHz: 1000, gain: .5 }. */
  blocked?: { cutoffHz: number; gain: number };
  /** Seconds a ray result stays valid; older results fall back to `unknown`. Default .5. */
  maxAge?: number;
  /** What an unknown or stale path is treated as. Default 'open'. */
  unknown?: 'open' | 'blocked';
  /**
   * Hits within this distance (world units) of either end of the segment are ignored, so the source's and the
   * listener's own colliders do not count as walls: [0, 10], default .05. A query should still exclude those
   * colliders where it can.
   */
  margin?: number;
}

export interface SpatialAudioLimits {
  /** Logical sources tracked at once (1..1024, default 128). `emit` returns null when full. */
  maxSources?: number;
  /**
   * Real voices this kit holds at once (1..64, default 24), fading voices included: the number of voices this kit has
   * on the output never exceeds it. A source replacing its own voice when no slot is free fades the old one first.
   */
  maxVoices?: number;
  /** Voices this kit asks to pan with HRTF (0..maxVoices, default 6). The output's own HRTF limit also applies. */
  maxHrtfVoices?: number;
  /** Occlusion queries per pump (0..256, default 8). */
  raysPerPump?: number;
  /** Seconds an emission may wait virtually for a voice before it is dropped (0..2, default .15). */
  maxLateness?: number;
  /** A waiting emission steals the weakest voice only when its score is this many times higher (1..10, default 1.5). */
  stealRatio?: number;
  /**
   * Opt-in rotation: seconds a voice that is not due must have played before a waiting emission of equal score (within
   * 1%) may take its slot (0..10, or Infinity; default Infinity, off). Off, equal sounds share voices only through
   * free slots and the starvation credit, and a playing voice is cut only by a steal. Set it (say .25..1) for short,
   * frequent one-shots that should get turns against older equal voices (shooters); leave it off for long equal sounds
   * (ambience, loops), which it would cut. Keep it above `maxLateness`.
   */
  rotateAfter?: number;
}

export interface SpatialAudioOptions {
  output: { playVoice(id: string, options?: CueVoiceOptions): CueVoice | null };
  classes: Readonly<Record<string, SoundClass>>;
  limits?: SpatialAudioLimits;
  occlusion?: OcclusionOptions;
  /** Time constant (s) for filter changes (air, occlusion): .005..2, default .08. */
  filterSmoothing?: number;
  /** Diagnostics for port or callback failures; each kind of failure is reported at most once per source. */
  report?: (message: string) => void;
}

export interface SourceInput {
  cue: string;
  /** A key of `classes`. */
  class: string;
  /** A fixed position, or a function read once per pump. */
  position: Point | (() => Point);
  /** Extra importance (>= 0), read once per pump; multiplied by the class importance. Default 1. */
  importance?: () => number;
  /** Repeat interval in seconds (>= .05): the source emits its cue every interval until cancelled. Omit for one emission. */
  every?: number;
  variant?: number;
  /** Voice gain [0, 1], default 1. */
  gain?: number;
  /** Aborting cancels the source (as `cancel(id)`). */
  signal?: AbortSignal;
  /**
   * Repeating sources only, opt-in (default false). Off, an emission that cannot start within `maxLateness` is
   * dropped and the source plays its next beat on time: right for gunfire and steps, where a late sound is worse than a
   * missing one. On, the late emission keeps waiting with its starvation credit for up to one interval (`every`), starts
   * at the next slot it ranks for, and restarts the rhythm from that start: right for long equal loops (ambience,
   * engines) that fill every voice and should still take turns. After one interval it is dropped.
   */
  carryLate?: boolean;
}

export interface SpatialAudioStats {
  /** `voices` counts every voice this kit holds on the output, fading ones included (`fading` of them). */
  readonly sources: number; readonly voices: number; readonly fading: number; readonly hrtf: number; readonly waiting: number;
  /**
   * Emissions that never played: waited longer than `maxLateness` (or one interval with `carryLate`), their
   * reservation timed out, or the output refused them.
   */
  readonly dropped: number;
  /** Emissions that played, but more than `maxLateness` after they were due (a reservation after a slow pump, or `carryLate`). */
  readonly late: number;
  /** Beats a repeating source never emitted because its pumps stopped for longer than `maxLateness` (a long frame, a hidden tab). */
  readonly skipped: number;
  /** Emissions skipped because the source was beyond its class cutoff. */
  readonly culled: number;
  /** Voices taken by a stronger emission (`stealRatio`). */
  readonly stolen: number;
  /** Voices that gave their slot to an equal or longer-waiting emission (fair rotation), not steals. */
  readonly rotated: number;
  readonly rays: number;
  /** Ray candidates left unqueried because the per-pump budget ran out (cumulative). */
  readonly raysDeferred: number;
  /**
   * Playing voices that use `unknown` right now: their occlusion result is older than `maxAge`, or they have none
   * (`unqueried` of them started and still play without a result). `oldestRayAge` is the oldest result age among
   * playing voices that have one, in seconds. A `stale` that stays above 0 means `raysPerPump` cannot keep every
   * playing voice informed within `maxAge`: raise the budget or `maxAge`, or lower the voice count.
   */
  readonly stale: number; readonly unqueried: number; readonly oldestRayAge: number;
  readonly errors: number;
}
export interface PumpResult { realised: number; waiting: number; rays: number; dropped: number }

const CEILING = { sources: 1024, voices: 64, rays: 256 } as const;
const FADE = .01, FADE_HOLD = .06, OPEN_HZ = 20000;
/** HRTF hysteresis: a claim moves only to a score this many times higher; an idle claim lapses after max(1 s, 2 × every). */
const HRTF_SWITCH = 1.25, HRTF_HOLD = 1;
/**
 * Safety bound (s) on a reservation: an emission that a voice is fading out for is exempt from `maxLateness` (the
 * voice was cut for it, so it must start), but never waits longer than this for the slot.
 */
const RESERVE_LIMIT = 1;
/** Scores within this fraction of each other are equal for admission order and rotation. */
const TIE = .01;

const finite3 = (p: Point) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
const intIn = (n: number, min: number, max: number) => Number.isSafeInteger(n) && n >= min && n <= max;
const numIn = (n: unknown, min: number, max: number) => typeof n === 'number' && n >= min && n <= max;

/** Validate a class; throws RangeError naming it. */
export function validateSoundClass(id: string, c: SoundClass): void {
  const ok = numIn(c.refDistance, Number.MIN_VALUE, 1e6) && numIn(c.cutoffDistance, c.refDistance, 1e6)
    && (c.rolloffFactor === undefined || numIn(c.rolloffFactor, 0, 100)) && (c.maxDistance === undefined || numIn(c.maxDistance, c.refDistance, 1e6))
    && (c.distanceModel === undefined || ['inverse', 'linear', 'exponential'].includes(c.distanceModel)) && (c.importance === undefined || numIn(c.importance, 0, 1e6))
    && (c.air === undefined || (numIn(c.air.nearHz, 10, 24000) && numIn(c.air.farHz, 10, 24000)));
  if (!ok) throw new RangeError(`spatial-audio: invalid sound class '${id}'`);
}

/**
 * The distance gain of a class at `distance`, 0 beyond its cutoff. The same pure rule a host can use to decide
 * whether an event is audible to a player before disclosing it; the host must measure `distance` from the same listener
 * position the client's output uses (the camera, not the player character in third person).
 */
export function classGain(c: SoundClass, distance: number): number {
  if (!(distance >= 0)) throw new RangeError('spatial-audio: invalid distance');
  if (distance > c.cutoffDistance) return 0;
  return distanceGain(c.distanceModel ?? 'inverse', distance, { refDistance: c.refDistance, rolloffFactor: c.rolloffFactor, maxDistance: c.maxDistance ?? c.cutoffDistance });
}

/** The class's air low-pass cutoff at `distance` (log-frequency interpolation between ref and cutoff). */
export function airCutoff(c: SoundClass, distance: number): number {
  if (!c.air) return OPEN_HZ;
  const span = c.cutoffDistance - c.refDistance;
  const t = span <= 0 ? 1 : Math.min(1, Math.max(0, (distance - c.refDistance) / span));
  return c.air.nearHz * Math.pow(c.air.farHz / c.air.nearHz, t);
}

interface Source {
  id: number; input: SourceInput; cls: SoundClass; nextAt: number; dueAt: number | null; emitted: boolean;
  voice: CueVoice | null; hrtf: boolean; score: number; weight: number; gain: number; distance: number; position: Point;
  sentPosition: Point | null; sentFilter: { hz: number; gain: number } | null;
  ray: { blocked: boolean; at: number } | null; reported: Set<string>; off?: () => void;
  /** When the current voice started (for occlusion age before its first query). */
  startedAt: number;
  /**
   * A voice is fading out to free a slot for this waiting emission (since `reservedAt`): it must not steal again, it
   * takes the next free slot before anything else, and it is not dropped for lateness while it waits for that slot.
   */
  reserved: boolean; reservedAt: number;
  /** The voice fading out for this reservation; the emission starts once it has stopped. */
  awaiting: CueVoice | null;
  /**
   * A `carryLate` source whose emission waited past `maxLateness`: it keeps waiting with its starvation credit for up
   * to one interval, starts at the next slot it ranks for, and restarts its rhythm from that start.
   */
  late: boolean;
  /**
   * HRTF deferred (since `deferredAt`): a repeat that overlapped its own voice at the HRTF cap started equal-power.
   * Its overlapping repeats get HRTF again only after `HRTF_HOLD` and with room for two HRTF voices (this one and its
   * next crossfade); a repeat with no voice of its own playing clears it.
   */
  hrtfDeferred: boolean; deferredAt: number;
  /** When this source last started a voice (-Infinity before its first); the least recently served goes first among equals. */
  playedAt: number;
  /**
   * Starvation credit: when this source first waited for a voice without getting one. It survives dropped emissions
   * and is cleared when the source plays (or is culled), so equal-score sources rotate.
   */
  waitingSince: number | null;
  /** Voices this source has started; among equal voices, the most-served one rotates out first. */
  served: number;
  /** An HRTF claim (kept across emissions), the score it was taken or renewed with, and when. */
  hrtfClaim: boolean; claimScore: number; claimAt: number;
}

export function createSpatialAudio(o: SpatialAudioOptions) {
  const l = o.limits ?? {};
  const maxSources = l.maxSources ?? 128, maxVoices = l.maxVoices ?? 24, maxHrtf = l.maxHrtfVoices ?? Math.min(6, maxVoices);
  const raysPerPump = l.raysPerPump ?? 8, maxLateness = l.maxLateness ?? .15, stealRatio = l.stealRatio ?? 1.5, rotateAfter = l.rotateAfter ?? Infinity;
  const smoothing = o.filterSmoothing ?? .08;
  if (!intIn(maxSources, 1, CEILING.sources) || !intIn(maxVoices, 1, CEILING.voices) || !intIn(maxHrtf, 0, maxVoices) || !intIn(raysPerPump, 0, CEILING.rays)
    || !numIn(maxLateness, 0, 2) || !numIn(stealRatio, 1, 10) || !(numIn(rotateAfter, 0, 10) || rotateAfter === Infinity) || !numIn(smoothing, .005, 2)) throw new RangeError('spatial-audio: invalid limits');
  const classes = new Map<string, SoundClass>();
  for (const [id, c] of Object.entries(o.classes)) { validateSoundClass(id, c); classes.set(id, structuredClone(c)); }
  if (!classes.size) throw new RangeError('spatial-audio: at least one sound class is required');
  const occ = o.occlusion;
  const blocked = occ?.blocked ?? { cutoffHz: 1000, gain: .5 }, maxAge = occ?.maxAge ?? .5, unknownBlocked = occ?.unknown === 'blocked';
  if (occ && (typeof occ.query !== 'function' || !numIn(blocked.cutoffHz, 10, 24000) || !numIn(blocked.gain, 0, 1) || !numIn(maxAge, 0, 60))) throw new RangeError('spatial-audio: invalid occlusion options');

  const margin = occ?.margin ?? .05;
  if (occ && !numIn(margin, 0, 10)) throw new RangeError('spatial-audio: invalid occlusion options');

  const sources = new Map<number, Source>();
  /** Voices fading out (~50 ms) before they are stopped. Every fade holds its slot in `maxVoices` until it stops. */
  const fading = new Map<CueVoice, { stopAt: number; owner: Source | null; hrtf: boolean }>();
  const stats = { dropped: 0, late: 0, skipped: 0, culled: 0, stolen: 0, rotated: 0, rays: 0, raysDeferred: 0, errors: 0 };
  let sequence = 0, step = 1 / 60, clock = -Infinity, closed = false, pumping = false, listener: Point = [0, 0, 0];

  /** Counts every failure; reports each kind of failure once per source. */
  const report = (s: Source | null, kind: string, message: string) => {
    stats.errors++;
    if (s) { if (s.reported.has(kind)) return; s.reported.add(kind); }
    try { o.report?.(message); } catch { /* Diagnostics never interrupt the pump. */ }
  };
  const playing = (s: Source) => !!s.voice && !s.voice.ended;
  /** Every voice this kit holds on the output: playing ones and fading ones. */
  const liveVoices = () => { let n = 0; for (const v of fading.keys()) if (!v.ended) n++; for (const s of sources.values()) if (playing(s)) n++; return n; };
  const hrtfVoices = () => { let n = 0; for (const s of sources.values()) if (s.hrtf && playing(s)) n++; return n; };
  /** HRTF voices this kit has on the output: playing ones and fading ones. */
  const hrtfOnOutput = () => { let n = hrtfVoices(); for (const [v, f] of fading) if (f.hrtf && !v.ended) n++; return n; };
  /** Ramp a voice's filter gain to 0 at its current cutoff (no brightening), then stop it on a later pump. */
  const fadeOut = (voice: CueVoice, owner: Source | null, now: number) => {
    if (voice.ended || fading.has(voice)) return;
    if (closed) { stop(voice, owner); return; }
    try { voice.setFilter?.({ cutoffHz: owner?.sentFilter?.hz ?? OPEN_HZ, gain: 0 }, FADE); fading.set(voice, { stopAt: now + FADE_HOLD, owner, hrtf: voice.panning === 'HRTF' }); }
    catch (error) { report(owner, 'voice', `spatial-audio: voice fade failed: ${String(error)}`); stop(voice, owner); }
  };
  const stop = (voice: CueVoice, owner: Source | null) => {
    try { if (!voice.ended) voice.stop(); } catch (error) { report(owner, 'voice', `spatial-audio: voice stop failed: ${String(error)}`); }
  };
  const release = (s: Source, now: number) => { if (playing(s)) fadeOut(s.voice!, s, now); s.voice = null; s.hrtf = false; };
  /** Cut `victim`'s voice for a waiting emission `s`; `s` now owns the slot that fade frees. */
  const cutFor = (s: Source, victim: Source, now: number) => { const v = victim.voice; release(victim, now); s.reserved = true; s.reservedAt = now; s.awaiting = v; };
  const settle = (s: Source) => { s.dueAt = null; s.reserved = false; s.awaiting = null; s.late = false; s.emitted ||= s.input.every === undefined; };
  const retire = (s: Source) => { sources.delete(s.id); s.reserved = false; s.awaiting = null; s.off?.(); s.off = undefined; };
  const isBlocked = (s: Source, now: number) => !occ ? false : s.ray && now - s.ray.at <= maxAge ? s.ray.blocked : unknownBlocked;
  const filterFor = (s: Source, now: number) => {
    const air = airCutoff(s.cls, s.distance), shut = isBlocked(s, now);
    return { hz: Math.min(air, shut ? blocked.cutoffHz : OPEN_HZ), gain: shut ? blocked.gain : 1 };
  };
  const read = (s: Source): Point | null => {
    try {
      const p = typeof s.input.position === 'function' ? s.input.position() : s.input.position;
      if (!finite3(p)) throw new RangeError('position must be three finite numbers');
      return [p[0], p[1], p[2]];
    } catch (error) { report(s, 'position', `spatial-audio: source ${s.id} position failed: ${String(error)}`); return null; }
  };
  const importance = (s: Source) => {
    const base = s.cls.importance ?? 1;
    if (!s.input.importance) return base;
    try { const v = s.input.importance(); if (!numIn(v, 0, 1e6)) throw new RangeError('importance must be in [0, 1e6]'); return base * v; }
    catch (error) { report(s, 'importance', `spatial-audio: source ${s.id} importance failed: ${String(error)}`); return base; }
  };
  /**
   * HRTF with hysteresis: at most `maxHrtf` sources hold a claim, kept across their emissions, so short cues with
   * near-equal scores do not flip between HRTF and equal-power. A claim moves only from a claimant that is not playing
   * HRTF now, to a score `HRTF_SWITCH` times its own; an idle claim lapses (see `claimLapsed`).
   */
  const hrtfTarget = (s: Source): Source | null | 'claim' => {
    if (!s.cls.localise || maxHrtf === 0) return null;
    if (s.hrtfClaim) return s;
    let claims = 0, weakest: Source | null = null;
    for (const o of sources.values()) {
      if (!o.hrtfClaim) continue;
      claims++;
      if (!(o.hrtf && playing(o)) && (!weakest || o.claimScore < weakest.claimScore)) weakest = o;
    }
    if (claims < maxHrtf) return 'claim';
    return weakest && s.score > weakest.claimScore * HRTF_SWITCH ? weakest : null;
  };
  const claimLapsed = (s: Source, now: number) => s.hrtfClaim && !playing(s) && s.dueAt === null && now - s.claimAt > Math.max(HRTF_HOLD, 2 * (s.input.every ?? 0));
  /** Start the source's due emission. A previous voice of the same source is replaced (faded; the fade holds a slot). */
  const start = (s: Source, now: number): boolean => {
    if (closed || sources.get(s.id) !== s) return false;
    const wasLate = s.dueAt !== null && now - s.dueAt > maxLateness;
    if (s.late) s.nextAt = now + s.input.every!;
    // HRTF only within the cap counting this kit's fading HRTF voices too (they still hold an HRTF panner). A repeat
    // overlapping its own voice never waits for HRTF: at the cap it starts equal-power (hrtfDeferred). A deferred
    // source's overlapping repeats return to HRTF only after HRTF_HOLD and when the cap has room for this voice and its
    // next crossfade too (hysteresis), so the panning model does not alternate per emission.
    const own = playing(s);
    if (!own) s.hrtfDeferred = false;
    const c = s.cls, target = hrtfTarget(s), f = filterFor(s, now);
    const held = own && s.hrtfDeferred;
    const hrtf = target !== null && (!held || now - s.deferredAt >= HRTF_HOLD) && hrtfOnOutput() + (held ? 2 : 1) <= maxHrtf;
    const deferred = target !== null && own && !hrtf;
    let voice: CueVoice | null = null;
    try {
      voice = o.output.playVoice(s.input.cue, {
        variant: s.input.variant, gain: s.input.gain,
        spatial: { position: s.position, refDistance: c.refDistance, rolloffFactor: c.rolloffFactor, maxDistance: c.maxDistance ?? c.cutoffDistance, distanceModel: c.distanceModel, cutoffDistance: c.cutoffDistance, panning: hrtf ? 'HRTF' : 'equalpower' },
        filter: { cutoffHz: f.hz, gain: f.gain },
      });
    } catch (error) { report(s, 'playback', `spatial-audio: playback of '${s.input.cue}' failed: ${String(error)}`); }
    settle(s);
    // The output may call back into this kit (an abort handler cancelling this source, or dispose): a voice for a
    // source that is gone is faded (or stopped, after dispose) instead of attached to it and leaked.
    if (voice && (closed || sources.get(s.id) !== s)) { fadeOut(voice, null, now); return false; }
    if (!voice) { stats.dropped++; return false; }
    if (wasLate) stats.late++;
    if (deferred && !s.hrtfDeferred) s.deferredAt = now;
    s.hrtfDeferred = deferred;
    if (playing(s)) fadeOut(s.voice!, s, now);
    if (target !== null && target !== 'claim' && target !== s) target.hrtfClaim = false;
    if (hrtf) { s.hrtfClaim = true; s.claimScore = s.score; s.claimAt = now; }
    s.voice = voice; s.hrtf = voice.panning === 'HRTF'; s.sentPosition = s.position; s.sentFilter = f; s.startedAt = now; s.playedAt = now; s.waitingSince = null; s.served++;
    return true;
  };

  /** Stop tracking a source; its playing voice fades out. Idempotent. */
  const cancel = (id: number): boolean => {
    const s = sources.get(id); if (!s) return false;
    release(s, clock === -Infinity ? 0 : clock); retire(s); return true;
  };

  /**
   * Ordering age for refreshing playing voices: seconds since the last result, or since the voice started when it has
   * none (so a long-playing voice is not starved by a stream of new unqueried ones). Stats do not use it: a voice with
   * no result counts as stale there.
   */
  const refreshAge = (s: Source, now: number) => now - (s.ray?.at ?? s.startedAt);
  const fresh = (s: Source, now: number) => !!s.ray && now - s.ray.at <= maxAge;
  const query = (s: Source, now: number) => {
    if (!occ) return;
    stats.rays++;
    try {
      const hit = occ.query(listener, s.position);
      if (hit !== null && (!Number.isFinite(hit) || hit < 0)) throw new RangeError('query must return a finite distance >= 0 or null');
      s.ray = { blocked: hit !== null && hit > margin && hit < s.distance - margin, at: now };
    } catch (error) { report(s, 'occlusion', `spatial-audio: occlusion query failed: ${String(error)}`); }
  };
  /**
   * Ordering for waiting emissions: by score in tiers, then the least recently served, the least served, the starvation
   * credit (the longest-starved, across dropped emissions), then the earliest due, then the oldest source. A tier is a run of scores within `TIE` of its
   * strongest member, so sources that are equal in practice (a float ulp apart, or a few centimetres) rotate instead of
   * the marginally stronger ones always winning. O(n log n).
   */
  const credit = (s: Source) => s.waitingSince ?? s.dueAt ?? 0;
  const byCredit = (a: Source, b: Source) => a.playedAt - b.playedAt || a.served - b.served || credit(a) - credit(b) || (a.dueAt ?? 0) - (b.dueAt ?? 0) || b.score - a.score || a.id - b.id;
  /** Split a sorted list into runs whose members `same(leader, member)`, sorting each run by `order`. */
  const tiers = (list: Source[], same: (leader: Source, member: Source) => boolean, order: (a: Source, b: Source) => number): Source[] => {
    const out: Source[] = [];
    for (let i = 0; i < list.length;) {
      let j = i + 1; while (j < list.length && same(list[i], list[j])) j++;
      out.push(...list.slice(i, j).sort(order)); i = j;
    }
    return out;
  };
  const byPriority = (list: Source[]) => tiers(list.sort((a, b) => b.score - a.score || a.id - b.id), (a, b) => b.score >= a.score * (1 - TIE), byCredit);

  return {
    cancel,
    /** Track a source. Null when full or disposed. The id cancels it. */
    emit(input: SourceInput, now: number): number | null {
      const cls = classes.get(input.class);
      if (!cls) throw new RangeError(`spatial-audio: unknown sound class '${input.class}'`);
      if (typeof input.cue !== 'string' || !input.cue || (typeof input.position !== 'function' && !finite3(input.position))
        || (input.every !== undefined && !numIn(input.every, .05, 3600)) || (input.gain !== undefined && !numIn(input.gain, 0, 1))
        || !Number.isSafeInteger(input.variant ?? 0) || (input.carryLate !== undefined && typeof input.carryLate !== 'boolean') || !Number.isFinite(now)) throw new RangeError('spatial-audio: invalid source');
      if (closed || sources.size >= maxSources || input.signal?.aborted) return null;
      const id = ++sequence;
      const s: Source = { id, input: { ...input }, cls, nextAt: now, dueAt: null, emitted: false, voice: null, hrtf: false, score: 0, weight: 0, gain: 0, distance: Infinity,
        position: [0, 0, 0], sentPosition: null, sentFilter: null, ray: null, reported: new Set(), startedAt: now, reserved: false, reservedAt: 0, awaiting: null, late: false, hrtfDeferred: false, deferredAt: 0, playedAt: -Infinity,
        waitingSince: null, served: 0, hrtfClaim: false, claimScore: 0, claimAt: now };
      if (input.signal) { const abort = () => cancel(id); input.signal.addEventListener('abort', abort, { once: true }); s.off = () => input.signal!.removeEventListener('abort', abort); }
      sources.set(id, s); return id;
    },
    /**
     * Run once per frame (or less) from the scene's update, with a monotonic time in seconds and the listener position
     * (normally the camera's). Work: O(sources log sources) plus at most `raysPerPump` queries.
     */
    pump(now: number, at: Point): PumpResult {
      if (!Number.isFinite(now) || now < clock || !finite3(at)) throw new RangeError('spatial-audio: pump needs a monotonic time and a finite listener');
      if (closed || pumping) return { realised: 0, waiting: 0, rays: 0, dropped: 0 };
      pumping = true; if (clock !== -Infinity && now > clock) step = Math.min(now - clock, 1); clock = now; listener = [at[0], at[1], at[2]];
      const droppedBefore = stats.dropped, raysBefore = stats.rays; let realised = 0;
      try {
        for (const [voice, f] of fading) if (voice.ended || now >= f.stopAt) { fading.delete(voice); stop(voice, f.owner); }
        // 1. Track every source: position, distance, class gain, due emissions and lateness.
        for (const s of [...sources.values()]) {
          if (s.voice?.ended) { s.voice = null; s.hrtf = false; }
          const p = read(s);
          if (!p) { release(s, now); retire(s); continue; }
          s.position = p; s.distance = Math.hypot(p[0] - listener[0], p[1] - listener[1], p[2] - listener[2]);
          s.gain = classGain(s.cls, s.distance);
          s.weight = s.gain > 0 && (s.voice || s.dueAt !== null || now >= s.nextAt) ? importance(s) : 0;
          if (s.dueAt === null && now >= s.nextAt && (s.input.every !== undefined || !s.emitted)) {
            const every = s.input.every;
            if (every === undefined) { s.dueAt = s.nextAt; s.nextAt = Infinity; }
            // A repeating source that missed its slot by more than the lateness (a long frame, a hidden tab) emits
            // once now and restarts its rhythm from now, instead of replaying or dropping the missed ones.
            else if (now - s.nextAt > maxLateness) { stats.skipped += Math.floor((now - s.nextAt) / every); s.dueAt = now; s.nextAt = now + every; }
            else { s.dueAt = s.nextAt; s.nextAt += every; }
          }
          if (s.dueAt !== null && s.gain === 0) { stats.culled++; settle(s); s.waitingSince = null; }
          if (claimLapsed(s, now)) s.hrtfClaim = false;
          // Lateness (reservations are checked after admission, so a slot that frees on this pump is used first).
          if (s.dueAt !== null && !s.reserved) {
            const waited = now - s.dueAt;
            if (s.late ? waited > s.input.every! : waited > maxLateness) {
              if (!s.late && s.input.carryLate && s.input.every !== undefined) s.late = true;
              else { stats.dropped++; settle(s); }
            }
          }
          if (s.input.every === undefined && s.emitted && s.dueAt === null && !s.voice) { retire(s); continue; }
        }
        // 2. Occlusion. Waiting emissions without a fresh result are guaranteed floor(budget / 2) rays, at least one, so
        // they start with a result even at a budget of 1. Playing voices get up to half the budget (rounded up) of what
        // is left, the oldest information first (time since the last result, or since the voice started when it has
        // none), so a stream of new emissions cannot starve a long-playing voice when the budget is 2 or more. Any rays
        // left go to the remaining candidates, never-queried first, then by score.
        if (occ && raysPerPump > 0) {
          const live: Source[] = [], waiting: Source[] = [], others: Source[] = [];
          for (const s of sources.values()) {
            if (s.gain <= 0) continue;
            s.score = s.gain * s.weight;
            if (playing(s)) live.push(s);
            else if (s.dueAt !== null) (fresh(s, now) ? others : waiting).push(s);
          }
          live.sort((a, b) => refreshAge(b, now) - refreshAge(a, now) || b.score - a.score || a.id - b.id);
          const neverFirst = (a: Source, b: Source) => (a.ray?.at ?? -Infinity) - (b.ray?.at ?? -Infinity) || b.score - a.score || a.id - b.id;
          waiting.sort(neverFirst);
          const newRays = waiting.length ? Math.min(waiting.length, Math.max(1, Math.floor(raysPerPump / 2))) : 0;
          const liveRays = Math.min(live.length, raysPerPump - newRays, Math.ceil(raysPerPump / 2));
          for (const s of live.slice(0, liveRays)) query(s, now);
          for (const s of waiting.slice(0, newRays)) query(s, now);
          const rest = [...live.slice(liveRays), ...waiting.slice(newRays), ...others].sort(neverFirst);
          for (const s of rest.slice(0, raysPerPump - liveRays - newRays)) query(s, now);
          stats.raysDeferred += Math.max(0, live.length + waiting.length + others.length - raysPerPump);
        }
        // 3. Admission. Every voice, fading ones included, holds a slot, so this kit never has more than `maxVoices` on
        // the output. Reserved emissions (a voice was cut for each) take free slots first and are not dropped for
        // lateness meanwhile, so a voice is never cut for an emission that then does not start (unless the output
        // refuses it, or the source is cancelled or leaves earshot). Then due emissions in priority order (score tier,
        // least recently served, least served, starvation credit, earliest due, oldest source): a due source whose own voice still
        // plays holds that slot, so the due set fills free + (due sources already playing) slots. Inside them, in order,
        // a playing source crossfades into a free slot or fades its old voice first; a waiting emission takes a free
        // slot, or the slot of a playing source that ranked outside (that one yields; equal repeaters rotate on their
        // beats). Remaining emissions may take voices that are not due, weakest tier first and inside it the
        // longest-playing: a steal needs `stealRatio` times the score; an opt-in rotation an equal score and a voice
        // that has played `rotateAfter`. The pass stops at the first emission that can take none.
        for (const s of sources.values()) s.score = s.gain * s.weight * (isBlocked(s, now) ? blocked.gain : 1);
        const holds = (s: Source) => playing(s) && !fading.has(s.voice!);
        let free = Math.max(0, maxVoices - liveVoices());
        const admit = (s: Source) => { if (start(s, now)) realised++; else if (s.input.every === undefined && !s.voice) retire(s); };
        // Reserved emissions first: a voice was cut for each of them, so the slots its fade frees are theirs.
        for (const s of byPriority([...sources.values()].filter(s => s.dueAt !== null && s.reserved && !holds(s)))) {
          if (s.awaiting && !s.awaiting.ended && fading.has(s.awaiting)) continue;
          if (free > 0) { free--; admit(s); }
        }
        const due = byPriority([...sources.values()].filter(s => s.dueAt !== null && !s.reserved));
        const slots = free + due.filter(holds).length;
        const inside = due.slice(0, slots), outside = due.slice(slots);
        const yielding = outside.filter(holds);
        // A voice is cut (steal, yield, rotation, own fade-first) only for an emission that can still start within
        // `maxLateness` after one fade and one pump, or that became due since the last pump (so slow pumps can still
        // steal; such a start may land after `maxLateness` and is counted in `late`). Otherwise the emission waits for a
        // free slot or is dropped, and no voice is cut for it.
        const fits = (s: Source) => { const waited = now - s.dueAt!; return waited + FADE_HOLD + step <= maxLateness || waited <= step + 1e-9; };
        for (const s of inside) {
          if (s.dueAt === null || sources.get(s.id) !== s) continue;
          if (holds(s)) {
            // Crossfade into a free slot (at the HRTF cap the repeat starts equal-power, see start); with no free slot
            // fade the old voice first and start when its slot frees (one fade plus a pump later).
            if (free > 0) { free--; admit(s); } else if (fits(s)) cutFor(s, s, now);
          } else if (free > 0) { free--; admit(s); }
          else if (fits(s)) { const y = yielding.shift(); if (y) { cutFor(s, y, now); stats.rotated++; } }
        }
        const candidates = outside.filter(s => s.dueAt !== null && !s.reserved && !holds(s));
        if (candidates.length) {
          // Weakest tier first; inside a tier the longest-playing voice, then the most-served source, gives way first.
          const victims = tiers([...sources.values()].filter(v => holds(v) && v.dueAt === null).sort((a, b) => a.score - b.score || a.id - b.id), (a, b) => b.score <= a.score * (1 + TIE),
            (a, b) => a.startedAt - b.startedAt || b.served - a.served || a.id - b.id);
          // Each candidate scans at most the (<= maxVoices) victims; the pass ends at the first candidate that takes none.
          for (const s of candidates) {
            // Opt-in rotation may also reserve while the emission is still within `maxLateness` (it then starts up to one
            // fade and one pump after it, counted in `late`): it needs the wait to find a voice old enough to rotate.
            const k = victims.findIndex(v => (s.score > v.score * stealRatio && fits(s))
              || (Math.abs(s.score - v.score) <= v.score * TIE && now - v.startedAt >= rotateAfter && now - s.dueAt! <= maxLateness));
            if (k < 0) break;
            const [victim] = victims.splice(k, 1);
            if (s.score > victim.score * stealRatio) stats.stolen++; else stats.rotated++;
            cutFor(s, victim, now);
          }
        }
        for (const s of sources.values()) {
          if (s.dueAt === null) continue;
          if (s.reserved && now - s.reservedAt > RESERVE_LIMIT) { stats.dropped++; settle(s); if (s.input.every === undefined && !s.voice) retire(s); continue; }
          s.waitingSince ??= s.dueAt;
        }
        // 4. Follow playing voices: position and filter, written only when they changed enough to matter.
        for (const s of sources.values()) {
          const v = s.voice; if (!v || v.ended || fading.has(v)) continue;
          try {
            const last = s.sentPosition;
            if (!last || Math.hypot(s.position[0] - last[0], s.position[1] - last[1], s.position[2] - last[2]) > 1e-3) { s.sentPosition = s.position; v.setPosition?.(s.position); }
            const f = filterFor(s, now), sent = s.sentFilter;
            if (!sent || Math.abs(Math.log(f.hz / sent.hz)) > .02 || Math.abs(f.gain - sent.gain) > .01) { s.sentFilter = f; v.setFilter?.({ cutoffHz: f.hz, gain: f.gain }, smoothing); }
          } catch (error) { report(s, 'voice', `spatial-audio: voice update failed: ${String(error)}`); }
        }
        let still = 0; for (const s of sources.values()) if (s.dueAt !== null) still++;
        return { realised, waiting: still, rays: stats.rays - raysBefore, dropped: stats.dropped - droppedBefore };
      } finally { pumping = false; }
    },
    /** Whether a source's last occlusion result (fresh or not) says blocked; null when never queried or unknown id. */
    occluded(id: number): boolean | null { return sources.get(id)?.ray?.blocked ?? null; },
    get stats(): SpatialAudioStats {
      let waiting = 0, stale = 0, unqueried = 0, oldestRayAge = 0, fades = 0;
      const now = clock === -Infinity ? 0 : clock;
      for (const v of fading.keys()) if (!v.ended) fades++;
      for (const s of sources.values()) {
        if (s.dueAt !== null) waiting++;
        if (!occ || !playing(s)) continue;
        if (!s.ray) { unqueried++; stale++; continue; }
        oldestRayAge = Math.max(oldestRayAge, now - s.ray.at); if (!fresh(s, now)) stale++;
      }
      return { sources: sources.size, voices: liveVoices(), fading: fades, hrtf: hrtfVoices(), waiting, stale, unqueried, oldestRayAge, ...stats };
    },
    /** Stop this kit's voices and reject new sources. The borrowed output is never closed. Idempotent. */
    dispose(): void {
      if (closed) return; closed = true;
      const errors: unknown[] = [];
      for (const s of [...sources.values()]) { try { if (s.voice && !s.voice.ended) s.voice.stop(); } catch (e) { errors.push(e); } retire(s); }
      for (const v of fading.keys()) { try { if (!v.ended) v.stop(); } catch (e) { errors.push(e); } }
      fading.clear();
      if (errors.length) throw new AggregateError(errors, 'spatial-audio cleanup failed');
    },
  };
}
export type SpatialAudio = ReturnType<typeof createSpatialAudio>;

/** Adapt a ray cast `(origin, unitDirection, maxDistance) => { distance } | null` (terrain surfaces) to a segment query. */
export function segmentQueryFromRaycast(raycast: (origin: { x: number; y: number; z: number }, direction: { x: number; y: number; z: number }, maxDistance: number) => { distance: number } | null): SegmentQuery {
  return (from, to) => {
    const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2], length = Math.hypot(dx, dy, dz);
    if (length === 0) return null;
    const hit = raycast({ x: from[0], y: from[1], z: from[2] }, { x: dx / length, y: dy / length, z: dz / length }, length);
    return hit && hit.distance <= length ? hit.distance : null;
  };
}
