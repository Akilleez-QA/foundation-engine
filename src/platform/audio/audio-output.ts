/**
 * platform/audio/audio-output.ts: the one audio output (STANDARD STD-SYS-16). It owns the page's only AudioContext
 * (lint rule `audio-context`), a master gain that follows the `sound.muted` and `sound.effects` settings, synthesised
 * effect cues registered as data, and one music channel.
 *
 * Test browsers and benches must stay silent (STD-TST-8): when `silent()` is true (the `dev.silent` flag, set by
 * `?silent-test` or `?flags=dev.silent`), the output never creates an AudioContext and never plays an element, so
 * nothing can reach the user's speakers. It never touches the user's system or application audio in any mode; the
 * harness also launches browsers with `--mute-audio`.
 *
 * Cues are data (`CueDef`): a recipe of tone sweeps and filtered noise, synthesised once per sample rate and cached.
 * Games register their own cues; a cue id without a row plays nothing and is reported once.
 *
 * Sound files: a game's own recordings (`defineAsset({ type: 'audio' })`) play through the same voices, spatial chain,
 * gain, mute, hidden-tab and listener rules. The composition root resolves a sound id to its URL (`sound`);
 * `sound-files.ts` fetches, keeps and decodes it within its bounds. A file that is not decoded yet is loaded on first
 * use; a voice asked to `wait` starts when it is ready if that is within the wait, and is otherwise dropped (counted
 * as skipped). `preload` fetches ahead (a scene's `sounds`); held files decode once a context exists (unlock).
 */
import { monotonicNow } from '../../core/clock';
import { createSoundFiles, type SoundFileOptions, type SoundFileStats } from './sound-files';
import type { AudioClockReading } from './audio-timeline';

/** One synthesis step: a tone sweep (sine, `hz` → `end`) or a burst of low-passed noise ("air"). Times in seconds. */
export type CueStep =
  | { tone: { at: number; duration: number; hz: number; end?: number; gain?: number } }
  | { air: { at: number; duration: number; cutoff: number; gain: number } };

export interface CueDef {
  /** '<area>.<name>': 'ui.click', 'ui.success'. */
  id: string;
  /** Caption string key for captioned audio (the caller shows it when captions are on). */
  caption?: string;
  duration: number;
  steps: readonly CueStep[];
}

/** Neutral interface cues every game gets. */
export const CORE_CUES: readonly CueDef[] = [
  { id: 'ui.click', caption: 'audio.cue.click', duration: .08, steps: [{ tone: { at: 0, duration: .065, hz: 540, end: 360, gain: .065 } }, { air: { at: 0, duration: .04, cutoff: 1800, gain: .05 } }] },
  { id: 'ui.success', caption: 'audio.cue.success', duration: .85, steps: [392, 494, 587].map((hz, i) => ({ tone: { at: i * .14, duration: .5, hz, gain: .11 } })) },
  { id: 'ui.arrive', caption: 'audio.cue.arrive', duration: .9, steps: [330, 494, 659].map((hz, i) => ({ tone: { at: i * .14, duration: .55, hz, gain: .1 } })) },
  { id: 'ui.count', caption: 'audio.cue.count', duration: .19, steps: [{ tone: { at: 0, duration: .18, hz: 660, gain: .1 } }] },
  { id: 'ui.bump', caption: 'audio.cue.bump', duration: .2, steps: [{ tone: { at: 0, duration: .12, hz: 170, end: 90, gain: .2 } }, { air: { at: 0, duration: .09, cutoff: 1400, gain: .12 } }] },
];

/** Bound authored synthesis work before allocating or registering output resources. */
function validateCue(cue: CueDef): void {
  if (typeof cue.id !== 'string' || !cue.id || cue.id.length > 256 || !Number.isFinite(cue.duration) || cue.duration <= 0 || cue.duration > 60 || !Array.isArray(cue.steps) || cue.steps.length > 128) throw Error('invalid audio cue');
  for (const step of cue.steps) {
    const value = 'tone' in step ? step.tone : step.air;
    const gain = value.gain ?? .1;
    if (!Number.isFinite(value.at) || value.at < 0 || !Number.isFinite(value.duration) || value.duration <= 0 || value.at + value.duration > cue.duration + 1e-9 || !Number.isFinite(gain) || gain < 0 || gain > 1) throw Error('invalid audio step');
    const frequencies = 'tone' in step ? [step.tone.hz, step.tone.end ?? step.tone.hz] : [step.air.cutoff];
    if (frequencies.some(n => !Number.isFinite(n) || n <= 0 || n > 192000)) throw Error('invalid cue frequency');
  }
}

/** Samples for one cue at `rate`. Deterministic per `variant` (the noise seed). Starts and ends at silence. */
export function synthCue(cue: CueDef, rate: number, variant = 0): Float32Array<ArrayBuffer> {
  validateCue(cue);
  if (!Number.isFinite(rate) || rate <= 0 || rate > 384000 || !Number.isSafeInteger(variant) || Math.ceil(cue.duration * rate) > 4194304) throw Error('invalid or oversized audio synthesis');
  const out = new Float32Array(Math.ceil(cue.duration * rate));
  let seed = 12345 + variant * 7919;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2147483648 - 1; };
  for (const step of cue.steps) {
    if ('tone' in step) {
      const { at, duration, hz, end = hz, gain = .1 } = step.tone;
      let phase = 0;
      for (let i = 0; i < duration * rate; i++) {
        const j = Math.floor(at * rate) + i; if (j >= out.length) break;
        const t = i / rate, u = t / duration;
        phase += 2 * Math.PI * (hz + (end - hz) * u) / rate;
        const env = Math.min(1, t / .01) * Math.min(1, (duration - t) / .03);
        out[j] += gain * Math.max(0, env) * Math.sin(phase);
      }
    } else {
      const { at, duration, cutoff, gain } = step.air;
      let low = 0; const a = 1 - Math.exp(-2 * Math.PI * cutoff / rate);
      for (let i = 0; i < duration * rate; i++) {
        const j = Math.floor(at * rate) + i; if (j >= out.length) break;
        low += a * (random() - low);
        const t = i / rate, env = Math.min(1, t / .005) * Math.exp(-3 * t / duration);
        out[j] += gain * env * low;
      }
    }
  }
  // Every buffer starts and ends at silence (no clicks).
  const edge = Math.min(Math.floor(rate * .004), Math.floor(out.length / 2));
  for (let i = 0; i < edge; i++) { out[i] *= i / edge; out[out.length - 1 - i] *= i / edge; }
  return out;
}

/** True at most once per `seconds`: for cues tied to events that can repeat quickly. */
export function cueGate(seconds: number, clock: () => number = () => monotonicNow() / 1000) {
  let at = -Infinity;
  return () => { const now = clock(); if (now - at < seconds) return false; at = now; return true; };
}

/** What the output needs from the world; the composition root wires the settings service and the feature flags. */
export interface AudioOutputOptions {
  /** True in tests and benches: no AudioContext is ever created and nothing plays. */
  silent(): boolean;
  muted(): boolean;
  /** Effects volume 0–1. */
  effects(): number;
  /** Music volume 0–1. */
  music(): number;
  /** Turns a music URL as given into the one the element loads (the composition root: the build's public base). */
  resolveUrl?(url: string): string;
  /** Subscribe to changes of muted/volumes (the settings service). Returns an unsubscribe. */
  onChange?(fn: () => void): () => void;
  cues?: readonly CueDef[];
  /** Injected for tests. */
  createContext?: () => AudioContext;
  createElement?: () => HTMLAudioElement;
  /** Diagnostics cannot interrupt voice cleanup; reporter failures use a best-effort console fallback. */
  report?: (message: string) => void;
  maxVoices?: number;
  maxBuffers?: number;
  /** Decoded mono sample bytes retained in the cache (default 16 MiB). */
  maxBufferBytes?: number;
  /** A game's sound files: the URL of a sound id, or undefined when the id is not a sound. */
  sound?(id: string): string | undefined;
  /** Bounds and the injected fetch for sound files (`sound-files.ts`); separate from the cue cache above. */
  files?: Omit<SoundFileOptions, 'report'>;
  /**
   * Voices that may use the 'HRTF' panner at once (default min(8, maxVoices); 0 disables HRTF). A request beyond it is
   * downgraded to 'equalpower' and counted in `stats.downgraded`, never refused. Changed later by `setHrtfLimit`.
   */
  maxHrtfVoices?: number;
  /**
   * Time constant in seconds for listener and spatial position updates: [0, 1], default 0 (instant writes, the
   * behaviour before smoothing existed). A positive value ramps each changed parameter with `setTargetAtTime` (~95%
   * after three time constants), which removes zipper noise from small per-update moves. Camera cuts, 180-degree snaps
   * and paths through the listener still flip the image, only more slowly. Browsers without listener AudioParams
   * (Firefox) and panners without position AudioParams still write instantly.
   */
  smoothing?: number;
  /** Largest lead, in seconds, of a voice started at a future context time (`at`). Default 10. */
  maxStartAhead?: number;
}

export type AudioVector = readonly [number, number, number];
/** Panner algorithm (Web Audio `PanningModelType`). 'equalpower' folds front/back and ignores elevation; 'HRTF' does not. */
export type PanningModel = 'equalpower' | 'HRTF';
/** Distance attenuation law (Web Audio `DistanceModelType`). Only 'linear' reads `maxDistance`. */
export type DistanceModel = 'inverse' | 'linear' | 'exponential';
export const PANNING_MODELS: readonly PanningModel[] = ['equalpower', 'HRTF'];
export const DISTANCE_MODELS: readonly DistanceModel[] = ['inverse', 'linear', 'exponential'];
/** The largest distance (world units) any spatial field accepts. */
export const MAX_SPATIAL_DISTANCE = 1e6;
/** Time constant (s) of the fade when a playing voice crosses its `cutoffDistance` (silent within ~50 ms). */
export const CUTOFF_TIME_CONSTANT = .01;
/** Default and bounds of the filter stage's time constant (s). */
export const FILTER_TIME_CONSTANT = { default: .03, min: .005, max: 2 } as const;

export interface SpatialCue {
  position: AudioVector;
  /** Distance where attenuation starts: (0, 1e6], default 1. */
  refDistance?: number;
  /**
   * [refDistance, 1e6], default 100. Only the 'linear' model reads it (its gain floor is reached here). The 'inverse'
   * and 'exponential' models ignore it, as the Web Audio spec defines: use `cutoffDistance` for silence.
   */
  maxDistance?: number;
  /** [0, 100], default 1. The 'linear' model clamps it to [0, 1] (spec). */
  rolloffFactor?: number;
  /**
   * Default 'equalpower' (unchanged). 'HRTF' is granted while the output has a free HRTF slot (`maxHrtfVoices`);
   * otherwise the voice plays with 'equalpower' and `stats.downgraded` counts it. HRTF never refuses playback. A full
   * limit first reclaims the slot of a voice its cutoff has kept silent for 50 ms or more (that voice stays equal-power).
   */
  panning?: PanningModel;
  /** Default 'inverse' (unchanged). */
  distanceModel?: DistanceModel;
  /**
   * Audible cutoff for any model: [refDistance, 1e6], default none. A start beyond it is refused (`stats.culled`); a
   * playing voice that moves (or whose listener moves) beyond it fades to silence and returns when back in range.
   */
  cutoffDistance?: number;
  /** Time constant (s) of `setPosition` ramps (small per-update moves; large jumps still flip): [0, 1], default the output's `smoothing`. 0 writes instantly. */
  smoothing?: number;
}
/** The optional per-voice low-pass and gain stage ("muffle"), for occlusion, air absorption or effects. */
export interface CueFilter {
  /** Low-pass cutoff: [10, 24000] Hz (the browser clamps it to the Nyquist frequency). */
  cutoffHz: number;
  /** Extra gain [0, 1], default 1. */
  gain?: number;
}
export interface CueVoice {
  readonly ended: boolean;
  /** The panning model in effect (null for a non-spatial voice). Optional so wrappers need not forward it. */
  readonly panning?: PanningModel | null;
  /** Per-voice gain, multiplied by the user's effects volume. */
  setGain(gain: number): void;
  setPosition?(position: AudioVector): void;
  /**
   * Ramp the filter stage (the voice must have been started with `filter`) towards new values with `setTargetAtTime`.
   * `timeConstant` in seconds: [0.005, 2], default 0.03; there is no instant path, so changes cannot click.
   */
  setFilter?(filter: CueFilter, timeConstant?: number): void;
  stop(): void;
}
export interface CueVoiceOptions {
  variant?: number; gain?: number; spatial?: SpatialCue; onEnded?: () => void;
  /** Adds the filter stage, starting at these values (no ramp at start). */
  filter?: CueFilter;
  /** Playback rate, 0.25…4: 2 is an octave up and twice as fast. Default 1. */
  rate?: number;
  /** A sound file still loading may start up to this many ms late (0…5000; default 0: dropped instead). */
  wait?: number;
  /** Context seconds to start at (an audio timeline's `when`); omitted or past: now. A pending voice holds its slot. */
  at?: number;
}
/** Playback rate bounds (`CueVoiceOptions.rate`). */
export const RATE_LIMITS = { min: .25, max: 4 } as const;
export const MAX_WAIT_MS = 5000;
export interface AudioStats {
  readonly contexts: number; readonly played: number;
  /** Starts refused (silent, muted, locked, unknown id, voice limit). */
  readonly skipped: number;
  /** Voices playing now. */
  readonly active: number;
  /** Voices using the 'HRTF' panner now, and the current limit. */
  readonly hrtfActive: number; readonly hrtfLimit: number;
  /** 'HRTF' requests played with 'equalpower', plus HRTF voices moved to 'equalpower' when the limit fell. */
  readonly downgraded: number;
  /** Spatial starts refused because the source was beyond its `cutoffDistance` (not counted in `skipped`). */
  readonly culled: number;
}

/**
 * The distance gain of one model, exactly as the Web Audio spec defines it (PannerNode "Distance Effects"), for
 * tests, tools and host-side audibility rules. The 'linear' model clamps the distance to [ref, max] and the rolloff
 * to [0, 1]; 'inverse' and 'exponential' clamp only below `refDistance` and never read `maxDistance`.
 */
export function distanceGain(model: DistanceModel, distance: number, spatial: Pick<SpatialCue, 'refDistance' | 'maxDistance' | 'rolloffFactor'> = {}): number {
  const ref = spatial.refDistance ?? 1, max = spatial.maxDistance ?? 100, rolloff = spatial.rolloffFactor ?? 1;
  if (!(distance >= 0) || !(ref > 0) || !(max >= ref) || !(rolloff >= 0)) throw Error('invalid distance gain input');
  if (model === 'linear') {
    const f = Math.min(1, rolloff);
    return max === ref ? 1 - f : 1 - f * (Math.min(Math.max(distance, ref), max) - ref) / (max - ref);
  }
  if (model === 'exponential') return Math.pow(Math.max(distance, ref) / ref, -rolloff);
  return ref / (ref + rolloff * (Math.max(distance, ref) - ref));
}

/**
 * The gain a spatial cue gets from distance at `listener`, including its audible cutoff (0 beyond it). Panning,
 * cone and filter effects are not included.
 */
export function audibleGain(spatial: SpatialCue, listener: AudioVector): number {
  const d = Math.hypot(spatial.position[0] - listener[0], spatial.position[1] - listener[1], spatial.position[2] - listener[2]);
  if (spatial.cutoffDistance !== undefined && d > spatial.cutoffDistance) return 0;
  return distanceGain(spatial.distanceModel ?? 'inverse', d, spatial);
}

/** Arrays and typed arrays of three finite numbers are accepted (as before); the output keeps its own copy. */
const vector = (p: ArrayLike<number>) => { if (!p || p.length !== 3 || ![0, 1, 2].every(i => Number.isFinite(p[i]))) throw Error('invalid audio position'); };
const copy = (p: ArrayLike<number>): AudioVector => [p[0], p[1], p[2]];
const within = (n: number | undefined, min: number, max: number) => n === undefined || (typeof n === 'number' && n >= min && n <= max);
function validateSpatial(p: SpatialCue): void {
  vector(p.position);
  const ref = p.refDistance ?? 1;
  if (!within(ref, Number.MIN_VALUE, MAX_SPATIAL_DISTANCE) || !within(p.maxDistance ?? 100, ref, MAX_SPATIAL_DISTANCE) || !within(p.rolloffFactor, 0, 100)
    || !within(p.cutoffDistance, ref, MAX_SPATIAL_DISTANCE) || !within(p.smoothing, 0, 1)
    || (p.panning !== undefined && !PANNING_MODELS.includes(p.panning)) || (p.distanceModel !== undefined && !DISTANCE_MODELS.includes(p.distanceModel))) throw Error('invalid spatial cue');
}
function validateFilter(f: CueFilter, timeConstant: number = FILTER_TIME_CONSTANT.default): void {
  if (!f || !within(f.cutoffHz, 10, 24000) || typeof f.cutoffHz !== 'number' || !within(f.gain, 0, 1) || !within(timeConstant, FILTER_TIME_CONSTANT.min, FILTER_TIME_CONSTANT.max)) throw Error('invalid cue filter');
}

/**
 * What `playVoice` does to its options before playing, shared with headless test doubles: a copy that owns its
 * spatial block (position as a plain `[x, y, z]` of the first three entries) and filter, then validated. Throws on the
 * first problem.
 */
export function normalizeCueVoiceOptions(options: CueVoiceOptions = {}): CueVoiceOptions {
  const copied: CueVoiceOptions = { ...options, ...(options.spatial ? { spatial: { ...options.spatial, position: copy(options.spatial.position) } } : {}), ...(options.filter ? { filter: { ...options.filter } } : {}) };
  validateCueVoiceOptions(copied);
  return copied;
}

/** The checks `playVoice` applies to its (normalised) options. Throws on the first problem. */
export function validateCueVoiceOptions(options: CueVoiceOptions = {}): void {
  const gain = options.gain ?? 1;
  if (!Number.isFinite(gain) || gain < 0 || gain > 1) throw Error('cue gain must be in [0, 1]');
  if (!Number.isSafeInteger(options.variant ?? 0)) throw Error('invalid cue variant');
  if (options.spatial) validateSpatial(options.spatial);
  if (options.filter) validateFilter(options.filter);
  const rate = options.rate ?? 1, wait = options.wait ?? 0;
  if (typeof rate !== 'number' || !(rate >= RATE_LIMITS.min && rate <= RATE_LIMITS.max)) throw Error(`playback rate must be in [${RATE_LIMITS.min}, ${RATE_LIMITS.max}]`);
  if (typeof wait !== 'number' || !(wait >= 0 && wait <= MAX_WAIT_MS)) throw Error(`wait must be in [0, ${MAX_WAIT_MS}] ms`);
  if (options.at !== undefined && (!Number.isFinite(options.at) || options.at < 0)) throw Error('invalid cue start time');
}

export interface AudioOutput {
  /** An owned cue handle, null if playback was skipped. */
  playVoice(id: string, options?: CueVoiceOptions): CueVoice | null;
  setListener(position: AudioVector, forward: AudioVector, up: AudioVector): void;
  /** Play a registered cue or a decoded sound. Returns false when nothing played (silent, muted, locked, unknown id,
   *  a sound still loading). */
  play(id: string, variant?: number): boolean;
  /** Fetch a sound file ahead of its first play (and decode it once a context exists). True when held. */
  preload(id: string, signal?: AbortSignal): Promise<boolean>;
  readonly sounds: SoundFileStats;
  /** One sample of the context clock, or null when there is no running context (silent, locked, hidden, disposed).
   *  Never creates or resumes the context. */
  clock(): AudioClockReading | null;
  /** Start (or switch to) a music track by URL; null stops. A repeated URL keeps playing. */
  music(url: string | null): void;
  /** Call from a user gesture: creates or resumes the context (browsers start audio suspended). */
  unlock(): void;
  /** Suspend on a hidden tab, resume when visible. */
  setHidden(hidden: boolean): void;
  /**
   * Change the HRTF voice limit: [0, maxVoices]. Lowering it moves the newest HRTF voices beyond it to 'equalpower'
   * (counted in `stats.downgraded`); raising it affects only later starts. 0 disables HRTF (a headphone setting off).
   */
  setHrtfLimit(limit: number): void;
  readonly stats: AudioStats;
  dispose(): void;
}

export function createAudioOutput(o: AudioOutputOptions): AudioOutput {
  const maxVoices=o.maxVoices??64,maxBuffers=o.maxBuffers??128,maxBufferBytes=o.maxBufferBytes??16*1024*1024,maxStartAhead=o.maxStartAhead??10;
  if(!Number.isFinite(maxStartAhead)||maxStartAhead<=0||maxStartAhead>600)throw Error('invalid audio start horizon');
  if(![maxVoices,maxBuffers,maxBufferBytes].every(n=>Number.isSafeInteger(n)&&n>0))throw Error('invalid audio limits');
  const hrtfLimitOk=(n:number)=>Number.isSafeInteger(n)&&n>=0&&n<=maxVoices;
  let hrtfLimit=o.maxHrtfVoices??Math.min(8,maxVoices);
  const smoothing=o.smoothing??0;
  if(!hrtfLimitOk(hrtfLimit)||!within(smoothing,0,1))throw Error('invalid audio limits');
  const definitions = o.cues ?? CORE_CUES;
  if (definitions.length > 1024) throw Error('too many audio cues');
  const cues = new Map<string, CueDef>();
  for (const definition of definitions) {
    validateCue(definition);
    if (cues.has(definition.id)) throw Error('duplicate audio cue');
    cues.set(definition.id, structuredClone(definition));
  }
  let bufferBytes = 0, hidden = false;
  const buffers = new Map<string, AudioBuffer>();
  const reported = new Set<string>();
  const stats = { contexts: 0, played: 0, skipped: 0, downgraded: 0, culled: 0,
    get active() { return voices.size; }, get hrtfActive() { return hrtf.size; }, get hrtfLimit() { return hrtfLimit; } };
  let ctx: AudioContext | null = null, master: GainNode | null = null, element: HTMLAudioElement | null = null, track: string | null = null, disposed = false;
  const reporter = o.report ?? ((m: string) => console.warn('[audio] ' + m));
  let reporting = false;
  const report = (message: string, cause?: unknown) => {
    if (reporting) return;
    reporting = true;
    try { reporter(message); }
    catch (error) {
      try { console.error('[audio] reporting failed', new AggregateError([new Error(message, { cause }), error])); }
      catch { /* Diagnostics cannot strand owned voices or their context. */ }
    } finally { reporting = false; }
  };
  const reportFailure = (message: string, cause: unknown) => {
    let detail = 'unprintable error';
    try { detail = String(cause); } catch { /* Preserve the original value without trusting its conversion. */ }
    report(`${message}: ${detail}`, cause);
  };
  const makeContext = o.createContext ?? (() => new AudioContext());
  const apply = () => {
    if (master) master.gain.value = o.muted() ? 0 : o.effects();
    if (element) { element.volume = Math.max(0, Math.min(1, o.music())); element.muted = o.muted(); }
  };
  const off = o.onChange?.(apply);
  const context = (): AudioContext | null => {
    if (disposed || o.silent()) return null;
    if (!ctx) { ctx = makeContext(); stats.contexts++; listenerWritten = null; master = ctx.createGain(); master.connect(ctx.destination); apply(); }
    return ctx;
  };
  const voices = new Set<CueVoice>();
  const files = createSoundFiles({ ...o.files, report: m => report(m) });
  /** HRTF voices in start order (oldest first), and the cutoff checks of voices that have a `cutoffDistance`. */
  const hrtf = new Set<{ downgrade(): void; silentSince: number | null }>();
  /** Once a cutoff fade has run this long (s), the voice is inaudible and its HRTF slot may be reclaimed silently. */
  const RECLAIM_AFTER = 5 * CUTOFF_TIME_CONSTANT;
  const cutoffChecks = new Set<() => void>();
  // Smoothed writes: one cancel plus one setTargetAtTime per changed parameter (callers skip unchanged ones), so each
  // update has constant cost.
  // A parameter that was ever automated is written with setValueAtTime afterwards, so an instant write is not lost.
  const automated = new WeakSet<AudioParam>();
  const write = (p: AudioParam, value: number, timeConstant: number) => {
    const now = ctx?.currentTime ?? 0;
    if (timeConstant > 0) { p.cancelScheduledValues(now); p.setTargetAtTime(value, now, timeConstant); automated.add(p); }
    else if (automated.has(p)) { p.cancelScheduledValues(now); p.setValueAtTime(value, now); }
    else p.value = value;
  };
  let listener:{position:AudioVector;forward:AudioVector;up:AudioVector}|null=null;
  /** The listener values last written to this context (null: none yet, so the first write is instant). */
  let listenerWritten: number[] | null = null;
  const applyListener=()=>{if(!ctx||!listener)return;const l=ctx.listener;
    const values=[...listener.position,...listener.forward,...listener.up],last=listenerWritten;
    if(last&&values.every((v,i)=>v===last[i]))return;
    const tau=last?smoothing:0;listenerWritten=values;
    if(l.positionX){const params=[l.positionX,l.positionY,l.positionZ,l.forwardX,l.forwardY,l.forwardZ,l.upX,l.upY,l.upZ];params.forEach((p,i)=>{if(!last||last[i]!==values[i])write(p,values[i],tau);});}
    else {l.setPosition(...listener.position);l.setOrientation(...listener.forward,...listener.up);}
  };
  const listenerPosition = (): AudioVector => listener?.position ?? [0, 0, 0];
  const beyond = (spatial: SpatialCue, at: AudioVector) => {
    if (spatial.cutoffDistance === undefined) return false;
    const l = listenerPosition();
    return Math.hypot(at[0] - l[0], at[1] - l[1], at[2] - l[2]) > spatial.cutoffDistance;
  };
  const validateGain = (gain: number) => { if (!Number.isFinite(gain) || gain < 0 || gain > 1) throw Error('cue gain must be in [0, 1]'); };
  const playVoice = (id: string, options: CueVoiceOptions = {}): CueVoice | null => {
    options = normalizeCueVoiceOptions(options);
    const wait = options.wait ?? 0;
    if(voices.size>=maxVoices){stats.skipped++;return null;}
      const cue = cues.get(id);
      let url: string | undefined;
      if (!cue) try { url = o.sound?.(id); } catch (error) { if (!reported.has(id) && reported.size < 1024) { reported.add(id); reportFailure(`sound '${id}' cannot be resolved`, error); } stats.skipped++; return null; }
      if (!cue && !url) { if (!reported.has(id) && reported.size < 1024) { reported.add(id); report(o.sound ? `no cue or sound '${id}'` : `no cue '${id}'`); } stats.skipped++; return null; }
      if (hidden || o.silent() || o.muted() || o.effects() <= 0) { stats.skipped++; return null; }
      const c = context();
      if (!c || c.state !== 'running' || !master) { stats.skipped++; return null; }
      if (options.spatial && beyond(options.spatial, options.spatial.position)) { stats.culled++; return null; }
      if (options.at !== undefined && options.at > c.currentTime + maxStartAhead) { if (!reported.has('\0horizon')) { reported.add('\0horizon'); report('cue start beyond the schedule horizon'); } stats.skipped++; return null; }
      if (url) {
        const ready = files.buffer(id);
        if (ready) return start(c, ready, options);
        if (files.failed(id)) { stats.skipped++; return null; }
        const loading = files.decode(id, url, c);
        if (wait <= 0) { loading.catch(() => { /* reported by the store */ }); stats.skipped++; return null; }
        return late(loading, wait, options);
      }
      if (!cue) { stats.skipped++; return null; }
      const variant = options.variant ?? 0;
      const key = `${id}|${variant}|${c.sampleRate}`;
      let buffer = buffers.get(key);
      if (!buffer) {
        const bytes = Math.ceil(cue.duration * c.sampleRate) * 4;
        if (!Number.isSafeInteger(bytes) || bytes > maxBufferBytes) { stats.skipped++; return null; }
        const samples = synthCue(cue, c.sampleRate, variant);
        buffer = c.createBuffer(1, samples.length, c.sampleRate); buffer.copyToChannel(samples, 0);
        while (buffers.size && (buffers.size >= maxBuffers || bufferBytes > maxBufferBytes - bytes)) {
          const oldest = buffers.keys().next().value!; bufferBytes -= buffers.get(oldest)!.length * 4; buffers.delete(oldest);
        }
        buffers.set(key, buffer); bufferBytes += bytes;
      }
      // Refresh recency; active voices keep their own bounded references after cache eviction.
      buffers.delete(key); buffers.set(key, buffer);
      return start(c, buffer, options);
  };
  /** One voice over a ready buffer (a synthesised cue or a decoded file); null when its spatial cutoff culls it. */
  const start = (c: AudioContext, buffer: AudioBuffer, options: CueVoiceOptions): CueVoice | null => {
      if (!master) return null;
      if (options.spatial && beyond(options.spatial, options.spatial.position)) { stats.culled++; return null; }
      const master_ = master;
      const source = c.createBufferSource(), level = c.createGain();
      const spatial=options.spatial,panner=spatial?c.createPanner():null;
      // Optional stages, created only when asked for: filter + muffle gain (CueFilter), then the cutoff gate.
      const filter=options.filter?c.createBiquadFilter():null,muffle=options.filter?c.createGain():null;
      const gate=spatial?.cutoffDistance!==undefined?c.createGain():null;
      let target:AudioVector|null=null,inRange=true;
      const positionTau=spatial?.smoothing??smoothing;
      const checkCutoff=()=>{if(!gate||!spatial||!target)return;const next=!beyond(spatial,target);if(next===inRange)return;inRange=next;
        slot.silentSince=next?null:c.currentTime;write(gate.gain,next?1:0,CUTOFF_TIME_CONSTANT);};
      const position=(value:AudioVector)=>{vector(value);if(!panner)return;const p=copy(value),last=target,tau=last?positionTau:0;target=p;
        if(panner.positionX){const params=[panner.positionX,panner.positionY,panner.positionZ];for(let i=0;i<3;i++)if(!last||last[i]!==p[i])write(params[i],p[i],tau);}
        else if(!last||p.some((v,i)=>v!==last[i]))panner.setPosition(...p);checkCutoff();};
      let panning:PanningModel|null=null;
      const slot={silentSince:null as number|null,downgrade(){if(!panner||panning!=='HRTF')return;panner.panningModel=panning='equalpower';hrtf.delete(slot);stats.downgraded++;}};
      if(panner&&spatial){
        // A voice silenced by its cutoff for longer than its fade gives up its HRTF slot to a new request (no audible change).
        if(spatial.panning==='HRTF'&&hrtf.size>=hrtfLimit&&hrtfLimit>0){for(const held of hrtf)if(held.silentSince!==null&&c.currentTime-held.silentSince>=RECLAIM_AFTER){held.downgrade();break;}}
        panning=spatial.panning==='HRTF'&&hrtf.size<hrtfLimit?'HRTF':'equalpower';
        if(spatial.panning==='HRTF'&&panning!=='HRTF')stats.downgraded++;
        panner.panningModel=panning;panner.distanceModel=spatial.distanceModel??'inverse';panner.refDistance=spatial.refDistance??1;panner.maxDistance=spatial.maxDistance??100;panner.rolloffFactor=spatial.rolloffFactor??1;position(spatial.position);applyListener();
      }
      if(filter&&muffle&&options.filter){filter.type='lowpass';filter.frequency.value=options.filter.cutoffHz;muffle.gain.value=options.filter.gain??1;}
      let ended = false;
      const stages=([level,filter,muffle,gate,panner] as (AudioNode|null)[]).filter((n):n is AudioNode=>n!==null);
      const finish = () => {
        if (ended) return; ended = true; voices.delete(voice); hrtf.delete(slot); cutoffChecks.delete(checkCutoff);
        source.onended = null; source.disconnect(); for (const stage of stages) stage.disconnect();
        try { options.onEnded?.(); } catch (error) { reportFailure('cue completion failed', error); }
      };
      const voice: CueVoice = {
        get ended() { return ended; },
        get panning() { return panning; },
        setPosition(value){if(!ended)position(value);},
        setGain(value) { validateGain(value); if (!ended) write(level.gain, value, 0); },
        setFilter(value, timeConstant = FILTER_TIME_CONSTANT.default) {
          validateFilter(value, timeConstant);
          if (ended) return;
          if (!filter || !muffle) throw Error('voice has no filter stage: pass `filter` to playVoice');
          { write(filter.frequency, value.cutoffHz, timeConstant); write(muffle.gain, value.gain ?? 1, timeConstant); }
        },
        stop() { if (ended) return; try { source.stop(); } finally { finish(); } },
      };
      level.gain.value = options.gain ?? 1;
      source.buffer = buffer; if (options.rate !== undefined && options.rate !== 1) source.playbackRate.value = options.rate;
      source.connect(level);
      for (let i = 1; i < stages.length; i++) stages[i - 1].connect(stages[i]);
      stages[stages.length - 1].connect(master_); source.onended = finish;
      voices.add(voice); if (panning === 'HRTF') hrtf.add(slot); if (gate) cutoffChecks.add(checkCutoff);
      try { if (options.at !== undefined && options.at > c.currentTime) source.start(options.at); else source.start(); } catch (error) { finish(); throw error; }
      stats.played++; return voice;
  };
  /**
   * A voice for a sound still loading: an owned handle at once (it holds a voice slot, so `maxVoices` bounds waiting
   * plays too), started when the file is ready if that is within `wait` (or before a scheduled context start time
   * `at`, when a caller passes one) and audio may still play; otherwise it ends unplayed. Gain, position and the
   * filter work before and after it starts (applied, or replayed with their latest values, at start); `panning` is
   * null until then. A start the output refuses (a spatial cutoff) ends the handle.
   */
  const late = (loading: Promise<AudioBuffer>, wait: number, options: CueVoiceOptions): CueVoice => {
    const asked = monotonicNow();
    let inner: CueVoice | null = null, ended = false, gain = options.gain ?? 1;
    let position = options.spatial ? copy(options.spatial.position) : undefined;
    let filterCall: [CueFilter, number | undefined] | null = null;
    const finish = () => {
      if (ended) return; ended = true; voices.delete(voice);
      try { options.onEnded?.(); } catch (error) { reportFailure('cue completion failed', error); }
    };
    const voice: CueVoice = {
      get ended() { return ended; },
      get panning() { return inner?.panning ?? null; },
      setGain(value) { validateGain(value); gain = value; inner?.setGain(value); },
      setPosition(value) { vector(value); position = copy(value); inner?.setPosition?.(value); },
      setFilter(value, timeConstant) {
        validateFilter(value, timeConstant);
        if (ended) return;
        if (!options.filter) throw Error('voice has no filter stage: pass `filter` to playVoice');
        if (inner) inner.setFilter?.(value, timeConstant); else filterCall = [{ ...value }, timeConstant];
      },
      stop() { if (ended) return; if (inner) inner.stop(); else finish(); },
    };
    voices.add(voice);
    const at = (options as { at?: unknown }).at;
    loading.then(buffer => {
      if (ended) return;
      const c = ctx;
      const onTime = monotonicNow() - asked <= wait || (typeof at === 'number' && !!c && c.currentTime <= at);
      if (disposed || !onTime || hidden || o.silent() || o.muted() || o.effects() <= 0 || !c || c.state !== 'running' || !master) { stats.skipped++; finish(); return; }
      voices.delete(voice);
      try { inner = start(c, buffer, { ...options, gain, ...(options.spatial && position ? { spatial: { ...options.spatial, position } } : {}), onEnded: finish }); }
      catch (error) { stats.skipped++; finish(); reportFailure('sound start failed', error); return; }
      if (!inner) { finish(); return; }
      if (filterCall) { inner.setFilter?.(...filterCall); filterCall = null; }
    }, () => { if (!ended) { stats.skipped++; finish(); } });
    return voice;
  };
  /** Decode held files once a context exists, so a first (or scheduled) play finds them ready. Bounded by the store. */
  const warm = () => {
    if (!ctx || disposed || o.silent()) return;
    for (const [id, url] of files.undecoded()) files.decode(id, url, ctx).catch(() => { /* reported by the store */ });
  };
  return {
    playVoice,
    setListener(position,forward,up){vector(position);vector(forward);vector(up);
      const fn=Math.hypot(forward[0],forward[1],forward[2]),un=Math.hypot(up[0],up[1],up[2]);if(!Number.isFinite(fn)||!Number.isFinite(un)||fn===0||un===0)throw Error('invalid audio orientation');
      const f=copy(forward).map(x=>x/fn) as unknown as AudioVector,u=copy(up).map(x=>x/un) as unknown as AudioVector;
      if(Math.abs(f.reduce((sum,x,i)=>sum+x*u[i],0))>0.999)throw Error('parallel audio orientation');
      listener={position:copy(position),forward:f,up:u};applyListener();
      for(const check of [...cutoffChecks])check();
    },
    setHrtfLimit(limit){
      if(!hrtfLimitOk(limit))throw Error('invalid HRTF voice limit');
      hrtfLimit=limit;for(const slot of [...hrtf].slice(limit))slot.downgrade();
    },
    play(id, variant = 0) { return playVoice(id, { variant }) !== null; },
    async preload(id, signal) {
      let url: string | undefined;
      try { url = !cues.has(id) ? o.sound?.(id) : undefined; } catch (error) { reportFailure(`sound '${id}' cannot be resolved`, error); return false; }
      if (!url || disposed) return false;
      files.retry(id);
      const held = await files.fetch(id, url, signal);
      if (held) warm();
      return held;
    },
    get sounds() { return files.stats; },
    clock() {
      if (disposed || hidden || !ctx || ctx.state !== 'running' || o.silent()) return null;
      const performanceTime = monotonicNow(), currentTime = ctx.currentTime;
      const seconds = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : 0;
      let output: AudioClockReading['output'] = null;
      try {
        const stamp = ctx.getOutputTimestamp?.();
        // Browsers report zeros before the first rendered block; that pair is not a usable mapping.
        if (stamp && Number.isFinite(stamp.contextTime) && Number.isFinite(stamp.performanceTime) && stamp.contextTime! > 0 && stamp.performanceTime! > 0) output = { contextTime: stamp.contextTime!, performanceTime: stamp.performanceTime! };
      } catch { /* An unsupported or failing timestamp leaves the latency estimate. */ }
      return { currentTime, performanceTime, outputLatency: seconds((ctx as { outputLatency?: number }).outputLatency), baseLatency: seconds(ctx.baseLatency), output };
    },
    music(url) {
      if (url === track) return;
      track = url;
      if (!url) { element?.pause(); return; }
      if (o.silent() || disposed) return;
      element ??= (o.createElement ?? (() => new Audio()))();
      element.loop = true; element.src = o.resolveUrl ? o.resolveUrl(url) : url; apply();
      if (!hidden) void element.play().catch(() => { /* locked until a gesture: unlock() retries */ });
    },
    unlock() {
      const c = context();
      if (!hidden && c && c.state === 'suspended') void c.resume();
      warm();
      if (!hidden && element && track && element.paused && !o.silent()) void element.play().catch(() => {});
    },
    setHidden(value) {
      hidden = value;
      if (ctx) { if (hidden) void ctx.suspend(); else if (!o.silent()) void ctx.resume(); }
      if (element) { if (hidden) element.pause(); else if (track && !o.silent()) void element.play().catch(() => {}); }
    },
    stats,
    dispose() { if (disposed) return; disposed = true; for (const voice of [...voices]) { try { voice.stop(); } catch (error) { reportFailure('cue stop failed', error); } } files.dispose(); off?.(); element?.pause(); element = null; void ctx?.close(); ctx = null; master = null; buffers.clear(); bufferBytes = 0; },
  };
}
