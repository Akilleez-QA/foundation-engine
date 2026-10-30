/** App-owned controller sampling on the existing loop; no alternate action vocabulary or animation loop. */
import type {FrameLoop, TickerHandle} from '../../core/activity/loop';
import {PAD_BUTTON_INDEX, type ActionLayers, type InputActions, type PadInput} from './actions';
import {buttonDown, MENU_ENGAGE, MENU_RELEASE, padFamily, type PadFamily, type PadLike} from './gamepad';
import {GamepadFocusGate} from './gamepad-gate';

type DocumentPort = EventTarget & {hidden?: boolean; hasFocus?(): boolean};
export interface ActionGamepadOptions {
  input: Pick<InputActions, 'padFrame' | 'cancel' | 'onCancel'>;
  layers: ActionLayers;
  loop: Pick<FrameLoop, 'add'>;
  doc: DocumentPort;
  win: EventTarget;
  signal: AbortSignal;
  getPads?: () => readonly (PadLike | null)[];
}

/** Only standard-mapped controllers have a portable button-position contract. */
export function installActionGamepad(o: ActionGamepadOptions): {readonly family: PadFamily | null} {
  const gate = new GamepadFocusGate();
  let ticker: TickerHandle | undefined,
    identity = '',
    down = new Set<PadInput>(),
    focused = o.doc.hasFocus?.() ?? true;
  let family: PadFamily | null = null,
    disposed = o.signal.aborted,
    generation = 0;
  const enabled = () => !disposed && focused && !o.doc.hidden;
  const read = () => {
    try {
      const pads: readonly (PadLike | null)[] = o.getPads ? o.getPads() : (globalThis.navigator?.getGamepads?.() ?? []);
      return Array.from(pads).filter((p): p is PadLike => !!p && p.connected && p.mapping === 'standard');
    } catch {
      return [];
    }
  };
  const release = () => {
    const previous = down;
    down = new Set();
    if (previous.size) o.input.padFrame([...previous].map(input => ({input, pressed: false})));
  };
  const reset = () => {
    release();
    gate.reset();
  };
  const stop = () => {
    ticker?.remove();
    ticker = undefined;
  };
  function sample(): boolean {
    const pads = read(),
      pad = pads.find(p => `${p.index}:${p.id}` === identity) ?? pads[0];
    if (!pad) {
      const connected = !!identity;
      reset();
      identity = '';
      family = null;
      if (connected) o.input.cancel('disconnect');
      stop();
      return false;
    }
    const key = `${pad.index}:${pad.id}`;
    if (identity && identity !== key) {
      reset();
      o.input.cancel('disconnect');
    }
    identity = key;
    family = padFamily(pad.id);
    const next = new Set<PadInput>();
    for (const [input, index] of Object.entries(PAD_BUTTON_INDEX) as [PadInput, number][]) {
      if (buttonDown(pad.buttons[index], down.has(input))) next.add(input);
    }
    for (const [prefix, offset] of [
      ['ls', 0],
      ['rs', 2],
    ] as const) {
      const x = pad.axes[offset] ?? NaN,
        y = pad.axes[offset + 1] ?? NaN; // a missing axis is not finite, as before
      for (const [name, value] of [
        ['left', -x],
        ['right', x],
        ['up', -y],
        ['down', y],
      ] as const) {
        const input = `${prefix}-${name}` as PadInput;
        if (Number.isFinite(value) && value > (down.has(input) ? MENU_RELEASE : MENU_ENGAGE)) next.add(input);
      }
    }
    // Sub-threshold stick displacement must return below release before a held controller can rearm.
    const neutral =
      !pad.buttons.some(button => buttonDown(button, true)) &&
      !next.size &&
      !pad.axes.slice(0, 4).some(v => Number.isFinite(v) && Math.abs(v) > MENU_RELEASE);
    if (!gate.accepts(pad, enabled(), neutral)) {
      release();
      return true;
    }
    const edges = [...down].filter(input => !next.has(input)).map(input => ({input, pressed: false}));
    edges.push(...[...next].filter(input => !down.has(input)).map(input => ({input, pressed: true})));
    down = next;
    if (edges.length) {
      o.input.padFrame(edges);
      // A dispatched edge may cancel/rebind synchronously. Retain physical downs so the next
      // gated sample releases even later edges the dispatcher blocked after that owner change.
      if (!disposed) down = next;
    }
    return true;
  }
  function start() {
    const visit = ++generation;
    stop();
    if (!enabled() || !sample() || visit !== generation || !enabled()) return;
    // Application input must reach ownerless opaque menus too; rendering remains owner-scoped.
    ticker = o.loop.add({
      owner: 'platform.input.gamepad',
      scope: 'application',
      priority: -1000,
      mode: 'continuous',
      update: () => {
        sample();
      },
    });
  }
  const blur = () => {
    focused = false;
    reset();
    stop();
    o.input.cancel('blur');
  };
  const focus = () => {
    focused = true;
    reset();
    start();
  };
  const visibility = () => {
    reset();
    if (o.doc.hidden) {
      stop();
      o.input.cancel('blur');
    } else start();
  };
  if (!disposed) {
    o.input.onCancel(reset, o.signal);
    o.layers.onChange(reset, o.signal);
    o.win.addEventListener('blur', blur, {signal: o.signal});
    o.win.addEventListener('focus', focus, {signal: o.signal});
    o.win.addEventListener('pagehide', blur, {signal: o.signal});
    o.win.addEventListener('pageshow', focus, {signal: o.signal});
    o.win.addEventListener(
      'gamepadconnected',
      () => {
        reset();
        start();
      },
      {signal: o.signal},
    );
    o.win.addEventListener(
      'gamepaddisconnected',
      () => {
        reset();
        o.input.cancel('disconnect');
        start();
      },
      {signal: o.signal},
    );
    o.doc.addEventListener('visibilitychange', visibility, {signal: o.signal});
    o.signal.addEventListener(
      'abort',
      () => {
        disposed = true;
        generation++;
        stop();
        reset();
        identity = '';
        family = null;
      },
      {once: true},
    );
    start();
  }
  return {
    get family() {
      return family;
    },
  };
}
