/**
 * platform/render/shadows.ts: the shadow scheduler (; STD-REN-12, STD-REN-13, STD-REN-14,
 * STD-REN-38; ADRs 0037, 0055, 0056, 0057). It replaces `src/shadow-updates.ts`.
 *
 * three redraws every shadow map on every render. `scheduleShadows(renderer)` makes a renderer redraw a scene's maps
 * only when the observing shadow tracker (`change-tracker.ts`) says a shadow light or a rendered caster changed:
 * moved, appeared, deformed, re-instanced, re-posed, or anything it cannot observe. It is installed on the renderer,
 * not on a scene: it wraps `renderer.shadowMap.render`, which three calls after `updateMatrixWorld` and after it has
 * collected the frame's shadow lights, so every shadow light the renderer draws is scheduled and no scene can opt out.
 * The renderer pool installs it on every lease; a lighting kit installs it on the renderers the pool does not
 * own yet. Installing twice returns the first scheduler.
 *
 * On-demand scenes (they draw only when something changed) ask `onDemandFrames(renderer)` whether a frame is due:
 * the colour tracker is asked first, and the shadow tracker when the colour tracker saw nothing, because the colour
 * tracker cannot see a depth-only input (a shadow hook, a caster outside the camera's layers). A frame is presented
 * when either is due (design note), and the shadow verdict taken for that decision is the one the render uses.
 *
 * Throttling (`throttleShadow`) is a port option only (STD-REN-14): on Reference (`shadows.quality` = `ultra`) a
 * throttled caster redraws at once like any other. Below Reference, a marked caster's own motion redraws the map at
 * most once per its interval, and its appearing or leaving redraws at once.
 */
import * as T from 'three';
import {createShadowGPUCache,type ShadowGPUCache,type ShadowGPUOptions} from './shadow-cache-gpu';
import {createColourTracker,createShadowTracker,type ScanResult,type Surface,type View} from './change-tracker';
import {monotonicNow} from '../../core/clock';
import {appQuality} from './quality-runtime';
import type {Quality} from './quality';
import {recordedShadowTechnique,type ShadowTechnique} from './shadow-technique';

export {stillSafe} from './change-tracker';

type ShadowLight=T.Light&{shadow:T.LightShadow};
type Tracker=ReturnType<typeof createShadowTracker>;

const throttled=new Set<WeakRef<T.Object3D>>();
/** Mark a small, constantly wandering caster (a bug, an orrery arm). Below Reference its own motion redraws the
 *  shadow map at most once per `seconds`; on Reference it is not throttled (STD-REN-14). */
export const throttleShadow=<O extends T.Object3D>(o:O,seconds=.1):O=>{o.userData.shadowInterval=seconds;throttled.add(new WeakRef(o));return o;};

export type ShadowStats={
 /** Shadow-map decisions taken (one per render of a scene with shadow lights). */
 checks:number;
 /** Decisions that redrew the scene's maps. */
 updates:number;
 /** Redraws forced by an input the tracker cannot observe. */
 forced:number;
};
export interface ShadowScheduler{
 readonly stats:ShadowStats;
 /** Private renderer-owned GPU cache; no production combination is enabled without a guard. */
 readonly cache:ShadowGPUCache;
 /** Scan `scene` now, for an on-demand scene deciding whether to draw. World matrices must be current (they are
  *  when nothing a colour scan reads changed since the last render). A due verdict is kept for the render that
  *  follows; a not-due one is not kept. */
 due(scene:T.Object3D,camera:T.Camera):boolean;
 /** The next render of `scene` (every scene when omitted) redraws its maps: a change the scan cannot see, a
  *  restored context. */
 invalidate(scene?:T.Object3D):void;
 /** Lights of `scene` decided apart (cascades): each redraws when a caster changed or when its own state changed,
  *  so a camera move that shifts one cascade redraws that cascade only. */
 apart(scene:T.Object3D,lights:readonly T.Light[]):void;
 /** Hear the renderer's context being restored, until the renderer is disposed (the pooled canvas outlives it). */
 onRestored(fn:()=>void):()=>void;
 /** Stop scheduling: shadow maps go back to three's per-frame update. */
 dispose():void;
}
export type {ShadowTechnique} from './shadow-technique';
export interface ScheduleOptions{
 technique?:ShadowTechnique;
 staticCache?:ShadowGPUOptions;
 quality?:Pick<Quality,'knob'>;
 /** Seconds, monotonic: the throttle clock (tests inject one). */
 clock?:()=>number;
}

interface ThrottleState{tracker:Tracker;visible:boolean;pending:boolean;interval:number}
interface Decision{scene:boolean;apart:Set<T.Light>}
interface SceneState{
 tracker:Tracker;
 /** Lights decided apart, each with its own tracker. */
 apart:Map<T.Light,Tracker>;
 /** The last render of this scene drew shadow lights (unknown before its first render). */
 lights:boolean|null;
 /** A due verdict from `due()`, kept for the render that follows. */
 kept:Decision|null;
 /** Seconds of the last redraw (throttle clock). */
 last:number;
 throttles:Map<T.Object3D,ThrottleState>;
}

const schedulers=new WeakMap<object,ShadowScheduler>(),techniques=new WeakMap<object,ShadowTechnique>();
/** The scheduler installed on `renderer`, if any. */
export const shadowSchedulerOf=(renderer:T.WebGLRenderer):ShadowScheduler|undefined=>schedulers.get(renderer.shadowMap);
/** The technique `renderer`'s scheduler was installed for (`authored` when none is installed). */
export const shadowTechniqueOf=(renderer:T.WebGLRenderer):ShadowTechnique=>techniques.get(renderer.shadowMap)??recordedShadowTechnique(renderer);

/** Installs the shadow scheduler on `renderer` (idempotent). */
export function scheduleShadows(renderer:T.WebGLRenderer,o:ScheduleOptions={}):ShadowScheduler{
 let map=renderer.shadowMap;const existing=schedulers.get(map);if(existing)return existing;
 const quality=o.quality??appQuality(),clock=o.clock??(()=>monotonicNow()/1000);
 const stats:ShadowStats={checks:0,updates:0,forced:0},restoredFns=new Set<()=>void>();
 let scenes=new WeakMap<T.Object3D,SceneState>();
 const stateOf=(scene:T.Object3D)=>{let s=scenes.get(scene);if(!s)scenes.set(scene,s={tracker:createShadowTracker(),apart:new Map(),lights:null,kept:null,last:-Infinity,throttles:new Map()});return s;};
 const vsm=()=>map.type===T.VSMShadowMap;

 /** The throttled roots drawn in `scene`, and whether each is shown (itself and every ancestor visible). */
 const throttledIn=(scene:T.Object3D)=>{
  const found:{root:T.Object3D;shown:boolean}[]=[];
  for(const ref of throttled){
   const root=ref.deref();if(!root){throttled.delete(ref);continue;}
   let shown=true,top:T.Object3D=root;for(let p:T.Object3D|null=root;p;p=p.parent){if(!p.visible)shown=false;top=p;}
   if(top===scene)found.push({root,shown});
  }
  return found;
 };

 /** The decision for one render: is any shadow map of `scene` due? */
 const decide=(scene:T.Object3D,camera:T.Camera):Decision=>{
  const s=stateOf(scene),options={cameraLayers:camera.layers.mask,vsm:vsm()};
  // Lights decided apart leave the scene scan (hidden for its duration) and are compared on their own.
  const hide=[...s.apart.keys()].filter(l=>l.visible);for(const l of hide)l.visible=false;
  let whole:boolean;try{whole=decideScene(scene,camera);}finally{for(const l of hide)l.visible=true;}
  const apart=new Set<T.Light>();
  for(const [l,t] of s.apart)if(t.scan(l,options).due)apart.add(l);
  if(!whole&&apart.size){stats.updates++;s.last=clock();}
  return {scene:whole,apart};
 };
 const decideScene=(scene:T.Object3D,camera:T.Camera):boolean=>{
  const s=stateOf(scene),options={cameraLayers:camera.layers.mask,vsm:vsm()};stats.checks++;
  const now=clock();
  const roots=quality.knob('shadows.quality')==='ultra'?[]:throttledIn(scene);
  let result:ScanResult,due:boolean;
  if(!roots.length){
   if(s.throttles.size){s.throttles.clear();s.tracker.invalidate();}
   result=s.tracker.scan(scene,options);due=result.due;
  }else{
   // The scene without its throttled casters decides at once; each throttled caster decides on its own clock.
   const hidden=roots.filter(r=>r.root.visible);for(const r of hidden)r.root.visible=false;
   try{result=s.tracker.scan(scene,options);}finally{for(const r of hidden)r.root.visible=true;}
   due=result.due;
   for(const r of roots){
    let t=s.throttles.get(r.root);
    if(!t){s.throttles.set(r.root,t={tracker:createShadowTracker(),visible:!r.shown,pending:false,interval:0});}
    t.interval=r.root.userData.shadowInterval as number??.1;
    if(t.visible!==r.shown){t.visible=r.shown;due=true;}
    if(r.shown){const own=t.tracker.scan(r.root,options);if(own.forcedBy)due=true;else if(own.due)t.pending=true;}
    if(t.pending&&now-s.last>=t.interval)due=true;
   }
   // A throttled caster that left the scene (or lost its mark) redraws at once.
   for(const root of [...s.throttles.keys()])if(!roots.some(r=>r.root===root)){s.throttles.delete(root);due=true;}
   if(due)for(const t of s.throttles.values())t.pending=false;
  }
  if(due){stats.updates++;if(result.forcedBy)stats.forced++;s.last=now;}
  return due;
 };

 let original=map.render;
 const gpu=createShadowGPUCache(renderer,o.staticCache);
 const renderMaps=function(this:T.WebGLShadowMap,lights:T.Light[],scene:T.Scene,camera:T.Camera){
  // A scene that gates the whole pass itself (renderer-level autoUpdate off, e.g. a second viewport) is left alone.
  if(map.autoUpdate===false&&map.needsUpdate===false)return original.call(this,lights,scene,camera);
  const s=stateOf(scene),drawn=map.enabled&&lights.length>0;
  if(drawn){
   // Scheduled maps never update on their own; set before the scan, which reads it.
   for(const l of lights as ShadowLight[])if(l.shadow)l.shadow.autoUpdate=false;
   const d=s.kept??decide(scene,camera);
   for(const l of lights as ShadowLight[])if(l.shadow&&(d.scene||d.apart.has(l)))l.shadow.needsUpdate=true;
  }
  s.kept=null;s.lights=drawn;
  return gpu.render((ls,sc,cam)=>original.call(this,ls,sc,cam),lights,scene,camera);
 } as T.WebGLShadowMap['render'];
 map.render=renderMaps;

 const scheduler:ShadowScheduler={
  stats,cache:gpu,
  due(scene,camera){
   if(!map.enabled)return false;
   const s=stateOf(scene);if(s.kept)return true;
   // A scene whose last render drew no shadow light has no map to redraw (a light that starts casting is a change
   // the colour tracker sees).
   if(s.lights===false)return false;
   const d=decide(scene,camera),due=d.scene||d.apart.size>0;if(due)s.kept=d;return due;
  },
  apart(scene,lights){const s=stateOf(scene);s.apart.clear();for(const l of lights)s.apart.set(l,createShadowTracker());s.tracker.invalidate();},
  invalidate(scene){gpu.invalidate();if(scene){const s=scenes.get(scene);s?.tracker.invalidate();s?.apart.forEach(t=>t.invalidate());}else scenes=new WeakMap();},
  onRestored(fn){restoredFns.add(fn);return ()=>{restoredFns.delete(fn);};},
  // Nothing of the lease may outlive it on the pooled canvas: the listeners go with the renderer.
  dispose(){if(schedulers.get(map)!==scheduler)return;schedulers.delete(map);techniques.delete(map);map.render=original;gpu.dispose();restored.abort();restoredFns.clear();},
 };
 schedulers.set(map,scheduler);techniques.set(map,o.technique??recordedShadowTechnique(renderer));
 // A Reference renderer at ultra fetches the cascades now, while its scene builds, so its first frame has them.
 if(techniques.get(map)==='reference'&&quality.knob('shadows.quality')==='ultra')void loadCascades().catch(()=>{});
 // A restored context has lost every map (ADR 0037; STD-REN-17): the next render of every scene redraws them.
 const restored=new AbortController(),canvas=renderer.domElement as Partial<HTMLCanvasElement>|undefined;
 canvas?.addEventListener?.('webglcontextlost',()=>{gpu.contextLost();},{signal:restored.signal});
 canvas?.addEventListener?.('webglcontextrestored',()=>{
  // r186 (as r183) replaces the WebGLShadowMap object in initGLContext. Rebind the same
  // scheduler/ownership state to its new pass before the first restored render.
  if(renderer.shadowMap!==map){
   const technique=techniques.get(map)!;schedulers.delete(map);techniques.delete(map);map.render=original;
   map=renderer.shadowMap;original=map.render;map.render=renderMaps;schedulers.set(map,scheduler);techniques.set(map,technique);
  }
  gpu.contextRestored();scheduler.invalidate();for(const f of [...restoredFns])f();
 },{signal:restored.signal});
 // The renderer's end is the scheduler's end.
 const dispose=renderer.dispose;
 renderer.dispose=function(this:T.WebGLRenderer){scheduler.dispose();renderer.dispose=dispose;return dispose.call(this);};
 return scheduler;
}

/**
 * The on-demand frame decision for a scene that draws only when something changed (it never draws every frame):
 * `changed(renderer, ...views)` is true when the colour tracker sees a change in anything those views would draw, or
 * when a shadow map of their scenes is due (the renderer's scheduler is installed on first use). Call it after
 * simulation and animation, before deciding to skip the frame, and draw when it is true. It replaces
 * `render-on-change.ts` in the scenes that are not staged: every call scans the whole scene (ADR 0057 2: no
 * alternate-frame shortcut), so a change after any still interval reaches the very next presented frame.
 */
export function onDemandFrames(){
 const colour=createColourTracker();let last:T.WebGLRenderer|null=null,shadows:ShadowScheduler|null=null,off:(()=>void)|null=null;
 return {
  colour,
  changed(renderer:T.WebGLRenderer,...views:View[]):boolean{
   // A new renderer has drawn nothing yet.
   if(renderer!==last){
    off?.();last=renderer;shadows=scheduleShadows(renderer);colour.invalidate();
    // A restored context shows nothing until the next draw: draw it whatever the scan says. Heard through the
    // scheduler, whose listener ends with the renderer (a listener on the pooled canvas would keep the scene alive).
    off=shadows.onRestored(()=>colour.invalidate());
   }
   if(colour.scan(renderer as T.WebGLRenderer&Surface,...views).due)return true;
   let due=false;for(const [root,camera] of views)if(shadows!.due(root,camera))due=true;
   return due;
  },
  /** The next frame is drawn whatever the scans say (a context restore, a change nothing can see). */
  invalidate(){colour.invalidate();},
 };
}

// ---------------------------------------------------------------------------------------------------------------
// The Reference technique, loaded on demand.

type CascadeModule=typeof import('./shadow-cascades');
let cascadeModule:Promise<CascadeModule>|null=null;
/** The cascades module (three's CSM addon and the PCSS chunks): only the `ultra` technique needs it, so it is its own
 *  chunk, fetched when a Reference renderer is leased at `ultra` (before the scene's first frame, in practice) or when
 *  the player picks `ultra`. */
export const loadCascades=():Promise<CascadeModule>=>cascadeModule??=import('./shadow-cascades');
export interface ReferenceShadowOptions{
 quality?:Pick<Quality,'knob'>&Partial<Pick<Quality,'subscribe'>>;
 /** How far from the camera cascades reach (m). Default: the diagonal of the sun's authored shadow box. */
 maxFar?:number;
}
/**
 * The Reference shadow technique for a scene's sun (`shadow-cascades.ts`), on a renderer leased for it.
 * Until the cascades module has loaded, and below `ultra`, the sun draws its authored map; once loaded, the next frame
 * is due (the scheduler is invalidated) and the cascades take over. Null on a renderer that keeps its authored look.
 */
export function referenceShadows(renderer:T.WebGLRenderer,scene:T.Scene,sun:T.DirectionalLight,o:ReferenceShadowOptions={}):{dispose():void}|null{
 // The scene's light is scheduled from its first frame, whether or not the pool's own install has loaded yet.
 scheduleShadows(renderer);
 if(shadowTechniqueOf(renderer)!=='reference')return null;
 const quality=o.quality??appQuality();
 let rig:{dispose():void}|null=null,disposed=false,off:(()=>void)|undefined;
 const start=()=>{
  if(rig||disposed||quality.knob('shadows.quality')!=='ultra')return;
  off?.();off=undefined;
  void loadCascades().then(m=>{
   if(rig||disposed)return;
   const scheduler=shadowSchedulerOf(renderer);if(!scheduler)return;
   rig=m.cascadeShadows(renderer,scene,sun,{scheduler,quality,maxFar:o.maxFar});
   scheduler.invalidate(scene);
  },()=>{/* the authored map keeps drawing */});
 };
 off=quality.subscribe?.(start);
 start();
 return {dispose(){disposed=true;off?.();rig?.dispose();}};
}

