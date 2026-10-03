/**
 * platform/ui/labels.ts: the batched world-label layer (STANDARD chapter 11 row
 * "Per-frame allocation, layout thrash": screen labels are placed by one batched system, read then write).
 *
 * A scene registers its DOM labels once (`add`) and calls `scene(camera, viewport, arrange)` once per drawn frame:
 *
 *  1. project: every label with an `anchor` is projected into normalised device coordinates (pure maths, reused
 *     vectors, no DOM);
 *  2. arrange: the scene's own policy decides, per label, `hidden`, the style it wants and its `data-*` flags. Sizes
 *     come from a cache fed by a `ResizeObserver` (border box, CSS px). The cache is refreshed after `setText`, after
 *     the viewport width changes, and whenever the observer reports a new size. Only a label whose size is unknown in
 *     the state it is asked for is measured on the spot, once; that read comes before final placement writes, but temporary measurement state may write DOM;
 *  3. write: the decisions are written, each only when it differs from the value this layer wrote last.
 *
 * Warm cached placement batches reads before final writes. Cold/state-change measurements temporarily change
 * label state and can force layout; the idle layout budget is verified separately in the browser.
 * When the observer reports that a shown label changed size (a web font arrived, the text changed), the last frame is
 * placed again before the paint, from the same inputs.
 *
 * It writes nothing to `dataset` for tests: positions for verifiers come from the test API's probes (ADR 0026). The
 * `data` decisions are presentation flags the page's CSS or code reads (`data-pin`, `data-offscreen`, `data-slid`).
 *
 * The labels keep the style properties they already had (`left`/`top`, the CSS `transform` stays the stylesheet's),
 * so a converted scene looks and places the same; a new scene may write `transform` instead.
 */
import * as THREE from 'three';

export interface LabelSize { readonly width: number; readonly height: number }
export interface LabelViewport { readonly width: number; readonly height: number }
/** Inline style a label's policy may write. Unset properties are left alone. */
export interface LabelStyle { left?: string; top?: string; width?: string; height?: string; transform?: string; visibility?: string }

export interface WorldLabelSpec<K = unknown> {
  readonly element: HTMLElement;
  /** Writes this frame's world anchor into `out`; false means "no anchor this frame" (`projected` stays false). */
  anchor?(out: THREE.Vector3): boolean;
  /** Anything the scene's policy wants to carry with the label (an index, a kind). */
  readonly key?: K;
}

/** One label during a `scene()` call: its projection and the decisions the policy makes for it. */
export interface ScenedLabel<K = unknown> {
  readonly spec: WorldLabelSpec<K>;
  readonly element: HTMLElement;
  readonly key: K | undefined;
  /** True when `anchor` gave a point this frame; `world` and `ndc` are then valid. */
  projected: boolean;
  readonly world: THREE.Vector3;
  readonly ndc: THREE.Vector3;
  /** Decision: the `hidden` attribute (undefined leaves it as it is). */
  hidden?: boolean | undefined;
  /** Decision: inline style to write. */
  readonly style: LabelStyle;
  /** Decision: `data-*` flags to set (a string) or remove (null). */
  readonly data: Record<string, string | null>;
  /**
   * The label's border-box size in `state` (see `LabelLayerOptions.stateOf`), in fractional CSS px (round it where the
   * old code read `offsetWidth`); measured on the spot when unknown.
   */
  size(state?: string): LabelSize;
}

export type LabelArrange<K = unknown> = (labels: readonly ScenedLabel<K>[], viewport: LabelViewport) => void;

export interface LabelHandle {
  readonly element: HTMLElement;
  /** Changes the text (only when it differs) and forgets the cached size, so the next frame uses the new one. */
  setText(text: string): void;
  remove(): void;
}

export interface LabelLayer<K = unknown> {
  add(spec: WorldLabelSpec<K>): LabelHandle;
  scene(camera: THREE.Camera, viewport: LabelViewport, arrange: LabelArrange<K>): void;
  /** The label as the last `scene()` left it (its projection and decisions), or undefined. */
  last(element: HTMLElement): ScenedLabel<K> | undefined;
  dispose(): void;
}

/** The subset of `ResizeObserver` the layer uses (injectable for tests). */
export interface SizeObserver { observe(el: Element): void; unobserve(el: Element): void; disconnect(): void }
export interface SizeEntry { readonly target: Element; readonly width: number; readonly height: number }

export interface LabelLayerOptions {
  /** The size state a label is in right now (default ''); the cache keeps one size per state. */
  stateOf?(el: HTMLElement): string;
  /**
   * Puts a label into `state` for a one-off measurement and returns the restore. The default shows a hidden label
   * for the read. A scene with a second look (a pinned label with an arrow) supplies its own.
   */
  measureAs?(el: HTMLElement, state: string): () => void;
  /** Makes the size observer (default `ResizeObserver` reporting border boxes; none where it doesn't exist). */
  observer?(onSizes: (entries: readonly SizeEntry[]) => void): SizeObserver | null;
}

const showForMeasure = (el: HTMLElement): () => void => {
  if (!el.hidden) return () => {};
  el.hidden = false;
  return () => { el.hidden = true; };
};

function browserObserver(onSizes: (entries: readonly SizeEntry[]) => void): SizeObserver | null {
  if (typeof ResizeObserver === 'undefined') return null;
  return new ResizeObserver(entries => onSizes(entries.map(e => {
    const box = e.borderBoxSize?.[0];
    return { target: e.target, width: box ? box.inlineSize : e.contentRect.width, height: box ? box.blockSize : e.contentRect.height };
  })));
}

interface Entry<K> extends ScenedLabel<K> {
  sizes: Map<string, LabelSize>;
  written: LabelStyle;
  removed: boolean;
}

export function createLabelLayer<K = unknown>(options: LabelLayerOptions = {}): LabelLayer<K> {
  const stateOf = options.stateOf ?? (() => ''), measureAs = options.measureAs ?? ((el: HTMLElement) => showForMeasure(el));
  const entries: Entry<K>[] = [], byElement = new Map<HTMLElement, Entry<K>>();
  let lastWidth = NaN, lastFrame: { camera: THREE.Camera; viewport: LabelViewport; arrange: LabelArrange<K> } | null = null;
  let placing = false, disposed = false;

  const observer = (options.observer ?? browserObserver)(sizes => {
    if (disposed) return;
    let shownChanged = false;
    for (const s of sizes) {
      const e = byElement.get(s.target as HTMLElement);
      // A hidden label reports 0 × 0: keep the size it had when it was shown.
      if (!e || s.width <= 0 || s.height <= 0) continue;
      const state = stateOf(e.element), known = e.sizes.get(state);
      if (known && known.width === s.width && known.height === s.height) continue;
      e.sizes.set(state, { width: s.width, height: s.height });
      if (!e.element.hidden) shownChanged = true;
    }
    // Scene the last frame again with the real sizes, before the paint (the observer runs after layout).
    if (shownChanged && lastFrame && !placing) run(lastFrame.camera, lastFrame.viewport, lastFrame.arrange, false);
  });

  function measure(e: Entry<K>, state: string): LabelSize {
    const restore = measureAs(e.element, state);
    const r = e.element.getBoundingClientRect(), size = { width: r.width, height: r.height };
    restore();
    if (size.width > 0 && size.height > 0) e.sizes.set(state, size);
    return size;
  }

  function write(e: Entry<K>): void {
    const el = e.element;
    if (e.hidden !== undefined && el.hidden !== e.hidden) el.hidden = e.hidden;
    const style = e.style as Record<string, string | undefined>, written = e.written as Record<string, string | undefined>;
    for (const prop in style) {
      const v = style[prop];
      if (v === undefined || written[prop] === v) continue;
      written[prop] = v;
      el.style.setProperty(prop, v);
    }
    for (const name in e.data) {
      const v = e.data[name];
      if (v === null) { if (el.dataset[name] !== undefined) delete el.dataset[name]; }
      else if (el.dataset[name] !== v) el.dataset[name] = v;
    }
  }

  function run(camera: THREE.Camera, viewport: LabelViewport, arrange: LabelArrange<K>, project: boolean): void {
    placing = true;
    try {
      // A new width can reflow every label (media queries, wrapping): forget the sizes.
      if (viewport.width !== lastWidth) { if (!Number.isNaN(lastWidth)) for (const e of entries) e.sizes.clear(); lastWidth = viewport.width; }
      for (const e of entries) {
        e.hidden = undefined;
        for (const k in e.style) delete (e.style as Record<string, unknown>)[k];
        for (const k in e.data) delete e.data[k];
        if (!project) continue;
        e.projected = !!e.spec.anchor?.(e.world);
        if (e.projected) e.ndc.copy(e.world).project(camera);
      }
      arrange(entries, viewport);
      for (const e of entries) write(e);
    } finally { placing = false; }
  }

  return {
    add(spec) {
      const e: Entry<K> = {
        spec, element: spec.element, key: spec.key, projected: false, world: new THREE.Vector3(), ndc: new THREE.Vector3(),
        style: {}, data: {}, sizes: new Map(), written: {}, removed: false,
        size(state = stateOf(spec.element)) { return e.sizes.get(state) ?? measure(e, state); },
      };
      entries.push(e); byElement.set(spec.element, e); observer?.observe(spec.element);
      return {
        element: spec.element,
        setText(text) { if (spec.element.textContent === text) return; spec.element.textContent = text; e.sizes.clear(); },
        remove() {
          if (e.removed) return; e.removed = true;
          const i = entries.indexOf(e); if (i >= 0) entries.splice(i, 1);
          byElement.delete(spec.element); observer?.unobserve(spec.element);
        },
      };
    },
    scene(camera, viewport, arrange) {
      if (disposed) return;
      lastFrame = { camera, viewport, arrange };
      run(camera, viewport, arrange, true);
    },
    last: el => byElement.get(el),
    dispose() { disposed = true; observer?.disconnect(); entries.length = 0; byElement.clear(); lastFrame = null; },
  };
}

/**
 * Map labels (a map view): a label sits beside a visible anchor, offset by
 * (dx, dy) and kept 4 px inside the view; an anchor outside the view hides its label rather than pinning it to an edge.
 */
export function clampLabelToView(point: { x: number; y: number; z: number }, width: number, height: number, labelWidth: number, labelHeight: number, dx = 0, dy = 0): { visible: boolean; x: number; y: number } {
  const visible = [point.x, point.y, point.z, width, height].every(Number.isFinite) && width > 0 && height > 0 && Math.abs(point.x) <= 1 && Math.abs(point.y) <= 1 && Math.abs(point.z) <= 1;
  if (!visible) return { visible: false, x: 0, y: 0 };
  return { visible: true, x: Math.max(4, Math.min(width - labelWidth - 4, (point.x + 1) * width / 2 + dx)), y: Math.max(4, Math.min(height - labelHeight - 4, (1 - point.y) * height / 2 + dy)) };
}
