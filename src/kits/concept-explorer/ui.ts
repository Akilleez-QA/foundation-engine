/**
 * kits/concept-explorer/ui: small DOM controls over a scene: a label pin, a parameter slider, layer toggles and a
 * mini quiz panel. Each writes the DOM only when its state changes; controls are real form elements, reachable by
 * keyboard and screen readers, with large touch targets.
 */
/** Show or hide an element whose style sets `display` (the `hidden` attribute alone would lose to it). */
export const showEl = (el: HTMLElement, on: boolean) => {
  if (el.dataset.display === undefined) el.dataset.display = el.style.display === 'none' ? '' : el.style.display;
  el.hidden = !on; el.style.display = on ? el.dataset.display : 'none';
};
const card = 'background:rgb(10 16 22 / 82%);color:var(--engine-text);border-radius:12px;padding:10px 14px;font:600 var(--engine-text-lg) var(--engine-font);pointer-events:auto;';
const button = 'min-height:44px;min-width:44px;padding:8px 14px;border-radius:10px;border:2px solid rgb(255 255 255 / 25%);background:rgb(255 255 255 / 10%);color:inherit;font:inherit;cursor:pointer;';

export interface Pin { set(label: { text: string; x: number; y: number } | null): void }
export function createPin(overlay: HTMLElement): Pin {
  const el = overlay.ownerDocument.createElement('div');
  el.className = 'explorer-pin'; el.setAttribute('role', 'status');
  el.style.cssText = `position:absolute;transform:translate(-50%,-120%);${card}padding:4px 10px;pointer-events:none;`;
  overlay.append(el); showEl(el, false);
  let last = '';
  return { set(l) {
    const key = l ? `${l.text}|${l.x.toFixed(3)}|${l.y.toFixed(3)}` : '';
    if (key === last) return; last = key;
    showEl(el, !!l);
    if (l) { el.textContent = l.text; el.style.left = `${((l.x + 1) / 2) * 100}%`; el.style.top = `${((1 - l.y) / 2) * 100}%`; }
  } };
}

export interface Slider { readonly root: HTMLElement; readonly value: number; set(v: number): void; show(on: boolean): void; onInput(fn: (v: number) => void): void; destroy(): void }
export function createSlider(overlay: HTMLElement, o: { id: string; label: string; min: number; max: number; step: number; value: number; unit?: string }): Slider {
  const doc = overlay.ownerDocument, wrap = doc.createElement('label');
  wrap.className = 'explorer-slider';
  wrap.style.cssText = `position:absolute;left:50%;bottom:84px;transform:translateX(-50%);width:min(520px,calc(100% - 32px));display:grid;gap:6px;${card}`;
  const text = doc.createElement('span'), input = doc.createElement('input');
  input.type = 'range'; input.min = String(o.min); input.max = String(o.max); input.step = String(o.step); input.value = String(o.value);
  input.style.cssText = 'width:100%;height:32px;accent-color:#ffd166;';
  wrap.append(text, input); overlay.append(wrap);
  let retired = false;
  let value = o.value, fn: ((v: number) => void) | null = null;
  const show = () => { text.textContent = `${o.label}: ${Math.round(value)}${o.unit ?? ''}`; };
  show();
  const onInput = () => { if (retired) return; value = Number(input.value); show(); fn?.(value); };
  input.addEventListener('input', onInput);
  return {
    root: wrap,
    get value() { return value; },
    set(v) { if (retired || v === value) return; value = v; input.value = String(v); show(); },
    show(on) { if (!retired) showEl(wrap, on); },
    onInput(f) { if (!retired) fn = f; },
    destroy() { if (retired) return; retired = true; fn = null; input.removeEventListener('input', onInput); wrap.remove(); },
  };
}

export function createLayerToggles(overlay: HTMLElement, layers: { id: string; label: string; on: boolean }[], onChange: (id: string, on: boolean) => void): { show(on: boolean): void } {
  const doc = overlay.ownerDocument, box = doc.createElement('fieldset');
  box.style.cssText = `position:absolute;right:16px;top:56px;margin:0;display:grid;gap:4px;border:0;${card}`;
  for (const l of layers) {
    const lab = doc.createElement('label'), cb = doc.createElement('input');
    cb.type = 'checkbox'; cb.checked = l.on; cb.style.cssText = 'width:22px;height:22px;';
    cb.addEventListener('change', () => onChange(l.id, cb.checked));
    lab.style.cssText = 'display:flex;gap:8px;align-items:center;min-height:32px;';
    lab.append(cb, doc.createTextNode(l.label)); box.append(lab);
  }
  overlay.append(box);
  return { show(on) { showEl(box, on); } };
}

export interface QuizPanelView { prompt: string; options: { id: string; text: string }[]; hints: string[]; feedback: string | null; state: 'asking' | 'right' | 'revealed'; chosen: string | null; answer?: string; index: number; count: number }
export interface QuizPanel { readonly root: HTMLElement; set(v: QuizPanelView | null): void; onAnswer(fn: (id: string) => void): void; destroy(): void }
export function createQuizPanel(overlay: HTMLElement, o: { questionOf: (i: number, n: number) => string; hintLabel: string }): QuizPanel {
  const doc = overlay.ownerDocument, box = doc.createElement('section');
  box.className = 'explorer-quiz'; box.setAttribute('aria-live', 'polite');
  box.style.cssText = `position:absolute;left:50%;top:50%;transform:translate(-50%,-55%);width:min(560px,calc(100% - 32px));display:grid;gap:10px;${card}`;
  overlay.append(box); showEl(box, false);
  let retired = false;
  let last = '', fn: ((id: string) => void) | null = null;
  return {
    root: box,
    onAnswer(f) { if (!retired) fn = f; },
    destroy() { if (retired) return; retired = true; fn = null; box.replaceChildren(); box.remove(); },
    set(v) {
      if (retired) return;
      const key = JSON.stringify(v);
      if (key === last) return; last = key;
      showEl(box, !!v); box.replaceChildren();
      if (!v) return;
      const head = doc.createElement('p'); head.style.cssText = 'margin:0;opacity:.8;font-size:var(--engine-text-md);'; head.textContent = o.questionOf(v.index + 1, v.count);
      const q = doc.createElement('h2'); q.style.cssText = 'margin:0;font-size:var(--engine-text-2xl);'; q.textContent = v.prompt;
      box.append(head, q);
      v.options.forEach((opt, k) => {
        const b = doc.createElement('button'); b.type = 'button'; b.textContent = `${k + 1}. ${opt.text}`; b.dataset.option = opt.id;
        const mark = v.state !== 'asking' && opt.id === v.answer ? 'border-color:#7bd88f;' : opt.id === v.chosen ? 'border-color:#ffd166;' : '';
        b.style.cssText = `${button}text-align:left;${mark}`; b.disabled = v.state !== 'asking';
        b.addEventListener('click', () => fn?.(opt.id));
        box.append(b);
      });
      for (const h of v.hints) { const p = doc.createElement('p'); p.style.cssText = 'margin:0;color:#ffd166;'; p.textContent = `${o.hintLabel}: ${h}`; box.append(p); }
      if (v.feedback) { const p = doc.createElement('p'); p.style.cssText = 'margin:0;'; p.textContent = v.feedback; box.append(p); }
    },
  };
}
