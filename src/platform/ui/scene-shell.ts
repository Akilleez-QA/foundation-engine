import copyCatalog from './strings/scene-loading/en.json';
import {appI18n as copyI18n, t as copyText} from '../../core/i18n/app-i18n';
copyI18n.addCatalog('en', copyCatalog);
/**
 * platform/ui/scene-shell.ts: the scene shell (ADR 0041, ADR 0045; STD-RUN-10 to STD-RUN-16).
 *
 * The one owner of "which scene is on screen". It reads the router's dispatch rows once, follows every route change,
 * and hands each navigation to the handover (core/router/handover.ts), which owns epochs, aborts and activation. The
 * shell supplies what the handover leaves to presentation:
 *
 *  - the loading card ("Going to <scene>…"), shown only when a load takes longer than `CARD_AFTER_MS`;
 *  - the failure card: the scene could not open; "Try again" re-enters the same address, "Go back" goes home;
 *  - the first render: the run's `ready`, then two frames of the one loop, so the first picture was submitted;
 *  - the mount element's state for tests and the bench: `data-scene="<id>"` and `data-scene-state` =
 *    `entering` | `active` | `failed`. The bench waits for `[data-scene-state="active"]` (never for a scene's own DOM).
 *
 * `activityScene` turns an `Activity` into a dispatch row: the visit's run is an activity run on the app's host, so
 * everything the scene creates is owned by the run and released when the player moves on.
 */
import type {Activity, ActivityHost, ActivityRun, RunningActivity} from '../../core/activity/activity';
import type {FrameLoop} from '../../core/activity/loop';
import type {EventBus} from '../../core/events';
import {lazy, type Lazy} from '../../core/registry';
import {
  createHandover,
  type Handover,
  type SceneEntry,
  type SceneRun,
  type SceneVisit,
} from '../../core/router/handover';
import type {SceneId} from '../../core/router/resolve';
import type {RouterService} from '../../core/router/service';
import {CARD_AFTER_MS, endLoading, startLoading} from './lazy-activity';
import {afterFrames} from './runtime';

export type SceneState = 'entering' | 'active' | 'failed';

/** What a scene's activity is entered with. */
export interface SceneParams {
  readonly visit: SceneVisit;
  /** The element the scene draws into (the shell's mount). The scene owns its children for the visit. */
  readonly mount: HTMLElement;
}

export interface SceneShellOptions {
  router: RouterService;
  mount: HTMLElement;
  doc: Document;
  events: EventBus;
  /** The active player, read at every handover boundary. */
  player(): string;
  /** Where "Go back" leads, and where an address without a dispatch row falls back to. */
  home: SceneId;
  loop?: FrameLoop;
  /** Default: the run's `ready`, then two loop frames (the first picture was submitted). */
  firstRender?: (run: SceneRun, visit: SceneVisit) => void | Promise<void>;
  /** A scene activated: e.g. the renderer pool retires a parked context nobody leased. */
  onEntered?(visit: SceneVisit): void;
  report?(message: string, error?: unknown): void;
}

export interface SceneShell {
  /** Follow the router and enter the current address. */
  start(): void;
  readonly handover: Handover;
  state(): {scene: SceneId | null; state: SceneState | null; epoch: number};
  dispose(): void;
}

export function createSceneShell(o: SceneShellOptions): SceneShell {
  const report = o.report ?? ((m: string, e?: unknown) => console.error(m, e ?? ''));
  const entries = new Map<SceneId, SceneEntry>(o.router.entries().map(e => [e.id, e]));
  const off = new AbortController();
  let scene: SceneId | null = null,
    state: SceneState | null = null,
    epoch = 0,
    failure: HTMLElement | null = null;
  const mark = (id: SceneId | null, next: SceneState | null) => {
    scene = id;
    state = next;
    if (id) o.mount.setAttribute('data-scene', id);
    else o.mount.removeAttribute('data-scene');
    if (next) o.mount.setAttribute('data-scene-state', next);
    else o.mount.removeAttribute('data-scene-state');
  };
  const clearFailure = () => {
    failure?.remove();
    failure = null;
  };

  const firstRender =
    o.firstRender ??
    ((_run: SceneRun, visit: SceneVisit) =>
      new Promise<void>((resolve, reject) => {
        const cancel = afterFrames(2, resolve, o.loop);
        visit.signal.addEventListener(
          'abort',
          () => {
            cancel();
            reject(new Error('superseded'));
          },
          {once: true},
        );
      }));

  const handover = createHandover({
    player: o.player,
    firstRender,
    loading: startLoading,
    settled: endLoading,
    entered: visit => {
      epoch = visit.epoch;
      mark(visit.scene, 'active');
      o.onEntered?.(visit);
      o.events.emit('scene.entered', {id: visit.scene, epoch: visit.epoch});
    },
    failed: (visit, error) => {
      report(`[scene-shell] ${visit.scene} could not open`, error);
      mark(visit.scene, 'failed');
      showFailure(entries.get(visit.scene)?.label ?? visit.scene);
    },
    report: (id, error) => report(`[scene-shell] leaving ${id} failed`, error),
  });

  function showFailure(label: string) {
    clearFailure();
    const doc = o.doc,
      card = doc.createElement('div');
    card.className = 'scene-failure-card';
    card.setAttribute('role', 'alert');
    const text = (tag: string, s: string) => {
      const e = doc.createElement(tag);
      e.textContent = s;
      return e;
    };
    const button = (s: string, fn: () => void) => {
      const b = doc.createElement('button');
      b.type = 'button';
      b.textContent = s;
      b.addEventListener('click', fn);
      return b;
    };
    const actions = doc.createElement('p');
    actions.className = 'scene-failure-actions';
    actions.append(
      button(copyText('engine.scene-loading.try-again'), () => void o.router.reenter('graphics')),
      button(copyText('engine.scene-loading.go-back'), () => void o.router.go(o.home)),
    );
    card.append(
      text('p', copyText('engine.scene-loading.could-not-open', {scene: label})),
      text('p', copyText('engine.scene-loading.check-connection')),
      actions,
    );
    o.mount.append(card);
    failure = card;
    actions.querySelector('button')?.focus({preventScroll: true});
  }

  // The loading card: shown after the event's delay, hidden when nothing is loading any more.
  let card: HTMLElement | null = null,
    timer: ReturnType<typeof setTimeout> | undefined;
  o.events.on(
    'loading.started',
    ({label, cardAfterMs}) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        card ??= Object.assign(o.doc.createElement('div'), {className: 'scene-loading-card'});
        card.setAttribute('role', 'status');
        card.textContent = copyText('engine.scene-loading.going-to', {scene: label});
        if (!card.isConnected) o.mount.append(card);
      }, cardAfterMs ?? CARD_AFTER_MS);
    },
    off.signal,
  );
  o.events.on(
    'loading.settled',
    ({pending}) => {
      if (pending > 0) return;
      clearTimeout(timer);
      card?.remove();
    },
    off.signal,
  );

  function follow() {
    clearFailure();
    const {resolved} = o.router.arrive();
    const entry = (resolved.sceneId && entries.get(resolved.sceneId)) || entries.get(o.home);
    if (!entry) {
      report(`[scene-shell] no dispatch row for ${resolved.sceneId ?? resolved.hash} and none for home ${o.home}`);
      return;
    }
    o.events.emit('scene.entering', {to: entry.id, from: scene});
    mark(entry.id, 'entering');
    void handover.go(entry, {params: resolved.params ?? {}});
  }

  let unlisten: (() => void) | null = null;
  return {
    handover,
    start() {
      unlisten = o.router.listen(follow);
      follow();
      // Scenes marked 'idle' are fetched after the first picture, one at a time, so a door opens without a wait.
      const warm = [...entries.values()].filter(e => e.preload === 'idle');
      const next = () => {
        const e = warm.shift();
        if (!e || off.signal.aborted) return;
        handover.preload(e);
        setTimeout(next, 250);
      };
      setTimeout(next, 1500);
    },
    state: () => ({scene, state, epoch}),
    dispose() {
      off.abort();
      unlisten?.();
      clearTimeout(timer);
      clearFailure();
      card?.remove();
      handover.leave();
      mark(null, null);
    },
  };
}

/**
 * Enter `activity` for one visit: start it on the app's activity host with the visit and the shell's mount, and hand
 * the handover its run. `ready` and `activate` are the activity's; `arrive` (optional) runs once the visit is current
 * and active, for entry work such as recording facts. A leave stops the run, which releases everything it owned.
 */
export async function enterActivity(o: {
  host: ActivityHost;
  mount: HTMLElement;
  activity: Activity<SceneParams>;
  visit: SceneVisit;
  arrive?: () => void;
}): Promise<SceneRun> {
  const running: RunningActivity = await o.host.start(o.activity, {visit: o.visit, mount: o.mount});
  const run: ActivityRun | null = running.run;
  if (!run) {
    running.stop('error');
    throw Error(`${o.activity.id}: the activity did not enter`);
  }
  o.visit.signal.addEventListener('abort', () => running.stop('route'), {once: true});
  return {
    ready: run.ready,
    activate: () => run.activate?.(),
    arrive: o.arrive,
    leave: reason =>
      running.stop(reason === 'player-changed' ? 'player-changed' : reason === 'failed' ? 'error' : 'route'),
  };
}

/**
 * A scene row whose visit is an activity run. `load` fetches the activity (its lazy chunk); `enter` is `enterActivity`.
 */
export function activityScene(o: {
  id: SceneId;
  label: string | (() => string);
  preload?: 'idle' | 'never';
  activity: Lazy<Activity<SceneParams>> | Activity<SceneParams>;
  host: () => ActivityHost;
  mount: () => HTMLElement;
}): SceneEntry<Activity<SceneParams>> {
  const source: Lazy<Activity<SceneParams>> =
    'load' in o.activity ? o.activity : lazy(async () => o.activity as Activity<SceneParams>);
  return {
    id: o.id,
    get label() {
      return typeof o.label === 'function' ? o.label() : o.label;
    },
    preload: o.preload,
    load: () => source.load(),
    enter: (activity, visit) => enterActivity({host: o.host(), mount: o.mount(), activity, visit}),
  };
}
