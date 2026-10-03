import {withFrameTime} from './frame-time';
/**
 * core/activity/loop.ts. The frame loop: the only `requestAnimationFrame` in the app (STD-RUN-1, ADR 0032).
 *
 * - Tickers render on demand: `invalidate()` marks one dirty; a 'continuous' ticker draws every frame it runs.
 *   When no ticker wants a frame, no frame is scheduled at all (STD-RUN-2, STD-RUN-9).
 * - Coverage comes from the layer port (STD-RUN-3): 'top' runs; 'scrim' follows the ticker's `whenCovered`
 *   ('pause' by default, 'run', or `{hz}` to throttle); 'opaque' and 'hidden' never run. A layer marked
 *   `preview` keeps the owner beneath it running at full rate. A ticker that did not run in the previous frame
 *   (covered, idle loop, hidden tab) resumes with dt = 0, never a catch-up step.
 * - A hidden tab stops the loop; nothing is scheduled until it is visible again.
 * - The frame carries dt, t, frame, ut, calm, preset and coverage, and no kit nouns (STD-RUN-4).
 * - The loop is the only holder of the clock driver and feeds the quality port one sample per frame, with
 *   `rendered: false` for frames in which nothing drew (STD-RUN-5).
 *
 * - An optional observational sampler (`attachSampler`, at most one) receives one reused `FrameRecord` per frame and
 *   per hidden transition. Without one, a frame reads no extra clock and builds no record (STD-SYS-18). A sampler
 *   never schedules, wakes or keeps the loop awake; one that throws is detached and reported.
 *   Frames stepped by a test driver while held are marked `stepped`: their timing is script-chosen.
 *
 * The frame source and the time source are injected; the defaults are the browser's.
 */
import type {
  ClockDriverPort, Coverage, FrameMode, FrameRecord, FrameSamplerPort, FrameScheduler, LayerPort, QualityPort, QualityPreset,
  VisibilityPort, WhenCovered,
} from './ports';

export interface FrameInfo {
  /** Seconds since this ticker last ran, clamped to its maxDt; 0 when it did not run in the previous frame. */
  readonly dt: number;
  /** Loop time in seconds (the frame timestamp / 1000). */
  readonly t: number;
  readonly frame: number;
  /** Universal time after this frame's clock advance (0 without a clock driver). */
  readonly ut: number;
  /** Calm scenes or the OS reduced-motion preference: motion systems read this, never the DOM. */
  readonly calm: boolean;
  readonly preset: QualityPreset;
  readonly coverage: Coverage;
}

export interface TickerSpec {
  /** Application input/update services may bypass layer coverage, never document visibility or render. */
  scope?: 'owner' | 'application';
  /** Owner key, usually the activity run id. The layer port answers coverage for it. */
  owner: string;
  update?: ((f: FrameInfo) => void) | undefined;
  /** Draw. Called when the ticker is dirty, or every running frame in 'continuous' mode. */
  /** Draw. Return `false` when nothing needed drawing (a continuous run whose picture did not change): the frame is
   *  then counted as skipped, not rendered (STD-RUN-9). */
  render?: ((f: FrameInfo) => unknown) | undefined;
  mode?: FrameMode | undefined;
  whenCovered?: WhenCovered | undefined;
  /** Lower runs first (simulation before camera before render). Default 0; ties keep insertion order. */
  priority?: number;
  /** Largest dt handed to this ticker, in seconds. Default 0.05. */
  maxDt?: number | undefined;
}

export interface TickerHandle {
  invalidate(): void;
  setMode(mode: FrameMode): void;
  remove(): void;
  readonly removed: boolean;
}

export interface LoopStats {
  /** Frames the loop ran. */
  frames: number;
  updates: number;
  renders: number;
  /** Frames the loop ran in which nothing rendered. */
  skipped: number;
}

export interface FrameLoopOptions {
  layers: Pick<LayerPort, 'coverage' | 'onChange'> & Partial<Pick<LayerPort, 'previewing'>>;
  calm: () => boolean;
  scheduler?: FrameScheduler;
  /** Milliseconds on the same timebase as the scheduler's timestamps. Used outside frames, and inside a frame only
   *  while a sampler is attached (two reads around the tickers). */
  now?: () => number;
  clock?: ClockDriverPort | undefined;
  quality?: QualityPort;
  visibility?: VisibilityPort;
  /** A ticker threw; it has been removed. Defaults to console.error. Reporter failures cannot stop other owners. */
  report?: (owner: string, error: unknown) => void;
}

interface Ticker {
  readonly spec: TickerSpec;
  readonly owner: string;
  readonly whenCovered: WhenCovered;
  readonly priority: number;
  readonly maxDt: number;
  readonly order: number;
  mode: FrameMode;
  dirty: boolean;
  removed: boolean;
  /** Timestamp (ms) of the last frame this ticker ran in; null forces dt = 0 next time. Kept in ms so dt is
   *  computed as (now - last) / 1000, the same rounding as a per-owner rAF callback. */
  last: number | null;
  /** Throttle accumulator under a scrim with `{hz}`. */
  acc: number;
}

function browserScheduler(): FrameScheduler {
  return {
    request: cb => globalThis.requestAnimationFrame(cb),
    cancel: id => globalThis.cancelAnimationFrame(id),
  };
}

export class FrameLoop {
  readonly stats: LoopStats = { frames: 0, updates: 0, renders: 0, skipped: 0 };
  private tickers: Ticker[] = [];
  private handle: number | null = null;
  private hidden = false;
  private disposed = false;
  private inTick = false;
  private clock: ClockDriverPort | undefined;
  private frame = 0;
  private held = false;
  private manualMs = 0;
  private order = 0;
  private lastTick: number | null = null;
  private wokeAt: number | null = null;
  private readonly scheduler: FrameScheduler;
  private readonly now: () => number;
  private readonly unsubscribe: (() => void)[] = [];
  private sampler: FrameSamplerPort | undefined;
  private readonly record: FrameRecord = { intervalMs: 0, rendered: false, hidden: false, sinceEnterMs: 0, timeMs: 0, workMs: 0, stepped: false };

  constructor(private readonly opts: FrameLoopOptions) {
    this.clock = opts.clock;
    this.scheduler = opts.scheduler ?? browserScheduler();
    this.now = opts.now ?? (() => globalThis.performance.now());
    // Coverage changes when layers open or close: re-evaluate at once (no polling).
    this.unsubscribe.push(opts.layers.onChange(() => this.wake()));
    if (opts.visibility) {
      this.hidden = opts.visibility.hidden();
      this.unsubscribe.push(opts.visibility.onChange(hidden => this.setHidden(hidden)));
    }
  }

  /** The composition root attaches the player driver to this existing shared loop, never to a second loop. */
  attachClock(clock: ClockDriverPort): () => void {
    if (this.disposed) throw new Error('FrameLoop is disposed');
    if (this.clock) throw new Error('FrameLoop already has a clock driver');
    this.clock = clock; this.lastTick = null;
    return () => { if (this.clock === clock) { this.clock = undefined; this.lastTick = null; } };
  }

  /**
   * Attach the one observational frame sampler (a session recorder, a dev overlay). It neither wakes nor schedules the
   * loop: an idle or hidden loop produces no records. Returns the detach; detaching twice, or after a replacement, is a no-op.
   */
  attachSampler(sampler: FrameSamplerPort): () => void {
    if (this.disposed) throw new Error('FrameLoop is disposed');
    if (this.sampler) throw new Error('FrameLoop already has a frame sampler');
    this.sampler = sampler;
    return () => { if (this.sampler === sampler) this.sampler = undefined; };
  }
  get hasSampler(): boolean { return this.sampler !== undefined; }

  /** True while a frame is requested from the scheduler. */
  get scheduled(): boolean { return this.handle !== null; }
  get isHidden(): boolean { return this.hidden; }

  add(spec: TickerSpec): TickerHandle {
    if (spec.scope === 'application' && spec.render) throw new Error('application ticker cannot render');
    if (this.disposed) throw new Error('FrameLoop is disposed');
    const t: Ticker = {
      spec, owner: spec.owner, whenCovered: spec.whenCovered ?? 'pause', priority: spec.priority ?? 0,
      maxDt: spec.maxDt ?? 0.05, order: this.order++, mode: spec.mode ?? 'on-demand',
      dirty: true, removed: false, last: null, acc: 0,
    };
    this.tickers.push(t);
    this.tickers.sort((a, b) => a.priority - b.priority || a.order - b.order);
    this.wake();
    const loop = this;
    return {
      invalidate() { if (!t.removed) { t.dirty = true; loop.wake(); } },
      setMode(mode) { if (!t.removed && t.mode !== mode) { t.mode = mode; loop.wake(); } },
      remove() { loop.drop(t); loop.wake(); },
      get removed() { return t.removed; },
    };
  }

  /** A test driver holds the actual scheduler, then steps the same update/render path. No second loop or clock. */
  holdFrames(held: boolean): void {
    if (this.held === held) return;
    // Held frames continue from the loop's real time: event timestamps (Event.timeStamp, the audio clock) stay on the
    // same timebase as stepped frame times instead of being off by the page's age.
    this.held = held; this.cancel(); this.lastTick = null; this.manualMs = held ? this.now() : 0;
    if (!held) this.wake();
  }
  get framesHeld(): boolean { return this.held; }
  stepFrame(seconds: number): void {
    if (!this.held) throw Error('Hold frames before manual stepping');
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > .05) throw Error('Manual frame must be between 0 and .05 seconds');
    this.manualMs += seconds * 1000;
    this.tick(this.manualMs);
  }

  /** Normally driven by the visibility port; exposed for the shell and tests. */
  setHidden(hidden: boolean): void {
    if (this.hidden === hidden || this.disposed) return;
    this.hidden = hidden;
    const sinceEnterMs = this.wokeAt === null ? 0 : Math.max(0, this.now() - this.wokeAt * 1000);
    this.forget();
    this.lastTick = null;
    if (hidden) {
      this.cancel();
      this.opts.quality?.frame({ intervalMs: 0, rendered: false, hidden: true, sinceEnterMs });
      if (this.sampler) this.sample(this.now(), 0, false, true, sinceEnterMs, 0);
    } else {
      this.clock?.resumeFromAway('visible');
      this.wake();
    }
  }

  /** Re-evaluate whether a frame is needed (a layer changed, a ticker was invalidated or added). */
  wake(): void {
    if (this.held || this.inTick) return; // the frame re-evaluates once when it ends
    const want = !this.held && !this.hidden && !this.disposed && this.tickers.some(t => this.wants(t));
    if (want) { if (this.handle === null) this.handle = this.scheduler.request(this.tick); }
    else this.cancel(); // idle: nothing is scheduled, and every ticker resumes with dt = 0
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.sampler = undefined;
    this.cancel();
    for (const off of this.unsubscribe.splice(0)) off();
    for (const t of this.tickers) t.removed = true;
    this.tickers = [];
  }

  private cancel(): void {
    if (this.handle !== null) { this.scheduler.cancel(this.handle); this.handle = null; }
    this.forget();
  }

  /** The loop went idle or hidden: every ticker resumes with dt = 0. */
  private forget(): void {
    for (const t of this.tickers) { t.last = null; t.acc = 0; }
    this.wokeAt = null;
    this.lastTick = null;
  }

  private drop(t: Ticker): void {
    if (t.removed) return;
    t.removed = true;
    this.tickers = this.tickers.filter(x => x !== t);
  }

  private previewing(owner: string): boolean {
    return this.opts.layers.previewing?.(owner) ?? false;
  }

  private runs(t: Ticker, cov: Coverage, preview: boolean): boolean {
    if (t.spec.scope === 'application') return true;
    if (cov === 'hidden') return false;
    if (preview || cov === 'top') return true;
    if (cov === 'opaque') return false;
    return t.whenCovered !== 'pause';
  }

  private wants(t: Ticker): boolean {
    return this.runs(t, this.opts.layers.coverage(t.owner), this.previewing(t.owner)) && (t.mode === 'continuous' || t.dirty);
  }

  private readonly tick = (timeMs: number): void => {
    this.handle = null;
    if (this.hidden || this.disposed) return;
    const now = timeMs / 1000;
    const realDt = this.lastTick === null ? 0 : Math.max(0, now - this.lastTick);
    this.lastTick = now;
    const wokeAt = this.wokeAt ??= now;
    const ut = this.clock ? this.clock.advance(realDt).to : 0;
    this.frame++;
    this.stats.frames++;
    this.inTick = true;
    let rendered = false;
    const sampling = this.sampler !== undefined, started = sampling ? this.now() : 0;
    try {
      rendered = withFrameTime(timeMs,()=>this.runTickers(timeMs, ut, this.opts.calm(), this.opts.quality?.preset() ?? 'reference'));
    } finally {
      this.inTick = false;
    }
    const workMs = sampling ? this.now() - started : 0;
    if (!rendered) this.stats.skipped++;
    const sinceEnterMs = Math.max(0, (now - wokeAt) * 1000);
    this.opts.quality?.frame({ intervalMs: realDt * 1000, rendered, hidden: false, sinceEnterMs });
    if (sampling && this.sampler) this.sample(timeMs, realDt * 1000, rendered, false, sinceEnterMs, workMs);
    this.wake();
  };

  /** Fill the one reused record and hand it to the sampler. A throwing sampler is detached; the loop continues. */
  private sample(timeMs: number, intervalMs: number, rendered: boolean, hidden: boolean, sinceEnterMs: number, workMs: number): void {
    const sampler = this.sampler!, r = this.record;
    r.timeMs = timeMs; r.intervalMs = intervalMs; r.rendered = rendered; r.hidden = hidden; r.sinceEnterMs = sinceEnterMs;
    r.workMs = Number.isFinite(workMs) && workMs > 0 ? workMs : 0;
    r.stepped = this.held && !hidden;
    try { sampler.frame(r); }
    catch (error) {
      if (this.sampler === sampler) this.sampler = undefined;
      try { (this.opts.report ?? ((owner, e) => console.error(`${owner} threw and was detached`, e)))('frame-sampler', error); }
      catch { /* A broken diagnostic sink cannot stop the shared frame. */ }
    }
  }

  /** Runs every ticker due this frame, in priority order. Returns whether anything rendered. */
  private runTickers(nowMs: number, ut: number, calm: boolean, preset: QualityPreset): boolean {
    const now = nowMs / 1000;
    let rendered = false;
    for (const t of [...this.tickers]) {
      if (t.removed) continue;
      const cov = this.opts.layers.coverage(t.owner), preview = this.previewing(t.owner);
      if (!this.runs(t, cov, preview)) { t.last = null; t.acc = 0; continue; }
      const raw = t.last === null ? 0 : Math.max(0, (nowMs - t.last) / 1000);
      t.last = nowMs;
      let dt = Math.min(t.maxDt, raw);
      if (t.spec.scope !== 'application' && cov === 'scrim' && !preview && typeof t.whenCovered === 'object') {
        t.acc += raw;
        if (t.acc < 1 / t.whenCovered.hz) continue;
        dt = Math.min(t.maxDt, t.acc);
        t.acc = 0;
      } else t.acc = 0;
      if (t.mode !== 'continuous' && !t.dirty) continue;
      const f: FrameInfo = { dt, t: now, frame: this.frame, ut, calm, preset, coverage: cov };
      try {
        t.dirty = false;
        if (t.spec.update) { t.spec.update(f); this.stats.updates++; }
        if (t.spec.scope !== 'application' && t.spec.render && !t.removed && t.spec.render(f) !== false) { this.stats.renders++; rendered = true; }
      } catch (error) {
        // One broken activity must not stop the others: drop its ticker and report once.
        this.drop(t);
        try {
          (this.opts.report ?? ((owner, e) => console.error(`Ticker for ${owner} threw and was removed`, e)))(t.owner, error);
        } catch (reportError) {
          // Preserve both failures when possible; diagnostics never own the shared frame's continuation.
          try { console.error(`Ticker for ${t.owner} was removed; reporting failed`, new AggregateError([error, reportError])); }
          catch { /* A broken diagnostic sink cannot freeze healthy owners. */ }
        }
      }
    }
    return rendered;
  }
}
