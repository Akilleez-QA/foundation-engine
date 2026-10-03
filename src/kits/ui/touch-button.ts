/**
 * An optional on-screen touch button for one game input (`defineInput`), owned by the scene visit. It feeds the
 * existing input owner through `bindPointerControl`: a touch on it presses the action, a `hold: true` input stays
 * held while that contact stays down on the button, and lifting, cancelling, sliding off, blur, page hide, a resize,
 * an overlay or the end of the visit release it. Presses reach `ctx.input` through the same dispatcher and press latch
 * as a key, so a held touch is one press (one fixed tick), then `held`. Mouse and pen pointers are ignored.
 */
import type {SceneContext} from '../../author';
import {actionOf} from '../../author/ids';
import {bindPointerControl} from '../../platform/input/pointer-control';

/** The smallest accepted side in CSS px (WCAG 2.5.5 target size: 44; the engine's controls use 48). */
export const TOUCH_BUTTON_MIN = 48;
/** The largest accepted side in CSS px. */
export const TOUCH_BUTTON_MAX = 240;

export interface TouchButtonOptions {
  /** Visible text, already resolved (`ctx.text('game.input.jump')`). */
  label: string;
  /** Side in CSS px, [48, 240]; default 72. */
  size?: number;
  /** Offsets in CSS px from the view's edges, added to the safe-area inset. Default `{ right: 24, bottom: 24 }`. */
  inset?: {left?: number; right?: number; top?: number; bottom?: number};
  /**
   * 'touch' (default): shown only where the device reports a touch screen or coarse pointer when the button is made.
   * 'always': shown everywhere (it still answers touch only).
   */
  show?: 'touch' | 'always';
  /** Removes the button before the visit ends; the visit's end always removes it. */
  signal?: AbortSignal;
  /** Extra class names for the creator's own styles. */
  className?: string;
}

export interface TouchButton {
  /** The button, or null where nothing was made (no overlay: headless tests; or hidden by `show`). */
  readonly element: HTMLElement | null;
  /** Release and remove it now. Idempotent. */
  dispose(): void;
}

const UP = 'rgb(10 16 22 / 62%)',
  DOWN = 'rgb(70 90 110 / 80%)';
const NONE: TouchButton = Object.freeze({element: null, dispose() {}});
const edge = (n: number | undefined, name: string) => {
  if (n !== undefined && (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 10000))
    throw new RangeError(`touchButton: inset.${name} must be in [0, 10000] CSS px`);
  return n;
};

function touchCapable(doc: Document): boolean {
  const win = doc.defaultView as (Window & typeof globalThis) | null;
  try {
    if (win?.matchMedia?.('(any-pointer: coarse)').matches) return true;
  } catch {
    /* No media queries: fall through. */
  }
  const nav = win?.navigator;
  return typeof nav?.maxTouchPoints === 'number' && nav.maxTouchPoints > 0;
}

/**
 * Add a touch button for the game input `input` (its local id, as in `defineInput({ id })`) to this visit's overlay.
 * The element is a touch-only supplement (`aria-hidden`): the input's key and pad bindings stay its accessible path.
 */
export function touchButton(ctx: SceneContext, input: string, options: TouchButtonOptions): TouchButton {
  if (typeof input !== 'string' || !input) throw new TypeError('touchButton: input must be a game input id');
  if (!options || typeof options.label !== 'string') throw new TypeError('touchButton: label must be a string');
  const size = options.size ?? 72;
  if (typeof size !== 'number' || !(size >= TOUCH_BUTTON_MIN && size <= TOUCH_BUTTON_MAX))
    throw new RangeError(`touchButton: size must be in [${TOUCH_BUTTON_MIN}, ${TOUCH_BUTTON_MAX}] CSS px`);
  const inset = options.inset ?? {right: 24, bottom: 24};
  const left = edge(inset.left, 'left'),
    right = edge(inset.right, 'right'),
    top = edge(inset.top, 'top'),
    bottom = edge(inset.bottom, 'bottom');
  if (options.show !== undefined && options.show !== 'touch' && options.show !== 'always')
    throw new TypeError("touchButton: show is 'touch' or 'always'");
  const overlay = ctx.view.overlay,
    visit = ctx.view.signal;
  if (!overlay || visit?.aborted || options.signal?.aborted) return NONE;
  const doc = overlay.ownerDocument;
  if ((options.show ?? 'touch') === 'touch' && !touchCapable(doc)) return NONE;

  const element = doc.createElement('div');
  element.className = ['touch-button', options.className].filter(Boolean).join(' ');
  element.dataset.input = input;
  element.textContent = options.label;
  element.setAttribute('aria-hidden', 'true');
  const at = (side: string, n: number | undefined) =>
    n === undefined ? '' : `${side}:calc(env(safe-area-inset-${side}, 0px) + ${n}px);`;
  element.style.cssText =
    'position:absolute;box-sizing:border-box;display:flex;align-items:center;justify-content:center;' +
    `width:${size}px;height:${size}px;min-width:${TOUCH_BUTTON_MIN}px;min-height:${TOUCH_BUTTON_MIN}px;` +
    at('left', left) +
    at('right', right) +
    at('top', top) +
    at('bottom', bottom) +
    `border-radius:50%;border:2px solid var(--engine-line);background:${UP};color:var(--engine-text);` +
    'font:600 var(--engine-text-lg) var(--engine-font);text-align:center;overflow:hidden;overflow-wrap:anywhere;' +
    'pointer-events:auto;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;';

  const life = new AbortController();
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    visit?.removeEventListener('abort', dispose);
    options.signal?.removeEventListener('abort', dispose);
    try {
      life.abort();
    } finally {
      element.remove();
    }
  };
  try {
    bindPointerControl(element, {
      input: ctx.service('input'),
      actions: [actionOf(input)],
      signal: life.signal,
      leave: 'release',
      // Feedback only on change: nothing redraws while the contact rests.
      onContact: down => {
        if (down) element.dataset.down = '';
        else delete element.dataset.down;
        element.style.background = down ? DOWN : UP;
      },
    });
    overlay.append(element);
  } catch (error) {
    dispose();
    throw error;
  }
  visit?.addEventListener('abort', dispose, {once: true});
  options.signal?.addEventListener('abort', dispose, {once: true});
  return {element, dispose};
}
