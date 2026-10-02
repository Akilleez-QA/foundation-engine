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
}

export interface SpatialAudioLimits {
  /** Logical sources tracked at once (1..1024, default 128). `emit` returns null when full. */
  maxSources?: number;
  /** Real voices this kit holds at once, including fading ones (1..64, default 24). */
  maxVoices?: number;
  /** Voices this kit asks to pan with HRTF (0..maxVoices, default 6). The output's own HRTF limit also applies. */
  maxHrtfVoices?: number;
  /** Occlusion queries per pump (0..256, default 8). */
  raysPerPump?: number;
  /** Seconds an emission may wait virtually for a voice before it is dropped (0..2, default .15). */
  maxLateness?: number;
  /** A waiting emission steals the weakest voice only when its score is this many times higher (1..10, default 1.5). */
  stealRatio?: number;
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
}

export interface SpatialAudioStats {
  readonly sources: number; readonly voices: number; readonly hrtf: number; readonly waiting: number;
  /** Emissions dropped: waited longer than maxLateness, or the output refused them. */
  readonly dropped: number;
  /** Emissions skipped because the source was beyond its class cutoff. */
  readonly culled: number;
  readonly stolen: number; readonly rays: number;
  /** Ray candidates left unqueried because the per-pump budget ran out (cumulative). */
  readonly raysDeferred: number;
  readonly errors: number;
}
export interface PumpResult { realised: number; waiting: number; rays: number; dropped: number }

const CEILING = { sources: 1024, voices: 64, rays: 256 } as const;
const FADE = .01, FADE_HOLD = .06, OPEN_HZ = 20000;

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
 * whether an event is audible to a player before disclosing it.
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
}

export function createSpatialAudio(o: SpatialAudioOptions) {
  const l = o.limits ?? {};
  const maxSources = l.maxSources ?? 128, maxVoices = l.maxVoices ?? 24, maxHrtf = l.maxHrtfVoices ?? Math.min(6, maxVoices);
  const raysPerPump = l.raysPerPump ?? 8, maxLateness = l.maxLateness ?? .15, stealRatio = l.stealRatio ?? 1.5;
  const smoothing = o.filterSmoothing ?? .08;
  if (!intIn(maxSources, 1, CEILING.sources) || !intIn(maxVoices, 1, CEILING.voices) || !intIn(maxHrtf, 0, maxVoices) || !intIn(raysPerPump, 0, CEILING.rays)
    || !numIn(maxLateness, 0, 2) || !numIn(stealRatio, 1, 10) || !numIn(smoothing, .005, 2)) throw new RangeError('spatial-audio: invalid limits');
  const classes = new Map<string, SoundClass>();
  for (const [id, c] of Object.entries(o.classes)) { validateSoundClass(id, c); classes.set(id, structuredClone(c)); }
  if (!classes.size) throw new RangeError('spatial-audio: at least one sound class is required');
  const occ = o.occlusion;
  const blocked = occ?.blocked ?? { cutoffHz: 1000, gain: .5 }, maxAge = occ?.maxAge ?? .5, unknownBlocked = occ?.unknown === 'blocked';
  if (occ && (typeof occ.query !== 'function' || !numIn(blocked.cutoffHz, 10, 24000) || !numIn(blocked.gain, 0, 1) || !numIn(maxAge, 0, 60))) throw new RangeError('spatial-audio: invalid occlusion options');

  const sources = new Map<number, Source>();
  /** Voices being faded out (stolen or replaced); they hold their slot until stopped. */
  const fading = new Map<CueVoice, number>();
  const stats = { dropped: 0, culled: 0, stolen: 0, rays: 0, raysDeferred: 0, errors: 0 };
  let sequence = 0, clock = -Infinity, closed = false, pumping = false, listener: Point = [0, 0, 0];

  /** Counts every failure; reports each kind of failure once per source. */
  const report = (s: Source | null, kind: string, message: string) => {
    stats.errors++;
    if (s) { if (s.reported.has(kind)) return; s.reported.add(kind); }
    try { o.report?.(message); } catch { /* Diagnostics never interrupt the pump. */ }
  };
  const liveVoices = () => { let n = fading.size; for (const s of sources.values()) if (s.voice && !s.voice.ended) n++; return n; };
  const hrtfVoices = () => { let n = 0; for (const s of sources.values()) if (s.hrtf && s.voice && !s.voice.ended) n++; return n; };
  const fadeOut = (voice: CueVoice, now: number) => {
    if (voice.ended || fading.has(voice)) return;
    try { voice.setFilter?.({ cutoffHz: OPEN_HZ, gain: 0 }, FADE); fading.set(voice, now + FADE_HOLD); }
    catch { voice.stop(); }
  };
  const retire = (s: Source) => { sources.delete(s.id); s.off?.(); s.off = undefined; };
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
  const start = (s: Source, now: number): boolean => {
    const c = s.cls, hrtf = !!c.localise && hrtfVoices() < maxHrtf, f = filterFor(s, now);
    let voice: CueVoice | null = null;
    try {
      voice = o.output.playVoice(s.input.cue, {
        variant: s.input.variant, gain: s.input.gain,
        spatial: { position: s.position, refDistance: c.refDistance, rolloffFactor: c.rolloffFactor, maxDistance: c.maxDistance ?? c.cutoffDistance, distanceModel: c.distanceModel, cutoffDistance: c.cutoffDistance, panning: hrtf ? 'HRTF' : 'equalpower' },
        filter: { cutoffHz: f.hz, gain: f.gain },
      });
    } catch (error) { report(s, 'playback', `spatial-audio: playback of '${s.input.cue}' failed: ${String(error)}`); }
    if (!voice) { stats.dropped++; return false; }
    if (s.voice && !s.voice.ended) fadeOut(s.voice, now);
    s.voice = voice; s.hrtf = voice.panning === 'HRTF'; s.sentPosition = s.position; s.sentFilter = f; s.emitted = true;
    return true;
  };

  /** Stop tracking a source; its playing voice fades out. Idempotent. */
  const cancel = (id: number): boolean => {
    const s = sources.get(id); if (!s) return false;
    if (s.voice && !s.voice.ended) fadeOut(s.voice, clock === -Infinity ? 0 : clock);
    retire(s); return true;
  };

  return {
    cancel,
    /** Track a source. Null when full or disposed. The id cancels it. */
    emit(input: SourceInput, now: number): number | null {
      const cls = classes.get(input.class);
      if (!cls) throw new RangeError(`spatial-audio: unknown sound class '${input.class}'`);
      if (typeof input.cue !== 'string' || !input.cue || (typeof input.position !== 'function' && !finite3(input.position))
        || (input.every !== undefined && !numIn(input.every, .05, 3600)) || (input.gain !== undefined && !numIn(input.gain, 0, 1))
        || !Number.isSafeInteger(input.variant ?? 0) || !Number.isFinite(now)) throw new RangeError('spatial-audio: invalid source');
      if (closed || sources.size >= maxSources || input.signal?.aborted) return null;
      const id = ++sequence;
      const s: Source = { id, input: { ...input }, cls, nextAt: now, dueAt: null, emitted: false, voice: null, hrtf: false, score: 0, weight: 0, gain: 0, distance: Infinity,
        position: [0, 0, 0], sentPosition: null, sentFilter: null, ray: null, reported: new Set() };
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
      pumping = true; clock = now; listener = [at[0], at[1], at[2]];
      const droppedBefore = stats.dropped; let realised = 0, rays = 0;
      try {
        for (const [voice, stopAt] of fading) if (voice.ended || now >= stopAt) { fading.delete(voice); if (!voice.ended) voice.stop(); }
        // 1. Track every source: position, distance, class gain, due emissions and lateness.
        for (const s of [...sources.values()]) {
          if (s.voice?.ended) { s.voice = null; s.hrtf = false; }
          const p = read(s);
          if (!p) { if (s.voice) fadeOut(s.voice, now); retire(s); continue; }
          s.position = p; s.distance = Math.hypot(p[0] - listener[0], p[1] - listener[1], p[2] - listener[2]);
          s.gain = classGain(s.cls, s.distance);
          s.weight = s.gain > 0 && (s.voice || s.dueAt !== null || now >= s.nextAt) ? importance(s) : 0;
          if (s.dueAt === null && now >= s.nextAt && (s.input.every !== undefined || !s.emitted)) {
            // A repeating source that missed its slot by more than the lateness (a long frame, a hidden tab) emits
            // once now instead of replaying or dropping the missed ones.
            s.dueAt = s.input.every !== undefined && now - s.nextAt > maxLateness ? now : s.nextAt;
            if (s.input.every !== undefined) s.nextAt = Math.max(s.nextAt + s.input.every, now + s.input.every * .5);
            else s.nextAt = Infinity;
          }
          if (s.dueAt !== null && s.gain === 0) { stats.culled++; s.dueAt = null; s.emitted ||= s.input.every === undefined; }
          if (s.dueAt !== null && now - s.dueAt > maxLateness) { stats.dropped++; s.dueAt = null; s.emitted ||= s.input.every === undefined; }
          if (s.input.every === undefined && s.emitted && s.dueAt === null && !s.voice) { retire(s); continue; }
        }
        // 2. Occlusion: the stalest relevant paths first (then the most important), within the ray budget.
        if (occ) {
          const candidates = [...sources.values()].filter(s => s.gain > 0 && (s.voice || s.dueAt !== null));
          for (const s of candidates) s.score = s.gain * s.weight;
          candidates.sort((a, b) => (a.ray?.at ?? -Infinity) - (b.ray?.at ?? -Infinity) || b.score - a.score || a.id - b.id);
          for (const s of candidates.slice(0, raysPerPump)) {
            rays++; stats.rays++;
            try {
              const hit = occ.query(listener, s.position);
              if (hit !== null && (!Number.isFinite(hit) || hit < 0)) throw new RangeError('query must return a finite distance >= 0 or null');
              s.ray = { blocked: hit !== null && hit < s.distance - 1e-6, at: now };
            } catch (error) { report(s, 'occlusion', `spatial-audio: occlusion query failed: ${String(error)}`); }
          }
          stats.raysDeferred += Math.max(0, candidates.length - raysPerPump);
        }
        // 3. Rank waiting emissions; realise the best, stealing only from clearly weaker voices.
        for (const s of sources.values()) s.score = s.gain * s.weight * (isBlocked(s, now) ? blocked.gain : 1);
        const waiting = [...sources.values()].filter(s => s.dueAt !== null).sort((a, b) => b.score - a.score || a.id - b.id);
        let live = liveVoices();
        for (const s of waiting) {
          if (live >= maxVoices) {
            let weakest: Source | null = null;
            for (const v of sources.values()) if (v.voice && !v.voice.ended && !fading.has(v.voice) && (!weakest || v.score < weakest.score)) weakest = v;
            if (weakest && s.score > weakest.score * stealRatio) { fadeOut(weakest.voice!, now); weakest.voice = null; weakest.hrtf = false; stats.stolen++; }
            continue; // The stolen slot frees after its fade; this emission waits (within maxLateness).
          }
          s.dueAt = null;
          if (start(s, now)) { realised++; live++; }
          else if (s.input.every === undefined && !s.voice) retire(s);
        }
        // 4. Follow playing voices: position and filter, written only when they changed enough to matter.
        for (const s of sources.values()) {
          const v = s.voice; if (!v || v.ended || fading.has(v)) continue;
          const last = s.sentPosition;
          if (!last || Math.hypot(s.position[0] - last[0], s.position[1] - last[1], s.position[2] - last[2]) > 1e-3) { v.setPosition?.(s.position); s.sentPosition = s.position; }
          const f = filterFor(s, now), sent = s.sentFilter;
          if (!sent || Math.abs(Math.log(f.hz / sent.hz)) > .02 || Math.abs(f.gain - sent.gain) > .01) { v.setFilter?.({ cutoffHz: f.hz, gain: f.gain }, smoothing); s.sentFilter = f; }
        }
        let still = 0; for (const s of sources.values()) if (s.dueAt !== null) still++;
        return { realised, waiting: still, rays, dropped: stats.dropped - droppedBefore };
      } finally { pumping = false; }
    },
    /** Whether a source's last occlusion result (fresh or not) says blocked; null when never queried or unknown id. */
    occluded(id: number): boolean | null { return sources.get(id)?.ray?.blocked ?? null; },
    get stats(): SpatialAudioStats {
      let waiting = 0; for (const s of sources.values()) if (s.dueAt !== null) waiting++;
      return { sources: sources.size, voices: liveVoices(), hrtf: hrtfVoices(), waiting, ...stats };
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
