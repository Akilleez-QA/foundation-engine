// platform/perf/session-recorder.ts (L1, pure): the optional sustained-session performance recorder (PERF-01, N7).
//
// It reads the one frame loop's records through `FrameLoop.attachSampler` (STD-RUN-1: it adds no loop, ticker or timer)
// and keeps rolling windows of frame-interval and frame-work percentiles, long-frame counts, rendered/idle frame counts
// and a drift estimate across session minutes (a thermal proxy, not a thermal measurement). Memory is fixed by its
// options: four histograms of HISTOGRAM_BINS counters, at most `maxWindows` window summaries and `maxSegments` segments.
// A frame does constant work and allocates nothing; a window close allocates one summary.
//
// Everything stays on the device (STD-SYS-18): the recorder has no transport. `evidence()` returns a plain object the
// caller may save locally; nothing here sends, schedules or persists it. Only the dev/test API imports this module, so
// production builds do not contain it.
import type {FrameRecord, FrameSamplerPort} from '../../core/activity/ports';
import {CLASSIFICATION_VERSION, type WindowClassification} from './window-class';

export const SESSION_EVIDENCE_SCHEMA = 'foundation.session-perf';
export const SESSION_EVIDENCE_VERSION = 1;

// ------------------------------------------------------------------------------------------------ fixed histogram
/** 0.1 ms bins below 50 ms, 1 ms bins to 250 ms, 10 ms bins to 1000 ms, then one overflow bin. */
export const HISTOGRAM_BINS = 776;
const OVERFLOW = HISTOGRAM_BINS - 1;
/** Bin width at a value: the documented accuracy bound of a reported percentile (it is never below the exact value). */
export function binWidthAt(ms: number): number {
  return ms < 50 ? 0.1 : ms < 250 ? 1 : ms < 1000 ? 10 : Infinity;
}
function binOf(ms: number): number {
  if (ms < 50) return Math.min(499, Math.floor(ms * 10));
  if (ms < 250) return 500 + Math.min(199, Math.floor(ms - 50));
  if (ms < 1000) return 700 + Math.min(74, Math.floor((ms - 250) / 10));
  return OVERFLOW;
}
function upperEdge(bin: number): number {
  if (bin < 500) return (bin + 1) / 10;
  if (bin < 700) return 50 + (bin - 500) + 1;
  if (bin < OVERFLOW) return 250 + (bin - 700 + 1) * 10;
  return Infinity;
}

export interface Distribution {
  count: number;
  /** Nearest-rank percentiles, reported as the containing bin's upper edge clamped to the observed [min, max]. */
  p50: number;
  p95: number;
  p99: number;
  max: number;
  mean: number;
}

/** A fixed-size histogram. `add` is O(1) and allocation-free; percentiles scan the fixed bins. */
export class FixedHistogram {
  private readonly counts = new Uint32Array(HISTOGRAM_BINS);
  count = 0;
  sum = 0;
  min = Infinity;
  max = -Infinity;
  add(ms: number): void {
    this.counts[binOf(ms)]!++; // a bin index from binOf (typed array: no undefined element)
    this.count++;
    this.sum += ms;
    if (ms < this.min) this.min = ms;
    if (ms > this.max) this.max = ms;
  }
  reset(): void {
    this.counts.fill(0);
    this.count = 0;
    this.sum = 0;
    this.min = Infinity;
    this.max = -Infinity;
  }
  /** Nearest rank: the smallest recorded bin whose cumulative count reaches ceil(p × n). */
  quantile(p: number): number {
    if (this.count === 0) return NaN;
    const rank = Math.max(1, Math.ceil(p * this.count));
    let seen = 0;
    for (let b = 0; b < HISTOGRAM_BINS; b++) {
      seen += this.counts[b]!; // b < HISTOGRAM_BINS = counts.length
      if (seen >= rank) return Math.max(this.min, Math.min(this.max, upperEdge(b)));
    }
    return this.max;
  }
  summary(): Distribution | null {
    if (this.count === 0) return null;
    return {
      count: this.count,
      p50: round(this.quantile(0.5)),
      p95: round(this.quantile(0.95)),
      p99: round(this.quantile(0.99)),
      max: round(this.max),
      mean: round(this.sum / this.count),
    };
  }
}
const round = (v: number) => Math.round(v * 1000) / 1000;

// ------------------------------------------------------------------------------------------------ options and output
export type OverflowPolicy = 'stop' | 'ring';
export type EvidenceClass = 'physical' | 'emulated' | 'unspecified';

export interface SessionMeta {
  /** Operator-entered device profile label (never inferred), e.g. 'phone-minimum'. */
  profile?: string;
  /** What produced the record. The recorder cannot verify it; only the operator can label a physical device run. */
  evidence?: EvidenceClass;
  /** Build revision, supplied by whoever built and served the page. */
  build?: string;
  notes?: string;
}

export interface SessionRecorderOptions {
  /** Loop-active milliseconds per window (sum of frame intervals; hidden and idle time excluded). Default 30 000. */
  windowMs?: number;
  /** Retained window summaries. Default 120 (60 minutes of 30 s windows). */
  maxWindows?: number;
  /** At capacity: 'stop' (default) records a truncation marker and stops; 'ring' evicts the oldest and counts it. */
  overflow?: OverflowPolicy;
  /** Distinct segments (scene/epoch/preset/label). At capacity the recorder truncates, whatever the policy. Default 256. */
  maxSegments?: number;
  /** The frame budget in ms (the brief's fps target). Default 1000 / 60. */
  budgetMs?: number;
  /** A long frame: interval above this. Default 1.5 × budgetMs (at least one missed display refresh at the budget rate). */
  longFrameMs?: number;
  /** A severe frame: interval at or above this. Default 50 ms. */
  severeFrameMs?: number;
  /** Intervals at or above this are gaps (a stalled tab, a debugger pause, a clock jump): counted, never percentiled.
   *  Default 1000 ms. */
  gapMs?: number;
  /** Optional cumulative counters (e.g. draw calls, triangles), read only when a window opens and closes. */
  counters?: () => {draws: number; triangles: number} | null | undefined;
  meta?: SessionMeta;
}

export interface SegmentKey {
  scene: string | null;
  /** The scene visit's run epoch (ADR 0053's guard); a re-entered scene is a new segment. */
  epoch?: number | null;
  preset?: string | null;
  label?: string | null;
}

export type WindowEnd = 'full' | 'hidden' | 'segment' | 'paused' | 'stopped' | 'truncated';

export interface SessionWindow {
  index: number;
  segment: number;
  /** Frame timestamps (ms) relative to the session's first record. */
  startMs: number;
  endMs: number;
  /** startMs in minutes: the drift x-axis. */
  startMinute: number;
  /** Sum of the window's frame intervals (excluding gaps). */
  activeMs: number;
  complete: boolean;
  end: WindowEnd;
  frames: number;
  renderedFrames: number;
  idleFrames: number;
  /** Frames after an idle or hidden loop (interval 0): not percentiled. */
  resumes: number;
  gaps: number;
  /** Frames stepped by a test driver while the loop was held: counted, never timed. */
  steppedFrames: number;
  longFrames: number;
  severeFrames: number;
  frameMs: Distribution | null;
  workMs: Distribution | null;
  /** Mean per rendered frame from the optional counters; null when not supplied or unavailable. */
  drawsPerRenderedFrame: number | null;
  trianglesPerRenderedFrame: number | null;
  classification: WindowClassification;
}

export interface SessionSegment {
  index: number;
  scene: string | null;
  epoch: number | null;
  preset: string | null;
  label: string | null;
  startMs: number;
}

export interface DriftEstimate {
  /** scene + preset: windows of different visits to the same scene and preset are one workload. */
  group: string;
  windows: number;
  /** Least-squares slope of window p95 against startMinute (ms per minute); null below two distinct minutes. */
  frameP95SlopeMsPerMin: number | null;
  workP95SlopeMsPerMin: number | null;
  /** Mean p95 of the first and last k = max(1, floor(n / 3)) complete windows, and late / early. */
  early: {frameP95: number; workP95: number | null} | null;
  late: {frameP95: number; workP95: number | null} | null;
  frameP95Ratio: number | null;
  workP95Ratio: number | null;
}

export type RecorderState = 'recording' | 'paused' | 'stopped' | 'truncated' | 'disposed';

export interface SessionEvidence {
  schema: typeof SESSION_EVIDENCE_SCHEMA;
  version: typeof SESSION_EVIDENCE_VERSION;
  meta: Required<Pick<SessionMeta, 'profile' | 'evidence' | 'build'>> & {notes: string | null};
  recorder: {
    windowMs: number;
    maxWindows: number;
    maxSegments: number;
    overflow: OverflowPolicy;
    budgetMs: number;
    longFrameMs: number;
    severeFrameMs: number;
    gapMs: number;
    histogram: {bins: number; resolution: string; percentile: string};
    counters: boolean;
  };
  state: RecorderState;
  truncated: {reason: 'capacity' | 'segments'; atMs: number} | null;
  session: {
    records: number;
    frames: number;
    renderedFrames: number;
    idleFrames: number;
    resumes: number;
    hiddenTransitions: number;
    steppedFrames: number;
    gaps: number;
    clockAnomalies: number;
    longFrames: number;
    severeFrames: number;
    durationMs: number;
    frameMs: Distribution | null;
    workMs: Distribution | null;
    windowsClosed: number;
    windowsRetained: number;
    evictedWindows: number;
    discardedWindows: number;
    counterFailures: number;
  };
  segments: SessionSegment[];
  windows: SessionWindow[];
  drift: DriftEstimate[];
  limitations: string[];
}

export interface SessionRecorder extends FrameSamplerPort {
  readonly state: RecorderState;
  /** Start a new segment (closing the open window); the same key is a no-op. `null` pauses until the next segment. */
  segment(key: SegmentKey | null): void;
  /** Close the open window and stop recording; the evidence stays readable. Idempotent. */
  stop(): void;
  /** Stop, drop the open window and the histograms; the retained summaries stay readable. Idempotent. */
  dispose(): void;
  /** A detached, JSON-safe copy of everything retained. */
  evidence(): SessionEvidence;
}

const LIMITATIONS = [
  "Frame interval is the difference of the one frame loop's requestAnimationFrame timestamps; it reflects display pacing, not GPU time.",
  "Work time is main-thread elapsed time around the loop's tickers; it excludes compositor, GPU, worker and browser work.",
  'Percentiles come from fixed bins: each is at most one bin width (0.1 ms below 50 ms) above the exact nearest-rank value.',
  'Drift is a regression over window p95 against session minutes: a proxy that may reflect throttling, content or background load.',
  'The evidence class and device profile are operator labels; the recorder cannot verify the device.',
  'This file is supporting evidence only; it does not by itself satisfy any device acceptance requirement (DV-01).',
];

// ------------------------------------------------------------------------------------------------ validation
function positive(
  name: string,
  v: number | undefined,
  fallback: number,
  min: number,
  max: number,
  integer = false,
): number {
  if (v === undefined) return fallback;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max || (integer && !Number.isInteger(v)))
    throw new RangeError(`session recorder: ${name} must be ${integer ? 'an integer ' : ''}between ${min} and ${max}`);
  return v;
}
const LABEL_MAX = 120;
function label(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  // eslint-disable-next-line no-control-regex
  return String(v)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .slice(0, LABEL_MAX);
}
const EVIDENCE: readonly EvidenceClass[] = ['physical', 'emulated', 'unspecified'];

/** Least-squares slope of y on x; null without two distinct x values. */
export function slope(xs: readonly number[], ys: readonly number[]): number | null {
  const n = xs.length;
  if (n < 2) return null;
  let mx = 0,
    my = 0;
  // i < n = xs.length; ys is expected to be xs-aligned (a shorter ys gives NaN, as before).
  for (let i = 0; i < n; i++) {
    mx += xs[i]!;
    my += ys[i]!;
  }
  mx /= n;
  my /= n;
  let sxx = 0,
    sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i]! - mx) ** 2;
    sxy += (xs[i]! - mx) * (ys[i]! - my);
  }
  return sxx > 0 ? round(sxy / sxx) : null;
}

// ------------------------------------------------------------------------------------------------ the recorder
export function createSessionRecorder(
  options: SessionRecorderOptions = {},
  detach: () => void = () => {},
): SessionRecorder {
  const windowMs = positive('windowMs', options.windowMs, 30_000, 100, 3_600_000);
  const maxWindows = positive('maxWindows', options.maxWindows, 120, 1, 4096, true);
  const maxSegments = positive('maxSegments', options.maxSegments, 256, 1, 4096, true);
  const budgetMs = positive('budgetMs', options.budgetMs, 1000 / 60, 0.1, 1000);
  const longFrameMs = positive('longFrameMs', options.longFrameMs, budgetMs * 1.5, 0.1, 60_000);
  const severeFrameMs = positive('severeFrameMs', options.severeFrameMs, 50, 0.1, 60_000);
  const gapMs = positive('gapMs', options.gapMs, 1000, 1, 3_600_000);
  const overflow = options.overflow ?? 'stop';
  if (overflow !== 'stop' && overflow !== 'ring')
    throw new RangeError('session recorder: overflow must be stop or ring');
  const evidenceClass = options.meta?.evidence ?? 'unspecified';
  if (!EVIDENCE.includes(evidenceClass))
    throw new RangeError('session recorder: meta.evidence must be physical, emulated or unspecified');
  const meta = {
    profile: label(options.meta?.profile) ?? 'unlabelled',
    evidence: evidenceClass,
    build: label(options.meta?.build) ?? 'unrecorded',
    notes: label(options.meta?.notes),
  };
  const counters = options.counters;

  let state: RecorderState = 'recording';
  let truncated: SessionEvidence['truncated'] = null;
  let detached = false;
  const release = () => {
    if (!detached) {
      detached = true;
      try {
        detach();
      } catch {
        /* the owner's detach is best effort */
      }
    }
  };

  // Session totals.
  let origin: number | null = null,
    lastTime = -Infinity;
  let records = 0,
    frames = 0,
    renderedFrames = 0,
    idleFrames = 0,
    resumes = 0,
    hiddenTransitions = 0;
  let steppedFrames = 0,
    gaps = 0,
    clockAnomalies = 0,
    longFrames = 0,
    severeFrames = 0,
    counterFailures = 0;
  let firstMs = 0,
    lastMs = 0;
  let totalFrame: FixedHistogram | null = new FixedHistogram(),
    totalWork: FixedHistogram | null = new FixedHistogram();
  /** The totals' summaries frozen at dispose, when the histograms are released. */
  let totalSummary: {frame: Distribution | null; work: Distribution | null} = {frame: null, work: null};

  // Segments and the retained windows (a ring of maxWindows).
  const segments: SessionSegment[] = [];
  let current: SegmentKey | null = {scene: null};
  let currentIndex = -1;
  const ring: (SessionWindow | undefined)[] = new Array(maxWindows);
  let head = 0,
    retained = 0,
    closed = 0,
    evicted = 0,
    discarded = 0;

  // The open window.
  let winFrame: FixedHistogram | null = new FixedHistogram(),
    winWork: FixedHistogram | null = new FixedHistogram();
  let open = false,
    wStart = 0,
    wEnd = 0,
    wActive = 0,
    wFrames = 0,
    wRendered = 0,
    wIdle = 0,
    wResumes = 0,
    wGaps = 0,
    wLong = 0,
    wSevere = 0,
    wStepped = 0;
  let wCounters: {draws: number; triangles: number} | null = null;

  const readCounters = (): {draws: number; triangles: number} | null => {
    if (!counters) return null;
    try {
      const c = counters();
      if (!c || !Number.isFinite(c.draws) || !Number.isFinite(c.triangles)) {
        counterFailures++;
        return null;
      }
      return {draws: c.draws, triangles: c.triangles};
    } catch {
      counterFailures++;
      return null;
    }
  };

  const sameKey = (a: SegmentKey | null, b: SegmentKey | null) =>
    a === b ||
    (!!a &&
      !!b &&
      a.scene === b.scene &&
      (a.epoch ?? null) === (b.epoch ?? null) &&
      (a.preset ?? null) === (b.preset ?? null) &&
      (a.label ?? null) === (b.label ?? null));

  const truncate = (reason: 'capacity' | 'segments', atMs: number) => {
    truncated = {reason, atMs: round(atMs)};
    state = 'truncated';
    release();
  };

  const ensureSegment = (atMs: number): boolean => {
    if (currentIndex >= 0) return true;
    if (segments.length >= maxSegments) {
      truncate('segments', atMs);
      return false;
    }
    const k = current!;
    currentIndex = segments.length;
    segments.push({
      index: currentIndex,
      scene: label(k.scene),
      epoch: Number.isFinite(k.epoch) ? k.epoch! : null,
      preset: label(k.preset),
      label: label(k.label),
      startMs: round(atMs),
    });
    return true;
  };

  const openWindow = (atMs: number) => {
    open = true;
    wStart = atMs;
    wEnd = atMs;
    wActive = 0;
    wFrames = 0;
    wRendered = 0;
    wIdle = 0;
    wResumes = 0;
    wGaps = 0;
    wLong = 0;
    wSevere = 0;
    wStepped = 0;
    winFrame!.reset();
    winWork!.reset();
    wCounters = readCounters();
  };

  const classify = (complete: boolean, end: WindowEnd): WindowClassification => {
    if (!complete || wFrames < 2) {
      const reasons = [`incomplete: ended by ${end} after ${round(wActive)} of ${windowMs} active ms`];
      if (end === 'segment' || end === 'paused') reasons.unshift('epoch: the segment changed or paused');
      return {kind: 'invalid', version: CLASSIFICATION_VERSION, reasons, comparable: false};
    }
    return {
      kind: 'unclassified',
      version: CLASSIFICATION_VERSION,
      comparable: false,
      reasons: [
        'complete window; the recorder has no upload or request facts, so ADR 0053 entry/firstUse/steady is not decided',
      ],
    };
  };

  const closeWindow = (end: WindowEnd) => {
    if (!open) return;
    open = false;
    const complete = end === 'full';
    if (!complete && wFrames < 2) {
      discarded++;
      return;
    }
    const after = wCounters ? readCounters() : null;
    const per = (d: number) => (wRendered > 0 ? round(d / wRendered) : null);
    const draws = wCounters && after ? per(after.draws - wCounters.draws) : null;
    const triangles = wCounters && after ? per(after.triangles - wCounters.triangles) : null;
    const startMs = wStart - origin!;
    const w: SessionWindow = {
      index: closed,
      segment: currentIndex,
      startMs: round(startMs),
      endMs: round(wEnd - origin!),
      startMinute: round(startMs / 60_000),
      activeMs: round(wActive),
      complete,
      end,
      frames: wFrames,
      renderedFrames: wRendered,
      idleFrames: wIdle,
      resumes: wResumes,
      gaps: wGaps,
      steppedFrames: wStepped,
      longFrames: wLong,
      severeFrames: wSevere,
      frameMs: winFrame!.summary(),
      workMs: winWork!.summary(),
      drawsPerRenderedFrame: draws,
      trianglesPerRenderedFrame: triangles,
      classification: classify(complete, end),
    };
    closed++;
    if (retained === maxWindows) {
      head = (head + 1) % maxWindows;
      evicted++;
      retained--;
    }
    ring[(head + retained) % maxWindows] = w;
    retained++;
    if (retained === maxWindows && overflow === 'stop') truncate('capacity', wEnd - origin!);
  };

  const active = () => state === 'recording';

  const recorder: SessionRecorder = {
    get state() {
      return state;
    },
    frame(r: Readonly<FrameRecord>) {
      if (state !== 'recording' && state !== 'paused') return;
      records++;
      if (r.stepped) {
        // A test driver stepped this frame (clock.hold/step): its timestamp and interval are script-chosen, so it is
        // counted but never timed, percentiled or used for the session timeline.
        steppedFrames++;
        if (open) wStepped++;
        return;
      }
      const t = r.timeMs;
      if (!Number.isFinite(t)) {
        clockAnomalies++;
        return;
      }
      if (t < lastTime) clockAnomalies++; // a backwards timestamp: keep the session monotonic
      const at = Math.max(t, lastTime);
      lastTime = at;
      if (origin === null) {
        // The session starts where its first timed interval started (its first frame's predecessor).
        const iv0 = r.intervalMs;
        origin = !r.hidden && iv0 > 0 && iv0 < gapMs ? at - iv0 : at;
        firstMs = origin;
      }
      lastMs = at;
      if (r.hidden) {
        hiddenTransitions++;
        closeWindow('hidden');
        return;
      }
      if (!active()) return;
      if (!ensureSegment(at - origin)) return;
      const iv = r.intervalMs,
        timed = iv > 0 && iv < gapMs;
      // A window covers its frames' intervals: it starts where its first timed interval started.
      if (!open) openWindow(timed ? Math.max(origin, at - iv) : at);
      wEnd = at;
      frames++;
      wFrames++;
      if (r.rendered) {
        renderedFrames++;
        wRendered++;
      } else {
        idleFrames++;
        wIdle++;
      }
      if (!(iv > 0) || !Number.isFinite(iv)) {
        resumes++;
        wResumes++;
      } else if (iv >= gapMs) {
        gaps++;
        wGaps++;
      } else {
        winFrame!.add(iv);
        totalFrame!.add(iv);
        wActive += iv;
        if (iv > longFrameMs) {
          longFrames++;
          wLong++;
        }
        if (iv >= severeFrameMs) {
          severeFrames++;
          wSevere++;
        }
      }
      const work = r.workMs;
      if (work >= 0 && Number.isFinite(work)) {
        winWork!.add(work);
        totalWork!.add(work);
      }
      if (wActive >= windowMs) closeWindow('full');
    },
    segment(key) {
      if (state !== 'recording' && state !== 'paused') return;
      if (key === null) {
        if (state === 'paused') return;
        closeWindow('paused');
        if ((state as RecorderState) === 'truncated') return; // that close filled the ring: stay truncated
        state = 'paused';
        current = null;
        currentIndex = -1;
        return;
      }
      if (state === 'recording' && sameKey(current, key)) return;
      closeWindow('segment');
      if ((state as RecorderState) === 'truncated') return;
      current = {scene: key.scene, epoch: key.epoch ?? null, preset: key.preset ?? null, label: key.label ?? null};
      currentIndex = -1;
      state = 'recording';
    },
    stop() {
      if (state === 'stopped' || state === 'disposed' || state === 'truncated') {
        release();
        return;
      }
      closeWindow('stopped');
      if ((state as RecorderState) !== 'truncated') state = 'stopped';
      release();
    },
    dispose() {
      if (state === 'disposed') return;
      if (open) {
        open = false;
        discarded++;
      }
      state = 'disposed';
      release();
      totalSummary = {frame: totalFrame?.summary() ?? null, work: totalWork?.summary() ?? null};
      winFrame = null;
      winWork = null;
      totalFrame = null;
      totalWork = null;
    },
    evidence() {
      const windows: SessionWindow[] = [];
      for (let i = 0; i < retained; i++) windows.push(clone(ring[(head + i) % maxWindows]!));
      return {
        schema: SESSION_EVIDENCE_SCHEMA,
        version: SESSION_EVIDENCE_VERSION,
        meta: {...meta},
        recorder: {
          windowMs,
          maxWindows,
          maxSegments,
          overflow,
          budgetMs: round(budgetMs),
          longFrameMs: round(longFrameMs),
          severeFrameMs,
          gapMs,
          counters: !!counters,
          histogram: {
            bins: HISTOGRAM_BINS,
            resolution: '0.1 ms < 50 ms; 1 ms < 250 ms; 10 ms < 1000 ms; overflow',
            percentile: 'nearest rank, bin upper edge clamped to observed min/max',
          },
        },
        state,
        truncated: truncated ? {...truncated} : null,
        session: {
          records,
          frames,
          renderedFrames,
          idleFrames,
          resumes,
          hiddenTransitions,
          steppedFrames,
          gaps,
          clockAnomalies,
          longFrames,
          severeFrames,
          durationMs: origin === null ? 0 : round(lastMs - firstMs),
          frameMs: totalFrame ? totalFrame.summary() : totalSummary.frame,
          workMs: totalWork ? totalWork.summary() : totalSummary.work,
          windowsClosed: closed,
          windowsRetained: retained,
          evictedWindows: evicted,
          discardedWindows: discarded,
          counterFailures,
        },
        segments: segments.map(s => ({...s})),
        windows,
        drift: drift(windows, segments),
        limitations: [...LIMITATIONS],
      };
    },
  };
  return recorder;
}

function clone(w: SessionWindow): SessionWindow {
  return {
    ...w,
    frameMs: w.frameMs && {...w.frameMs},
    workMs: w.workMs && {...w.workMs},
    classification: {...w.classification, reasons: [...w.classification.reasons]},
  };
}

/** Drift per scene + preset group, over complete windows only. */
export function drift(windows: readonly SessionWindow[], segments: readonly SessionSegment[]): DriftEstimate[] {
  const groups = new Map<string, SessionWindow[]>();
  for (const w of windows) {
    if (!w.complete || !w.frameMs) continue;
    const s = segments[w.segment];
    const key = `${s?.scene ?? '(none)'}|${s?.preset ?? '(none)'}`;
    let list = groups.get(key);
    if (!list) groups.set(key, (list = []));
    list.push(w);
  }
  const out: DriftEstimate[] = [];
  for (const [group, list] of groups) {
    const xs = list.map(w => w.startMinute),
      fs = list.map(w => w.frameMs!.p95);
    const withWork = list.filter(w => w.workMs);
    const k = Math.max(1, Math.floor(list.length / 3));
    const mean = (ws: SessionWindow[], f: (w: SessionWindow) => number | undefined) => {
      const vs = ws.map(f).filter((v): v is number => v !== undefined);
      return vs.length ? round(vs.reduce((a, b) => a + b, 0) / vs.length) : null;
    };
    const edge = (ws: SessionWindow[]) => ({
      frameP95: mean(ws, w => w.frameMs!.p95)!,
      workP95: mean(ws, w => w.workMs?.p95),
    });
    const early = list.length >= 2 ? edge(list.slice(0, k)) : null,
      late = list.length >= 2 ? edge(list.slice(-k)) : null;
    const ratio = (a: number | null | undefined, b: number | null | undefined) =>
      a && b !== null && b !== undefined && a > 0 ? round(b / a) : null;
    out.push({
      group,
      windows: list.length,
      frameP95SlopeMsPerMin: slope(xs, fs),
      workP95SlopeMsPerMin: slope(
        withWork.map(w => w.startMinute),
        withWork.map(w => w.workMs!.p95),
      ),
      early,
      late,
      frameP95Ratio: ratio(early?.frameP95, late?.frameP95),
      workP95Ratio: ratio(early?.workP95, late?.workP95),
    });
  }
  return out;
}

/** Attach a recorder to a loop's one sampler slot; stop/dispose/truncation detach it. */
export function recordSession(
  loop: {attachSampler(s: FrameSamplerPort): () => void},
  options: SessionRecorderOptions = {},
): SessionRecorder {
  let off: (() => void) | null = null;
  const recorder = createSessionRecorder(options, () => {
    off?.();
    off = null;
  });
  off = loop.attachSampler(recorder);
  return recorder;
}
