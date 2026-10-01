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
 */
import { monotonicNow } from '../../core/clock';

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
}

export type AudioVector = readonly [number, number, number];
export interface SpatialCue { position: AudioVector; refDistance?: number; maxDistance?: number; rolloffFactor?: number }
export interface CueVoice {
  readonly ended: boolean;
  /** Per-voice gain, multiplied by the user's effects volume. */
  setGain(gain: number): void;
  setPosition?(position: AudioVector): void;
  stop(): void;
}
export interface CueVoiceOptions { variant?: number; gain?: number; spatial?: SpatialCue; onEnded?: () => void }

export interface AudioOutput {
  /** An owned cue handle, null if playback was skipped. */
  playVoice(id: string, options?: CueVoiceOptions): CueVoice | null;
  setListener(position: AudioVector, forward: AudioVector, up: AudioVector): void;
  /** Play a registered cue. Returns false when nothing played (silent, muted, locked, unknown id). */
  play(id: string, variant?: number): boolean;
  /** Start (or switch to) a music track by URL; null stops. A repeated URL keeps playing. */
  music(url: string | null): void;
  /** Call from a user gesture: creates or resumes the context (browsers start audio suspended). */
  unlock(): void;
  /** Suspend on a hidden tab, resume when visible. */
  setHidden(hidden: boolean): void;
  readonly stats: { readonly contexts: number; readonly played: number; readonly skipped: number };
  dispose(): void;
}

export function createAudioOutput(o: AudioOutputOptions): AudioOutput {
  const maxVoices=o.maxVoices??64,maxBuffers=o.maxBuffers??128,maxBufferBytes=o.maxBufferBytes??16*1024*1024;
  if(![maxVoices,maxBuffers,maxBufferBytes].every(n=>Number.isSafeInteger(n)&&n>0))throw Error('invalid audio limits');
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
  const stats = { contexts: 0, played: 0, skipped: 0 };
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
    if (!ctx) { ctx = makeContext(); stats.contexts++; master = ctx.createGain(); master.connect(ctx.destination); apply(); }
    return ctx;
  };
  const voices = new Set<CueVoice>();
  const vector=(p:AudioVector)=>{if(p.length!==3||!p.every(Number.isFinite))throw Error('invalid audio position');};
  let listener:{position:AudioVector;forward:AudioVector;up:AudioVector}|null=null;
  const applyListener=()=>{if(!ctx||!listener)return;const l=ctx.listener;
    if(l.positionX){[l.positionX.value,l.positionY.value,l.positionZ.value]=listener.position;[l.forwardX.value,l.forwardY.value,l.forwardZ.value]=listener.forward;[l.upX.value,l.upY.value,l.upZ.value]=listener.up;}
    else {l.setPosition(...listener.position);l.setOrientation(...listener.forward,...listener.up);}
  };
  const validateGain = (gain: number) => { if (!Number.isFinite(gain) || gain < 0 || gain > 1) throw Error('cue gain must be in [0, 1]'); };
  const playVoice = (id: string, options: CueVoiceOptions = {}): CueVoice | null => {
    options = { ...options, ...(options.spatial ? { spatial: { ...options.spatial, position: [...options.spatial.position] as AudioVector } } : {}) };
    validateGain(options.gain ?? 1);
    if(!Number.isSafeInteger(options.variant??0))throw Error('invalid cue variant');
    if(options.spatial){const p=options.spatial;vector(p.position);if(!Number.isFinite(p.refDistance??1)||(p.refDistance??1)<=0||!Number.isFinite(p.maxDistance??100)||(p.maxDistance??100)<(p.refDistance??1)||!Number.isFinite(p.rolloffFactor??1)||(p.rolloffFactor??1)<0)throw Error('invalid spatial cue');}
    if(voices.size>=maxVoices){stats.skipped++;return null;}
      const cue = cues.get(id);
      if (!cue) { if (!reported.has(id) && reported.size < 1024) { reported.add(id); report(`no cue '${id}'`); } stats.skipped++; return null; }
      if (hidden || o.silent() || o.muted() || o.effects() <= 0) { stats.skipped++; return null; }
      const c = context();
      if (!c || c.state !== 'running' || !master) { stats.skipped++; return null; }
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
      const source = c.createBufferSource(), level = c.createGain();
      const panner=options.spatial?c.createPanner():null;
      const position=(p:AudioVector)=>{vector(p);if(!panner)return;if(panner.positionX){[panner.positionX.value,panner.positionY.value,panner.positionZ.value]=p;}else panner.setPosition(...p);};
      if(panner&&options.spatial){panner.panningModel='equalpower';panner.distanceModel='inverse';panner.refDistance=options.spatial.refDistance??1;panner.maxDistance=options.spatial.maxDistance??100;panner.rolloffFactor=options.spatial.rolloffFactor??1;position(options.spatial.position);applyListener();}
      let ended = false;
      const finish = () => {
        if (ended) return; ended = true; voices.delete(voice);
        source.onended = null; source.disconnect(); level.disconnect(); panner?.disconnect();
        try { options.onEnded?.(); } catch (error) { reportFailure('cue completion failed', error); }
      };
      const voice: CueVoice = {
        get ended() { return ended; },
        setPosition(value){if(!ended)position(value);},
        setGain(value) { validateGain(value); if (!ended) level.gain.value = value; },
        stop() { if (ended) return; try { source.stop(); } finally { finish(); } },
      };
      level.gain.value = options.gain ?? 1;
      source.buffer = buffer; source.connect(level); if(panner){level.connect(panner);panner.connect(master);}else level.connect(master); source.onended = finish;
      voices.add(voice);
      try { source.start(); } catch (error) { finish(); throw error; }
      stats.played++; return voice;
  };
  return {
    playVoice,
    setListener(position,forward,up){vector(position);vector(forward);vector(up);
      const fn=Math.hypot(...forward),un=Math.hypot(...up);if(!Number.isFinite(fn)||!Number.isFinite(un)||fn===0||un===0)throw Error('invalid audio orientation');
      const f=forward.map(x=>x/fn) as unknown as AudioVector,u=up.map(x=>x/un) as unknown as AudioVector;
      if(Math.abs(f.reduce((sum,x,i)=>sum+x*u[i],0))>0.999)throw Error('parallel audio orientation');
      listener={position:[...position],forward:f,up:u};applyListener();
    },
    play(id, variant = 0) { return playVoice(id, { variant }) !== null; },
    music(url) {
      if (url === track) return;
      track = url;
      if (!url) { element?.pause(); return; }
      if (o.silent() || disposed) return;
      element ??= (o.createElement ?? (() => new Audio()))();
      element.loop = true; element.src = url; apply();
      if (!hidden) void element.play().catch(() => { /* locked until a gesture: unlock() retries */ });
    },
    unlock() {
      const c = context();
      if (!hidden && c && c.state === 'suspended') void c.resume();
      if (!hidden && element && track && element.paused && !o.silent()) void element.play().catch(() => {});
    },
    setHidden(value) {
      hidden = value;
      if (ctx) { if (hidden) void ctx.suspend(); else if (!o.silent()) void ctx.resume(); }
      if (element) { if (hidden) element.pause(); else if (track && !o.silent()) void element.play().catch(() => {}); }
    },
    stats,
    dispose() { if (disposed) return; disposed = true; for (const voice of [...voices]) { try { voice.stop(); } catch (error) { reportFailure('cue stop failed', error); } } off?.(); element?.pause(); element = null; void ctx?.close(); ctx = null; master = null; buffers.clear(); bufferBytes = 0; },
  };
}
