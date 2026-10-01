import type {FrameInfo,FrameLoop,TickerHandle} from '../../core/activity/loop';
import type {FrameMode,WhenCovered} from '../../core/activity/ports';
import {anonymousOwner,appLoop,calm,createLoop} from './runtime';

export interface ActivityFramesOptions{
 /** Activity run the frames belong to; the layer stack answers its coverage. Default: a fresh key. */
 owner?:string;
 /** What the frames do under a scrim. Default 'pause'. */
 whenCovered?:WhenCovered;
}

/** One frame owner per activity: a facade over the app's one frame loop (core/activity/loop.ts).
 * Hidden documents stop scheduling, and resume with a fresh clock rather than consuming time spent in another
 * app. A test that injects `request` (and `cancel`) gets a private loop on that scheduler. */
export class ActivityFrames {
 private ticker:TickerHandle|null=null;
 private active=false;
 private visible=true;
 private readonly loop:FrameLoop;
 private readonly owner:string;
 private readonly whenCovered:WhenCovered;
 constructor(private frame:(dt:number,frame:FrameInfo)=>void,private suspend:()=>void,
  request?:(callback:FrameRequestCallback)=>number,cancel?:(id:number)=>void,options:ActivityFramesOptions={}){
  this.loop=request?createLoop({scheduler:{request,cancel:cancel??(()=>{})}}):appLoop();
  this.owner=options.owner??anonymousOwner('activity-frames');this.whenCovered=options.whenCovered??'pause';
 }
 start(){this.active=true;this.schedule();}
 stop(){this.active=false;this.clear();}
 setVisible(visible:boolean){if(this.visible===visible)return;this.visible=visible;this.clear();if(!visible&&this.active)this.suspend();this.schedule();}
 private clear(){this.ticker?.remove();this.ticker=null;}
 private schedule(){
  if(!this.active||!this.visible||(this.ticker&&!this.ticker.removed))return;
  // A new ticker's first frame has dt = 0; later frames are clamped to 0.05 s (the loop's default maxDt).
  this.ticker=this.loop.add({owner:this.owner,mode:'continuous',whenCovered:this.whenCovered,render:f=>this.frame(f.dt,f)});
 }
}
/** Calm scenes: a shim over the settings value `comfort.calm` (default: the OS preference), read live (02.s7). */
export function reducedMotion(){return calm();}

/** A converted hand loop: `frame(now, f)` in every frame of the app's one loop, `now` being the frame
 * timestamp in ms that its `requestAnimationFrame` callback had, and `f` the frame itself (motion reads `f.calm`). It pauses under an ordinary scrim; explicit run/throttled policies remain available.
 * `remove()` stops it. Mode 'on-demand' draws once after each `invalidate()`. A loop that requested its next frame
 * before its work (`keepOnError`) survived a throw: the error is reported and the ticker stays; otherwise a throw removes it.
 * An overlay supplies its layer's `owner`, so its own opaque cover does not pause its renderer. */
export function frameTicker(name:string,frame:(now:number,f:FrameInfo)=>void,{mode='continuous',keepOnError=false,owner,whenCovered='pause',maxDt}:{mode?:FrameMode;keepOnError?:boolean;owner?:string;whenCovered?:WhenCovered;maxDt?:number}={}):TickerHandle{
 const run=keepOnError?(now:number,f:FrameInfo)=>{try{frame(now,f);}catch(error){globalThis.reportError?.(error);}}:frame;
 return appLoop().add({owner:owner??anonymousOwner(name),mode,whenCovered,maxDt,render:f=>run(f.t*1000,f)});
}
/** `fn(now)` once, in the next frame of the app's one loop (a converted one-shot `requestAnimationFrame`). Returns a cancel. */
export function nextFrame(fn:(now:number)=>void):()=>void{
 const t=appLoop().add({owner:anonymousOwner('next-frame'),mode:'continuous',whenCovered:'run',update:f=>{t.remove();fn(f.t*1000);}});
 return ()=>t.remove();
}
