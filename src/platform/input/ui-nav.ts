import {Repeater, type Direction} from './frame-actions';

/** Spatial DOM focus navigation for overlays, driven by the d-pad, the stick and the arrow keys.
 * The first move is immediate; holding repeats after 380 ms, then every 120 ms. */
export type Rect = {left: number; top: number; width: number; height: number};
export const NAV_REPEAT_DELAY = 380,
  NAV_REPEAT_INTERVAL = 120;
export const FOCUSABLE =
  'button,[href],input,select,textarea,summary,[tabindex]:not([tabindex="-1"]),[role="button"],[role="slider"]';
/** Controls whose arrows already mean something: text fields, ranges, selects and roving groups. */
export const ARROW_OWNERS =
  'input,textarea,select,[contenteditable="true"],[role="slider"],[role="listbox"],[role="menu"],[role="menubar"],[role="tablist"],[role="radiogroup"],[role="grid"],[role="tree"],[role="toolbar"],[data-nav-native]';
const VECTORS: Record<Direction, [number, number]> = {up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0]};

/** Nearest candidate whose centre lies ahead in `direction`; aligned items win (primary + 2 × offset). */
export function pickDirection(from: Rect, candidates: readonly Rect[], direction: Direction): number {
  const [vx, vy] = VECTORS[direction],
    cx = from.left + from.width / 2,
    cy = from.top + from.height / 2;
  let best = -1,
    bestScore = Infinity;
  candidates.forEach((r, i) => {
    const dx = r.left + r.width / 2 - cx,
      dy = r.top + r.height / 2 - cy,
      primary = dx * vx + dy * vy,
      offset = Math.abs(dx * vy - dy * vx);
    if (primary <= 1) return;
    const score = primary + 2 * offset;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}
type El = HTMLElement;
const visible = (e: El) =>
  !(e as HTMLButtonElement).disabled &&
  !e.closest('[inert],[hidden],[aria-hidden="true"]') &&
  e.getClientRects().length > 0;
export const focusables = (scope: Element) => Array.from(scope.querySelectorAll<El>(FOCUSABLE)).filter(visible);

export type UiNavOptions = {doc?: Document; scope: () => Element | null; delay?: number; interval?: number};
export class UiNav {
  private repeat: Repeater;
  private doc: Document;
  private remembered = new WeakMap<Element, El>();
  constructor(private options: UiNavOptions) {
    this.doc = options.doc ?? globalThis.document;
    this.repeat = new Repeater(options.delay ?? NAV_REPEAT_DELAY, options.interval ?? NAV_REPEAT_INTERVAL);
  }
  /** One spatial step. With a keyboard `target`, controls that own their arrows keep them. */
  move(direction: Direction, target?: EventTarget | null): boolean {
    const scope = this.options.scope();
    if (!scope) return false;
    if (target && (target as Element).closest?.(ARROW_OWNERS)) return false;
    const items = focusables(scope);
    if (!items.length) return false;
    const active = this.doc.activeElement as El | null,
      current = active && scope.contains(active) && items.includes(active) ? active : null;
    if (!current) {
      this.focus(
        scope,
        this.remembered.get(scope) && items.includes(this.remembered.get(scope)!)
          ? this.remembered.get(scope)!
          : items[0]! /* items is non-empty */,
      );
      return true;
    }
    const range =
      current.tagName === 'INPUT' && (current as HTMLInputElement).type === 'range'
        ? (current as HTMLInputElement)
        : null;
    if (!target && range && (direction === 'left' || direction === 'right')) {
      if (direction === 'right') range.stepUp();
      else range.stepDown();
      current.dispatchEvent(new Event('input', {bubbles: true}));
      current.dispatchEvent(new Event('change', {bubbles: true}));
      return true;
    }
    const override = current.dataset[`nav${direction.charAt(0).toUpperCase()}${direction.slice(1)}`],
      forced = override ? scope.querySelector<El>(override) : null;
    const others = items.filter(e => e !== current),
      next =
        forced && visible(forced)
          ? forced
          : others[
              pickDirection(
                current.getBoundingClientRect(),
                others.map(e => e.getBoundingClientRect()),
                direction,
              )
            ];
    if (next) this.focus(scope, next);
    return true;
  }
  /** Per-frame held direction from the pad; returns the number of moves made. */
  step(direction: Direction | null, now: number) {
    const r = this.repeat.update(direction, now),
      count = (r.first ? 1 : 0) + r.repeats;
    let moved = 0;
    for (let i = 0; i < count; i++) if (this.move(direction!)) moved++;
    return moved;
  }
  /** Confirm: click the focused control in scope. */
  activate() {
    const scope = this.options.scope(),
      active = this.doc.activeElement as El | null;
    if (!scope || !active || !scope.contains(active) || active === scope) return false;
    active.click();
    return true;
  }
  reset() {
    this.repeat.reset();
  }
  private focus(scope: Element, el: El) {
    this.remembered.set(scope, el);
    el.focus({preventScroll: false});
    el.scrollIntoView?.({block: 'nearest'});
  }
}

/** Traps Tab inside `scope`, focuses its first (or `initial`) control, and on release restores
 * focus to the opener, or to `fallback` when the opener is gone. Native modal dialogs already trap. */
export function trapFocus(
  scope: El,
  options: {doc?: Document; initial?: El | null; fallback?: () => El | null; signal?: AbortSignal} = {},
) {
  const doc = options.doc ?? globalThis.document,
    opener = doc.activeElement as El | null,
    abort = new AbortController();
  const first = options.initial ?? focusables(scope)[0] ?? scope;
  first.focus({preventScroll: true});
  scope.addEventListener(
    'keydown',
    e => {
      if (e.key !== 'Tab' || e.defaultPrevented) return;
      const items = focusables(scope);
      if (!items.length) {
        e.preventDefault();
        return;
      }
      const i = items.indexOf(doc.activeElement as El),
        next = e.shiftKey ? (i <= 0 ? items.at(-1)! : null) : i === items.length - 1 || i < 0 ? items[0] : null;
      if (next) {
        e.preventDefault();
        next.focus();
      }
    },
    {signal: abort.signal},
  );
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    abort.abort();
    const back = opener?.isConnected && opener !== doc.body ? opener : options.fallback?.();
    back?.focus({preventScroll: true});
  };
  options.signal?.addEventListener('abort', release, {once: true});
  return release;
}
