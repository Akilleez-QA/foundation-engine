/**
 * core/router/handover.ts: navigation epochs, abort ownership and activation for scene changes (ADR 0045 amending
 * ADR 0041; STD-RUN-14, STD-RUN-15, STD-RUN-16). Pure: no DOM,
 * no storage, no clock. The shell supplies the player, the first render and the loading/failure presentation.
 *
 * Every navigation captures one epoch `{epoch, player, scene, params}` before anything else and aborts the previous
 * pending one. Each awaited boundary (load → enter → ready → first render → activate) checks that the visit is still
 * the current request of the same player. A stale load never enters; a stale enter/ready/render has its run left
 * without activation; an obsolete failure is ignored. Only the current request that rendered once is activated:
 * `activate()` (synchronous), an epoch recheck (the hook may navigate), then `arrive()` drains the run's queued
 * owner-scoped work (rewards and their writes) and `entered` is reported exactly once.
 *
 * `load`: the module is fetched once per entry, a failed fetch is retried on the next navigation, `preload` fetches
 * without entering. A module that is already in (or a synchronous `load`, a hub scene) enters in the same call.
 */
import type {SceneId} from './resolve';

export type HandoverOutcome = 'activated' | 'superseded' | 'failed';
/** Why a run is left: a newer request or the player changed before activation, it failed, or the player moved on. */
export type HandoverLeave = 'superseded' | 'player-changed' | 'failed' | 'route';

/** One navigation: what the scene is entered with. */
export interface SceneVisit {
  readonly epoch: number;
  readonly scene: SceneId;
  readonly params: Readonly<Record<string, string>>;
  /** The player this visit belongs to, captured when it started. */
  readonly player: string;
  /** Aborted when the visit is superseded, the player changes, it fails or it is left. */
  readonly signal: AbortSignal;
  /** True while this visit is the current request of the same player and has not been aborted. */
  current(): boolean;
}

/** What `enter` returns: the visit's run. Preparation is dormant; effects wait for `arrive`. */
export interface SceneRun {
  /** Preparation only (ADR 0045): resolves when the run can render its first frame. */
  ready?: Promise<void>;
  /** Synchronous, current owner only, after the first successful render: enable owner-scoped work. */
  activate?(): void;
  /** After the epoch recheck: drain the entry work queued during preparation (rewards, facts). */
  arrive?(): void;
  /** Dispose the run. Called once: before activation for a stale or failed run, or when the player moves on. */
  leave(reason: HandoverLeave): void;
}

/** A scene's dispatch row: how its code loads and how a visit enters it. */
export interface SceneEntry<M = unknown> {
  readonly id: SceneId;
  /** For the loading card: "Going to <label>…". */
  readonly label: string;
  /** 'idle': fetched in idle time after the first picture, in row order. */
  readonly preload?: 'idle' | 'never';
  load(): M | Promise<M>;
  /** Required CPU/data preparation while the previous run remains usable; no render surface allocation. */
  prepare?(module: M, visit: SceneVisit): void | Promise<void>;
  enter(module: M, visit: SceneVisit): SceneRun | Promise<SceneRun>;
}

export interface HandoverDeps {
  /** The active player, read at every boundary. */
  player(): string;
  /** Give the pending run one render (dt = 0) and settle when it was submitted; reject when it failed. */
  firstRender(run: SceneRun, visit: SceneVisit): void | Promise<void>;
  /** A module is on its way in (the loading card); `settled` follows once for each `loading`. */
  loading?(label: string): void;
  settled?(): void;
  /** Emitted once per activated visit. */
  entered?(visit: SceneVisit): void;
  /** The current request failed (load, enter, ready, first render). Obsolete failures are never reported. */
  failed?(visit: SceneVisit, error: unknown): void;
  /** A run threw while leaving. */
  report?(scene: SceneId, error: unknown): void;
}

export interface GoRequest {
  params?: Readonly<Record<string, string>>;
}

export interface Handover {
  /** Navigate to `entry`: a new epoch that supersedes any pending one and leaves the current run. */
  go(entry: SceneEntry, request?: GoRequest): Promise<HandoverOutcome>;
  /** Abort the pending request and leave the current run (the address left the router's scenes). */
  leave(): void;
  /** Fetch the module without entering. Errors are swallowed; the next `go` retries. */
  preload(entry: SceneEntry): void;
  /** The last activated visit (its run may already have been left). */
  current(): SceneVisit | null;
  /** True while a request is being prepared. */
  loading(): boolean;
}

type Loaded = {sync: true; value: unknown} | {sync: false; promise: Promise<unknown>};
const thenable = <T>(v: unknown): v is PromiseLike<T> => !!v && typeof (v as {then?: unknown}).then === 'function';

export function createHandover(deps: HandoverDeps): Handover {
  let serial = 0;
  interface Pending {
    visit: SceneVisit;
    abort: AbortController;
    run: SceneRun | null;
    left: boolean;
  }
  let pending: Pending | null = null;
  let active: {visit: SceneVisit; run: SceneRun; abort: AbortController} | null = null;
  let lastActivated: SceneVisit | null = null;
  const modules = new Map<SceneId, {value?: unknown; has: boolean; promise?: Promise<unknown>}>();

  const leaveRun = (scene: SceneId, run: SceneRun | null, reason: HandoverLeave) => {
    if (!run) return;
    try {
      run.leave(reason);
    } catch (error) {
      deps.report?.(scene, error);
    }
  };
  /** Abort a request and leave its run, if it has one yet, exactly once. A run that arrives later is left then. */
  const discard = (p: Pending, reason: HandoverLeave) => {
    if (pending === p) pending = null;
    if (!p.abort.signal.aborted) p.abort.abort(reason);
    if (p.run && !p.left) {
      p.left = true;
      leaveRun(p.visit.scene, p.run, reason);
    }
  };
  const abortPending = (reason: HandoverLeave) => {
    if (pending) discard(pending, reason);
  };

  const leaveActive = () => {
    const a = active;
    if (!a) return;
    active = null;
    a.abort.abort('route');
    leaveRun(a.visit.scene, a.run, 'route');
  };

  const load = (entry: SceneEntry): Loaded => {
    let slot = modules.get(entry.id);
    if (slot?.has) return {sync: true, value: slot.value};
    if (slot?.promise) return {sync: false, promise: slot.promise};
    const value = entry.load();
    if (!thenable(value)) {
      modules.set(entry.id, {value, has: true});
      return {sync: true, value};
    }
    slot = {has: false};
    slot.promise = Promise.resolve(value).then(
      v => {
        modules.set(entry.id, {value: v, has: true});
        return v;
      },
      error => {
        modules.delete(entry.id);
        throw error;
      },
    );
    modules.set(entry.id, slot);
    return {sync: false, promise: slot.promise};
  };

  const go = (entry: SceneEntry, request: GoRequest = {}): Promise<HandoverOutcome> => {
    // 1. A new epoch, captured before anything else; the previous pending request and the current run go.
    const epoch = ++serial,
      player = deps.player();
    abortPending('superseded');
    if (!entry.prepare || (active && active.visit.player !== player)) leaveActive();
    const abort = new AbortController();
    const visit: SceneVisit = {
      epoch,
      scene: entry.id,
      params: request.params ?? {},
      player,
      signal: abort.signal,
      current: () =>
        (pending?.visit === visit || active?.visit === visit) && !abort.signal.aborted && deps.player() === player,
    };
    const self: Pending = {visit, abort, run: null, left: false};
    pending = self;

    let loadingShown = false;
    const settle = () => {
      if (loadingShown) {
        loadingShown = false;
        deps.settled?.();
      }
    };
    /** Not current any more: a newer request (already aborted this one) or a player change (abort it here). */
    const stale = (): HandoverOutcome => {
      settle();
      discard(self, deps.player() === player ? 'superseded' : 'player-changed');
      if (active && active.visit.player !== deps.player()) leaveActive();
      return 'superseded';
    };
    const fail = (error: unknown): HandoverOutcome => {
      if (!visit.current()) return stale();
      settle();
      discard(self, 'failed');
      deps.failed?.(visit, error);
      return 'failed';
    };
    const activate = (): HandoverOutcome => {
      if (!visit.current()) return stale();
      const run = self.run!;
      try {
        run.activate?.();
      } catch (error) {
        return fail(error);
      }
      // The hook may have navigated (a newer request already left this run) or switched players.
      if (!visit.current()) return stale();
      pending = null;
      active = {visit, run, abort};
      lastActivated = visit;
      try {
        run.arrive?.();
      } catch (error) {
        deps.report?.(entry.id, error);
      }
      deps.entered?.(visit);
      return 'activated';
    };
    const rendered = (): HandoverOutcome | Promise<HandoverOutcome> => {
      if (!visit.current()) return stale();
      settle();
      let first: void | Promise<void>;
      try {
        first = deps.firstRender(self.run!, visit);
      } catch (error) {
        return fail(error);
      }
      return thenable(first) ? Promise.resolve(first).then(activate, fail) : activate();
    };
    const entered = (run: SceneRun): HandoverOutcome | Promise<HandoverOutcome> => {
      self.run = run;
      // A late run for a superseded request is left at once, never activated.
      if (!visit.current()) return stale();
      return run.ready ? run.ready.then(rendered, fail) : rendered();
    };
    const enterPrepared = (module: unknown): HandoverOutcome | Promise<HandoverOutcome> => {
      // A stale load may warm the module cache but never enters.
      if (!visit.current()) return stale();
      leaveActive();
      if (!visit.current()) return stale(); // Disposal callbacks can navigate.
      let run: SceneRun | Promise<SceneRun>;
      try {
        run = entry.enter(module, visit);
      } catch (error) {
        return fail(error);
      }
      return thenable<SceneRun>(run) ? Promise.resolve(run).then(entered, fail) : entered(run);
    };

    const enter = (module: unknown): HandoverOutcome | Promise<HandoverOutcome> => {
      if (!visit.current()) return stale();
      if (!entry.prepare) return enterPrepared(module);
      try {
        const prepared = entry.prepare(module, visit);
        return thenable(prepared)
          ? Promise.resolve(prepared).then(() => enterPrepared(module), fail)
          : enterPrepared(module);
      } catch (error) {
        return fail(error);
      }
    };

    let outcome: HandoverOutcome | Promise<HandoverOutcome>;
    try {
      const loaded = load(entry);
      if (loaded.sync) outcome = enter(loaded.value);
      else {
        loadingShown = true;
        deps.loading?.(entry.label);
        outcome = loaded.promise.then(enter, fail);
      }
    } catch (error) {
      outcome = fail(error);
    }
    return Promise.resolve(outcome);
  };

  return {
    go,
    leave() {
      abortPending('superseded');
      leaveActive();
    },
    preload(entry) {
      try {
        const l = load(entry);
        if (!l.sync) l.promise.catch(() => {});
      } catch {
        /* the next go retries */
      }
    },
    current: () => lastActivated,
    loading: () => pending !== null,
  };
}

// The `scene` event area belongs to the router (`scene.entered` once per activated visit); platform.shell emits it.
declare module '../events' {
  interface EngineEvents {
    /** A visit was activated after its first successful render. Emitted once per navigation epoch. */
    'scene.entered': {id: SceneId; epoch: number};
    /** A navigation inside the router's scenes is about to hand over to `to`: the run it covers pauses and saves. */
    'scene.entering': {to: SceneId; from: SceneId | null};
    /** The address left the router's scenes, so the shell no longer owns a scene. */
    'scene.left': {scene: SceneId; reason: string};
  }
}
