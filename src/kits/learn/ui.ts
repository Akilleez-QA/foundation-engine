/**
 * kits/learn/ui: the lesson's controls over the view: a progress line, the objectives card, a control bar (Back,
 * Show again, Hint, I have a question, Pause, Next) and the finished card. Real buttons (keyboard, pad focus and
 * screen readers reach them; 44 px touch targets). The DOM changes only when the view it shows changes.
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
export interface Controls { set(v: ControlsView): void; onCommand(fn: (c: LessonCommand) => void): void; destroy(): void }

const card = 'background:rgb(10 16 22 / 82%);color:var(--engine-text);border-radius:12px;padding:10px 14px;font:600 var(--engine-text-lg) var(--engine-font);';
const btn = 'min-height:44px;min-width:44px;padding:8px 14px;border-radius:10px;border:2px solid rgb(255 255 255 / 25%);background:rgb(255 255 255 / 10%);color:var(--engine-text);font:600 var(--engine-text-md) var(--engine-font);cursor:pointer;';

export function createControls(overlay: HTMLElement): Controls {
  const doc = overlay.ownerDocument;
  const progress = doc.createElement('p'); progress.style.cssText = `position:absolute;left:16px;top:56px;margin:0;${card}padding:4px 10px;font-size:var(--engine-text-md);`;
  const objectives = doc.createElement('section'); objectives.style.cssText = `position:absolute;left:50%;top:50%;transform:translate(-50%,-60%);width:min(560px,calc(100% - 32px));${card}`;
  const finished = doc.createElement('section'); finished.setAttribute('role', 'status'); finished.style.cssText = objectives.style.cssText;
  const bar = doc.createElement('nav');
  bar.style.cssText = 'position:absolute;left:8px;right:8px;bottom:12px;display:flex;flex-wrap:wrap;justify-content:center;gap:8px;pointer-events:auto;';
  const order: LessonCommand[] = ['back', 'again', 'hint', 'question', 'pause', 'next'];
  const buttons = new Map<LessonCommand, HTMLButtonElement>();
  let fn: ((c: LessonCommand) => void) | null = null;
  for (const c of order) {
    const b = doc.createElement('button'); b.type = 'button'; b.dataset.command = c; b.style.cssText = btn + (c === 'next' ? 'background:#ffd166;color:#10151c;border-color:#ffd166;' : '');
    b.addEventListener('click', () => fn?.(c));
    buttons.set(c, b); bar.append(b);
  }
  overlay.append(progress, objectives, finished, bar);
  let last = '';
  return {
    onCommand(f) { fn = f; },
    set(v) {
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
    destroy() { for (const el of [progress, objectives, finished, bar]) el.remove(); },
  };
}
