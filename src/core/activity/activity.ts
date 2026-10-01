/**
 * core/activity/activity.ts. The activity contract (STD-RUN-6, STD-RUN-7; ADR 0032).
 *
 * The panel lifecycle generalised to every scene, panel, minigame and widget: `enter(ctx, params)`
 * returns a per-visit `ActivityRun`; everything the visit creates is owned through its context and released in
 * reverse order when it leaves. Children leave before their parent. A throwing `enter` releases what it owned and
 * reports once.
 *
 * Leave order: children (newest first) → `run.leave(reason)` → main ticker → the run's layers → owned disposers
 * (reverse order of `own()`/`ticker()`/`surface()`) → the run's AbortSignal → `done` resolves.
 *
 * Preparation and activation (ADR 0045) are the router's to drive: this host exposes the run (`ready`, `activate`)
 * on the returned handle and does not interpret them.
 */
import type { Disposable } from '../module';
import type { FrameInfo, FrameLoop, TickerHandle, TickerSpec } from './loop';
import type {
  Coverage, FrameMode, LayerHandle, LayerPort, LayerRequest, QualityPreset, SurfaceLease, SurfacePort, SurfaceRequest, WhenCovered,
} from './ports';

export type ActivityKind = 'scene' | 'panel' | 'minigame' | 'widget';
export type LeaveReason = 'exit' | 'escape' | 'route' | 'replaced' | 'parent-left' | 'player-changed' | 'error' | 'context-lost';

/** Returned by `enter()`: the per-visit behaviour. Everything else is owned through the context. */
export interface ActivityRun {
  update?(f: FrameInfo): void;
  /** Draw; `false` when nothing needed drawing (see TickerSpec.render). */
  render?(f: FrameInfo): unknown;
  /** 'on-demand' (default): render only after `ctx.invalidate()`. 'continuous' while something animates. */
  frameMode?: FrameMode;
  whenCovered?: WhenCovered;
  /** ADR 0045: preparation only; no gameplay effects. */
  ready?: Promise<void>;
  /** ADR 0045: synchronous, current owner only, after a successful first render. */
  activate?(): void;
  /** Last words before disposal (save a checkpoint). Owned resources are released after this. */
  leave?(reason: LeaveReason): void;
  /** The GPU context came back: re-create render targets that were not in the asset cache. */
  contextRestored?(): void;
}

export interface Activity<P = void> {
  readonly id: string;
  readonly kind: ActivityKind;
  enter(ctx: ActivityContext, params: P): ActivityRun | Promise<ActivityRun>;
}

/** The kernel's `Disposable` (core/module.ts), re-exported for the activity host's callers. */
export type { Disposable };

export interface ActivityContext {
  readonly id: string;
  /** Unique per visit; the owner key for layers, tickers, surfaces and leases. */
  readonly runId: string;
  readonly signal: AbortSignal;
  readonly parent: ActivityContext | null;
  /** Push a layer owned by this run; it closes when the run leaves. */
  layer(request: Omit<LayerRequest, 'owner'>): LayerHandle;
  /** Extra tickers (a second view, a HUD), owned by this run and removed on leave. */
  ticker(spec: Omit<TickerSpec, 'owner'>): TickerHandle;
  /** Mark the run's main ticker dirty: the next frame renders. */
  invalidate(): void;
  setFrameMode(mode: FrameMode): void;
  own<T extends Disposable | (() => void)>(x: T): T;
  /** Start a child (a panel over this scene). Children leave before their parent. */
  start<Q>(child: Activity<Q>, params: Q): Promise<RunningActivity>;
  /** Leave this run (the exit button). */
  leave(reason?: LeaveReason): void;
  /** True before children or owned resources begin teardown. */
  leaving(): boolean;
  calm(): boolean;
  coverage(): Coverage;
  quality(): QualityPreset;
  /** A render surface from the pool, released when the run leaves. Throws when no surface port is installed. */
  surface(request: Omit<SurfaceRequest, 'owner'>): SurfaceLease;
}

export interface RunningActivity {
  readonly id: string;
  readonly runId: string;
  readonly signal: AbortSignal;
  /** The run `enter` returned; null while entering, after a failed enter, or when stopped before it resolved. */
  readonly run: ActivityRun | null;
  readonly stopped: boolean;
  stop(reason: LeaveReason): void;
  /** Resolves after every owned resource was released. */
  readonly done: Promise<LeaveReason>;
}

export interface ActivityHostDeps {
  loop: FrameLoop;
  layers: Pick<LayerPort, 'push' | 'coverage' | 'closeOwned'>;
  calm: () => boolean;
  quality?: () => QualityPreset;
  surfaces?: SurfacePort;
  /** An activity threw while entering, leaving or disposing. Called once per failure. */
  report?: (activityId: string, error: unknown) => void;
}

export class ActivityHost {
  private serial = 0;
  private reporting = false;
  private readonly live = new Set<RunningActivity>();

  constructor(private readonly deps: ActivityHostDeps) {}

  private report(id: string, error: unknown): void {
    if (this.reporting) return;
    this.reporting = true;
    try { this.deps.report?.(id, error); } catch { /* diagnostics must not interrupt ownership cleanup */ }
    finally { this.reporting = false; }
  }

  /** Runs that have entered and not left, in start order. */
  running(): readonly RunningActivity[] { return [...this.live]; }

  /** The renderer pool restored the GPU context: tell every live run, parents before children. */
  contextRestored(): void {
    for (const r of [...this.live]) {
      try { r.run?.contextRestored?.(); } catch (error) { this.report(r.id, error); }
    }
  }

  start<P>(activity: Activity<P>, params: P): Promise<RunningActivity> {
    return this.launch(activity, params, null);
  }

  private async launch<P>(
    activity: Activity<P>, params: P, parent: { ctx: ActivityContext; children: Set<RunningActivity>; stopped(): boolean } | null,
  ): Promise<RunningActivity> {
    const { loop, layers } = this.deps;
    const runId = `${activity.id}#${++this.serial}`;
    const abort = new AbortController();
    const disposers: (() => void)[] = [];
    const children = new Set<RunningActivity>();
    let run: ActivityRun | null = null;
    let main: TickerHandle | null = null;
    let pendingMode: FrameMode | undefined;
    let stopped = false;
    let resolveDone!: (reason: LeaveReason) => void;
    const done = new Promise<LeaveReason>(resolve => { resolveDone = resolve; });
    const fail = (error: unknown) => this.report(activity.id, error);
    const dispose = (d: () => void) => { try { d(); } catch (error) { fail(error); } };

    const stop = (reason: LeaveReason) => {
      if (stopped) return;
      stopped = true;
      for (const child of [...children].reverse()) child.stop('parent-left');
      if (run?.leave) dispose(() => run!.leave!(reason));
      main?.remove();
      dispose(() => layers.closeOwned(runId));
      for (const d of disposers.splice(0).reverse()) dispose(d);
      abort.abort(reason);
      this.live.delete(running);
      parent?.children.delete(running);
      resolveDone(reason);
    };

    const running: RunningActivity = {
      id: activity.id, runId, signal: abort.signal, done, stop,
      get run() { return run; },
      get stopped() { return stopped; },
    };
    // Adopted before entering, so a parent that leaves mid-enter still stops this child first.
    parent?.children.add(running);

    const self = { ctx: null as unknown as ActivityContext, children, stopped: () => stopped };
    const host = this;
    const ctx: ActivityContext = {
      id: activity.id, runId, signal: abort.signal, parent: parent?.ctx ?? null,
      layer: request => {
        const handle = layers.push({ ...request, owner: runId });
        if (stopped) handle.close('owner-left');
        return handle;
      },
      ticker: spec => {
        const handle = loop.add({ ...spec, owner: runId });
        ctx.own(() => handle.remove());
        return handle;
      },
      invalidate: () => main?.invalidate(),
      setFrameMode: mode => { if (main) main.setMode(mode); else pendingMode = mode; },
      own(x) {
        const d = typeof x === 'function' ? x as () => void : () => (x as Disposable).dispose();
        if (stopped) dispose(d); else disposers.push(d);
        return x;
      },
      async start(child, childParams) {
        if (stopped) throw new Error(`${runId} has left; it cannot start ${child.id}`);
        return host.launch(child, childParams, self);
      },
      leave: (reason = 'exit') => stop(reason),
      leaving: () => stopped,
      calm: () => this.deps.calm(),
      coverage: () => layers.coverage(runId),
      quality: () => this.deps.quality?.() ?? 'reference',
      surface: request => {
        if (!this.deps.surfaces) throw new Error('No surface port is installed');
        const lease = this.deps.surfaces.acquire({ ...request, owner: runId });
        ctx.own(() => lease.release());
        return lease;
      },
    };
    self.ctx = ctx;

    let entered: ActivityRun;
    try {
      entered = await activity.enter(ctx, params);
    } catch (error) {
      fail(error);
      stop('error');
      throw error;
    }
    if (stopped) {
      // Left (or its parent left) while entering: the late run still gets its last words, and nothing ticks.
      try { entered.leave?.('replaced'); } catch (error) { fail(error); }
      return running;
    }
    run = entered;
    this.live.add(running);
    if (run.update || run.render) {
      main = loop.add({
        owner: runId,
        update: run.update?.bind(run),
        render: run.render?.bind(run),
        mode: pendingMode ?? run.frameMode,
        whenCovered: run.whenCovered,
      });
    }
    return running;
  }
}
