/**
 * platform/render/context-recovery.ts: the one generic GPU context-loss recovery layer (STD-REN-5;
 * ADR 0045 5).
 *
 * One capture-phase listener on the document hears `webglcontextlost` and `webglcontextrestored` for every canvas in
 * the page (context events do not bubble, but capture still runs on the ancestors), so pooled leases, panel stages
 * and the renderers that never handled loss all recover the same way, and no scene writes its own fallback text:
 *
 *  1. **Lost.** `preventDefault` (so the browser may restore it; three does the same for its own renderer). three
 *     skips `render` on a lost context, and the scene's update keeps running. `lost` is emitted.
 *  2. **Restored within `restoreTimeoutMs` (3 s).** three re-initialises its GL state and re-uploads buffers and
 *     textures lazily from the objects, which still hold their sources; pooled leases hear `onRestored`
 *     (renderer-pool.ts). `restored` is emitted and nothing else happens.
 *  3. **No restore in time.** The app's `recreate` runs: the current scene is entered again, its lease is released,
 *     the pool retires the lost context and the new visit leases a fresh one. `recreated` is emitted.
 *  4. **Two failures within `failureWindowMs` (60 s).** The tier steps down one level (`stepDown`) and the app's one
 *     "The pictures took a break · Try again" layer is shown (`showBreak`); Try again recreates.
 *
 * A loss is a failure only if its canvas is still in the page one task later: a scene that disposes its renderer
 * (`forceContextLoss`, the pool's recycle valve or `settle`) removes the canvas in the same task, and a parked pool
 * canvas is never a scene's picture. `exempt` names the canvases whose scene still handles loss itself: the staged
 * areas (ADR 0061) until their rows adopt this layer.
 *
 * The layer is app-agnostic: what "enter the scene again", "step down" and "show the break" mean is injected by the
 * app (src/graphics-recovery.ts).
 */

export interface RecoveryTimers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export type RecoveryEvent = 'lost' | 'restored' | 'recreated' | 'break';

export interface ContextRecoveryOptions {
  doc: Document;
  /** Enter the current scene again, so its renderer is made on a fresh context. */
  recreate(): void;
  /** A canvas whose scene still handles loss itself (a staged area until its row). */
  exempt?(canvas: HTMLCanvasElement): boolean;
  /** Two failures within the window: one quality tier down. */
  stepDown?(): void;
  /** Show the one recovery layer; `retry` recreates. Returns a function that removes it. */
  showBreak?: ((retry: () => void) => () => void) | undefined;
  /** Observes each step (the app emits `render.context.*`). */
  emit?(event: RecoveryEvent, canvas: HTMLCanvasElement): void;
  timers?: RecoveryTimers;
  restoreTimeoutMs?: number;
  failureWindowMs?: number;
}

export interface RecoveryStats {
  losses: number;
  restored: number;
  recreated: number;
  breaks: number;
  ignored: number;
  pending: number;
}

export interface ContextRecovery {
  /**
   * The test API's `engine.render.loseContext()`: loses the context of the frontmost (last in document order) visible
   * three.js canvas that this layer recovers (or of `canvas`) through `WEBGL_lose_context`. Returns a function that
   * restores it, or null when there is nothing to lose.
   */
  loseContext(canvas?: HTMLCanvasElement): (() => void) | null;
  stats(): RecoveryStats;
  dispose(): void;
}

const globalTimers: RecoveryTimers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: h => clearTimeout(h as ReturnType<typeof setTimeout>),
};
/** The pool's hidden parking element (renderer-pool.ts): canvases there belong to no scene. */
const PARKED = '[data-renderer-pool="parking"]';

type LoseExt = {loseContext(): void; restoreContext(): void};
const webgl = (c: HTMLCanvasElement): WebGLRenderingContext | WebGL2RenderingContext | null => {
  try {
    return (
      (c.getContext('webgl2') as WebGL2RenderingContext | null) ??
      (c.getContext('webgl') as WebGLRenderingContext | null)
    );
  } catch {
    return null;
  }
};

export function installContextRecovery(o: ContextRecoveryOptions): ContextRecovery {
  const timers = o.timers ?? globalTimers;
  const restoreMs = o.restoreTimeoutMs ?? 3000,
    windowMs = o.failureWindowMs ?? 60_000;
  const stats: RecoveryStats = {losses: 0, restored: 0, recreated: 0, breaks: 0, ignored: 0, pending: 0};
  const pending = new Map<HTMLCanvasElement, {timer: unknown; counted: boolean}>();
  const windowTimers = new Set<unknown>();
  let failures = 0,
    hideBreak: (() => void) | null = null,
    disposed = false;
  const off = new AbortController();

  const ours = (c: HTMLCanvasElement) => !c.closest?.(PARKED) && !o.exempt?.(c);
  const drop = (c: HTMLCanvasElement) => {
    const p = pending.get(c);
    if (p) {
      timers.clear(p.timer);
      pending.delete(c);
      stats.pending = pending.size;
    }
  };
  const recreate = (c: HTMLCanvasElement) => {
    // A superseded loss (the scene already left) must not re-enter whatever scene is showing now.
    for (const other of [...pending.keys()]) drop(other);
    stats.recreated++;
    o.emit?.('recreated', c);
    o.recreate();
  };
  const showBreak = (c: HTMLCanvasElement) => {
    for (const other of [...pending.keys()]) drop(other);
    stats.breaks++;
    o.emit?.('break', c);
    o.stepDown?.();
    hideBreak?.();
    hideBreak =
      o.showBreak?.(() => {
        hideBreak?.();
        hideBreak = null;
        recreate(c);
      }) ?? null;
    if (!o.showBreak) recreate(c);
  };

  o.doc.addEventListener(
    'webglcontextlost',
    e => {
      const c = e.target as HTMLCanvasElement;
      if (disposed || !ours(c) || pending.has(c)) return;
      e.preventDefault();
      const entry = {timer: undefined as unknown, counted: false};
      pending.set(c, entry);
      stats.pending = pending.size;
      // One task later: a canvas its scene removed was a deliberate release, not a failure.
      entry.timer = timers.set(() => {
        if (pending.get(c) !== entry) return;
        if (!c.isConnected || c.closest?.(PARKED)) {
          drop(c);
          stats.ignored++;
          return;
        }
        entry.counted = true;
        stats.losses++;
        o.emit?.('lost', c);
        failures++;
        const t = timers.set(() => {
          windowTimers.delete(t);
          failures = Math.max(0, failures - 1);
        }, windowMs);
        windowTimers.add(t);
        if (failures >= 2) {
          failures = 0;
          for (const w of windowTimers) timers.clear(w);
          windowTimers.clear();
          showBreak(c);
          return;
        }
        entry.timer = timers.set(() => {
          if (pending.get(c) !== entry) return;
          drop(c);
          if (c.isConnected) recreate(c);
        }, restoreMs);
      }, 0);
    },
    {capture: true, signal: off.signal},
  );

  o.doc.addEventListener(
    'webglcontextrestored',
    e => {
      const c = e.target as HTMLCanvasElement;
      const p = pending.get(c);
      if (disposed || !p) return;
      drop(c);
      if (p.counted) {
        stats.restored++;
        o.emit?.('restored', c);
      }
    },
    {capture: true, signal: off.signal},
  );

  return {
    loseContext(canvas) {
      const doc = o.doc;
      // Only canvases three drew on (it marks them `data-engine`): asking a blank canvas for a context would create one.
      const candidates = canvas
        ? [canvas]
        : Array.from(doc.querySelectorAll<HTMLCanvasElement>('canvas[data-engine^="three.js"]')).reverse();
      for (const c of candidates) {
        if (!c.isConnected || !ours(c) || !c.getClientRects().length) continue;
        const gl = webgl(c);
        if (!gl || gl.isContextLost()) continue;
        const ext = gl.getExtension('WEBGL_lose_context') as LoseExt | null;
        if (!ext) continue;
        ext.loseContext();
        return () => {
          try {
            ext.restoreContext();
          } catch {
            /* already restored or recreated */
          }
        };
      }
      return null;
    },
    stats: () => ({...stats}),
    dispose() {
      disposed = true;
      off.abort();
      for (const c of [...pending.keys()]) drop(c);
      for (const w of windowTimers) timers.clear(w);
      windowTimers.clear();
      hideBreak?.();
      hideBreak = null;
    },
  };
}
