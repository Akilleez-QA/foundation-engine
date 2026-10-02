import {installProgramValidation, type ProgramValidation} from './program-validation';
import {TEST_API} from '../../core/env';
import {waitForPrograms} from './program-readiness';
/**
 * platform/render/renderer-pool.ts: the renderer pool (ADRs 0016, 0040, 0041, 0045;
 * STD-REN-3, STD-REN-4, STD-REN-5, STD-REN-34, STD-RUN-17). the `world` role.
 *
 * The pool owns WebGL contexts, never scenes. A `world` lease borrows the one world canvas and its context for one
 * scene visit (a hub, a scene of the scene engine, a view). Fast travel and a scene door hand the same context to
 * the next visit instead of creating a new one.
 *
 * Every lease gets a FRESH three.js renderer bound to the pooled context (`new WebGLRenderer({canvas, context})`), so
 * nothing a scene set on its renderer (tone mapping, exposure, colour space, shadow type, clear colour, clipping,
 * autoClear, info.autoReset, pixel ratio, scissor, render lists, program and binding caches) can reach the next scene:
 * the render profile is reset by construction and then set from the request. On release the pool resets the GL
 * state, disposes that renderer and deletes every GL object the lease created and did not delete itself (the leak
 * audit reports how many), then returns the canvas, cleared and at a fresh canvas's size, to the parking element.
 * That is exactly what the old per-scene `dispose()` + `forceContextLoss()` freed, without losing the context.
 *
 * Resources (ADR 0040): the pool lease owns the context; asset leases own shared immutables (released with
 * `releaseSharedRendererTextures`, as before); the run owns its scene, and no scene is ever transferred: a lease ends
 * with its renderer, and the next lease starts empty.
 *
 * Context loss is watched once, here, on the pooled canvas (D6): the lease's `onLost`/`onRestored` hear it, a lost
 * context is never handed to the next scene (the next lease recreates it), and a parked lost context is retired.
 * What the page does about a loss (wait for a restore, recreate by re-entering the scene, the break layer) is the one
 * generic recovery layer, context-recovery.ts; scenes write no loss handling of their own.
 *
 * The recycle valve (D5): a release whose renderer still counts more textures or geometries than the tier's cap, or
 * (lower tiers) every `recycleEvery` leases, retires the context (`dispose()` + `forceContextLoss()`); the next lease
 * creates a fresh one. `settle()` retires a parked world context once a scene that does not use it has activated
 * (a staged area with its own renderer), so the budgeted live-context count never grows.
 *
 * Shadows (STD-REN-12): every leased renderer gets the shadow scheduler (`shadows.ts`, loaded with the first
 * scene's chunk), so every shadow light a pooled scene draws redraws its map only when a caster or the light changed;
 * no scene can opt out. The lease records the technique (`shadow-technique.ts`): Reference cascades unless staged.
 *
 * The held frame (ADR 0041/0045): `hold()` copies the world canvas's resolved output (after MSAA resolve and any post
 * chain, as displayed) into a 2D canvas laid over the page, for the router to keep across a scene change.
 *
 * The `utility` role is pool-snapshot.ts, kept out of the first-load file: `attachUtility` gives it the world
 * context (it draws into a render target there) and tells it when that context changes hands, so it lets go before a
 * lease starts or a release sweeps the context, and retires its own utility context once a world exists.
 */
import * as T from 'three';
import { getAppRendererPool } from './app-renderer-pool';
export { rendererPoolStats } from './app-renderer-pool';
import { livePixelRatio } from './quality-runtime';
import { setShadowTechnique, type ShadowTechnique } from './shadow-technique';
import { anonymousOwner, appLoop } from '../ui/runtime';
import { createStagePool, type StageSurfaceRequest } from './pool-stage';

import type { SurfaceRole, RenderProfile, SurfaceRequest, RenderSurface, LeaseAudit, PoolStats, RecycleValve, HeldFrame, RendererPool, UtilityAccess, PoolRenderer, RendererPoolOptions } from './renderer-pool-types';
export type { SurfaceRole, RenderProfile, SurfaceRequest, RenderSurface, LeaseAudit, PoolStats, RecycleValve, HeldFrame, RendererPool, UtilityAccess, PoolRenderer, RendererPoolOptions } from './renderer-pool-types';

type GL = WebGL2RenderingContext;
/** Reference: a context is recycled only when a scene leaves an implausible amount behind. */
export const REFERENCE_VALVE: RecycleValve = { textures: 2048, geometries: 16384, every: 0 };

const GL_KINDS = [
  ['createTexture', 'deleteTexture'], ['createBuffer', 'deleteBuffer'], ['createFramebuffer', 'deleteFramebuffer'],
  ['createRenderbuffer', 'deleteRenderbuffer'], ['createVertexArray', 'deleteVertexArray'], ['createProgram', 'deleteProgram'],
  ['createShader', 'deleteShader'], ['createQuery', 'deleteQuery'], ['createSampler', 'deleteSampler'],
] as const;

/**
 * Wraps the pooled context's own create/delete calls (instance properties; the prototype is untouched) so a release
 * can delete what its lease left behind. The context's own startup objects (made before the wrap) are never deleted.
 */
function trackGlObjects(gl: GL): { live: Map<object, string>; validation: ProgramValidation } {
  const live = new Map<object, string>();
  const g = gl as unknown as Record<string, (...a: unknown[]) => unknown>;
  for (const [create, del] of GL_KINDS) {
    const c = g[create], d = g[del];
    if (typeof c !== 'function' || typeof d !== 'function') continue;
    g[create] = function (this: unknown, ...a: unknown[]) { const o = c.apply(gl, a); if (o && typeof o === 'object') live.set(o, del); return o; };
    g[del] = function (this: unknown, o: unknown) { if (o && typeof o === 'object') live.delete(o); return d.call(gl, o); };
  }
  return { live, validation: installProgramValidation(gl) };
}

interface Slot { canvas: HTMLCanvasElement; gl: GL; tracker: ReturnType<typeof trackGlObjects>; leased: boolean; uses: number; lost: boolean; off: AbortController; renderer?: PoolRenderer | null }

export function createRendererPool(o: RendererPoolOptions = {}): RendererPool {
  const make = o.createRenderer ?? ((canvas, context) => new T.WebGLRenderer(canvas ? { canvas, context, antialias: true } : { antialias: true }));
  const pixelRatio = o.pixelRatio ?? ((r, max) => { livePixelRatio(r as T.WebGLRenderer, max); });
  // The scheduler (and the change tracker it runs) loads with the first scene's chunk, not with the app: the technique
  // is recorded now, and the scheduler is installed as soon as its module is there (the scene's own lighting installs
  // it synchronously before its first frame; until then three's per-frame update draws the same maps).
  const shadows = o.shadows ?? ((r, technique) => {
    if (!(r as T.WebGLRenderer).shadowMap) return;
    setShadowTechnique(r, technique);
    void import('./shadows').then(m => { m.scheduleShadows(r as T.WebGLRenderer); }, () => { /* per-frame maps, as three draws them */ });
  });
  const valve = o.valve ?? REFERENCE_VALVE;
  const nextFrame = o.nextFrame ?? (fn => {
    const t = appLoop().add({ owner: anonymousOwner('renderer-pool-hold'), mode: 'continuous', whenCovered: 'run', priority: Number.MAX_SAFE_INTEGER, update() { t.remove(); fn(); } });
    return () => t.remove();
  });
  const stats: PoolStats = { created: 0, contexts: 0, leases: 0, losses: 0, recreations: 0, recycles: 0, overflows: 0, lastRelease: null };
  let world: Slot | null = null;
  let current: { canvas: HTMLCanvasElement; lost: Set<() => void>; restored: Set<() => void> } | null = null;
  let parking: HTMLElement | null = null;
  let utility: { worldChanged(): void } | null = null;
  const worldChanged = () => utility?.worldChanged();

  const doc = (): Document | undefined => o.doc ?? (typeof document === 'object' ? document : undefined);
  const park = (canvas: HTMLCanvasElement) => {
    const d = doc();
    if (!d?.body) { canvas.remove?.(); return; }
    if (!parking || !parking.isConnected) {
      parking = d.createElement('div');
      parking.hidden = true;
      parking.setAttribute('aria-hidden', 'true');
      parking.dataset.rendererPool = 'parking';
      d.body.append(parking);
    }
    parking.append(canvas);
  };
  /** A fresh canvas's state: no attributes but three's `display:block`, 300×150, cleared. */
  const freshCanvas = (canvas: HTMLCanvasElement) => {
    for (const name of canvas.getAttributeNames?.() ?? []) canvas.removeAttribute(name);
    // Handler properties (`onpointermove = …`) would keep the last scene's closures alive and firing in the next.
    const handlers = canvas as unknown as Record<string, unknown>;
    for (const key in canvas) if (key.startsWith('on') && typeof handlers[key] === 'function') handlers[key] = null;
    if (canvas.style) canvas.style.display = 'block';
    canvas.width = 300; canvas.height = 150;
  };

  const retire = (slot: Slot, lose: boolean) => {
    worldChanged();
    if (world === slot) world = null;
    slot.off.abort();
    if (lose && !slot.lost) (slot.gl.getExtension?.('WEBGL_lose_context') as WEBGL_lose_context | null)?.loseContext();
    slot.tracker.live.clear(); slot.tracker.validation.clear();
    slot.canvas.remove?.();
    stats.contexts = Math.max(0, stats.contexts - 1);
  };

  const watch = (slot: Slot) => {
    const signal = slot.off.signal;
    slot.canvas.addEventListener('webglcontextlost', e => {
      // three calls preventDefault for a leased context; a parked one needs it too so it may be restored.
      e.preventDefault();
      slot.lost = true; slot.tracker.live.clear(); slot.tracker.validation.clear(); stats.losses++;
      if (current?.canvas === slot.canvas) for (const f of [...current.lost]) f();
      else if (!slot.leased) retire(slot, false);
    }, { signal });
    slot.canvas.addEventListener('webglcontextrestored', () => {
      slot.lost = false;
      if (current?.canvas === slot.canvas) for (const f of [...current.restored]) f();
    }, { signal });
  };

  const newSlot = (r: PoolRenderer): Slot => {
    const gl = r.getContext() as GL;
    const slot: Slot = { canvas: r.domElement, gl, tracker: trackGlObjects(gl), leased: false, uses: 0, lost: false, off: new AbortController() };
    stats.created++; stats.contexts++;
    watch(slot);
    return slot;
  };

  const applyProfile = (r: PoolRenderer, p: Partial<RenderProfile> = {}) => {
    const x = r as T.WebGLRenderer;
    if (p.toneMapping !== undefined) x.toneMapping = p.toneMapping;
    if (p.toneMappingExposure !== undefined) x.toneMappingExposure = p.toneMappingExposure;
    if (p.outputColorSpace !== undefined) x.outputColorSpace = p.outputColorSpace;
    if (p.shadowMap) { x.shadowMap.enabled = p.shadowMap.enabled; x.shadowMap.type = p.shadowMap.type; }
    if (p.clearColor !== undefined || p.clearAlpha !== undefined) x.setClearColor(p.clearColor ?? 0x000000, p.clearAlpha ?? 1);
    if (p.localClippingEnabled !== undefined) x.localClippingEnabled = p.localClippingEnabled;
  };

  /** Everything the lease's renderer and GL objects held, freed; the context itself kept. */
  const scrub = (slot: Slot, r: PoolRenderer): LeaseAudit => {
    const m = r.info.memory as { textures: number; geometries: number };
    const programs = (r.info as { programs?: unknown[] | null }).programs?.length ?? 0;
    const audit: LeaseAudit = { textures: m.textures, geometries: m.geometries, programs, glObjects: 0 };
    if (!slot.lost) { try { r.resetState(); } catch { /* a context lost mid-release */ } }
    r.dispose();
    const g = slot.gl as unknown as Record<string, (x: object) => void>;
    for (const [obj, del] of [...slot.tracker.live]) { audit.glObjects++; try { g[del]!(obj); } catch { /* lost */ } }
    slot.tracker.live.clear(); slot.tracker.validation.clear();
    return audit;
  };

  const stage = createStagePool({
    stats, valve, doc, pixelRatio, applyProfile, track: trackGlObjects, createRenderer: (view, gl) => make(view, gl),
    createContext: o.createStageContext ?? (antialias => {
      const canvas = doc()!.createElement('canvas');
      // three's own context attributes (it always asks for an alpha channel), with this stage's antialias.
      const gl = canvas.getContext('webgl2', { alpha: true, depth: true, stencil: false, antialias, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'default', failIfMajorPerformanceCaveat: false });
      if (!gl) throw Error('WebGL2 unavailable');
      return { canvas, gl };
    }),
  });

  const lease = (req: SurfaceRequest | StageSurfaceRequest<Partial<RenderProfile>>): RenderSurface | null => {
    if (req.role === 'stage') return stage.lease(req);
    // A scene change: an idle stage context is not kept across it (the live-context peak stays world + stage).
    stage.settle();
    // A world context that was lost (or is lost now) is never handed on: retire it and start a new one.
    if (world && !world.leased && (world.lost || world.gl.isContextLost?.())) { retire(world, false); stats.recreations++; }
    let r: PoolRenderer, slot: Slot | null = null, pooled = true;
    worldChanged();
    try {
      if (world && !world.leased) { slot = world; r = make(slot.canvas, slot.gl); }
      else if (world) { pooled = false; stats.overflows++; r = make(); stats.created++; stats.contexts++; }
      else { r = make(); slot = world = newSlot(r); }
    } catch { return null; }
    if (slot) { slot.leased = true; slot.uses++; slot.renderer = r; }
    stats.leases++;
    const canvas = r.domElement;
    const lost = new Set<() => void>(), restored = new Set<() => void>();
    if (pooled) current = { canvas, lost, restored };
    pixelRatio(r, req.maxPixelRatio);
    shadows(r, req.shadows ?? 'reference');
    applyProfile(r, req.profile);
    if(r.debug)r.debug.checkShaderErrors=(o.programDiagnostics??(TEST_API?'full':'failure-only'))==='full';
    if (req.insert === 'prepend') req.host.prepend(canvas); else req.host.append(canvas);
    let released = false;
    let preparationOwner=new AbortController();
    let pendingPreparation:AbortController|undefined;
    const programTracker=slot?.tracker??trackGlObjects(r.getContext() as GL);
    const retirePreparation=()=>preparationOwner.abort();
    lost.add(retirePreparation);
    restored.add(()=>{preparationOwner=new AbortController();});
    const overflowEvents=new AbortController();
    if(!slot){
      canvas.addEventListener('webglcontextlost',event=>{
        if(released)return;
        event.preventDefault();programTracker.live.clear();programTracker.validation.clear();stats.losses++;
        for(const fn of [...lost])fn();
      },{signal:overflowEvents.signal});
      canvas.addEventListener('webglcontextrestored',()=>{
        if(released)return;
        for(const fn of [...restored])fn();
      },{signal:overflowEvents.signal});
    }
    const surface: RenderSurface = {
      renderer: r as T.WebGLRenderer, canvas, role: req.role, pooled,
      onLost(fn) { lost.add(fn); return () => lost.delete(fn); },
      onRestored(fn) { restored.add(fn); return () => restored.delete(fn); },
      programsReady(signal) {
        pendingPreparation?.abort();
        const request=new AbortController();pendingPreparation=request;
        return waitForPrograms(r.getContext() as GL,programTracker.live,AbortSignal.any([signal,preparationOwner.signal,request.signal]),{validate:programTracker.validation.validate})
          .finally(()=>{if(pendingPreparation===request)pendingPreparation=undefined;});
      },
      release() {
        if (released) return;
        preparationOwner.abort();overflowEvents.abort();
        released = true;
        lost.clear(); restored.clear();
        if (!slot) { r.dispose(); r.forceContextLoss(); programTracker.live.clear();programTracker.validation.clear(); canvas.remove?.(); stats.contexts = Math.max(0, stats.contexts - 1); return; }
        if (current?.canvas === canvas) current = null;
        worldChanged();
        const audit = stats.lastRelease = scrub(slot, r);
        slot.leased = false;
        freshCanvas(canvas);
        const over = audit.textures > valve.textures || audit.geometries > valve.geometries || (valve.every > 0 && slot.uses >= valve.every);
        if (slot.lost || slot.gl.isContextLost?.()) retire(slot, false);
        else if (over) { stats.recycles++; retire(slot, true); }
        else park(canvas);
      },
      dispose() { surface.release(); },
    };
    req.ctx?.own(surface);
    return surface;
  };

  /**
   * A non-preserved WebGL canvas can be copied only inside the frame that drew it (after presentation its drawing
   * buffer is cleared), so the copy is taken in the next frame, after every ticker has rendered. A scene that did not
   * draw in that frame (an idle on-demand scene) gives a blank copy: then there is nothing to hold (null).
   */
  const hold = (): Promise<HeldFrame | null> => new Promise(resolve => {
    const d = doc();
    const slot = world;
    if (!d || !slot || !slot.leased || slot.lost) { resolve(null); return; }
    let done = false;
    const finish = (h: HeldFrame | null) => { if (done) return; done = true; cancel(); clearTimeout(timer); resolve(h); };
    const timer = setTimeout(() => finish(null), o.holdTimeoutMs ?? 250);
    const cancel = nextFrame(() => finish(capture(d, slot)));
  });
  const capture = (d: Document, slot: Slot): HeldFrame | null => {
    if (world !== slot || !slot.leased || slot.lost || slot.gl.isContextLost?.()) return null;
    const source = slot.canvas, rect = source.getBoundingClientRect();
    if (!rect.width || !rect.height || !source.width || !source.height) return null;
    const copy = d.createElement('canvas');
    copy.width = source.width; copy.height = source.height;
    const g = copy.getContext('2d', { willReadFrequently: false });
    if (!g) return null;
    g.drawImage(source, 0, 0);
    // Blank (a frame the scene did not draw): nothing to hold.
    let seen = 0;
    for (const [fx, fy] of [[.5, .5], [.25, .25], [.75, .25], [.25, .75], [.75, .75]] as const) {
      const px = g.getImageData(Math.floor(copy.width * fx), Math.floor(copy.height * fy), 1, 1).data;
      seen += px[3]!;
    }
    if (!seen) return null;
    copy.className = 'renderer-pool-hold';
    copy.setAttribute('aria-hidden', 'true');
    Object.assign(copy.style, { position: 'fixed', left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', height: rect.height + 'px', pointerEvents: 'none', zIndex: '30', opacity: '1', margin: '0' });
    d.body.append(copy);
    let gone = false;
    const drop = () => { if (gone) return; gone = true; copy.remove(); };
    // A lost context gives no promise that its pixels survive (ADR 0045 5): the DOM recovery replaces the hold.
    slot.canvas.addEventListener('webglcontextlost', drop, { once: true });
    return {
      element: copy, drop,
      fade(ms) {
        if (gone) return Promise.resolve();
        if (ms <= 0 || typeof copy.animate !== 'function') { drop(); return Promise.resolve(); }
        const a = copy.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, easing: 'ease-out', fill: 'forwards' });
        return a.finished.then(drop, drop);
      },
    };
  };

  return {
    lease,
    acquire(req) { const s = lease(req); return s ? Promise.resolve(s) : Promise.reject(Error('The picture could not start (WebGL unavailable).')); },
    settle() { if (world && !world.leased) retire(world, true); stage.settle(); },
    hold,
    get state() { return world?.lost ? 'lost' as const : 'ok' as const; },
    stats: () => ({ ...stats }),
    attachUtility(u) { utility = u; return { make, stats, world: () => world }; },
  };
}

/** The app's renderer pool (created on first use). */
export function appRenderers(): RendererPool {
  return getAppRendererPool(createRendererPool);
}
