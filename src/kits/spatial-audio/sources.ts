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
  /** Real voices this kit holds at once (1..64, default 24). Stolen, yielding and cancelled voices count while they fade; a source's own replaced voice does not. */
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
  /**
   * Playing voices whose occlusion result is older than `maxAge` right now (they use `unknown`), and the oldest result
   * age among playing voices in seconds. A non-zero `stale` means `raysPerPump` cannot refresh every playing voice
   * within `maxAge`: raise the budget or `maxAge`, or lower the voice count.
   */
  readonly stale: number; readonly oldestRayAge: number;
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
  /** A voice is fading out to free a slot for this waiting emission: it must not steal again. */
  reserved: boolean;
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

  const margin = occ?.margin ?? .05;
  if (occ && !numIn(margin, 0, 10)) throw new RangeError('spatial-audio: invalid occlusion options');

  const sources = new Map<number, Source>();
  /**
   * Voices fading out (~50 ms) before they are stopped. `counted` fades (stolen or cancelled voices) hold their slot
   * in `maxVoices`; a source's own replaced voice does not (its replacement already holds the source's slot).
   */
  const fading = new Map<CueVoice, { stopAt: number; counted: boolean; owner: Source | null }>();
  const stats = { dropped: 0, culled: 0, stolen: 0, rays: 0, raysDeferred: 0, errors: 0 };
  let sequence = 0, clock = -Infinity, closed = false, pumping = false, listener: Point = [0, 0, 0];

  /** Counts every failure; reports each kind of failure once per source. */
  const report = (s: Source | null, kind: string, message: string) => {
    stats.errors++;
    if (s) { if (s.reported.has(kind)) return; s.reported.add(kind); }
    try { o.report?.(message); } catch { /* Diagnostics never interrupt the pump. */ }
  };
  const playing = (s: Source) => !!s.voice && !s.voice.ended;
  const liveVoices = () => { let n = 0; for (const f of fading.values()) if (f.counted) n++; for (const s of sources.values()) if (playing(s)) n++; return n; };
  const hrtfVoices = (except?: Source) => { let n = 0; for (const s of sources.values()) if (s !== except && s.hrtf && playing(s)) n++; return n; };
  /** Ramp a voice's filter gain to 0 at its current cutoff (no brightening), then stop it on a later pump. */
  const fadeOut = (voice: CueVoice, owner: Source | null, now: number, counted: boolean) => {
    if (voice.ended || fading.has(voice)) return;
    try { voice.setFilter?.({ cutoffHz: owner?.sentFilter?.hz ?? OPEN_HZ, gain: 0 }, FADE); fading.set(voice, { stopAt: now + FADE_HOLD, counted, owner }); }
    catch (error) { report(owner, 'voice', `spatial-audio: voice fade failed: ${String(error)}`); stop(voice, owner); }
  };
  const stop = (voice: CueVoice, owner: Source | null) => {
    try { if (!voice.ended) voice.stop(); } catch (error) { report(owner, 'voice', `spatial-audio: voice stop failed: ${String(error)}`); }
  };
  const release = (s: Source, now: number) => { if (playing(s)) fadeOut(s.voice!, s, now, true); s.voice = null; s.hrtf = false; };
  const settle = (s: Source) => { s.dueAt = null; s.reserved = false; s.emitted ||= s.input.every === undefined; };
  const retire = (s: Source) => { sources.delete(s.id); s.reserved = false; s.off?.(); s.off = undefined; };
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
  /** Start the source's due emission. A previous voice of the same source is replaced (faded, not counted). */
  const start = (s: Source, now: number): boolean => {
    const c = s.cls, hrtf = !!c.localise && hrtfVoices(s) < maxHrtf, f = filterFor(s, now);
    let voice: CueVoice | null = null;
    try {
      voice = o.output.playVoice(s.input.cue, {
        variant: s.input.variant, gain: s.input.gain,
        spatial: { position: s.position, refDistance: c.refDistance, rolloffFactor: c.rolloffFactor, maxDistance: c.maxDistance ?? c.cutoffDistance, distanceModel: c.distanceModel, cutoffDistance: c.cutoffDistance, panning: hrtf ? 'HRTF' : 'equalpower' },
        filter: { cutoffHz: f.hz, gain: f.gain },
      });
    } catch (error) { report(s, 'playback', `spatial-audio: playback of '${s.input.cue}' failed: ${String(error)}`); }
    settle(s);
    if (!voice) { stats.dropped++; return false; }
    if (playing(s)) fadeOut(s.voice!, s, now, false);
    s.voice = voice; s.hrtf = voice.panning === 'HRTF'; s.sentPosition = s.position; s.sentFilter = f; s.startedAt = now;
    return true;
  };

  /** Stop tracking a source; its playing voice fades out. Idempotent. */
  const cancel = (id: number): boolean => {
    const s = sources.get(id); if (!s) return false;
    release(s, clock === -Infinity ? 0 : clock); retire(s); return true;
  };

  /** Seconds since the source's last occlusion result, or since its voice started when it has none. */
  const rayAge = (s: Source, now: number) => now - (s.ray?.at ?? s.startedAt);
  const query = (s: Source, now: number) => {
    if (!occ) return;
    stats.rays++;
    try {
      const hit = occ.query(listener, s.position);
      if (hit !== null && (!Number.isFinite(hit) || hit < 0)) throw new RangeError('query must return a finite distance >= 0 or null');
      s.ray = { blocked: hit !== null && hit > margin && hit < s.distance - margin, at: now };
    } catch (error) { report(s, 'occlusion', `spatial-audio: occlusion query failed: ${String(error)}`); }
  };
  /** Ordering for waiting emissions: score, then the longest-waiting, then the oldest source. */
  const byPriority = (a: Source, b: Source) => b.score - a.score || (a.dueAt ?? 0) - (b.dueAt ?? 0) || a.id - b.id;

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
        position: [0, 0, 0], sentPosition: null, sentFilter: null, ray: null, reported: new Set(), startedAt: now, reserved: false };
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
            else if (now - s.nextAt > maxLateness) { s.dueAt = now; s.nextAt = now + every; }
            else { s.dueAt = s.nextAt; s.nextAt += every; }
          }
          if (s.dueAt !== null && s.gain === 0) { stats.culled++; settle(s); }
          if (s.dueAt !== null && now - s.dueAt > maxLateness) { stats.dropped++; settle(s); }
          if (s.input.every === undefined && s.emitted && s.dueAt === null && !s.voice) { retire(s); continue; }
        }
        // 2. Occlusion. Half the budget (rounded up) refreshes playing voices, stalest first, so new emissions cannot
        // starve them; the rest goes to any candidate, stalest first, then by score.
        if (occ && raysPerPump > 0) {
          const live: Source[] = [], all: Source[] = [];
          for (const s of sources.values()) {
            if (s.gain <= 0) continue;
            s.score = s.gain * s.weight;
            if (playing(s)) live.push(s);
            if (playing(s) || s.dueAt !== null) all.push(s);
          }
          // Oldest information first: time since the last result, or since the voice started when it has none, so a
          // long-playing voice is not starved by a stream of new ones (those get the other half of the budget).
          live.sort((a, b) => rayAge(b, now) - rayAge(a, now) || b.score - a.score || a.id - b.id);
          const done = new Set<Source>();
          for (const s of live.slice(0, Math.ceil(raysPerPump / 2))) { query(s, now); done.add(s); }
          const rest = all.filter(s => !done.has(s)).sort((a, b) => (a.ray?.at ?? -Infinity) - (b.ray?.at ?? -Infinity) || b.score - a.score || a.id - b.id);
          for (const s of rest.slice(0, raysPerPump - done.size)) query(s, now);
          stats.raysDeferred += Math.max(0, all.length - raysPerPump);
        }
        // 3. Admission, in priority order (score, then longest-waiting, then oldest source). A due source whose own
        // voice still plays holds that slot, so the due set can fill free + (due sources already playing) slots. A
        // playing source that ranks outside them yields: its voice fades and the slot is reserved for a waiting
        // emission that ranked inside (equal sources rotate instead of starving). A source replacing its own voice
        // needs no free slot. Remaining emissions may steal the weakest non-due voices, strongest first, stopping at
        // the first that does not clear `stealRatio`; an emission with a reserved slot never steals again.
        for (const s of sources.values()) s.score = s.gain * s.weight * (isBlocked(s, now) ? blocked.gain : 1);
        const due = [...sources.values()].filter(s => s.dueAt !== null).sort(byPriority);
        const holds = (s: Source) => playing(s) && !fading.has(s.voice!);
        let free = Math.max(0, maxVoices - liveVoices());
        const admit = (s: Source) => { if (start(s, now)) realised++; else if (s.input.every === undefined && !s.voice) retire(s); };
        const slots = free + due.filter(holds).length;
        const inside = due.slice(0, slots), outside = due.slice(slots);
        const yielding = outside.filter(holds);
        for (const s of inside) if (holds(s)) admit(s);
        for (const s of inside.filter(s => s.dueAt !== null)) {
          if (free > 0) { free--; admit(s); }
          else if (s.reserved) continue;
          else { const y = yielding.shift(); if (y) { release(y, now); s.reserved = true; stats.stolen++; } }
        }
        const candidates = outside.filter(s => s.dueAt !== null && !s.reserved && !holds(s));
        if (candidates.length) {
          const weakest = [...sources.values()].filter(v => holds(v) && v.dueAt === null).sort((a, b) => a.score - b.score || b.id - a.id);
          for (let i = 0; i < candidates.length && i < weakest.length; i++) {
            const s = candidates[i], victim = weakest[i];
            if (!(s.score > victim.score * stealRatio)) break;
            release(victim, now); s.reserved = true; stats.stolen++;
          }
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
      let waiting = 0, stale = 0, oldestRayAge = 0;
      const now = clock === -Infinity ? 0 : clock;
      for (const s of sources.values()) {
        if (s.dueAt !== null) waiting++;
        if (occ && playing(s)) { const age = rayAge(s, now); oldestRayAge = Math.max(oldestRayAge, age); if (age > maxAge) stale++; }
      }
      return { sources: sources.size, voices: liveVoices(), hrtf: hrtfVoices(), waiting, stale, oldestRayAge, ...stats };
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
