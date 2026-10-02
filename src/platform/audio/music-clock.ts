/**
 * platform/audio/music-clock.ts: music on the audio clock (AU-02), for the one audio output (STD-SYS-16).
 *
 * A music file (a `defineAsset({ type: 'audio' })` row, the same ids as sound files) is fetched and decoded whole into
 * an AudioBuffer by its own `sound-files.ts` store, with music-sized bounds (`musicBudgets`), then played by an
 * AudioBufferSourceNode started at an exact context time: `start`, `stop`, `seek` and native loop points are all
 * sample-accurate on the context clock, so an audio timeline (`audio-timeline.ts`) and a chart line up with the song.
 * The music bus follows the `sound.music` volume and mute; muting silences without stopping, so a run stays in sync.
 *
 * Bounds: music voices at once (`maxVoices`, default 2: a seek or a crossfade briefly holds two sources), the music
 * store's file, encoded and decoded budgets (decodes are admitted on the estimated decoded size before decoding, one at
 * a time), and the output's start horizon. A playing voice keeps its own buffer reference, so peak decoded memory is at
 * most (1 + maxVoices) × the decoded budget. Overload: beyond `maxVoices` a play is refused (null, counted as skipped).
 * Lateness: a file that finishes decoding after its start time starts at once, skipped ahead to where the song should
 * be (`late: 'skip-ahead'`, the default, keeping sync), or is dropped (`late: 'drop'`). Cancellation: `stop(at?)`,
 * the output's dispose, and a scene's exit (author layer). Recovery: a failed fetch or decode is reported once by the
 * store and remembered; `load(id)` forgets it and tries again. Silent, locked or hidden output: nothing plays (null).
 */
import type { SoundFiles } from './sound-files';

/** Default music memory bounds for the brief's minimum device. Decoded PCM is float32 per channel at the context rate:
 *  48 MiB holds about 2 min 11 s of 48 kHz stereo. */
export function musicBudgets(device: 'phone' | 'tablet' | 'laptop' | 'desktop' = 'laptop') {
  const MIB = 1024 * 1024;
  if (device === 'phone') return { maxFileBytes: 4 * MIB, maxEncodedBytes: 8 * MIB, maxDecodedBytes: 48 * MIB };
  if (device === 'tablet') return { maxFileBytes: 6 * MIB, maxEncodedBytes: 12 * MIB, maxDecodedBytes: 64 * MIB };
  return { maxFileBytes: 10 * MIB, maxEncodedBytes: 20 * MIB, maxDecodedBytes: 96 * MIB };
}

export interface MusicOptions {
  /** Context seconds to start at (an audio timeline's `contextTime(0)`). Default: now (plus the start margin). */
  at?: number;
  /** Song seconds to start from. Default 0. */
  offset?: number;
  /** Native loop points in song seconds; `end` defaults to the song's end. The song plays into the loop and repeats it. */
  loop?: { start: number; end?: number };
  /** Per-voice gain [0, 1], multiplied by the music volume. Default 1. */
  gain?: number;
  /** A file decoded after its start time: 'skip-ahead' (default) starts at once where the song should be; 'drop' ends it. */
  late?: 'skip-ahead' | 'drop';
  onEnded?: () => void;
}

export type MusicState = 'loading' | 'scheduled' | 'playing' | 'ended';

export interface MusicVoice {
  readonly state: MusicState;
  readonly ended: boolean;
  /** True once the song is scheduled on the clock; false when it was dropped, refused or stopped first. */
  readonly ready: Promise<boolean>;
  /** Song length in seconds, null while loading. */
  readonly duration: number | null;
  /** Song seconds playing at a context time (negative before the start: the lead-in), following loops, seeks and a
   *  scheduled stop; null while loading. */
  songTime(contextTime: number): number | null;
  /** Continue from song second `offset` at context time `at` (default: now plus the start margin), sample-accurately. */
  seek(offset: number, at?: number): void;
  /** Stop at context time `at` (default: now). Idempotent. */
  stop(at?: number): void;
  setGain(gain: number): void;
}

export interface MusicStats { readonly playing: number; readonly played: number; readonly skipped: number; readonly dropped: number }

export interface MusicHost {
  /** The running context, or null (silent, locked, hidden, disposed). */
  running(): AudioContext | null;
  /** Any existing context for decoding (it may be suspended), or null (silent, disposed, never unlocked). */
  existing(): AudioContext | null;
  bus(): AudioNode | null;
  files: SoundFiles;
  /** The URL of a music id, or undefined; may throw for a malformed row. */
  url(id: string): string | undefined;
  report(message: string): void;
  maxVoices: number;
  maxStartAhead: number;
}

/** Seconds ahead of `currentTime` at which a "now" start or seek is scheduled, so it is exact rather than late by the
 *  time between reading the clock and the call. */
export const MUSIC_START_MARGIN = 0.02;

interface Segment { source: AudioBufferSourceNode; start: number; offset: number }

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

function validate(options: MusicOptions) {
  if (options.at !== undefined && !(finite(options.at) && options.at >= 0)) throw Error('music: invalid start time');
  if (options.offset !== undefined && !(finite(options.offset) && options.offset >= 0)) throw Error('music: invalid offset');
  if (options.gain !== undefined && !(finite(options.gain) && options.gain >= 0 && options.gain <= 1)) throw Error('music: gain must be in [0, 1]');
  if (options.late !== undefined && options.late !== 'skip-ahead' && options.late !== 'drop') throw Error('music: late must be skip-ahead or drop');
  const loop = options.loop;
  if (loop && !(finite(loop.start) && loop.start >= 0 && (loop.end === undefined || (finite(loop.end) && loop.end > loop.start)))) throw Error('music: invalid loop points');
}

export function createMusicPlayer(host: MusicHost) {
  if (!Number.isSafeInteger(host.maxVoices) || host.maxVoices < 1 || host.maxVoices > 16) throw Error('music: maxVoices must be an integer in [1, 16]');
  const voices = new Set<MusicVoice>();
  const stats = { played: 0, skipped: 0, dropped: 0 };
  const reported = new Set<string>();
  const once = (key: string, message: string) => { if (reported.has(key) || reported.size >= 256) return; reported.add(key); try { host.report(message); } catch { /* diagnostics only */ } };

  function play(id: string, options: MusicOptions = {}): MusicVoice | null {
    validate(options);
    options = { ...options, ...(options.loop ? { loop: { ...options.loop } } : {}) };
    if (voices.size >= host.maxVoices) { stats.skipped++; return null; }
    let url: string | undefined;
    try { url = host.url(id); } catch (error) { once(id, `music '${id}' cannot be resolved: ${String(error)}`); stats.skipped++; return null; }
    if (!url) { once(id, `no music '${id}'`); stats.skipped++; return null; }
    const c = host.running(), bus = host.bus();
    if (!c || !bus) { stats.skipped++; return null; }
    if (options.at !== undefined && options.at > c.currentTime + host.maxStartAhead) { once('\0horizon', 'music start beyond the schedule horizon'); stats.skipped++; return null; }

    let ended = false, buffer: AudioBuffer | null = null, current: Segment | null = null, previous: Segment | null = null, stopAt: number | null = null;
    let pending = { offset: options.offset ?? 0, at: options.at };
    let settle!: (ok: boolean) => void;
    const ready = new Promise<boolean>(resolve => { settle = resolve; });
    const level = c.createGain(); level.gain.value = options.gain ?? 1; level.connect(bus);
    const loopEnd = () => Math.min(options.loop?.end ?? Infinity, buffer?.duration ?? Infinity);
    /** Song position `elapsed` seconds after starting at `offset`, with the loop applied. */
    const advance = (offset: number, elapsed: number) => {
      const p = offset + elapsed, loop = options.loop;
      if (loop && buffer) { const end = loopEnd(), length = end - loop.start; if (p >= end && length > 0) return loop.start + ((p - loop.start) % length); return p; }
      return buffer ? Math.min(p, buffer.duration) : p;
    };
    const release = (segment: Segment | null) => { if (!segment) return; segment.source.onended = null; try { segment.source.stop(); } catch { /* not started or already stopped */ } segment.source.disconnect(); };
    const finish = () => {
      if (ended) return; ended = true; voices.delete(voice);
      release(previous); release(current); previous = current = null; level.disconnect();
      settle(false);
      try { options.onEnded?.(); } catch (error) { once('\0ended', `music completion failed: ${String(error)}`); }
    };
    const begin = (at: number, offset: number): Segment => {
      const source = c.createBufferSource();
      source.buffer = buffer;
      if (options.loop) { source.loop = true; source.loopStart = options.loop.start; source.loopEnd = loopEnd(); }
      source.connect(level);
      const segment = { source, start: at, offset };
      source.onended = () => { if (current === segment) finish(); else if (previous === segment) { previous = null; segment.source.disconnect(); } };
      source.start(at, offset);
      return segment;
    };
    const schedule = (decoded: AudioBuffer) => {
      if (ended) return;
      if (host.running() !== c) { stats.dropped++; finish(); return; }
      buffer = decoded;
      const { offset } = pending;
      if (offset >= decoded.duration || (options.loop && (options.loop.start >= loopEnd() || offset >= loopEnd()))) { once(`\0range:${id}`, `music '${id}': offset or loop points outside the song`); stats.dropped++; finish(); return; }
      const earliest = c.currentTime + MUSIC_START_MARGIN;
      let at = pending.at ?? earliest, from = offset;
      if (at < earliest) {
        // Decoded after its start time: keep sync by starting where the song should be, or drop.
        if (pending.at !== undefined && options.late === 'drop') { stats.dropped++; finish(); return; }
        from = advance(offset, earliest - at); at = earliest;
        if (!options.loop && from >= decoded.duration) { stats.dropped++; finish(); return; }
      }
      // A skipped-ahead start records where it actually began, so songTime matches what is heard.
      current = begin(at, from);
      stats.played++; settle(true);
    };

    const voice: MusicVoice = {
      get state() { return ended ? 'ended' : !current ? 'loading' : c.currentTime < current.start ? 'scheduled' : 'playing'; },
      get ended() { return ended; },
      ready,
      get duration() { return buffer?.duration ?? null; },
      songTime(t) {
        if (!finite(t)) throw Error('music: invalid context time');
        const segment = previous && current && t < current.start ? previous : current;
        if (!segment) return null;
        const at = stopAt !== null ? Math.min(t, stopAt) : t;
        const elapsed = at - segment.start;
        return elapsed < 0 ? segment.offset + elapsed : advance(segment.offset, elapsed);
      },
      seek(offset, at) {
        if (!(finite(offset) && offset >= 0)) throw Error('music: invalid offset');
        if (at !== undefined && !(finite(at) && at >= 0)) throw Error('music: invalid seek time');
        if (ended) return;
        if (!current || !buffer) { pending = { offset, at }; return; }
        if (offset >= buffer.duration || (options.loop && offset >= loopEnd())) throw Error('music: seek beyond the song');
        const when = Math.max(at ?? 0, c.currentTime + MUSIC_START_MARGIN);
        if (when > c.currentTime + host.maxStartAhead) throw Error('music: seek beyond the schedule horizon');
        release(previous);
        previous = current;
        try { previous.source.stop(when); } catch { /* already stopping */ }
        current = begin(when, offset);
        stopAt = null;
      },
      stop(at) {
        if (at !== undefined && !(finite(at) && at >= 0)) throw Error('music: invalid stop time');
        if (ended) return;
        if (!current || at === undefined || at <= c.currentTime) { finish(); return; }
        stopAt = at;
        try { current.source.stop(at); } catch { finish(); }
      },
      setGain(gain) { if (!(finite(gain) && gain >= 0 && gain <= 1)) throw Error('music: gain must be in [0, 1]'); if (!ended) level.gain.value = gain; },
    };
    voices.add(voice);
    const decoded = host.files.buffer(id);
    if (decoded) schedule(decoded);
    else host.files.decode(id, url, c).then(schedule, () => { if (!ended) { stats.dropped++; finish(); } });
    return voice;
  }

  return {
    play,
    /** Fetch and decode ahead. True when decoded and ready to start exactly; false when silent, never unlocked
     *  (nothing to decode on yet), failed or refused. Forgets an earlier failure. */
    async load(id: string, signal?: AbortSignal): Promise<boolean> {
      let url: string | undefined;
      try { url = host.url(id); } catch (error) { once(id, `music '${id}' cannot be resolved: ${String(error)}`); return false; }
      if (!url) { once(id, `no music '${id}'`); return false; }
      host.files.retry(id);
      if (!await host.files.fetch(id, url, signal)) return false;
      const c = host.existing();
      if (!c || signal?.aborted) return false;
      try { await host.files.decode(id, url, c); return !signal?.aborted; } catch { return false; }
    },
    get stats(): MusicStats { return { playing: voices.size, ...stats }; },
    dispose() { for (const voice of [...voices]) voice.stop(); host.files.dispose(); },
  };
}
export type MusicPlayer = ReturnType<typeof createMusicPlayer>;
