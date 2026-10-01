/** Optional HUD presentation; applications choose inline or disclosed detail independently of device and quality. */
import { defineKit, type KitDefinition, type SceneContext } from '../../author';

export interface HudState { lines: Record<string, string>; banner: string | null; prompt: string | null }
export type HudPresentation = { mode: 'inline' } | { mode: 'disclose'; label: string; closeLabel: string };
export interface Hud {
  /** Existing two-argument lines remain essential and visible. Labels are resolved through ctx.text. */
  line(id: string, text: string | null, options?: { importance: 'essential' | 'detail' }): void;
  banner(text: string | null): void;
  prompt(text: string | null): void;
  /** Explicit author choice; never inferred from device, viewport or rendering quality. */
  present(options: HudPresentation): void;
  /** Opt-in creator selection from scene viewport CSS pixels. null detaches, retaining current presentation. */
  layout(options: { select(size: Readonly<{ width: number; height: number }>): HudPresentation } | null): void;
  /** Opens the read-only detail sheet. Closing and Back use the existing visit-owned layer. */
  details(open: boolean): void;
  read(): HudState;
}

const huds = new WeakMap<object, Hud>();
type Sheet = ReturnType<NonNullable<SceneContext['view']['openReadingSheet']>>;

function build(view: SceneContext['view']): Hud {
  const overlay = view.overlay;
  const state: HudState = { lines: Object.create(null), banner: null, prompt: null };
  const importance = new Map<string, 'essential' | 'detail'>();
  let presentation: HudPresentation = { mode: 'inline' };
  let stopLayout: (() => void) | undefined;
  let layoutVersion = 0;
  const detach = () => { ++layoutVersion; const stop = stopLayout; stopLayout = undefined; stop?.(); };
  let lines: HTMLElement | null = null, banner: HTMLElement | null = null, prompt: HTMLElement | null = null;
  let trigger: HTMLButtonElement | null = null, header: HTMLElement | null = null;
  let inlineLines = '', inlineTrigger = '';
  let current: { handle: Sheet; element: HTMLElement; content: HTMLElement; title: HTMLElement; scroll: HTMLElement; close: HTMLButtonElement } | null = null;
  const details = () => Object.entries(state.lines).filter(([id]) => importance.get(id) === 'detail');
  const closeSheet = () => { const old = current; current = null; old?.handle.close(); trigger?.setAttribute('aria-expanded', 'false'); };
  const rows = (host: HTMLElement, values: [string, string][]) => {
    host.replaceChildren(...values.map(([id, value]) => {
      const el = host.ownerDocument.createElement('div'); el.dataset.hud = id; el.textContent = value; return el;
    }));
  };
  function showDetails(open: boolean): void {
    if (!open) { closeSheet(); return; }
    if (current || presentation.mode !== 'disclose' || !details().length || !overlay || !view.openReadingSheet) return;
    const doc = overlay.ownerDocument, element = doc.createElement('section');
    element.className = 'hud-details-sheet'; element.setAttribute('role', 'dialog');
    element.setAttribute('aria-label', presentation.label);
    element.style.cssText = 'position:absolute;inset:max(16px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) max(16px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left));max-width:640px;margin-inline:auto;display:flex;flex-direction:column;gap:8px;padding:16px;box-sizing:border-box;min-height:0;pointer-events:auto;background:var(--engine-ink);color:var(--engine-text);border:2px solid var(--engine-line);border-radius:var(--engine-radius-md);font:var(--engine-text-lg) var(--engine-font);overflow:hidden;';
    const title = doc.createElement('h2'), content = doc.createElement('div'), scroll = doc.createElement('div'), close = doc.createElement('button');
    title.textContent = presentation.label; title.style.cssText = 'margin:0;font:inherit;font-weight:700;overflow-wrap:anywhere;';
    content.className = 'hud-detail-content'; content.style.cssText = 'overflow-wrap:anywhere;';
    scroll.className = 'hud-details-scroll'; scroll.tabIndex = 0; scroll.setAttribute('data-ui-scroll', '');
    scroll.setAttribute('role', 'region'); scroll.setAttribute('aria-label', presentation.label);
    scroll.style.cssText = 'overflow-y:auto;overflow-x:hidden;min-height:0;flex:1;';
    close.className = 'hud-details-close'; close.type = 'button'; close.textContent = presentation.closeLabel;
    close.style.cssText = 'min-width:48px;min-height:48px;flex-shrink:0;font:inherit;white-space:normal;overflow-wrap:anywhere;';
    rows(content, details()); scroll.append(title, content); element.append(scroll, close);
    // Start in the reading region so keyboard/controller paging works immediately.
    const handle = view.openReadingSheet({ id: 'hud-details', element, initialFocus: () => scroll,
      returnFocus: () => trigger && !trigger.hidden && trigger.isConnected ? trigger : overlay.parentElement });
    const active = { handle, element, content, title, scroll, close }; current = active;
    trigger?.setAttribute('aria-expanded', 'true');
    const finished = () => {
      if (current === active) { current = null; trigger?.setAttribute('aria-expanded', 'false'); }
      element.remove();
    };
    close.addEventListener('click', () => handle.close(), { signal: handle.signal });
    handle.signal.addEventListener('abort', finished, { once: true });
    if (handle.signal.aborted) finished();
    // The bridge reports entry failures. Consume rejection so a late failure cannot become unhandled.
    void handle.ready.catch(finished);
  }
  if (overlay) {
    const doc = overlay.ownerDocument;
    const box = (cls: string, css: string) => { const el = doc.createElement('div'); el.className = cls; el.style.cssText = css; overlay.append(el); return el; };
    const text = 'color:var(--engine-text);font:600 var(--engine-text-xl) var(--engine-font);text-shadow:0 1px 3px rgb(0 0 0 / 60%);pointer-events:none;';
    lines = box('hud-lines', `position:absolute;left:16px;top:56px;display:grid;gap:4px;${text}`);
    banner = box('hud-banner', `position:absolute;left:50%;top:40%;transform:translate(-50%,-50%);max-width:calc(100% - 32px);text-align:center;${text}font-size:var(--engine-text-3xl);`);
    banner.setAttribute('role', 'status'); banner.setAttribute('aria-live', 'polite');
    prompt = box('hud-prompt', `position:absolute;left:50%;bottom:24px;transform:translateX(-50%);max-width:calc(100% - 32px);text-align:center;${text}`);
    trigger = doc.createElement('button'); trigger.className = 'hud-details-trigger'; trigger.type = 'button'; trigger.hidden = true;
    trigger.setAttribute('aria-haspopup', 'dialog'); trigger.setAttribute('aria-expanded', 'false');
    trigger.style.cssText = 'position:absolute;right:max(16px,env(safe-area-inset-right));top:max(16px,env(safe-area-inset-top));min-width:48px;min-height:48px;max-width:calc(100% - 32px);pointer-events:auto;font:var(--engine-text-lg) var(--engine-font);white-space:normal;overflow-wrap:anywhere;';
    trigger.addEventListener('click', () => showDetails(true));
    inlineLines = lines.style.cssText; inlineTrigger = trigger.style.cssText;
    header = box('hud-header', 'display:contents;'); header.append(lines, trigger);
  }
  const renderLines = () => {
    const entries = Object.entries(state.lines), secondary = details();
    if (header && lines && trigger) {
      const disclosed = presentation.mode === 'disclose' && secondary.length > 0;
      header.style.cssText = disclosed
        ? 'position:absolute;left:max(16px,env(safe-area-inset-left));right:max(16px,env(safe-area-inset-right));top:max(16px,env(safe-area-inset-top));display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:start;gap:8px;'
        : 'display:contents;';
      lines.style.cssText = inlineLines + (disclosed ? 'position:static;min-width:0;overflow-wrap:anywhere;' : '');
      trigger.style.cssText = inlineTrigger + (disclosed ? 'position:static;max-width:min(40vw,240px);' : '');
    }
    if (lines) rows(lines, presentation.mode === 'inline' ? entries : entries.filter(([id]) => importance.get(id) !== 'detail'));
    if (trigger) { trigger.hidden = presentation.mode === 'inline' || !secondary.length; if (presentation.mode === 'disclose') trigger.textContent = presentation.label; }
    if (!secondary.length || presentation.mode === 'inline') closeSheet();
    if (current && presentation.mode === 'disclose') {
      rows(current.content, secondary); current.title.textContent = presentation.label;
      current.element.setAttribute('aria-label', presentation.label); current.scroll.setAttribute('aria-label', presentation.label); current.close.textContent = presentation.closeLabel;
    }
  };
  function applyPresentation(options: HudPresentation): void {
    if (!options || (options.mode !== 'inline' && options.mode !== 'disclose') ||
      (options.mode === 'disclose' && (typeof options.label !== 'string' || typeof options.closeLabel !== 'string'))) {
      throw new TypeError('HUD presentation requires inline or disclose with string labels');
    }
    if (presentation.mode === options.mode && (options.mode === 'inline' || presentation.mode === 'disclose' && options.label === presentation.label && options.closeLabel === presentation.closeLabel)) return;
    presentation = { ...options }; renderLines();
  }
  return {
    line(id, text, options) {
      const next = options?.importance ?? 'essential';
      if ((state.lines[id] ?? null) === text && (importance.get(id) ?? 'essential') === next) return;
      if (text === null) { delete state.lines[id]; importance.delete(id); } else { state.lines[id] = text; importance.set(id, next); }
      renderLines();
    },
    banner(text) { if (state.banner === text) return; state.banner = text; if (banner) { banner.textContent = text ?? ''; banner.hidden = text === null; } },
    prompt(text) { if (state.prompt === text) return; state.prompt = text; if (prompt) { prompt.textContent = text ?? ''; prompt.hidden = text === null; } },
    present(options) { detach(); applyPresentation(options); },
    layout(options) {
      detach();
      if (!options || !view.observeSize) return;
      const version = layoutVersion;
      const select = options.select;
      const stop = view.observeSize(size => {
        if (version !== layoutVersion) return;
        const next = select(size);
        // A selector may explicitly replace its own registration or call present().
        if (version === layoutVersion) applyPresentation(next);
      });
      if (version === layoutVersion) stopLayout = stop;
      else stop();
    },
    details: showDetails,
    read: () => ({ lines: { ...state.lines }, banner: state.banner, prompt: state.prompt }),
  };
}

/** The HUD of this scene visit (one per view overlay; per context in tests). */
export function hud(ctx: SceneContext): Hud {
  const key: object = ctx.view.overlay ?? ctx.world;
  let h = huds.get(key);
  if (!h) { h = build(ctx.view); huds.set(key, h); }
  return h;
}

/** The kit: nothing to register; listing it documents that the game uses it. */
export function ui(): KitDefinition { return defineKit({ id: 'ui' }); }
