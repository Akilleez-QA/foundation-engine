/**
 * platform/ui/layers.ts: the layer manager, the only owner of "what is on top of the screen" (ADR 0020; 
 * STD-RUN-20). It owns focus trapping and focus return, `inert`, Escape and the coverage signal the frame loop reads.
 *
 * Status: live since. `appLayers()` (platform/ui/runtime.ts) is the app's one manager: `showActivity` pushes
 * a `scene` layer and the frame loop reads coverage from it. The legacy overlays, the panel shell's focus guard and
 * the narration/music polls keep working until their migration steps.
 *
 * Kinds are ranked `scene < panel < sheet < modal < toast`. Each layer declares:
 *  - `cover` ('none' | 'scrim' | 'opaque'): what the frame loop sees for activities beneath it;
 *  - `modal` ('page' | 'scope' | false): 'page' makes everything else inert including the shell regions, 'scope'
 *    makes only the layers below inert and leaves the shell usable (panels today), false does neither;
 *  - narration, music, initial and return focus, and Escape behaviour.
 * Layers nest (a panel lives inside its scene's host), so the manager makes inert what sits beside the path to a
 * kept layer, never an ancestor of it. `showModal` is never used: the browser top layer would sit above toasts.
 *
 * Layer rules (STD-LAY-5, STD-LAY-7): platform imports only core, plus its own siblings. `LayerManager` implements
 * the kernel's `LayerPort` (core/activity/ports.ts) and the input dispatcher's `ActionLayers` view
 * (platform/input/actions.ts); the vocabulary (kinds, covers, coverage, close reasons) is core/activity's.
 */
import type {
  Coverage, LayerCloseReason, LayerCover, LayerHandle as PortLayerHandle, LayerKind, LayerPort, LayerRequest,
} from '../../core/activity/ports';
import type { ActionLayers } from '../input/actions';

export type { Coverage, LayerCover, LayerKind };
export const LAYER_KINDS: readonly LayerKind[] = ['scene', 'panel', 'sheet', 'modal', 'toast'];
export const LAYER_RANK: Readonly<Record<LayerKind, number>> = { scene: 0, panel: 1, sheet: 2, modal: 3, toast: 4 };
/** 'page': everything else (shell included) is inert. 'scope': layers below are inert; the shell stays usable. */
export type LayerModality = 'page' | 'scope' | false;
export type CloseReason = LayerCloseReason;

/** The platform's full request: core/activity's `LayerRequest` plus the element, modality, focus and sound. */
export interface LayerSpec extends LayerRequest {
  id: string;
  kind: LayerKind;
  element: HTMLElement;
  /** Activity run that owns the layer; the loop asks coverage() by this key. */
  owner?: string | undefined;
  /** What this layer does to the activities beneath it. 'none' = a stage window (VAB benches) or a toast. */
  cover?: LayerCover;
  modal?: LayerModality;
  narration?: string;
  music?: string;
  /**
   * A dormant layer is being prepared (ADR 0045, STD-RUN-15): it is inert itself, covers nothing, owns no input and
   * is excluded from narration and music until `handle.activate()`.
   */
  dormant?: boolean;
  /**
   * While this layer is live, the other children of `inertHost` are inert (the layer's element sits in it, or is about
   * to). A hosted minigame is modal to its card only: nothing else turns inert, and Escape and Tab stay as its
   * modality says (it replaces `modal-inert.ts`'s `inertHostChildren`). Children are read each time the
   * inert set is recomputed; each one gets back its own inert flag when the layer closes.
   */
  inertHost?: HTMLElement;
  initialFocus?: () => HTMLElement | null | undefined;
  returnFocus?: () => HTMLElement | null | undefined;
  /** Escape on this layer. Default: close('escape'). Return false to let Escape fall to the layer below. */
  onEscape?: () => void | boolean;
  onClose?: ((reason: CloseReason) => void) | undefined;
}
export interface LayerInfo {
  readonly id: string; readonly kind: LayerKind; readonly element: HTMLElement; readonly owner?: string | undefined;
  readonly cover: LayerCover; readonly modal: LayerModality; readonly narration?: string | undefined; readonly music?: string | undefined;
  readonly dormant: boolean;
}
export interface LayerHandle extends LayerInfo, PortLayerHandle {
  readonly signal: AbortSignal;
  readonly closed: boolean;
  close(reason?: CloseReason): void;
  set(patch: { narration?: string; music?: string; cover?: LayerCover }): void;
  /** Wake a dormant layer: it becomes live, may take focus and joins coverage, narration and input. */
  activate(): void;
}
export interface LayerChange { top: LayerInfo | null; reason: 'push' | 'close' | 'update' | 'activate' }

interface Entry extends LayerHandle {
  spec: LayerSpec; seq: number; opener: HTMLElement | null; abort: AbortController;
  cover: LayerCover; narration?: string | undefined; music?: string | undefined; dormant: boolean;
}

const FOCUSABLE = 'button,a,input,select,textarea,summary,[tabindex]';
/** inert is inherited: an element is unreachable when it or any ancestor is inert (a property check, so any DOM works). */
export function isInert(el: Element | null): boolean {
  for (let n: Element | null = el; n; n = n.parentElement) if ((n as HTMLElement).inert === true) return true;
  return false;
}
export function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(e =>
    !(e as HTMLButtonElement).disabled && e.tabIndex >= 0 && e.getClientRects().length > 0 && !isInert(e) &&
    !(e.tagName === 'A' && !e.hasAttribute('href')));
}
const focus = (el: HTMLElement | null | undefined) => el?.focus?.({ preventScroll: true });

export interface LayerManagerOptions {
  /** Shell regions (header, settings menu) made inert under a 'page' modal. */
  shell?: () => readonly HTMLElement[];
  /** Where a throwing change listener is reported (default console.error); the other listeners still run. */
  report?: (error: unknown) => void;
}

export class LayerManager implements LayerPort, ActionLayers {
  private entries: Entry[] = [];
  private seq = 0;
  private listeners = new Set<(c: LayerChange) => void>();
  /** Elements this manager made inert, with the value they had before. */
  private inerted = new Map<HTMLElement, boolean>();
  /** Re-entrancy guard: an Escape handled while another Escape is running is ignored (Escape closes once). */
  private escaping = false;
  private readonly opening = new Map<string, object>();

  constructor(private readonly doc: Document, private readonly opts: LayerManagerOptions = {}) {}

  /** Open one layer per id. A same-id open during replacement callbacks supersedes the outer
   * request. That outer call returns its own closed handle, without admitting or focusing it. */
  open(spec: LayerSpec): LayerHandle {
    const abort = new AbortController(), mgr = this;
    const entry: Entry = {
      spec, seq: this.seq++, abort, signal: abort.signal, opener: null,
      id: spec.id, kind: spec.kind, element: spec.element, owner: spec.owner,
      cover: spec.cover ?? (spec.kind === 'toast' || spec.kind === 'scene' ? 'none' : 'scrim'),
      modal: spec.modal ?? (spec.kind === 'modal' ? 'page' : spec.kind === 'panel' || spec.kind === 'sheet' ? 'scope' : false),
      narration: spec.narration, music: spec.music, dormant: spec.dormant === true,
      get closed() { return abort.signal.aborted; },
      close(reason: CloseReason = 'program') { mgr.closeEntry(entry, reason); },
      set(patch) {
        if (entry.closed) return;
        if (patch.narration !== undefined) entry.narration = patch.narration;
        if (patch.music !== undefined) entry.music = patch.music;
        if (patch.cover !== undefined) entry.cover = patch.cover;
        mgr.emit({ top: mgr.top(), reason: 'update' });
      },
      activate() {
        if (entry.closed || !entry.dormant) return;
        entry.dormant = false;
        mgr.applyInert();
        mgr.focusIfTop(entry);
        mgr.emit({ top: mgr.top(), reason: 'activate' });
      },
    };
    const identity = {};
    this.opening.set(entry.id, identity);
    try {
      this.entries.find(e => e.id === entry.id)?.close('replaced');
      if (this.opening.get(entry.id) !== identity) {
        // Never admitted: no close callback, focus restoration or stack event belongs to it.
        abort.abort();
        return entry;
      }
      // Preserve ordinary replacement's opener after the old close callback has run.
      const active = this.doc.activeElement as HTMLElement | null;
      entry.opener = active && active !== this.doc.body ? active : null;
      this.entries.push(entry);
      this.entries.sort((a, b) => LAYER_RANK[a.kind] - LAYER_RANK[b.kind] || a.seq - b.seq);
      this.applyInert();
      this.focusIfTop(entry);
      this.emit({ top: this.top(), reason: 'push' });
      return entry;
    } finally {
      if (this.opening.get(entry.id) === identity) this.opening.delete(entry.id);
    }
  }
  /** the activity host calls it `push` (`LayerPort.push`). The request must carry the platform's
   *  `LayerSpec` fields: the port's `LayerRequest` is the open, augmentable core of it. */
  push(spec: LayerSpec): LayerHandle { return this.open(spec); }

  /** Close a layer by id or handle. Returns false when no such open layer exists. */
  close(layer: string | LayerInfo, reason: CloseReason = 'program'): boolean {
    const entry = this.entries.find(e => (typeof layer === 'string' ? e.id === layer : e === layer));
    if (!entry) return false;
    entry.close(reason);
    return true;
  }

  /** The top interactive layer: toasts never own input and dormant layers are not yet live. */
  top(): LayerInfo | null {
    for (let i = this.entries.length - 1; i >= 0; i--) { const e = this.entries[i]!; if (this.live(e)) return e; } // i < entries.length
    return null;
  }
  /** Every open layer, bottom to top, dormant and toast included. */
  stack(): readonly LayerInfo[] { return this.entries; }
  /** Interactive layers from the top down, as the input dispatcher traverses them. */
  fromTop(): readonly LayerInfo[] { return this.entries.filter(e => this.live(e)).reverse(); }
  /** The index of the owner's highest layer, or -1 when it has none. */
  private lastIndexOfOwner(owner: string): number {
    for (let i = this.entries.length - 1; i >= 0; i--) if (this.entries[i]!.owner === owner) return i; // i < entries.length
    return -1;
  }

  /**
   * The coverage signal: how covered an owner's highest layer is. An owner with no layer counts as
   * 'top' only when nothing covers the page. Dormant layers cover nothing.
   */
  coverage(owner: string): Coverage {
    const index = this.lastIndexOfOwner(owner);
    let result: Coverage = 'top';
    for (let i = index + 1; i < this.entries.length; i++) {
      const e = this.entries[i]!; // i < entries.length
      if (e.dormant) continue;
      if (e.cover === 'opaque') return 'opaque';
      if (e.cover === 'scrim') result = 'scrim';
    }
    return result;
  }

  /**
   * True while a live `preview: true` layer (the Graphics screen, STD-SET-14) sits above the owner's highest layer, or
   * anywhere when the owner has none: the covered scene keeps drawing beneath it so changes are seen live.
   */
  previewing(owner: string): boolean {
    const index = this.lastIndexOfOwner(owner);
    for (let i = index + 1; i < this.entries.length; i++) { const e = this.entries[i]!; if (!e.dormant && e.spec.preview === true) return true; } // i < entries.length
    return false;
  }

  /** Narration context: the top live layer that declares a key (replaces narration.ts:23-40 and its poll). */
  narration(fallback: string): string {
    for (const e of this.fromTop()) if (e.narration) return e.narration;
    return fallback;
  }
  /** Music: the top live layer that declares a track (replaces audio.ts's 480 ms poll). */
  music(fallback?: string): string | undefined {
    for (const e of this.fromTop()) if (e.music) return e.music;
    return fallback;
  }

  /**
   * Escape. Traverses live layers from the top: the first layer that handles it consumes it, so Escape closes only the
   * top layer, once. A scene never closes on Escape. A modal layer that declines Escape still owns it. Returns true
   * when a layer consumed it.
   */
  escape(): boolean {
    if (this.escaping) return true;
    this.escaping = true;
    try {
      for (const layer of this.fromTop()) {
        const e = layer as Entry;
        if (e.kind === 'scene') return false;
        const handled = e.spec.onEscape ? e.spec.onEscape() : (e.close('escape'), true);
        if (handled !== false) return true;
        if (e.modal !== false) return true;
      }
      return false;
    } finally { this.escaping = false; }
  }

  /** Activate an eligible focused control in the highest live modal; false leaves native/custom handling intact. */
  activateFocus(): boolean {
    const top = this.fromTop().find(layer => layer.modal !== false);
    if (!top) return false;
    const target = this.doc.activeElement as HTMLElement | null;
    if (!target || !top.element.contains(target) || !focusables(top.element).includes(target)
      || target.closest('[aria-disabled="true"]')) return false;
    // Preserve native text/edit/select behavior; an arbitrary focusable container is not an action.
    if (!target.matches('button,a[href],summary,input[type="button"],input[type="submit"],input[type="reset"],input[type="checkbox"],input[type="radio"],[role="button"]')) return false;
    target.click();
    return true;
  }

  /** Page only an explicitly marked reading region; never infer a scroll target from the whole view. */
  scrollFocus(direction: -1 | 1): boolean {
    const top = this.fromTop().find(layer => layer.modal !== false);
    if (!top) return false;
    const active = this.doc.activeElement as HTMLElement | null;
    if (!active || !top.element.contains(active) || active.closest('input,textarea,select,[contenteditable="true"]')) return false;
    const region = active.closest('[data-ui-scroll]') as HTMLElement | null;
    if (!region || !top.element.contains(region) || !focusables(top.element).includes(region)
      || active.closest('[aria-disabled="true"]')) return false;
    const height = region.clientHeight, extent = region.scrollHeight - height;
    if (height > 0 && Number.isFinite(height) && Number.isFinite(extent) && extent > 0) {
      region.scrollTop = Math.max(0, Math.min(extent, region.scrollTop + direction * height * 0.8));
      // A scrollable region owns paging at its boundary too; avoid scrolling an ancestor instead.
      return true;
    }
    return false;
  }

  /** Tab cycling inside the top modal-ish layer (the focus trap). Returns true when handled. */
  cycleFocus(backwards: boolean): boolean {
    const top = this.top();
    if (!top || top.modal === false) return false;
    const list = focusables(top.element);
    if (!list.length) return true;
    const i = list.indexOf(this.doc.activeElement as HTMLElement);
    const next = backwards ? (i <= 0 ? list[list.length - 1] : list[i - 1]) : (i < 0 || i === list.length - 1 ? list[0] : list[i + 1]);
    focus(next);
    return true;
  }

  /**
   * The focus guard (replaces the original panel shell): focus that lands outside the top modal-ish layer is pulled
   * back into it. Call from a focusin listener; returns true when focus was moved.
   */
  containFocus(target: Element | null): boolean {
    const top = this.top();
    if (!top || top.modal === false || !target || top.element.contains(target)) return false;
    if (top.modal === 'scope' && this.opts.shell?.().some(s => s.contains(target))) return false;
    focus(focusables(top.element)[0] ?? top.element);
    return true;
  }

  /** Close every layer an owner opened (the activity host calls it on leave), top first. */
  closeOwned(owner: string, reason: CloseReason = 'owner-left'): void {
    for (const e of [...this.entries].reverse()) if (e.owner === owner) e.close(reason);
  }

  onChange(fn: (c: LayerChange) => void, signal?: AbortSignal): () => void {
    if (signal?.aborted) return () => {};
    this.listeners.add(fn);
    const off = () => { this.listeners.delete(fn); signal?.removeEventListener('abort', off); };
    signal?.addEventListener('abort', off, { once: true });
    return off;
  }

  private live(e: Entry) { return e.kind !== 'toast' && !e.dormant; }

  private focusIfTop(entry: Entry) {
    if (entry.dormant || entry.modal === false || this.top() !== entry) return;
    const requested = entry.spec.initialFocus?.();
    // Focus callbacks can synchronously close or replace their layer.
    if (entry.closed || entry.dormant || this.top() !== entry) return;
    focus(requested ?? focusables(entry.element)[0] ?? entry.element);
  }

  private closeEntry(entry: Entry, reason: CloseReason) {
    if (entry.abort.signal.aborted) return;
    const wasTop = this.top() === entry;
    entry.abort.abort();
    this.entries = this.entries.filter(e => e !== entry);
    this.applyInert();
    try { entry.spec.onClose?.(reason); } finally {
      // A layer that never takes focus (modal: false, e.g. a scene) never moves it on close either.
      if (wasTop && reason !== 'replaced' && entry.modal !== false) {
        const wanted = entry.spec.returnFocus?.() ?? entry.opener;
        const usable = wanted && wanted.isConnected && !isInert(wanted);
        focus(usable ? wanted : this.top()?.element);
      }
      this.emit({ top: this.top(), reason: 'close' });
    }
  }

  private applyInert() {
    const want = new Set<HTMLElement>();
    // A dormant layer is inert itself until it activates (STD-RUN-15).
    for (const e of this.entries) if (e.dormant) want.add(e.element);
    for (const e of this.entries) {
      const host = e.spec.inertHost;
      if (!host || e.dormant) continue;
      for (const child of Array.from(host.children) as HTMLElement[]) if (child !== e.element && !child.contains(e.element)) want.add(child);
    }
    let blocker = -1;
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i]!; // i < entries.length
      if (this.live(e) && e.modal !== false) { blocker = i; break; }
    }
    const blocking = this.entries[blocker];
    if (blocking) {
      const keep = this.entries.slice(blocker).filter(e => !e.dormant).map(e => e.element);
      // Inert what is beside the path to a kept layer, never an ancestor of one.
      const cover = (el: HTMLElement) => {
        if (keep.includes(el)) return;
        if (!keep.some(k => el.contains(k))) { want.add(el); return; }
        for (const child of Array.from(el.children) as HTMLElement[]) cover(child);
      };
      for (let i = 0; i < blocker; i++) cover(this.entries[i]!.element); // i < blocker < entries.length
      if (blocking.modal === 'page') for (const el of this.opts.shell?.() ?? []) want.add(el);
    }
    for (const [el, before] of this.inerted) if (!want.has(el)) { el.inert = before; this.inerted.delete(el); }
    for (const el of want) if (!this.inerted.has(el)) { this.inerted.set(el, el.inert === true); el.inert = true; }
  }

  private emit(c: LayerChange) {
    for (const fn of [...this.listeners]) {
      // A throwing listener is isolated (the event-bus rule): the others still hear the change.
      try { fn(c); } catch (err) { (this.opts.report ?? console.error)(err); }
    }
  }
}
