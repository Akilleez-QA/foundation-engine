import {monotonicNow} from '../../core/clock';
import {clampNotches,LINE_PX,NOTCH_PX,PAGE_FRACTION,PINCH_NOTCHES_PER_EFOLD,stamp,TRACKPAD_GAIN,worldKind,type InputSink,type ZoomStep} from './frame-actions';

/** Wheel, trackpad and Safari gesture normalisation into zoom notches (100 px each, at most ±1.5
 * per event). Gesture segmentation and detents belong to the camera rig: every step carries its
 * source, timestamp and, where the browser reports it, the momentum flag. */
export type WheelSample={deltaX:number;deltaY:number;deltaMode:number;ctrlKey:boolean;timeStamp:number;momentum?:boolean};
/** Horizontal trackpad scroll turns the view: radians per normalised px. */
export const WHEEL_LOOK_PER_PX=.005;
export const wheelPixels=(e:Pick<WheelSample,'deltaMode'|'deltaX'|'deltaY'>,innerHeight:number)=>{
 // Read deltaMode first: Firefox reports lines only to pages that check it.
 const mode=e.deltaMode,k=mode===1?LINE_PX:mode===2?innerHeight*PAGE_FRACTION:1;
 return {x:(e.deltaX||0)*k,y:(e.deltaY||0)*k};
};

/** Matches src/wheel-zoom.ts (fix/controls-wheel): physical Control comes from every key event's
 * ctrlKey, ctrl+wheel always wins a Safari pinch (also one that began up to 250 ms before
 * gesturestart), and gesture events are left to the pointer pinch while a finger is down. */
export class WheelInput{
 private last=-Infinity;private pinchWheelAt=-Infinity;private gesture:{scale:number;wheel:boolean}|null=null;
 /** Physical Control key state, from capture-phase key events. */
 controlHeld=false;
 /** Touch pointers down on the surface: iOS also reports their pinch as gesture events. */
 readonly touches=new Set<number>();
 constructor(private sink:InputSink,private viewportHeight:()=>number=()=>globalThis.innerHeight||800,private now:()=>number=monotonicNow){}
 /** Returns true when the event was used; the caller always prevents page scroll and zoom. */
 wheel(e:WheelSample):boolean{
  const t=stamp(e,this.now),gap=t-this.last;this.last=t;
  if(e.ctrlKey&&!this.controlHeld){this.pinchWheelAt=t;if(this.gesture)this.gesture.wheel=true;}
  if(!worldKind(this.sink.kind()))return false;
  const px=wheelPixels(e,this.viewportHeight()),momentum=typeof e.momentum==='boolean'?e.momentum:undefined;
  if(e.ctrlKey&&!this.controlHeld){
   // Chrome, Edge and Firefox report a trackpad pinch as ctrl+wheel: scale ≈ exp(−deltaY/100).
   return this.emit({notches:clampNotches(PINCH_NOTCHES_PER_EFOLD*px.y/NOTCH_PX),source:'pinch',t,momentum});
  }
  if(!e.ctrlKey&&Math.abs(px.x)>Math.abs(px.y)){this.sink.latch.look(px.x*WHEEL_LOOK_PER_PX,0);return true;}
  const trackpad=isTrackpadLike(e,px.y,gap);
  return this.emit({notches:clampNotches(px.y/NOTCH_PX*(trackpad?TRACKPAD_GAIN:1)),source:trackpad?'trackpad':'wheel',t,momentum});
 }
 /** Safari: scale is absolute from gesturestart, so each change applies scale/lastScale. */
 gestureStart(scale=1,timeStamp=0){const t=stamp({timeStamp},this.now);this.gesture={scale:scale>0?scale:1,wheel:t-this.pinchWheelAt<250};}
 gestureChange(scale:number,timeStamp:number){
  const g=this.gesture;if(!g||!(scale>0))return;const ratio=scale/g.scale;g.scale=scale;
  if(g.wheel||this.touches.size||!worldKind(this.sink.kind()))return;
  this.emit({notches:clampNotches(-PINCH_NOTCHES_PER_EFOLD*Math.log(ratio)),source:'pinch',t:stamp({timeStamp},this.now)});
 }
 gestureEnd(){this.gesture=null;}
 reset(){this.gesture=null;this.controlHeld=false;this.touches.clear();}
 private emit(step:ZoomStep){if(step.momentum===undefined)delete step.momentum;this.sink.latch.zoom(step);return true;}
}
/** pixel mode, small or fractional deltas, sideways motion or a
 * dense stream. This only changes gain; it never changes what the wheel means. */
export const isTrackpadLike=(e:Pick<WheelSample,'deltaMode'|'deltaX'|'deltaY'>,pxY:number,gapMs:number)=>e.deltaMode===0&&Math.abs(pxY)<50&&(!Number.isInteger(e.deltaY)||e.deltaX!==0||gapMs<20);

type Env={win?:EventTarget&{innerHeight?:number};doc?:EventTarget&{hidden?:boolean}};
export function attachWheel(surface:EventTarget,sink:InputSink,options:Env&{signal:AbortSignal;now?:()=>number}){
 const win=options.win??globalThis.window,doc=options.doc??globalThis.document,signal=options.signal,w=new WheelInput(sink,()=>win.innerHeight||800,options.now);
 surface.addEventListener('wheel',e=>{e.preventDefault();w.wheel(e as WheelEvent&{momentum?:boolean});},{signal,passive:false});
 type Gesture=Event&{scale:number};
 surface.addEventListener('gesturestart',e=>{e.preventDefault();w.gestureStart((e as Gesture).scale,e.timeStamp);},{signal,passive:false});
 surface.addEventListener('gesturechange',e=>{e.preventDefault();w.gestureChange((e as Gesture).scale,e.timeStamp);},{signal,passive:false});
 surface.addEventListener('gestureend',e=>{e.preventDefault();w.gestureEnd();},{signal,passive:false});
 const control=(e:Event)=>{w.controlHeld=!!(e as KeyboardEvent).ctrlKey;};
 win.addEventListener('keydown',control,{capture:true,signal});win.addEventListener('keyup',control,{capture:true,signal});
 win.addEventListener('blur',()=>w.reset(),{signal});doc.addEventListener('visibilitychange',()=>{if(doc.hidden)w.reset();},{signal});
 surface.addEventListener('pointerdown',e=>{const p=e as PointerEvent;if(p.pointerType==='touch')w.touches.add(p.pointerId);},{capture:true,signal});
 for(const type of ['pointerup','pointercancel','lostpointercapture'])surface.addEventListener(type,e=>w.touches.delete((e as PointerEvent).pointerId),{capture:true,signal});
 return w;
}
