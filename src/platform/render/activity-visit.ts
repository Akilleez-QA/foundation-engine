/** Synchronous entry bridge for staged scenes; the router still owns activation. */
import {ActivityHost,type ActivityContext} from '../../core/activity/activity';
import {appLoop,appLayers,calm} from '../ui/runtime';
import {appRenderers,type RenderSurface,type SurfaceRequest} from './renderer-pool';

declare module '../../core/activity/ports' {
 interface SurfaceRequest {
  host?:HTMLElement;
  maxPixelRatio?:number;
  shadows?:SurfaceRequestShadow;
 }
 interface SurfaceLease {readonly renderer?:RenderSurface['renderer']}
}
type SurfaceRequestShadow=SurfaceRequest['shadows'];
export interface RenderVisit {
 readonly ctx:ActivityContext;
 readonly active:boolean;
 input():boolean;
 /** Own construction cleanup immediately. After mount succeeds, its existing disposer takes ownership. */
 onMountFailure(cleanup:()=>void):void;
 resource<T extends {dispose():void}>(value:T):T;
 surface(host:HTMLElement):RenderSurface['renderer'];
}
let installed:ActivityHost|undefined;
/** The mount and its resources belong to one run, including a failed or discarded preparation. */
export function startRenderVisit(id:string,screen:HTMLElement,mount:(visit:RenderVisit)=>()=>void,activate:(fn:()=>void)=>void):()=>void {
 const layers=appLayers();
 const host=installed??=new ActivityHost({loop:appLoop(),layers,calm,surfaces:{acquire:req=>{
  if(req.role!=='world'||!req.host)throw Error('A world surface needs its host');
  const surface=appRenderers().lease({role:'world',host:req.host,maxPixelRatio:req.maxPixelRatio,shadows:req.shadows});
  if(!surface)throw Error('WebGL unavailable');
  return surface;
 }}});
 return enterRenderVisit(host,id,screen,mount,activate);
}

/** Each deferred mount needs its own rollback scope, even inside an already mounted visit. */
export function prepareRenderMount(visit:Omit<RenderVisit,'resource'|'onMountFailure'>,mount:(visit:RenderVisit)=>()=>void):()=>void {
 let mounted=false;
 const preparing:RenderVisit={...visit,get active(){return visit.active;},
  onMountFailure:cleanup=>{visit.ctx.own(()=>{if(!mounted)cleanup();});},
  resource:value=>{visit.ctx.own(()=>{if(!mounted)value.dispose();});return value;}};
 try{const dispose=mount(preparing);mounted=true;return dispose;}
 catch(error){visit.ctx.leave('error');throw error;}
}

/** Injectable host for lifecycle and lease fixtures. */
export function enterRenderVisit(host:ActivityHost,id:string,screen:Pick<HTMLElement,'inert'>,mount:(visit:RenderVisit)=>()=>void,activate:(fn:()=>void)=>void):()=>void {
 let stop=()=>{},failure:unknown,failed=false;
 // ActivityHost invokes enter synchronously; its promise only publishes the finished run.
 const started=host.start({id,kind:'scene',enter(ctx){
  let active=false,ownsInert=true;
  const beforeInert=screen.inert;
  const releaseInert=()=>{if(ownsInert){ownsInert=false;screen.inert=beforeInert;}};
  // Protect asynchronous preparation until the screen's dormant layer takes over.
  // The layer must remember the pre-preparation value, not our temporary true flag.
  const visitContext:ActivityContext={...ctx,layer(request){
   if((request as {element?:unknown}).element===screen)releaseInert();
   return ctx.layer(request);
  }};
  stop=()=>ctx.leave('route');
  const visit:Omit<RenderVisit,'resource'|'onMountFailure'>={ctx:visitContext,get active(){return active;},input:()=>active&&!ctx.signal.aborted&&ctx.coverage()==='top',
   surface:host=>ctx.surface({role:'world',host,maxPixelRatio:1.5,shadows:'authored'}).renderer!};
  screen.inert=true;ctx.own(releaseInert);
  try{activate(()=>{if(ctx.signal.aborted)return;active=true;releaseInert();});ctx.own(prepareRenderMount(visit,mount));}catch(error){failed=true;failure=error;ctx.leave('error');throw error;}
  return {};
 }},undefined);
 void started.catch(error=>{if(!failed)globalThis.reportError?.(error);});
 if(failed)throw failure;
 return stop;
}
