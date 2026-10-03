/**
 * platform/audio/audio-timeline.ts: an audio-clock timeline. The audio context's clock is the master; frame and
 * input timestamps (milliseconds on the page's monotonic clock, `performance.now()`) are mapped onto it.
 *
 * - Mapping: each `pump()` reads one clock sample from the existing audio output (`AudioOutput.clock()`), and
 *   smooths the offset between the context clock and the page clock (render-quantum jitter, slow drift). A jump
 *   larger than `resyncThreshold` (suspend and resume, a device change) re-anchors at once and is counted.
 * - Heard time: what the listener hears lags the context's render clock by the output latency. It is measured
 *   from `getOutputTimestamp()` where the browser reports it, otherwise `baseLatency + outputLatency`.
 * - Positions are seconds on the timeline (0 = its start). `position` is frame-consistent and never runs
 *   backwards within a run; `inputPosition(eventMs)` maps an input's own timestamp, minus the stored calibration.
 * - Scheduling: events (`schedule(at, payload)`) are dispatched once, in time order, when they come within
 *   `lookahead` of the render clock, with the exact context time `when` to start sound at. Bounded admission
 *   (`maxPending`), bounded work per pump (`maxDispatch`); an event later than `lateTolerance` is dropped, not
 *   played late. Cancellation: `cancel(id)`, an AbortSignal, `stop()`, `dispose()`.
 * - Without a clock sample at `start()` (silent tests, a locked or absent context) the run uses a page-clock
 *   fallback (`source: 'performance'`) whose steps are clamped like the frame loop's, so a hidden tab never
 *   leaps ahead; `when` is then null. A run keeps its source until it is stopped and started again.
 *
 * It owns no audio resources and creates no context, timer or loop: the caller pumps it from its frame update and
 * plays sound through the existing output (`playVoice(id, { at: when })`). Pure and deterministic with fakes.
 */

/** One sample of the context clock, taken by the audio output. Times: seconds (context) and milliseconds (page). */
export interface AudioClockReading {
  /** `AudioContext.currentTime`: the start of the next block the context renders. */
  readonly currentTime: number;
  /** `performance.now()` read together with `currentTime`. */
  readonly performanceTime: number;
  /** `AudioContext.outputLatency` in seconds; 0 where unreported. */
  readonly outputLatency: number;
  /** `AudioContext.baseLatency` in seconds; 0 where unreported. */
  readonly baseLatency: number;
  /** `getOutputTimestamp()` when the browser reports a usable pair: the context time audible at `performanceTime`. */
  readonly output: {readonly contextTime: number; readonly performanceTime: number} | null;
}

/**
 * A player's stored latency calibration: two measured lags in milliseconds, each within ±`MAX_CALIBRATION_MS`. Both
 * use the same sign: positive means that path is late by that much, and the timeline compensates for it.
 */
export interface AudioCalibration {
  /** Input lag: a press registers this much after the player meant it (subtracted from input positions). */
  readonly inputMs: number;
  /** Display lag: a drawn frame reaches the eye this much after it is rendered (added to the frame position). */
  readonly visualMs: number;
}
export const MAX_CALIBRATION_MS = 500;
export const NO_CALIBRATION: AudioCalibration = Object.freeze({inputMs: 0, visualMs: 0});

export interface TimelineEvent<T> {
  readonly id: number;
  /** Timeline seconds the event was scheduled for. */
  readonly at: number;
  /** Context seconds to start sound at (`playVoice(id, { at: when })`); null on the page-clock fallback. */
  readonly when: number | null;
  /** Seconds behind the render clock at dispatch (negative: ahead, the normal case). */
  readonly lateBy: number;
  readonly payload: T;
}

export type TimelineSource = 'audio' | 'performance';

export interface AudioTimelineOptions<T> {
  /** One clock sample, or null (silent, locked, suspended, hidden). Usually `() => ctx.audioClock()`. */
  read(): AudioClockReading | null;
  /** Page monotonic milliseconds for the current frame. Usually `() => ctx.time.now`. */
  now(): number;
  /** Called once per due event, in time order. A throwing handler does not stop its siblings. */
  dispatch(event: TimelineEvent<T>): void;
  /** Called for an event dropped because it was later than `lateTolerance`. */
  dropped?(event: TimelineEvent<T>): void;
  /** 'performance' (default): a run without a clock sample uses the page clock. 'none': `start()` returns null. */
  fallback?: 'performance' | 'none';
  /** Seconds ahead of the render clock that events are dispatched. Default 0.1; (0, 1]. */
  lookahead?: number;
  /** Seconds behind the render clock an event may still be dispatched. Default 0.03; [0, 1]. */
  lateTolerance?: number;
  /** Pending events admitted. Default 512; 1 to 16384. */
  maxPending?: number;
  /** Events resolved (dispatched or dropped) per pump. Default 64; 1 to 4096. */
  maxDispatch?: number;
  /** A clock offset change larger than this (seconds) re-anchors. Default 0.05; [0.005, 1]. */
  resyncThreshold?: number;
  /** Smoothing factor per sample. Default 0.1; (0, 1]. */
  smoothing?: number;
  /** Largest output latency accepted (seconds); larger measurements are clamped. Default 0.5; [0, 2]. */
  maxLatency?: number;
  calibration?: AudioCalibration;
}

export interface AudioTimelineStats {
  readonly source: TimelineSource | null;
  /** The audio source has no clock sample (suspended, hidden, locked): positions hold and nothing dispatches. */
  readonly stalled: boolean;
  readonly pending: number;
  /** Records held, including cancelled ones awaiting compaction: at most 2 × maxPending + 65. */
  readonly retained: number;
  readonly dispatched: number;
  readonly dropped: number;
  /** Re-anchors after a clock jump. */
  readonly resyncs: number;
  /** Smoothed output latency in seconds (0 on the page-clock fallback). */
  readonly latency: number;
}

export interface AudioTimeline<T> {
  /** Begin a run `lead` seconds from now (default lookahead + 0.05). Returns the run's source, or null when
   *  `fallback: 'none'` and there is no clock sample. Throws when already running or disposed. */
  start(lead?: number): TimelineSource | null;
  /** End the run; pending events are cancelled without callbacks. Idempotent. */
  stop(): void;
  readonly running: boolean;
  /** Sample the clock, then dispatch due events. Call once per frame, before reading `position`. */
  pump(): number;
  /** Frame-consistent heard position (seconds) plus the display lag (`calibration.visualMs`); monotonic within a run. */
  readonly position: number;
  /** Heard position at a page timestamp (ms), uncalibrated and unclamped. NaN when not running. */
  positionAt(ms: number): number;
  /** Heard position of an input at its own timestamp (ms), minus the input calibration. NaN when not running. */
  inputPosition(ms: number): number;
  /** Context seconds for a timeline position (for sound); null on the fallback or when not running. */
  contextTime(at: number): number | null;
  /** Admit an event; null when full, stopped-and-disposed, or the signal is aborted. Throws on a non-finite time. */
  schedule(at: number, payload: T, signal?: AbortSignal): number | null;
  cancel(id: number): boolean;
  calibration: AudioCalibration;
  readonly stats: AudioTimelineStats;
  dispose(): void;
}

/** Largest page-clock step on the fallback (matches the frame loop's clamp: a stall never teleports). */
const MAX_FALLBACK_STEP_S = 0.25;
const MAX_TIME = 1e7;

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const ranged = (name: string, value: number, min: number, max: number, open = false) => {
  if (!finite(value) || value > max || (open ? value <= min : value < min))
    throw Error(`audio timeline: ${name} out of range`);
  return value;
};
const integer = (name: string, value: number, min: number, max: number) => {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw Error(`audio timeline: ${name} out of range`);
  return value;
};
export function validateCalibration(c: AudioCalibration): AudioCalibration {
  if (!c || typeof c !== 'object') throw Error('audio timeline: invalid calibration');
  ranged('inputMs', c.inputMs, -MAX_CALIBRATION_MS, MAX_CALIBRATION_MS);
  ranged('visualMs', c.visualMs, -MAX_CALIBRATION_MS, MAX_CALIBRATION_MS);
  return Object.freeze({inputMs: c.inputMs, visualMs: c.visualMs});
}

/** A usable reading: finite, non-negative times and latencies. Anything else counts as no sample. */
function usable(r: AudioClockReading | null): r is AudioClockReading {
  if (!r || !finite(r.currentTime) || r.currentTime < 0 || !finite(r.performanceTime) || r.performanceTime < 0)
    return false;
  if (!finite(r.outputLatency) || r.outputLatency < 0 || !finite(r.baseLatency) || r.baseLatency < 0) return false;
  return (
    r.output === null ||
    (finite(r.output.contextTime) &&
      r.output.contextTime >= 0 &&
      finite(r.output.performanceTime) &&
      r.output.performanceTime >= 0)
  );
}

interface Pending<T> {
  id: number;
  at: number;
  payload: T;
  live: boolean;
  off?: () => void;
}

export function createAudioTimeline<T = unknown>(o: AudioTimelineOptions<T>): AudioTimeline<T> {
  if (typeof o.read !== 'function' || typeof o.now !== 'function' || typeof o.dispatch !== 'function')
    throw Error('audio timeline: read, now and dispatch are required');
  const fallback = o.fallback ?? 'performance';
  if (fallback !== 'performance' && fallback !== 'none') throw Error('audio timeline: invalid fallback');
  const lookahead = ranged('lookahead', o.lookahead ?? 0.1, 0, 1, true);
  const lateTolerance = ranged('lateTolerance', o.lateTolerance ?? 0.03, 0, 1);
  const maxPending = integer('maxPending', o.maxPending ?? 512, 1, 16384);
  const maxDispatch = integer('maxDispatch', o.maxDispatch ?? 64, 1, 4096);
  const resyncThreshold = ranged('resyncThreshold', o.resyncThreshold ?? 0.05, 0.005, 1);
  const smoothing = ranged('smoothing', o.smoothing ?? 0.1, 0, 1, true);
  const maxLatency = ranged('maxLatency', o.maxLatency ?? 0.5, 0, 2);
  let calibration = validateCalibration(o.calibration ?? NO_CALIBRATION);

  // Mapping: render clock (context seconds) at page time p (ms) = p / 1000 + offset; heard = render - latency.
  let source: TimelineSource | null = null,
    origin = 0,
    offset = 0,
    latency = 0,
    synced = false,
    stalled = false;
  let lastPageMs = 0,
    framePosition = 0,
    closed = false,
    pumping = false,
    sequence = 0;
  let dispatched = 0,
    droppedCount = 0,
    resyncs = 0,
    run = 0;
  // Time-ordered queue with lazy deletion: `head` advances past resolved records; cancelled records inside the queue
  // are dead until compaction, which runs once they outnumber live ones, so the queue holds O(maxPending) records.
  let queue: Pending<T>[] = [],
    head = 0,
    live = 0;
  const byId = new Map<number, Pending<T>>();

  const readNow = () => {
    const ms = o.now();
    if (!finite(ms) || ms < 0 || ms > MAX_TIME * 1000)
      throw Error('audio timeline: now() must be finite page milliseconds');
    return ms;
  };
  const sampleAudio = (): boolean => {
    let r: AudioClockReading | null;
    try {
      r = o.read();
    } catch {
      r = null;
    }
    if (!usable(r)) {
      stalled = true;
      return false;
    }
    const measured = r.currentTime - r.performanceTime / 1000;
    const heardLag = r.output
      ? measured - (r.output.contextTime - r.output.performanceTime / 1000)
      : r.baseLatency + r.outputLatency;
    const lag = Math.min(maxLatency, Math.max(0, finite(heardLag) ? heardLag : 0));
    if (!synced || stalled || Math.abs(measured - offset) > resyncThreshold) {
      if (synced) resyncs++;
      offset = measured;
      latency = lag;
      synced = true;
      stalled = false;
    } else {
      offset += smoothing * (measured - offset);
      latency += smoothing * (lag - latency);
    }
    return true;
  };
  const samplePage = (ms: number) => {
    // A page-clock run: advance by real elapsed time, clamped per pump like the frame loop's dt.
    const step = (ms - lastPageMs) / 1000;
    if (step > MAX_FALLBACK_STEP_S) offset -= step - MAX_FALLBACK_STEP_S;
    else if (step < 0) offset -= step; // a timestamp that runs backwards never rewinds the run
    lastPageMs = ms;
  };
  const heardAt = (ms: number) => ms / 1000 + offset - latency - origin;
  const renderAt = (ms: number) => ms / 1000 + offset - origin;

  const removeAt = (record: Pending<T>) => {
    record.live = false;
    record.off?.();
    record.off = undefined;
    byId.delete(record.id);
    live--;
  };
  const compact = () => {
    if (pumping) return; // the pump compacts once its loop ends
    const dead = queue.length - live; // resolved records before `head` plus cancelled ones after it
    if (dead > 64 && dead > live) {
      queue = queue.slice(head).filter(r => r.live);
      head = 0;
    }
  };
  const clearAll = () => {
    for (const record of queue.slice(head)) if (record.live) removeAt(record);
    queue = [];
    head = 0;
  };
  const event = (record: Pending<T>, lateBy: number): TimelineEvent<T> =>
    Object.freeze({
      id: record.id,
      at: record.at,
      when: source === 'audio' ? origin + record.at : null,
      lateBy,
      payload: record.payload,
    });

  const timeline: AudioTimeline<T> = {
    start(lead = lookahead + 0.05) {
      if (closed) throw Error('audio timeline: disposed');
      if (source) throw Error('audio timeline: already running');
      ranged('lead', lead, 0, 60);
      const ms = readNow();
      synced = false;
      stalled = false;
      latency = 0;
      offset = 0;
      if (sampleAudio()) source = 'audio';
      else if (fallback === 'performance') {
        source = 'performance';
        stalled = false;
        offset = 0;
        latency = 0;
        lastPageMs = ms;
      } else {
        stalled = false;
        return null;
      }
      origin = ms / 1000 + offset + lead; // never relative to a previous run's origin
      // The listener hears the start `lead` seconds from now; until then positions are negative.
      framePosition = heardAt(ms) + calibration.visualMs / 1000;
      run++;
      return source;
    },
    stop() {
      source = null;
      stalled = false;
      run++;
      clearAll();
    },
    get running() {
      return source !== null;
    },
    pump() {
      if (closed || !source || pumping) return 0;
      pumping = true;
      let errors: unknown[] | null = null;
      let count = 0,
        resolved = 0;
      const epoch = run;
      try {
        const ms = readNow();
        if (source === 'audio') {
          if (!sampleAudio()) return 0;
        } else samplePage(ms);
        framePosition = Math.max(framePosition, heardAt(ms) + calibration.visualMs / 1000);
        const now = renderAt(ms);
        // A handler that stops or restarts the run ends this loop: `now` belonged to the old run.
        while (head < queue.length && resolved < maxDispatch && !closed && source && run === epoch) {
          const record = queue[head]!; // head < queue.length (loop condition)
          if (!record.live) {
            head++;
            continue;
          }
          if (record.at > now + lookahead) break;
          head++;
          const lateBy = now - record.at;
          removeAt(record);
          const e = event(record, lateBy);
          resolved++;
          if (lateBy > lateTolerance) {
            droppedCount++;
            try {
              o.dropped?.(e);
            } catch (error) {
              (errors ??= []).push(error);
            }
          } else {
            dispatched++;
            count++;
            try {
              o.dispatch(e);
            } catch (error) {
              (errors ??= []).push(error);
            }
          }
        }
      } finally {
        pumping = false;
      }
      compact();
      if (errors?.length === 1) throw errors[0];
      if (errors) throw new AggregateError(errors, 'audio timeline dispatch failed');
      return count;
    },
    get position() {
      return source ? framePosition : NaN;
    },
    positionAt(ms) {
      if (!finite(ms)) throw Error('audio timeline: invalid timestamp');
      return source ? heardAt(ms) : NaN;
    },
    inputPosition(ms) {
      return timeline.positionAt(ms) - calibration.inputMs / 1000;
    },
    contextTime(at) {
      if (!finite(at)) throw Error('audio timeline: invalid position');
      return source === 'audio' ? origin + at : null;
    },
    schedule(at, payload, signal) {
      if (!finite(at) || Math.abs(at) > MAX_TIME) throw Error('audio timeline: invalid event time');
      if (closed || signal?.aborted || live >= maxPending) return null;
      const record: Pending<T> = {id: ++sequence, at, payload, live: true};
      // Binary search among pending records: equal times keep admission order.
      let lo = head,
        hi = queue.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (queue[mid]!.at <= at) /* head <= lo <= mid < hi <= queue.length */ lo = mid + 1;
        else hi = mid;
      }
      queue.splice(lo, 0, record);
      byId.set(record.id, record);
      live++;
      if (signal) {
        const abort = () => {
          if (record.live) {
            removeAt(record);
            compact();
          }
        };
        signal.addEventListener('abort', abort, {once: true});
        record.off = () => signal.removeEventListener('abort', abort);
      }
      return record.id;
    },
    cancel(id) {
      const record = byId.get(id);
      if (!record) return false;
      removeAt(record);
      compact();
      return true;
    },
    get calibration() {
      return calibration;
    },
    set calibration(value) {
      calibration = validateCalibration(value);
    },
    get stats() {
      return Object.freeze({
        source,
        stalled: source === 'audio' && stalled,
        pending: live,
        retained: queue.length,
        dispatched,
        dropped: droppedCount,
        resyncs,
        latency: source === 'audio' ? latency : 0,
      });
    },
    dispose() {
      if (closed) return;
      closed = true;
      source = null;
      clearAll();
    },
  };
  return timeline;
}

export interface OffsetEstimate {
  readonly offsetMs: number;
  readonly spreadMs: number;
  readonly used: number;
}

/**
 * Calibration from taps: `deltasMs` are (input position - target position) in ms for a tap-along test. Samples that
 * are not finite or lie beyond ±1000 ms are discarded (a stray tap never throws). Returns the median after dropping
 * samples further than 3 median absolute deviations (at least 5 ms) from it, or null with fewer than `min` usable
 * samples. Bounded: at most 1024 samples. Targets are usually the nearest beat, which aliases once the true lag nears
 * half a beat (wireless output at a fast tempo): calibrate at a tempo whose beat is well over twice the largest lag.
 */
export function estimateOffset(deltasMs: readonly number[], min = 8): OffsetEstimate | null {
  integer('min', min, 1, 1024);
  if (!Array.isArray(deltasMs) || deltasMs.length > 1024) throw Error('audio timeline: too many calibration samples');
  const usableDeltas = deltasMs.filter(d => finite(d) && Math.abs(d) <= 1000);
  if (usableDeltas.length < min) return null;
  // xs holds at least min >= 1 samples, so m and m - 1 are in range.
  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b),
      m = s.length >> 1;
    return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
  };
  const m0 = median(usableDeltas);
  const mad = median(usableDeltas.map(d => Math.abs(d - m0)));
  const kept = usableDeltas.filter(d => Math.abs(d - m0) <= Math.max(5, 3 * mad));
  if (kept.length < min) return null;
  const offsetMs = median(kept);
  const spreadMs = median(kept.map(d => Math.abs(d - offsetMs)));
  return Object.freeze({
    offsetMs: Math.max(-MAX_CALIBRATION_MS, Math.min(MAX_CALIBRATION_MS, offsetMs)),
    spreadMs,
    used: kept.length,
  });
}
