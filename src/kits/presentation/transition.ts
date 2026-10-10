/**
 * Screen transitions (fade, wipe, iris) with an input lock: a pure state machine driven by the caller's time, a CSS
 * style for an overlay element, an optional DOM adapter over `ctx.view.overlay`, and an input view that reads neutral
 * while locked. Typical use: cover, change scene or teleport while covered, uncover.
 */
import type {InputState} from '../../author';

export type TransitionKind = 'fade' | 'wipe' | 'iris';
export type TransitionPhase = 'idle' | 'covering' | 'covered' | 'uncovering';

export interface TransitionStyle {
  readonly kind: TransitionKind;
  /** Seconds to cover and to uncover (0 to 30). */
  readonly coverSeconds: number;
  readonly uncoverSeconds: number;
  /** CSS colour of the cover (default black). */
  readonly color?: string;
  /** Wipe direction (default 'right': the cover enters from the left). */
  readonly direction?: 'left' | 'right' | 'up' | 'down';
  /** Iris centre in view fractions (0..1, default the middle), e.g. the player's projected position. */
  readonly center?: readonly [number, number];
}

export interface TransitionSnapshot {
  readonly phase: TransitionPhase;
  /** 0 = clear, 1 = fully covered. */
  readonly coverage: number;
  readonly locked: boolean;
  readonly kind: TransitionKind;
}

const fail = (message: string): never => {
  throw new RangeError(`presentation: ${message}`);
};
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const NAMED = /^[a-zA-Z]{3,20}$/;
const COLOR =
  /^(#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|rgba?\(\s*\d{1,3}(?:\s*,\s*\d{1,3}){2}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\))$/;
/** Named colours that would not cover the view. */
const NON_COVERING = new Set(['transparent', 'inherit', 'initial', 'unset', 'revert', 'currentcolor']);

function captureStyle(input: TransitionStyle): Required<TransitionStyle> {
  if (typeof input !== 'object' || input === null) return fail('style must be an object');
  const r: Record<string, unknown> = {...input};
  if (r.kind !== 'fade' && r.kind !== 'wipe' && r.kind !== 'iris') fail('kind must be fade, wipe or iris');
  for (const k of ['coverSeconds', 'uncoverSeconds'] as const) {
    const v = r[k];
    if (!finite(v) || v < 0 || v > 30) fail(`${k} must be in [0, 30]`);
  }
  const color = r.color ?? '#000';
  if (
    typeof color !== 'string' ||
    !(COLOR.test(color) || (NAMED.test(color) && !NON_COVERING.has(color.toLowerCase())))
  )
    fail('color must be #rgb/#rrggbb(aa), rgb()/rgba() with commas, or a named colour that covers');
  const direction = r.direction ?? 'right';
  if (!['left', 'right', 'up', 'down'].includes(direction as string)) fail('direction must be left, right, up or down');
  const center = r.center ?? [0.5, 0.5];
  if (!Array.isArray(center) || center.length !== 2 || !center.every(v => finite(v) && v >= 0 && v <= 1))
    return fail('center must be [x, y] in [0, 1]');
  const [cx, cy] = center as [number, number];
  return Object.freeze({
    kind: r.kind as TransitionKind,
    coverSeconds: r.coverSeconds as number,
    uncoverSeconds: r.uncoverSeconds as number,
    color: color as string,
    direction: direction as 'left' | 'right' | 'up' | 'down',
    center: Object.freeze([cx, cy]) as readonly [number, number],
  });
}

/** Smoothstep easing (zero slope at both ends). */
const ease = (x: number) => x * x * (3 - 2 * x);

/**
 * A screen transition. `cover(now)` starts covering (input locks at once); `covered` is reported when coverage
 * reaches 1, where the caller swaps scenes or moves the camera; `uncover(now)` reveals; input unlocks when coverage
 * returns to 0. Calls are idempotent per phase; time must not go backwards.
 */
export function createScreenTransition(initial: TransitionStyle) {
  let style = captureStyle(initial);
  let phase: TransitionPhase = 'idle';
  let start = 0;
  let from = 0;
  let last = -Infinity;
  const time = (t: unknown): number => {
    if (!finite(t) || t < last) return fail('time must be finite and nondecreasing');
    last = t;
    return t;
  };
  const coverageAt = (t: number) => {
    if (phase === 'idle') return 0;
    if (phase === 'covered') return 1;
    const span = phase === 'covering' ? style.coverSeconds : style.uncoverSeconds;
    const f = span === 0 ? 1 : Math.min(1, (t - start) / span);
    return phase === 'covering' ? from + (1 - from) * f : from * (1 - f);
  };
  const snapshot = (coverage: number): TransitionSnapshot =>
    Object.freeze({phase, coverage, locked: phase !== 'idle', kind: style.kind});

  return {
    get phase() {
      return phase;
    },
    get style(): Required<TransitionStyle> {
      return style;
    },
    /** Change the look for the next transition (or the current one: the coverage carries over). */
    setStyle(next: TransitionStyle): void {
      const captured = captureStyle(next);
      // Rebase an active fade so the coverage shown now carries over into the new durations.
      if (phase === 'covering' || phase === 'uncovering') {
        const now = last === -Infinity ? 0 : last;
        from = coverageAt(now);
        start = now;
      }
      style = captured;
    },
    /** Begin covering from the current coverage (reverses an uncover in progress). */
    cover(now: number): void {
      const t = time(now);
      if (phase === 'covering' || phase === 'covered') return;
      from = coverageAt(t);
      phase = 'covering';
      start = t;
    },
    /** Begin uncovering from the current coverage (reverses a cover in progress). */
    uncover(now: number): void {
      const t = time(now);
      if (phase === 'idle' || phase === 'uncovering') return;
      from = coverageAt(t);
      phase = 'uncovering';
      start = t;
    },
    /** Advance to `now`; returns the state and whether this update reached `covered` or `idle`. */
    update(now: number): TransitionSnapshot & {readonly reached: 'covered' | 'idle' | null} {
      const t = time(now);
      let reached: 'covered' | 'idle' | null = null;
      const c = coverageAt(t);
      if (phase === 'covering' && c >= 1) {
        phase = 'covered';
        reached = 'covered';
      } else if (phase === 'uncovering' && c <= 0) {
        phase = 'idle';
        reached = 'idle';
      }
      return Object.freeze({...snapshot(phase === 'idle' ? 0 : phase === 'covered' ? 1 : c), reached});
    },
    /** The current state without advancing. */
    peek(): TransitionSnapshot {
      return snapshot(coverageAt(last === -Infinity ? 0 : last));
    },
  };
}
export type ScreenTransition = ReturnType<typeof createScreenTransition>;

/**
 * CSS declarations for an overlay element that covers the view by `coverage` (0..1) with the given style. Fade uses
 * opacity; wipe uses a hard-edged linear gradient; iris uses a circular radial gradient closing on `center`.
 */
export function transitionCss(style: TransitionStyle, coverage: number): Readonly<Record<string, string>> {
  const s = captureStyle(style);
  if (!finite(coverage) || coverage < 0 || coverage > 1) fail('coverage must be in [0, 1]');
  const c = ease(coverage);
  const base = {position: 'absolute', inset: '0', 'pointer-events': c > 0 ? 'auto' : 'none'};
  if (s.kind === 'fade') return Object.freeze({...base, background: s.color, opacity: c.toFixed(4)});
  if (s.kind === 'wipe') {
    const toward = {right: 'to right', left: 'to left', down: 'to bottom', up: 'to top'}[s.direction];
    const edge = (c * 100).toFixed(3);
    return Object.freeze({
      ...base,
      opacity: c > 0 ? '1' : '0',
      background: `linear-gradient(${toward}, ${s.color} ${edge}%, transparent ${edge}%)`,
    });
  }
  // Iris: a circle gradient sized to the farthest corner (the CSS default), so stops in % close the clear circle
  // from the whole view (0% coverage) to nothing (100%) around the centre.
  const [cx, cy] = s.center;
  const radius = ((1 - c) * 100).toFixed(3);
  return Object.freeze({
    ...base,
    opacity: c > 0 ? '1' : '0',
    background: `radial-gradient(circle at ${(cx * 100).toFixed(2)}% ${(cy * 100).toFixed(2)}%, transparent ${radius}%, ${s.color} ${radius}%)`,
  });
}

/**
 * Attach a cover element to an overlay (e.g. `ctx.view.overlay`) and return a `render(transition)` that applies the
 * transition's coverage each frame. Null overlay (headless) returns a no-op renderer. The element is removed when
 * `signal` aborts (use `ctx.view.signal`). The element is decorative: `aria-hidden`, no focus.
 */
export function mountTransitionOverlay(
  overlay: HTMLElement | null,
  signal?: AbortSignal,
): {render(transition: ScreenTransition): void; readonly element: HTMLElement | null} {
  if (!overlay) return {render() {}, element: null};
  if (signal?.aborted) return {render() {}, element: null};
  const el = overlay.ownerDocument.createElement('div');
  el.setAttribute('aria-hidden', 'true');
  el.dataset.presentationTransition = '';
  overlay.appendChild(el);
  signal?.addEventListener('abort', () => el.remove(), {once: true});
  let lastCss = '';
  return {
    element: el,
    render(transition) {
      const state = transition.peek();
      const css = transitionCss(transition.style, state.coverage);
      const text = Object.entries(css)
        .map(([k, v]) => `${k}:${v}`)
        .join(';');
      if (text !== lastCss) {
        el.setAttribute('style', text);
        lastCss = text;
      }
    },
  };
}

/**
 * An input view that reads neutral (nothing pressed or held, axes 0, pointer up) while `locked()` is true and passes
 * through otherwise. Give it to systems that move the player so a transition cannot be walked through.
 */
export function lockedInput(input: InputState, locked: () => boolean): InputState {
  if (typeof locked !== 'function') fail('locked must be a function');
  const neutralPointer = Object.freeze({x: 0, y: 0, down: false, pressed: false});
  return {
    describe: action => input.describe(action),
    pressed: action => !locked() && input.pressed(action),
    pressedAt: action => (locked() ? null : input.pressedAt(action)),
    held: action => !locked() && input.held(action),
    axis: action => (locked() ? 0 : input.axis(action)),
    get pointer() {
      return locked() ? neutralPointer : input.pointer;
    },
  };
}
