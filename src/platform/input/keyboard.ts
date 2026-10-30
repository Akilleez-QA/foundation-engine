import {monotonicNow} from '../../core/clock';
import {
  QUICK_SLOTS,
  stamp,
  worldKind,
  type ButtonAction,
  type CameraModeRequest,
  type Direction,
  type InputSink,
} from './frame-actions';

/** Movement by physical `code` (AZERTY gets ZQSD); mnemonics by `key`, case-insensitively,
 * so Shift, Caps Lock and Sticky Keys still work. Ctrl, Meta and Alt chords are never consumed. */
export type KeyCommand = ButtonAction | {zoom: number} | {mode: CameraModeRequest};
export type KeyBindings = {
  move: Record<string, Direction>;
  keys: Record<string, KeyCommand>;
  codes: Record<string, KeyCommand>;
};
export const defaultKeyBindings: KeyBindings = {
  move: {
    KeyW: 'up',
    ArrowUp: 'up',
    KeyS: 'down',
    ArrowDown: 'down',
    KeyA: 'left',
    ArrowLeft: 'left',
    KeyD: 'right',
    ArrowRight: 'right',
  },
  keys: {
    m: 'mute',
    v: {mode: 'cycle'},
    '+': {zoom: -1},
    '=': {zoom: -1},
    '-': {zoom: 1},
    _: {zoom: 1},
    i: {zoom: -1},
    o: {zoom: 1},
    c: 'recentre',
    p: 'pause',
    e: 'interact',
    enter: 'interact',
    ' ': 'interact',
    escape: 'back',
    ...Object.fromEntries(QUICK_SLOTS.map((e, i) => [String(i + 1), e])),
  },
  codes: {NumpadAdd: {zoom: -1}, NumpadSubtract: {zoom: 1}},
};
/** Autorepeat zoom stays within the OS rate but never above 8 notches a second. */
export const KEY_REPEAT_ZOOM_MS = 125;
const ACTIVATES = new Set(['enter', ' ']);
type KeyTarget = {
  tagName?: string;
  isContentEditable?: boolean;
  getAttribute?(name: string): string | null;
  closest?(selector: string): unknown;
};
const target = (e: Event): KeyTarget | null => (e.composedPath?.()[0] ?? e.target) as KeyTarget | null;
/** Text fields, selects, ranges and contenteditable own every key. */
export const isEditable = (t: KeyTarget | null) =>
  !!t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName ?? '') || t.isContentEditable === true);
/** A focused button-like control owns Space and Enter. */
export const isActivatable = (t: KeyTarget | null) =>
  !!t &&
  (/^(BUTTON|SUMMARY)$/.test(t.tagName ?? '') ||
    (t.tagName === 'A' && !!t.getAttribute?.('href')) ||
    /^(button|link|checkbox|switch|menuitem|tab|option|radio)$/.test(t.getAttribute?.('role') ?? ''));
export const isSingleCharacter = (key: string) => key.length === 1 && key !== ' ';

export type KeyboardOptions = {
  bindings?: KeyBindings | undefined;
  now?: () => number;
  singleKeyShortcuts?: () => boolean;
};
/** The keyboard state machine, DOM-free for tests. `down` returns true when it consumed the key. */
export class KeyboardInput {
  private bindings: KeyBindings;
  private now: () => number;
  private lastRepeatZoom = -Infinity;
  private shortcuts: () => boolean;
  constructor(
    private sink: InputSink,
    options: KeyboardOptions = {},
  ) {
    this.bindings = options.bindings ?? defaultKeyBindings;
    this.now = options.now ?? monotonicNow;
    this.shortcuts = options.singleKeyShortcuts ?? (() => true);
  }
  down(e: KeyboardEvent): boolean {
    if (
      e.ctrlKey ||
      e.metaKey ||
      e.altKey ||
      e.isComposing ||
      e.keyCode === 229 ||
      e.defaultPrevented ||
      (e as KeyboardEvent & {inputSynthetic?: boolean}).inputSynthetic
    )
      return false;
    const t = target(e),
      key = (e.key ?? '').toLowerCase(),
      at = stamp(e, this.now);
    if (isEditable(t) || (ACTIVATES.has(key) && isActivatable(t))) return false;
    const kind = this.sink.kind(),
      direction = this.bindings.move[e.code];
    if (direction) {
      this.sink.device('keyboard-mouse', at);
      if (!worldKind(kind)) {
        if (!/^Arrow/.test(e.code) || !this.sink.nav?.(direction, e.target)) return false;
        e.preventDefault();
        return true;
      }
      e.preventDefault();
      if (this.sink.held.press('key:' + e.code, direction, e.repeat)) this.sink.latch.moveStarted();
      return true;
    }
    const byCode = this.bindings.codes[e.code],
      command = byCode ?? this.bindings.keys[key];
    // WCAG 2.1.4: character shortcuts (M, V, 1–6, +, −) can be switched off; Escape, Enter and Space stay.
    if (!command || (!byCode && isSingleCharacter(key) && !this.shortcuts())) return false;
    this.sink.device('keyboard-mouse', at);
    if (typeof command === 'object' && 'zoom' in command) {
      if (!worldKind(kind)) return false;
      if (e.repeat) {
        if (at - this.lastRepeatZoom < KEY_REPEAT_ZOOM_MS) return true;
        this.lastRepeatZoom = at;
      } else this.lastRepeatZoom = at;
      e.preventDefault();
      this.sink.latch.zoom({notches: command.zoom, source: e.repeat ? 'repeat' : 'key', t: at});
      return true;
    }
    // Toggles, panels and quick slots fire once per physical press.
    if (e.repeat) return worldKind(kind) && key === ' ' ? (e.preventDefault(), true) : false;
    const action: ButtonAction = typeof command === 'object' ? 'cameraMode' : command;
    if (action === 'interact' && !worldKind(kind)) return false;
    if (key === ' ') e.preventDefault();
    this.sink.latch.action({
      action,
      t: at,
      device: 'keyboard-mouse',
      mode: typeof command === 'object' && 'mode' in command ? command.mode : undefined,
    });
    return true;
  }
  up(e: KeyboardEvent) {
    this.sink.held.release('key:' + e.code);
    // macOS never sends keyup for keys pressed while Cmd was down.
    if (e.key === 'Meta') this.releaseAll();
  }
  releaseAll() {
    this.sink.held.releaseWhere(s => s.startsWith('key:'));
  }
}

type Env = {win?: EventTarget; doc?: EventTarget & {hidden?: boolean}};
/** keydown/keyup on window (so keys released over an overlay still clear) plus the lifecycle
 * resets: blur, hidden, pagehide, pointer-lock and fullscreen changes. */
export function attachKeyboard(sink: InputSink, options: KeyboardOptions & Env & {signal: AbortSignal}) {
  const keyboard = new KeyboardInput(sink, options),
    win = options.win ?? globalThis.window,
    doc = options.doc ?? globalThis.document,
    signal = options.signal,
    release = () => keyboard.releaseAll();
  win.addEventListener('keydown', e => keyboard.down(e as KeyboardEvent), {signal});
  win.addEventListener('keyup', e => keyboard.up(e as KeyboardEvent), {signal});
  win.addEventListener('blur', release, {signal});
  win.addEventListener('pagehide', release, {signal});
  doc.addEventListener(
    'visibilitychange',
    () => {
      if (doc.hidden) release();
    },
    {signal},
  );
  doc.addEventListener('pointerlockchange', release, {signal});
  doc.addEventListener('fullscreenchange', release, {signal});
  return keyboard;
}
