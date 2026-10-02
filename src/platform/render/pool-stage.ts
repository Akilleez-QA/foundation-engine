/**
 * platform/render/pool-stage.ts: the renderer pool's `stage` role (ADR 0040; STD-REN-3,
 * STD-REN-4). 
 *
 * `stage` is everything drawn over a covered scene: minigames, panel 3D, inspector views, the
 * panorama and the galaxy survey. They share ONE WebGL context (per antialias setting), however many views are open:
 * a view and its panorama, or a minigame's two scissored views, draw on the same context.
 *
 * How the views share it. The context lives on a detached canvas that is never shown. Every lease gets a fresh
 * three.js renderer bound to that context but to ITS OWN view canvas (`new WebGLRenderer({canvas: view, context})`),
 * so the scene keeps its canvas where it always was: same element, same DOM order, same CSS, same pointer and
 * keyboard listeners, same `setSize`/`setPixelRatio` behaviour. The renderer draws into the lower-left of the shared
 * drawing buffer (three's viewport starts at 0,0 and the buffer only grows), and the pool copies that rectangle into
 * the view canvas (`drawImage`, the scissored view) before anything else can draw: in a microtask after the render,
 * or at once when another view is about to draw. Three.js caches GL state per renderer, so the pool resets the
 * state cache whenever a different view's renderer takes the context (its render target is kept).
 *
 * What a view cannot do on the shared context: `preserveDrawingBuffer` and other context attributes of its own
 * (thumbnails and snapshots are the `utility` role); `forceContextLoss()` (a no-op here: ending the lease is
 * `release()`, and `renderer.dispose()` ends it too, so an owner's existing dispose still frees everything).
 *
 * Resources (ADR 0040): a release disposes that lease's renderer; GL objects nobody deleted are swept when the stage
 * context has no lease left (views overlap, so one view's leftovers cannot be told from another's until then), and
 * the recycle valve then retires a context left too full. `settle()` (a scene activated) retires an idle stage
 * context, so a staged scene with its own renderers never finds a parked stage context on top of them.
 *
 * Context loss: the shared canvas is detached, so the generic recovery layer (context-recovery.ts), which listens
 * on the document, cannot hear it there. The pool re-dispatches `webglcontextlost`/`webglcontextrestored` on every
 * leased view canvas: that layer then recovers stage views like any other canvas, and each view's three.js renderer
 * stops and resumes drawing. `onLost`/`onRestored` hear it too. A lost context is never handed to a new lease.
 */
import type * as T from 'three';

type GL = WebGL2RenderingContext;
// renderer-pool.ts imports this module, so the shapes it shares are restated here (structurally the same).
type PoolRenderer = Pick<T.WebGLRenderer, 'domElement' | 'getContext' | 'dispose' | 'forceContextLoss' | 'resetState' | 'info'> & Partial<T.WebGLRenderer>;
interface LeaseAudit { textures: number; geometries: number; programs: number; glObjects: number }
interface Stats { created: number; contexts: number; leases: number; losses: number; recreations: number; recycles: number; lastRelease: LeaseAudit | null }
/** A stage lease (renderer-pool's `RenderSurface` with `role: 'stage'`). */
export interface StageSurface {
  readonly renderer: T.WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  readonly role: 'stage';
  readonly pooled: boolean;
  onLost(fn: () => void): () => void;
  onRestored(fn: () => void): () => void;
  release(): void;
  dispose(): void;
}

export interface StageSurfaceRequest<P = object> {
  role: 'stage';
  /** Where the view canvas goes; omitted: the caller scenes `surface.canvas` itself. */
  host?: HTMLElement;
  insert?: 'append' | 'prepend';
  /** Use this element as the view canvas (a caller that builds its canvas first); default: a new canvas. */
  canvas?: HTMLCanvasElement;
  ctx?: { own<D extends { dispose(): void }>(d: D): D };
  maxPixelRatio?: number;
  /** MSAA on the shared context (default true). Views with and without it use different stage contexts. */
  antialias?: boolean;
  /** A transparent view: clears to alpha 0 (three's `alpha: true`). Default false: clears to opaque black. */
  alpha?: boolean;
  profile?: P;
}

export interface StagePoolDeps<P> {
  stats: Stats;
  valve: { textures: number; geometries: number };
  /** renderer-pool's GL object tracker (what a context created and has not deleted). */
  track(gl: GL): { live: Map<object, string>; validation?: {clear():void} };
  doc(): Document | undefined;
  /** Make the shared context (a detached canvas). Throws when WebGL cannot start. */
  createContext(antialias: boolean): { canvas: HTMLCanvasElement; gl: GL };
  /** Make a lease's renderer on its view canvas and the shared context. */
  createRenderer(view: HTMLCanvasElement, gl: GL): PoolRenderer;
  pixelRatio(r: PoolRenderer, max: number | undefined): void;
  applyProfile(r: PoolRenderer, p: P | undefined): void;
}

export interface StagePool<P> {
  lease(req: StageSurfaceRequest<P>): StageSurface | null;
  /** Retire every stage context with no lease. */
  settle(): void;
  /** Live stage contexts and leased views (tests and the probe). */
  counts(): { contexts: number; views: number };
}

interface View {
  canvas: HTMLCanvasElement;
  r: PoolRenderer;
  g2d: CanvasRenderingContext2D | null;
  lost: Set<() => void>;
  restored: Set<() => void>;
  released: boolean;
}
interface StageSlot {
  key: boolean;
  canvas: HTMLCanvasElement;
  gl: GL;
  tracker: { live: Map<object, string>; validation?: {clear():void} };
  views: Set<View>;
  /** The view whose renderer's state cache matches the context. */
  drawer: View | null;
  /** A view drawn to the screen and not yet copied out. */
  pending: View | null;
  lost: boolean;
  off: AbortController;
}

/** The three.js entry points that touch GL state; a view that calls one takes the context first. */
const ENTRIES = ['render', 'clear', 'clearColor', 'clearDepth', 'clearStencil', 'setRenderTarget', 'compile', 'compileAsync', 'initTexture', 'initRenderTarget', 'readRenderTargetPixels', 'readRenderTargetPixelsAsync', 'copyFramebufferToTexture', 'copyTextureToTexture'] as const;

export function createStagePool<P>(d: StagePoolDeps<P>): StagePool<P> {
  const slots = new Map<boolean, StageSlot>();

  const retire = (slot: StageSlot, lose: boolean) => {
    if (slots.get(slot.key) === slot) slots.delete(slot.key);
    slot.off.abort();
    if (lose && !slot.lost) (slot.gl.getExtension?.('WEBGL_lose_context') as WEBGL_lose_context | null)?.loseContext();
    slot.tracker.live.clear();slot.tracker.validation?.clear();
    d.stats.contexts = Math.max(0, d.stats.contexts - 1);
  };

  const forward = (slot: StageSlot, type: 'webglcontextlost' | 'webglcontextrestored') => {
    for (const v of [...slot.views]) {
      if (typeof Event === 'function') { try { v.canvas.dispatchEvent(new Event(type, { cancelable: true })); } catch { /* a detached test canvas */ } }
      for (const f of [...(type === 'webglcontextlost' ? v.lost : v.restored)]) f();
    }
  };

  const newSlot = (key: boolean): StageSlot => {
    const { canvas, gl } = d.createContext(key);
    const slot: StageSlot = { key, canvas, gl, tracker: d.track(gl), views: new Set(), drawer: null, pending: null, lost: false, off: new AbortController() };
    d.stats.created++; d.stats.contexts++;
    const signal = slot.off.signal;
    canvas.addEventListener('webglcontextlost', e => {
      e.preventDefault();
      slot.lost = true;slot.tracker.live.clear();slot.tracker.validation?.clear(); slot.pending = null; slot.drawer = null; d.stats.losses++;
      if (slot.views.size) forward(slot, 'webglcontextlost'); else retire(slot, false);
    }, { signal });
    canvas.addEventListener('webglcontextrestored', () => { slot.lost = false; forward(slot, 'webglcontextrestored'); }, { signal });
    slots.set(key, slot);
    return slot;
  };

  /** Copy the view's rectangle (bottom-left of the shared buffer) into its canvas. */
  const flush = (slot: StageSlot) => {
    const v = slot.pending;
    slot.pending = null;
    if (!v || slot.lost) return;
    const w = v.canvas.width, h = v.canvas.height;
    if (!w || !h) return;
    const g = v.g2d ??= (v.canvas.getContext?.('2d') as CanvasRenderingContext2D | null) ?? null;
    if (!g) return;
    g.globalCompositeOperation = 'copy';
    g.drawImage(slot.canvas, 0, slot.canvas.height - h, w, h, 0, 0, w, h);
    g.globalCompositeOperation = 'source-over';
  };

  /** `v` is about to use the context: copy out the last view, fit the buffer, and hand `v`'s renderer a clean state. */
  const take = (slot: StageSlot, v: View) => {
    if (slot.pending && slot.pending !== v) flush(slot);
    const need = [v.canvas.width, v.canvas.height];
    if (slot.canvas.width < need[0]! || slot.canvas.height < need[1]!) {
      if (slot.pending) flush(slot);
      slot.canvas.width = Math.max(slot.canvas.width, need[0]!);
      slot.canvas.height = Math.max(slot.canvas.height, need[1]!);
    }
    if (slot.drawer !== v) {
      // First, so the (wrapped) setRenderTarget below does not take again.
      slot.drawer = v;
      const x = v.r as T.WebGLRenderer;
      const target = x.getRenderTarget?.() ?? null;
      if (!slot.lost) { try { x.resetState(); } catch { /* lost mid-call */ } }
      if (target) x.setRenderTarget?.(target);
    }
  };

  const wrap = (slot: StageSlot, v: View) => {
    const x = v.r as unknown as Record<string, unknown>;
    for (const name of ENTRIES) {
      const f = x[name];
      if (typeof f !== 'function') continue;
      const orig = f as (...a: unknown[]) => unknown;
      x[name] = function (...a: unknown[]) {
        // A released view (a late frame after its owner closed) never draws on the shared context again.
        if (v.released) return undefined;
        take(slot, v);
        const out = orig.apply(v.r, a);
        if (name === 'render' && !(v.r as T.WebGLRenderer).getRenderTarget?.()) {
          const first = slot.pending !== v;
          slot.pending = v;
          if (first) queueMicrotask(() => { if (slot.pending === v) flush(slot); });
        }
        return out;
      };
    }
  };

  /** Everything the context held, freed when no view is left; the context kept unless the valve says otherwise. */
  const idle = (slot: StageSlot, audit: LeaseAudit) => {
    slot.drawer = null; slot.pending = null;
    const g = slot.gl as unknown as Record<string, (o: object) => void>;
    for (const [obj, del] of [...slot.tracker.live]) { audit.glObjects++; try { g[del]!(obj); } catch { /* lost */ } }
    slot.tracker.live.clear();slot.tracker.validation?.clear();
    if (slot.lost || slot.gl.isContextLost?.()) { retire(slot, false); return; }
    if (audit.textures > d.valve.textures || audit.geometries > d.valve.geometries) { d.stats.recycles++; retire(slot, true); return; }
    // An idle stage keeps its context but not its (possibly large) drawing buffer.
    slot.canvas.width = 1; slot.canvas.height = 1;
  };

  const lease = (req: StageSurfaceRequest<P>): StageSurface | null => {
    const key = req.antialias ?? true;
    let slot = slots.get(key) ?? null;
    if (slot && (slot.lost || slot.gl.isContextLost?.())) {
      // Never hand on a lost context. One with views still on it lives until they release.
      if (!slot.views.size) retire(slot, false); else slots.delete(key);
      d.stats.recreations++;
      slot = null;
    }
    // An idle stage context with the other antialias setting is not kept alongside a new one.
    for (const other of [...slots.values()]) if (other.key !== key && !other.views.size) retire(other, true);
    const doc = d.doc();
    const canvas = req.canvas ?? (doc?.createElement('canvas') as HTMLCanvasElement | undefined);
    if (!canvas) return null;
    let r: PoolRenderer;
    try {
      slot ??= newSlot(key);
      r = d.createRenderer(canvas, slot.gl);
    } catch { return null; }
    const s = slot;
    d.stats.leases++;
    const v: View = { canvas, r, g2d: null, lost: new Set(), restored: new Set(), released: false };
    s.views.add(v);
    // As three does for a renderer made with `alpha: false` (its contexts always have an alpha channel).
    if (!req.alpha) (r as T.WebGLRenderer).setClearColor?.(0x000000, 1);
    wrap(s, v);
    const dispose = r.dispose.bind(r);
    // `renderer.dispose()` (an owner's existing teardown) ends the lease; `forceContextLoss` must not end the context.
    (r as { dispose(): void }).dispose = () => { if (!v.released) surface.release(); else dispose(); };
    (r as { forceContextLoss(): void }).forceContextLoss = () => {};
    d.pixelRatio(r, req.maxPixelRatio);
    d.applyProfile(r, req.profile);
    if (req.host) { if (req.insert === 'prepend') req.host.prepend(canvas); else req.host.append(canvas); }
    const surface: StageSurface = {
      renderer: r as T.WebGLRenderer, canvas, role: 'stage', pooled: true,
      onLost(fn) { v.lost.add(fn); return () => v.lost.delete(fn); },
      onRestored(fn) { v.restored.add(fn); return () => v.restored.delete(fn); },
      release() {
        if (v.released) return;
        v.released = true;
        if (s.pending === v) flush(s);
        v.lost.clear(); v.restored.clear();
        const m = r.info.memory as { textures: number; geometries: number };
        const audit: LeaseAudit = { textures: m.textures, geometries: m.geometries, programs: (r.info as { programs?: unknown[] | null }).programs?.length ?? 0, glObjects: 0 };
        if (s.drawer === v) s.drawer = null;
        // The outermost dispose (a `livePixelRatio` wrapper unsubscribes there) reaches three's own dispose last.
        (r as { dispose(): void }).dispose();
        s.views.delete(v);
        d.stats.lastRelease = audit;
        if (!s.views.size) idle(s, audit);
      },
      dispose() { surface.release(); },
    };
    req.ctx?.own(surface);
    return surface;
  };

  return {
    lease,
    settle() { for (const s of [...slots.values()]) if (!s.views.size) retire(s, true); },
    counts() { let views = 0; for (const s of slots.values()) views += s.views.size; return { contexts: slots.size, views }; },
  };
}

