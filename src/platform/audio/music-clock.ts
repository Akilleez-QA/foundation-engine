/**
 * platform/audio/music-clock.ts: music on the audio clock (AU-02), for the one audio output (STD-SYS-16).
 *
 * A music file (a `defineAsset({ type: 'audio' })` row, the same ids as sound files) is fetched and decoded whole into
 * an AudioBuffer by its own `sound-files.ts` store, with music-sized bounds (`musicBudgets`), then played by an
 * AudioBufferSourceNode started at an exact context time: `start`, `stop`, `seek` and native loop points are all
 * sample-accurate on the context clock, so an audio timeline (`audio-timeline.ts`) and a chart line up with the song.
 * The music bus follows the `sound.music` volume and mute; muting silences without stopping, so a run stays in sync.
 *
 * Bounds: music voices at once (`maxVoices`, default 2; each voice holds at most two sources, during a seek's
 * hand-off), the music store's file, encoded and decoded budgets (decodes are admitted on the estimated decoded size
 * before decoding, one at a time, with a fetch/decode timeout scaled to the file budget), and the output's start
 * horizon. A playing voice keeps its own buffer reference, so peak decoded memory is at
 * most (1 + maxVoices) × the decoded budget. Overload: beyond `maxVoices` a play is refused (null, counted as skipped).
 * Lateness: a file that finishes decoding after its start time starts at once, skipped ahead to where the song should
 * be (`late: 'skip-ahead'`, the default, keeping sync), or is dropped (`late: 'drop'`). Cancellation: `stop(at?)`,
 * the output's dispose, and a scene's exit (author layer). Recovery: a failed fetch or decode is reported once by the
 * store and remembered; `load(id)` forgets it and tries again. Silent, locked or hidden output: nothing plays (null);
 * a song already loading when the tab is hidden is scheduled on the suspended clock and plays when it resumes.
 * The music store is separate from the sound-file store: an id played both as a sound and as music decodes twice.
 */
import type {SoundFiles} from './sound-files';

/** Decoded bytes per encoded byte assumed for compressed music: 128 kbps stereo decoded to float32 stereo at 48 kHz
 *  (384 000 B/s ÷ 16 000 B/s). Lower-bitrate files decode to more than this estimate (64 kbps: twice). */
export const MUSIC_COMPRESSED_RATIO = 24;

/** A fetch or decode timeout scaled to the file budget: 10 s, or 1 s per 128 KiB (a 1 Mbit/s link), if longer. */
export const musicTimeoutMs = (maxFileBytes: number) => Math.max(10_000, Math.ceil(maxFileBytes / (128 * 1024)) * 1000);

/**
 * Default music bounds for the brief's minimum device. Decoded PCM is float32 per channel at the context rate, so the
 * decoded budget sets the longest song (48 kHz stereo: 48 MiB ≈ 2 min 11 s, 72 MiB ≈ 3 min 16 s, 96 MiB ≈ 4 min
 * 22 s). The file budget is the decoded budget ÷ `MUSIC_COMPRESSED_RATIO`, so a compressed song that downloads in
 * full also fits when decoded (128 kbps: the same lengths). A 16-bit stereo 48 kHz WAV is 192 000 B/s on disk, so the
 * file budget caps it far sooner: about 11 s (phone), 16 s (tablet), 22 s (laptop, desktop).
 */
export function musicBudgets(device: 'phone' | 'tablet' | 'laptop' | 'desktop' = 'laptop') {
  const MIB = 1024 * 1024;
  const decoded = device === 'phone' ? 48 * MIB : device === 'tablet' ? 72 * MIB : 96 * MIB;
  const file = Math.floor(decoded / MUSIC_COMPRESSED_RATIO);
  return {
    maxFileBytes: file,
    maxEncodedBytes: 2 * file,
    maxDecodedBytes: decoded,
    compressedRatio: MUSIC_COMPRESSED_RATIO,
    timeoutMs: musicTimeoutMs(file),
  };
}

export interface MusicOptions {
  /** Context seconds to start at (an audio timeline's `contextTime(0)`). Default: now plus `MUSIC_START_MARGIN`. A time
   *  earlier than that counts as late (see `late`): pass at least `currentTime + MUSIC_START_MARGIN`. */
  at?: number;
  /** Song seconds to start from. Default 0. */
  offset?: number;
  /** Native loop points in song seconds; `end` defaults to the song's end. The song plays into the loop and repeats it. */
  loop?: {start: number; end?: number};
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
  /** Song seconds playing at a context time, following loops, seeks and a scheduled stop. Before the start it is the
   *  start offset minus the remaining lead-in (negative for a song started from 0). Null while loading; after the
   *  voice ends it stays frozen where it ended. */
  songTime(contextTime: number): number | null;
  /** Continue from song second `offset` at context time `at` (default: now plus the start margin), sample-accurately. */
  seek(offset: number, at?: number): void;
  /** Stop at context time `at` (default: now); while loading, the stop applies once the song is scheduled. A seek
   *  cannot pass a scheduled stop. Idempotent. */
  stop(at?: number): void;
  setGain(gain: number): void;
}

export interface MusicStats {
  /** Voices held: loading, scheduled or playing. */
  readonly active: number;
  readonly played: number;
  readonly skipped: number;
  readonly dropped: number;
}

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

/** One source. `done`: it has ended (its stop time passed or the song ran out) but is kept until the hand-off, so
 *  songTime and state stay on what was last audible. */
interface Segment {
  source: AudioBufferSourceNode;
  start: number;
  offset: number;
  done?: boolean;
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

function validate(options: MusicOptions) {
  if (options.at !== undefined && !(finite(options.at) && options.at >= 0)) throw Error('music: invalid start time');
  if (options.offset !== undefined && !(finite(options.offset) && options.offset >= 0))
    throw Error('music: invalid offset');
  if (options.gain !== undefined && !(finite(options.gain) && options.gain >= 0 && options.gain <= 1))
    throw Error('music: gain must be in [0, 1]');
  if (options.late !== undefined && options.late !== 'skip-ahead' && options.late !== 'drop')
    throw Error('music: late must be skip-ahead or drop');
  const loop = options.loop;
  if (
    loop &&
    !(finite(loop.start) && loop.start >= 0 && (loop.end === undefined || (finite(loop.end) && loop.end > loop.start)))
  )
    throw Error('music: invalid loop points');
}

export function createMusicPlayer(host: MusicHost) {
  if (!Number.isSafeInteger(host.maxVoices) || host.maxVoices < 1 || host.maxVoices > 16)
    throw Error('music: maxVoices must be an integer in [1, 16]');
  const voices = new Set<MusicVoice>();
  const stats = {played: 0, skipped: 0, dropped: 0};
  const reported = new Set<string>();
  const once = (key: string, message: string) => {
    if (reported.has(key) || reported.size >= 256) return;
    reported.add(key);
    try {
      host.report(message);
    } catch {
      /* diagnostics only */
    }
  };

  function play(id: string, options: MusicOptions = {}): MusicVoice | null {
    validate(options);
    options = {...options, ...(options.loop ? {loop: {...options.loop}} : {})};
    if (voices.size >= host.maxVoices) {
      stats.skipped++;
      return null;
    }
    let url: string | undefined;
    try {
      url = host.url(id);
    } catch (error) {
      once(id, `music '${id}' cannot be resolved: ${String(error)}`);
      stats.skipped++;
      return null;
    }
    if (!url) {
      once(id, `no music '${id}'`);
      stats.skipped++;
      return null;
    }
    const c = host.running(),
      bus = host.bus();
    if (!c || !bus) {
      stats.skipped++;
      return null;
    }
    if (options.at !== undefined && options.at > c.currentTime + host.maxStartAhead) {
      once('\0horizon', 'music start beyond the schedule horizon');
      stats.skipped++;
      return null;
    }

    let ended = false,
      buffer: AudioBuffer | null = null,
      duration: number | null = null;
    let current: Segment | null = null,
      previous: Segment | null = null,
      stopAt: number | null = null,
      pendingStop: number | null = null;
    /** Where songTime freezes once the voice has ended: the last segment and the time it ended. */
    let frozen: {segment: {start: number; offset: number}; at: number} | null = null;
    let pending = {offset: options.offset ?? 0, at: options.at};
    let settle!: (ok: boolean) => void;
    const ready = new Promise<boolean>(resolve => {
      settle = resolve;
    });
    const level = c.createGain();
    level.gain.value = options.gain ?? 1;
    level.connect(bus);
    const loopEnd = () => Math.min(options.loop?.end ?? Infinity, duration ?? Infinity);
    /** Song position `elapsed` seconds after starting at `offset`, with the loop applied. */
    const advance = (offset: number, elapsed: number) => {
      const p = offset + elapsed,
        loop = options.loop;
      if (loop && duration !== null) {
        const end = loopEnd(),
          length = end - loop.start;
        if (p >= end && length > 0) return loop.start + ((p - loop.start) % length);
        return p;
      }
      return duration !== null ? Math.min(p, duration) : p;
    };
    const started = (segment: Segment) => c.currentTime >= segment.start;
    const release = (segment: Segment | null) => {
      if (!segment) return;
      segment.source.onended = null;
      try {
        segment.source.stop();
      } catch {
        /* not started or already stopped */
      }
      segment.source.disconnect();
    };
    const finish = () => {
      if (ended) return;
      ended = true;
      voices.delete(voice);
      const last = current && (started(current) || !previous) ? current : (previous ?? current);
      if (last)
        frozen = {segment: {start: last.start, offset: last.offset}, at: Math.min(stopAt ?? Infinity, c.currentTime)};
      release(previous);
      release(current);
      previous = current = null;
      level.disconnect();
      buffer = null; // the store keeps its own copy within its budget; an ended voice holds no PCM
      settle(false);
      try {
        options.onEnded?.();
      } catch (error) {
        once('\0ended', `music completion failed: ${String(error)}`);
      }
    };
    const begin = (at: number, offset: number): Segment => {
      const source = c.createBufferSource();
      source.buffer = buffer;
      if (options.loop) {
        source.loop = true;
        source.loopStart = options.loop.start;
        source.loopEnd = loopEnd();
      }
      source.connect(level);
      const segment: Segment = {source, start: at, offset};
      source.onended = () => {
        if (current === segment) finish();
        else if (previous === segment) {
          segment.done = true;
          segment.source.disconnect();
        }
      };
      source.start(at, offset);
      if (stopAt !== null) source.stop(stopAt);
      return segment;
    };
    const schedule = (decoded: AudioBuffer) => {
      if (ended) return;
      // Only a disposed, silenced or replaced context drops the song; a suspended one (hidden tab) has a frozen
      // clock, so the song is scheduled on it and plays in step with the timeline when the tab returns.
      if (host.existing() !== c) {
        stats.dropped++;
        finish();
        return;
      }
      buffer = decoded;
      duration = decoded.duration;
      const {offset} = pending;
      if (offset >= decoded.duration || (options.loop && (options.loop.start >= loopEnd() || offset >= loopEnd()))) {
        once(`\0range:${id}`, `music '${id}': offset or loop points outside the song`);
        stats.dropped++;
        finish();
        return;
      }
      const earliest = c.currentTime + MUSIC_START_MARGIN;
      let at = pending.at ?? earliest,
        from = offset;
      if (at < earliest) {
        // Decoded after its start time: keep sync by starting where the song should be, or drop.
        if (pending.at !== undefined && options.late === 'drop') {
          stats.dropped++;
          finish();
          return;
        }
        from = advance(offset, earliest - at);
        at = earliest;
        if (!options.loop && from >= decoded.duration) {
          stats.dropped++;
          finish();
          return;
        }
      }
      // A stop asked for while loading: at or before the start, nothing plays.
      if (pendingStop !== null) {
        if (pendingStop <= at) {
          finish();
          return;
        }
        stopAt = pendingStop;
      }
      // A skipped-ahead start records where it actually began, so songTime matches what is heard.
      current = begin(at, from);
      stats.played++;
      settle(true);
    };

    const voice: MusicVoice = {
      // Between a seek and its hand-off the voice is `playing` even if the old source has already run out: it is in
      // progress and will sound again at the hand-off.
      get state() {
        return ended ? 'ended' : !current ? 'loading' : !started(current) && !previous ? 'scheduled' : 'playing';
      },
      get ended() {
        return ended;
      },
      ready,
      get duration() {
        return duration;
      },
      songTime(t) {
        if (!finite(t)) throw Error('music: invalid context time');
        if (frozen) {
          const elapsed = Math.min(t, frozen.at) - frozen.segment.start;
          return elapsed < 0 ? frozen.segment.offset + elapsed : advance(frozen.segment.offset, elapsed);
        }
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
        if (!current || !buffer) {
          pending = {offset, at};
          return;
        }
        if (offset >= buffer.duration || (options.loop && offset >= loopEnd()))
          throw Error('music: seek beyond the song');
        const when = Math.max(at ?? 0, c.currentTime + MUSIC_START_MARGIN);
        if (when > c.currentTime + host.maxStartAhead) throw Error('music: seek beyond the schedule horizon');
        if (stopAt !== null && when >= stopAt) throw Error('music: seek after the scheduled stop');
        if (!started(current)) {
          // The last seek's hand-off (or the first start) has not happened yet: replace it; whatever is audible now
          // (the previous source) keeps playing and now hands over at the new time.
          release(current);
          current = null;
          if (previous) {
            try {
              previous.source.stop(when);
            } catch {
              /* already stopping */
            }
          }
        } else {
          release(previous);
          previous = current;
          try {
            previous.source.stop(when);
          } catch {
            /* already stopping */
          }
        }
        current = begin(when, offset);
      },
      stop(at) {
        if (at !== undefined && !(finite(at) && at >= 0)) throw Error('music: invalid stop time');
        if (ended) return;
        if (at === undefined || at <= c.currentTime) {
          finish();
          return;
        }
        if (!current) {
          pendingStop = at;
          return;
        }
        if (at <= current.start) {
          // The stop lands before the pending start or hand-off: that source never plays, so release it now (do not
          // rely on browsers firing `ended` for a source stopped before it started). What is audible now (the
          // previous source) becomes the voice's only source and ends at `at`; its own `ended` finishes the voice.
          release(current);
          current = previous;
          previous = null;
          if (!current || current.done) {
            stopAt = at;
            finish();
            return;
          }
        }
        stopAt = at;
        try {
          current.source.stop(at);
        } catch {
          finish();
        }
      },
      setGain(gain) {
        if (!(finite(gain) && gain >= 0 && gain <= 1)) throw Error('music: gain must be in [0, 1]');
        if (!ended) level.gain.value = gain;
      },
    };
    voices.add(voice);
    const decoded = host.files.buffer(id);
    if (decoded) schedule(decoded);
    else
      host.files.decode(id, url, c).then(schedule, () => {
        if (!ended) {
          stats.dropped++;
          finish();
        }
      });
    return voice;
  }

  return {
    play,
    /** Fetch and decode ahead. True when decoded and ready to start exactly; false when silent, never unlocked
     *  (nothing to decode on yet), failed or refused. Forgets an earlier failure. */
    async load(id: string, signal?: AbortSignal): Promise<boolean> {
      let url: string | undefined;
      try {
        url = host.url(id);
      } catch (error) {
        once(id, `music '${id}' cannot be resolved: ${String(error)}`);
        return false;
      }
      if (!url) {
        once(id, `no music '${id}'`);
        return false;
      }
      host.files.retry(id);
      if (!(await host.files.fetch(id, url, signal))) return false;
      const c = host.existing();
      if (!c || signal?.aborted) return false;
      try {
        await host.files.decode(id, url, c);
        return !signal?.aborted;
      } catch {
        return false;
      }
    },
    get stats(): MusicStats {
      return {active: voices.size, ...stats};
    },
    dispose() {
      for (const voice of [...voices]) voice.stop();
      host.files.dispose();
    },
  };
}
export type MusicPlayer = ReturnType<typeof createMusicPlayer>;
