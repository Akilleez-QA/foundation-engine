import {TEST_API} from '../../core/env';
import {monotonicNow} from '../../core/clock';
/**
 * platform/ui/runtime.ts: the app's one frame loop, installed once and shared (STD-RUN-1).
 *
 * `appLoop()` is the single `FrameLoop` the running game uses. Legacy frame owners reach it through the
 * `ActivityFrames` facade (src/activity-frames.ts), so they run through this one `requestAnimationFrame`
 * without changing their API. Tests inject their own scheduler and get a private loop instead.
 *
 * `appLayers()` is the app's one layer manager. The shared loop reads coverage from it, so a covered
 * owner pauses per its `whenCovered` and the loop re-evaluates as soon as a layer opens or closes.
 *
 * `appActivities()` is the app's activity host: panel experiences run on it, each owning its `panel`
 * layer.
 *
 * `appInput()` is the app's one action dispatcher (ADRs 0044/0047): one `InputActions` over the core
 * `inputActions` rows and the app's layers, fed by one capture keydown and one capture keyup listener on window, with
 * blur cancelling held input. Keyboard dispatch uses the event's `timeStamp`; polled inputs use the monotonic clock.
 */
import {ActivityHost} from '../../core/activity/activity';
import {FrameLoop, type FrameLoopOptions} from '../../core/activity/loop';
import type {LayerPort} from '../../core/activity/ports';
import {LayerManager} from './layers';
import {calmScenes} from '../../core/settings/app-settings';
import type {Registry} from '../../core/registry';
import {
  CORE_INPUT_ACTIONS,
  inputActionRegistry,
  InputActions,
  type ActionLayers,
  type ActionOverrides,
  type InputActionDef,
} from '../input/actions';

/** Coverage where there is no document (node tests): nothing covers any owner. */
export const NO_LAYERS: Pick<LayerPort, 'coverage' | 'onChange'> = {coverage: () => 'top', onChange: () => () => {}};

/**
 * Calm scenes: the settings value `comfort.calm` (STD-SET-2), whose default is the OS reduced-motion
 * preference, followed live. One O(1) read, never a media query or a DOM query; false in node tests (no platform).
 */
export function calm(): boolean {
  return calmScenes();
}

/**
 * A ticker that throws is removed and reported as an uncaught error would be (the legacy frame callback threw out
 * of its own rAF), so error listeners and the verify scripts still see it.
 */
function reportTicker(owner: string, error: unknown): void {
  if (typeof globalThis.reportError === 'function') globalThis.reportError(error);
  else console.error(`Ticker for ${owner} threw and was removed`, error);
}

/** A loop with the app's defaults; `overrides` swaps the scheduler (tests) or the layers. */
export function createLoop(overrides: Partial<FrameLoopOptions> = {}): FrameLoop {
  return new FrameLoop({layers: NO_LAYERS, calm, report: reportTicker, ...overrides});
}

const managers = new WeakMap<Document, LayerManager>();
/**
 * The app's one layer manager (created on first use). A 'page' modal makes the top bar inert. One per document: the
 * app has one; node tests that install a fresh fake document per case get a fresh manager with it.
 */
export function appLayers(doc: Document = document): LayerManager {
  let manager = managers.get(doc);
  if (!manager) {
    manager = new LayerManager(doc, {shell: () => Array.from(doc.querySelectorAll<HTMLElement>('header.topbar'))});
    managers.set(doc, manager);
  }
  return manager;
}

let shared: FrameLoop | null = null;
/** The app's one frame loop (created on first use), with coverage from the app's layers. */
export function appLoop(): FrameLoop {
  if (!shared) {
    shared = createLoop(
      typeof document === 'undefined'
        ? {}
        : {
            layers: appLayers(),
            visibility: {
              hidden: () => document.hidden,
              onChange(fn) {
                const changed = () => fn(document.hidden);
                document.addEventListener('visibilitychange', changed);
                return () => document.removeEventListener('visibilitychange', changed);
              },
            },
          },
    );
    if (TEST_API && typeof location !== 'undefined' && new URLSearchParams(location.search).has('engine-capture'))
      shared.holdFrames(true);
  }
  return shared;
}

const hosts = new WeakMap<Document, ActivityHost>();
/**
 * The app's activity host: runs started here own their layers on `appLayers(doc)` and their tickers on the
 * one loop, and release them in reverse order when they leave. Panel experiences are its first runs; scenes join
 * it when their legacy openers become activities, after which a panel becomes a child of its scene's run.
 */
export function appActivities(doc: Document = document): ActivityHost {
  let host = hosts.get(doc);
  if (!host) {
    host = new ActivityHost({
      loop: appLoop(),
      layers: appLayers(doc),
      calm,
      report: (id, error) => console.error(`Activity ${id} failed`, error),
    });
    hosts.set(doc, host);
  }
  return host;
}

let serial = 0;
/** A fresh owner key for a ticker that belongs to no activity run yet. */
export const anonymousOwner = (prefix = 'frames'): string => `${prefix}#${++serial}`;

/**
 * Run `fn` in the `n`th frame from now (n = 2 is the legacy "after the next paint" double rAF). Returns a cancel.
 */
export function afterFrames(n: number, fn: () => void, loop: FrameLoop = appLoop()): () => void {
  let seen = 0;
  const ticker = loop.add({
    owner: anonymousOwner('after-frames'),
    mode: 'continuous',
    whenCovered: 'run',
    update() {
      if (++seen < n) return;
      ticker.remove();
      fn();
    },
  });
  return () => ticker.remove();
}

/** The app's `inputActions` rows: today the core rows. `npm run verify:input-reach` checks exactly these. */
export const APP_INPUT_ACTIONS: readonly InputActionDef[] = CORE_INPUT_ACTIONS;
/** The app's remaps. Empty until the settings Controls section stores overrides. */
export const APP_INPUT_OVERRIDES: ActionOverrides = {};

/** The window events the dispatcher listens to (a fake stands in for window in node tests). */
export type InputWindow = Pick<EventTarget, 'addEventListener'>;
/**
 * A dispatcher over the app's rows and `layers`, fed by one capture keydown and one capture keyup listener on `win`,
 * with blur and pagehide cancelling held input. Keyboard dispatch uses the event's `timeStamp`; other inputs use the supplied monotonic clock.
 */
export function createInput(
  win: InputWindow,
  layers: ActionLayers,
  signal?: AbortSignal,
  registry: Registry<InputActionDef> = inputActionRegistry(APP_INPUT_ACTIONS),
  now: () => number = monotonicNow,
): InputActions {
  let stamp: number | undefined;
  const actions = new InputActions(
    {registry, layers, now: () => stamp ?? now(), overrides: APP_INPUT_OVERRIDES},
    signal,
  );
  const dispatchKey = (e: Event, dispatch: () => void) => {
    const previous = stamp;
    stamp = e.timeStamp;
    try {
      dispatch();
    } finally {
      stamp = previous;
    }
  };
  // Listener options omit an absent signal: the DOM treats a missing and an undefined `signal` member alike.
  const listen = signal === undefined ? {} : {signal};
  win.addEventListener(
    'keydown',
    e =>
      dispatchKey(e, () => {
        actions.keyDown(e as KeyboardEvent);
      }),
    {capture: true, ...listen},
  );
  win.addEventListener(
    'keyup',
    e =>
      dispatchKey(e, () => {
        actions.keyUp(e as KeyboardEvent);
      }),
    {capture: true, ...listen},
  );
  const cancel = () => actions.cancel('blur');
  win.addEventListener('focusin', e => actions.focusEntered(e.composedPath?.()[0] ?? e.target), {
    capture: true,
    ...listen,
  });
  win.addEventListener('blur', cancel, {...listen});
  win.addEventListener('pagehide', cancel, {...listen});
  return actions;
}

/** Share the document's existing dispatcher owner; visibility must not depend on optional adapters. */
function createDocumentInput(doc: Document, registry?: Registry<InputActionDef>, signal?: AbortSignal): InputActions {
  const actions = createInput(doc.defaultView ?? doc, appLayers(doc), signal, registry);
  doc.addEventListener(
    'visibilitychange',
    () => {
      if (doc.hidden) actions.cancel('blur');
    },
    signal === undefined ? {} : {signal},
  );
  return actions;
}

const inputs = new WeakMap<Document, InputActions>();
/**
 * The app's one action dispatcher (created on first use). Its window listeners run in the capture phase, before
 * panels that stop keydown (panel panels, a photo booth, a travel map), so an 'always' row such as M mute works
 * under every modal. A key no subscriber takes, or a row marked `passThrough`, is left for the page untouched.
 * One per document, over that document's layers; a document without a window (the node fake DOM) is listened to
 * directly, since it is the root its events travel through.
 */
export function appInput(doc: Document = document): InputActions {
  let actions = inputs.get(doc);
  if (!actions) {
    actions = createDocumentInput(doc);
    inputs.set(doc, actions);
  }
  return actions;
}

/** The `platform.input` module installs the app's dispatcher over the kernel's frozen `inputActions` registry, so every
 *  module's rows are live; `appInput()` then returns it. */
export function installAppInput(doc: Document, registry: Registry<InputActionDef>, signal?: AbortSignal): InputActions {
  const actions = createDocumentInput(doc, registry, signal);
  inputs.set(doc, actions);
  signal?.addEventListener(
    'abort',
    () => {
      if (inputs.get(doc) === actions) inputs.delete(doc);
    },
    {once: true},
  );
  return actions;
}
