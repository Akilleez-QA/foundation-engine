/**
 * kits/learn/ui: the lesson's controls over the view: a progress line, the objectives card, a control bar (Back,
 * Show again, Hint, I have a question, Pause, Next) and the finished card. Real buttons (keyboard, pad focus and
 * screen readers reach them; 48 px touch targets). The DOM changes only when the view it shows changes.
 *
 * Layout seam: the control bar wraps onto more rows on narrow screens and the progress line takes the top-left
 * corner, so on phones the lesson's own content (board, caption line, slider, quiz) must stay clear of them. One
 * ResizeObserver, owned by the controls, marks the layout dirty when the bar, the progress line, the overlay or an
 * arranged element changes size; `layout()` (called once per frame by the lesson) then re-measures and publishes on
 * the overlay:
 *   - `--learn-controls-reserve`: the space the bar takes from the bottom (bar offset + height + gap). Content uses
 *     `aboveControls(min)`, which keeps its authored inset while the bar fits on one row.
 *   - `--learn-top-clear` / `--learn-top-side`: set only when a centred top line (`topLine()`, at most 640 px wide
 *     with 80 px sides) would run into the progress line; the line then sits below it with 16 px gutters.
 * The objectives/finished cards and a centred panel registered with `arrange({ line, panel, floor })` (the quiz) keep
 * their authored position unless they would cover the progress or top line, reach the bar, or (cards only) cover the
 * board's caption (`floor`); then they start below the top content and scroll within the space that is left.
 * Wherever there is space (desktop, and any one-row bar for the bottom insets) nothing moves. The observer and the
 * properties retire with the controls.
 */
import { showEl } from '../concept-explorer/ui';

export type LessonCommand = 'next' | 'back' | 'again' | 'hint' | 'question' | 'pause';
export interface ControlsView {
  progress: string;
  objectives: { text: string; met: boolean }[] | null;
  objectivesTitle: string;
  can: Record<LessonCommand, boolean>;
  paused: boolean;
  labels: Record<LessonCommand | 'play' | 'finished' | 'controls', string>;
  finished: boolean;
}
/** Lesson content the controls keep clear: a top line, a centred panel (the quiz), and the board's caption (cards stay above it). */
export interface Arranged { line?: HTMLElement | null; panel?: HTMLElement | null; floor?: HTMLElement | null }
export interface Controls { set(v: ControlsView): void; onCommand(fn: (c: LessonCommand) => void): void; arrange(o: Arranged): void; /** Re-measure if anything changed size since the last call; call once per frame. */ layout(): void; destroy(): void }

/** The overlay CSS property holding the space the control bar takes from the bottom of the overlay. */
export const CONTROLS_RESERVE = '--learn-controls-reserve';
const TOP_CLEAR = '--learn-top-clear', TOP_SIDE = '--learn-top-side';
/** The centred top line: its widest content box, side margins, and the most horizontal chrome it adds (padding, border). */
const TOP = { max: 640, side: 160, chrome: 30, y: 56, gutter: 16 };
const BAR_BOTTOM = 12, BAR_GAP = 8;
/** A bottom inset that keeps content `min` px from the bottom, or above the control bar when the bar is taller. */
export const aboveControls = (min: number): string => `max(${min}px, var(${CONTROLS_RESERVE}, 0px))`;
/** Position and width of a centred line at the top of the lesson; it drops below the progress line only if they collide. */
export const topLine = (): string => `top:max(${TOP.y}px, var(${TOP_CLEAR}, 0px));left:50%;transform:translateX(-50%);width:min(${TOP.max}px,calc(100% - var(${TOP_SIDE}, ${TOP.side}px)));`;

const card = 'background:rgb(10 16 22 / 82%);color:var(--engine-text);border-radius:12px;padding:10px 14px;font:600 var(--engine-text-lg) var(--engine-font);';
const btn = 'min-height:48px;min-width:48px;padding:8px 14px;border-radius:10px;border:2px solid rgb(255 255 255 / 25%);background:rgb(255 255 255 / 10%);color:var(--engine-text);font:600 var(--engine-text-lg) var(--engine-font);cursor:pointer;';

export function createControls(overlay: HTMLElement): Controls {
  const doc = overlay.ownerDocument;
  const progress = doc.createElement('p'); progress.style.cssText = `position:absolute;left:16px;top:56px;margin:0;${card}padding:4px 10px;font-size:var(--engine-text-md);`;
  const objectives = doc.createElement('section'); objectives.style.cssText = `position:absolute;left:50%;top:50%;transform:translate(-50%,-60%);width:min(560px,calc(100% - 32px));${card}`;
  const finished = doc.createElement('section'); finished.setAttribute('role', 'status'); finished.style.cssText = objectives.style.cssText;
  const bar = doc.createElement('nav');
  bar.style.cssText = `position:absolute;left:8px;right:8px;bottom:${BAR_BOTTOM}px;display:flex;flex-wrap:wrap;justify-content:center;gap:8px;pointer-events:auto;`;
  const order: LessonCommand[] = ['back', 'again', 'hint', 'question', 'pause', 'next'];
  const buttons = new Map<LessonCommand, HTMLButtonElement>();
  let fn: ((c: LessonCommand) => void) | null = null;
  for (const c of order) {
    const b = doc.createElement('button'); b.type = 'button'; b.dataset.command = c; b.style.cssText = btn + (c === 'next' ? 'background:#ffd166;color:#10151c;border-color:#ffd166;' : '');
    b.addEventListener('click', () => fn?.(c));
    buttons.set(c, b); bar.append(b);
  }
  overlay.append(progress, objectives, finished, bar);
  let last = '', retired = false, reserve = '', top = '';
  type Fit = { el: HTMLElement; top: string; transform: string; pointer: string; tab: string | null; fitted: boolean };
  const fit = (el: HTMLElement): Fit => ({ el, top: el.style.top, transform: el.style.transform, pointer: el.style.pointerEvents ?? '', tab: el.getAttribute('tabindex'), fitted: false });
  let line: HTMLElement | null = null, floorEl: HTMLElement | null = null, quiz: Fit | null = null;
  const own = [fit(objectives), fit(finished)];
  // Size changes only mark the layout dirty; `layout()`, called from the lesson's frame system, measures once. Never
  // measuring inside the observer's delivery matters: the measurement writes the fitted panel's max-height, and
  // writing an observed element's size during delivery makes Chromium report "ResizeObserver loop completed with
  // undelivered notifications". The refit is idempotent, so the frame after a fit observes the same sizes and settles.
  let dirty = true, shownKey = '';
  const schedule = () => { dirty = true; };
  const sizes = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
  const unfit = (f: Fit | null) => {
    if (!f?.fitted) return;
    f.fitted = false;
    Object.assign(f.el.style, { top: f.top, transform: f.transform, maxHeight: '', overflowY: '', pointerEvents: f.pointer });
    if (f.tab === null) f.el.removeAttribute('tabindex'); else f.el.setAttribute('tabindex', f.tab);
  };
  const shown = (el: HTMLElement | null) => !!el && el.getClientRects().length > 0;
  /** Keep a centred panel where it was authored unless it would cover the top content or reach the floor. */
  const place = (f: Fit, o: DOMRect, ceiling: number, floor: number) => {
    unfit(f);   // measure the panel where it was authored
    if (!shown(f.el)) return;
    const r = f.el.getBoundingClientRect(), h = Math.max(r.height, f.el.scrollHeight || 0), at = r.top - o.top;
    if (at >= ceiling && at + h <= floor) return;
    const y = Math.max(ceiling, Math.min(at, floor - h));
    const cs = typeof getComputedStyle === 'function' ? getComputedStyle(f.el) : null;   // max-height excludes padding and border
    const chrome = cs && cs.boxSizing !== 'border-box' ? ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth'].reduce((n, k) => n + (parseFloat(cs[k as 'paddingTop']) || 0), 0) : 0;
    f.fitted = true;
    // A fitted panel scrolls: it must receive wheel/touch (the scene overlay is pointer-events:none) and keyboard focus.
    Object.assign(f.el.style, { top: `${y}px`, transform: 'translateX(-50%)', maxHeight: `${Math.max(0, floor - y - chrome)}px`, overflowY: 'auto', pointerEvents: 'auto' });
    if (f.tab === null) f.el.setAttribute('tabindex', '0');
  };
  const measure = () => {
    if (retired) return;
    const o = overlay.getBoundingClientRect(), barHeight = Math.ceil(bar.getBoundingClientRect().height) + BAR_BOTTOM + BAR_GAP;
    const px = `${barHeight}px`;
    if (px !== reserve) { reserve = px; overlay.style.setProperty(CONTROLS_RESERVE, px); }
    const p = progress.getBoundingClientRect();
    const lineLeft = (o.width - Math.min(TOP.max, o.width - TOP.side) - TOP.chrome) / 2;
    const clash = p.width > 0 && p.right - o.left + BAR_GAP > lineLeft;
    const next = clash ? `${Math.ceil(p.bottom - o.top) + BAR_GAP}px` : '0px';
    if (next !== top) {
      top = next;
      overlay.style.setProperty(TOP_CLEAR, next); overlay.style.setProperty(TOP_SIDE, `${clash ? 2 * TOP.gutter + TOP.chrome : TOP.side}px`);
    }
    const below = (el: HTMLElement | null) => shown(el) ? Math.ceil(el!.getBoundingClientRect().bottom - o.top) + BAR_GAP : 0;
    const ceiling = Math.max(below(progress), below(line));
    const barFloor = o.height - barHeight;
    const floor = shown(floorEl) ? Math.min(barFloor, Math.floor(floorEl!.getBoundingClientRect().top - o.top) - BAR_GAP) : barFloor;
    for (const f of own) place(f, o, ceiling, floor);
    if (quiz) place(quiz, o, ceiling, barFloor);
  };
  const watch = (el: HTMLElement | null, on: boolean) => { if (el) { if (on) sizes?.observe(el); else sizes?.unobserve(el); } };
  for (const el of [bar, progress, overlay, objectives, finished]) watch(el, true);
  return {
    onCommand(f) { if (!retired) fn = f; },
    layout() {
      if (retired) return;
      // Showing, hiding or re-texting arranged content is caught here, in the same frame, without reading layout;
      // size changes after that arrive through the observer.
      const k = [...own.map(f => f.el), quiz?.el, line].map(el => el ? `${el.style.display}|${el.textContent?.length ?? 0}` : '-').join(',');
      if (k !== shownKey) { shownKey = k; dirty = true; }
      if (!dirty) return;
      dirty = false; measure();
    },
    arrange(o) {
      if (retired) return;
      if (o.line !== undefined && o.line !== line) { watch(line, false); line = o.line; watch(line, true); dirty = true; }
      if (o.floor !== undefined && o.floor !== floorEl) { watch(floorEl, false); floorEl = o.floor; watch(floorEl, true); dirty = true; }
      if (o.panel !== undefined && o.panel !== quiz?.el) {
        unfit(quiz); watch(quiz?.el ?? null, false); quiz = o.panel ? fit(o.panel) : null; watch(o.panel, true); dirty = true;
      }
    },
    set(v) {
      if (retired) return;
      const key = JSON.stringify(v);
      if (key === last) return; last = key;
      progress.textContent = v.progress; bar.setAttribute('aria-label', v.labels.controls);
      showEl(objectives, !!v.objectives);
      if (v.objectives) {
        const h = doc.createElement('h2'); h.style.cssText = 'margin:0 0 6px;font-size:var(--engine-text-xl);'; h.textContent = v.objectivesTitle;
        const ul = doc.createElement('ul'); ul.style.cssText = 'margin:0;padding-left:1.2em;display:grid;gap:4px;';
        for (const o of v.objectives) { const li = doc.createElement('li'); li.textContent = `${o.met ? '✓ ' : ''}${o.text}`; ul.append(li); }
        objectives.replaceChildren(h, ul);
      }
      showEl(finished, v.finished); finished.textContent = v.finished ? v.labels.finished : '';
      for (const [c, b] of buttons) {
        b.textContent = c === 'pause' && v.paused ? v.labels.play : v.labels[c];
        b.disabled = !v.can[c]; b.style.opacity = b.disabled ? '0.45' : '1';
        showEl(b, !((c === 'question' || c === 'hint') && !v.can[c]));
      }
    },
    destroy() {
      if (retired) return;
      for (const f of [...own, quiz]) unfit(f);
      retired = true; fn = null; sizes?.disconnect();
      line = null; floorEl = null; quiz = null;
      if (reserve) overlay.style.setProperty(CONTROLS_RESERVE, '');
      if (top) for (const k of [TOP_CLEAR, TOP_SIDE]) overlay.style.setProperty(k, '');
      for (const el of [progress, objectives, finished, bar]) el.remove();
    },
  };
}
