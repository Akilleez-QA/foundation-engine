import {monotonicNow} from '../../core/clock';
import {clampNotches,PINCH_NOTCHES_PER_EFOLD,stamp,worldKind,type InputSink} from './frame-actions';

/** One gesture recognizer per surface. Each pointerId gets a role on pointerdown and keeps it:
 * the first is primary (tap or look drag), a second pinches, any more are ignored, so a
 * child's extra fingers never break the first finger's gesture. */
export type PointerSample={pointerId:number;pointerType:string;clientX:number;clientY:number;button:number;buttons:number;timeStamp:number};
export type PointerOptions={
 /** Tap slop in CSS px; default 12, or 16 for touch. */
 slop?:(pointerType:string)=>number;
 /** World taps longer than this are holds, not taps (children's slow pokes still count). */
 tapMaxMs?:number;
 /** Look radians per CSS px of drag; the scenes today use .006 yaw and .004 pitch. */
 lookPerPx?:{x:number;y:number};
 /** A second finger must change the spread by this much before it zooms. */
 pinchLatchPx?:number;
 now?:()=>number;
};
type Tracked={id:number;type:string;x0:number;y0:number;t0:number;x:number;y:number;travel:number;dragging:boolean;role:'primary'|'secondary'|'ignored'};
export const defaultSlop=(pointerType:string)=>pointerType==='touch'?16:12;

export class GestureRecognizer{
 private pointers=new Map<number,Tracked>();private pinch:{start:number;last:number;latched:boolean}|null=null;
 private hover:{x:number;y:number}|null=null;private readonly o:Required<PointerOptions>;
 constructor(private sink:InputSink,options:PointerOptions={}){this.o={slop:defaultSlop,tapMaxMs:1500,lookPerPx:{x:.006,y:.004},pinchLatchPx:20,now:monotonicNow,...options};}
 get dragging(){for(const p of this.pointers.values())if(p.role==='primary'&&p.dragging&&!this.pinch)return true;return false;}
 get pinching(){return !!this.pinch;}
 get active(){return this.pointers.size;}
 ids(){return [...this.pointers.keys()];}
 /** Returns true when the surface took the pointer (the caller then captures it). */
 down(e:PointerSample):boolean{
  const t=stamp(e,this.o.now);
  if(e.pointerType==='mouse'&&e.button!==0)return false;
  this.sink.device(e.pointerType==='mouse'?'keyboard-mouse':'touch',t);
  if(!worldKind(this.sink.kind()))return false;
  const live=[...this.pointers.values()].filter(p=>p.role!=='ignored');
  const role=live.length===0?'primary':live.length===1&&e.pointerType!=='mouse'?'secondary':'ignored';
  this.pointers.set(e.pointerId,{id:e.pointerId,type:e.pointerType,x0:e.clientX,y0:e.clientY,t0:t,x:e.clientX,y:e.clientY,travel:0,dragging:false,role});
  if(role==='secondary'){const d=this.spread();this.pinch={start:d,last:d,latched:false};for(const p of this.pointers.values())p.dragging=p.role!=='ignored';}
  return role!=='ignored';
 }
 move(e:PointerSample){
  const p=this.pointers.get(e.pointerId);
  if(!p){if(e.pointerType==='mouse'){const h=this.hover;this.hover={x:e.clientX,y:e.clientY};if(h)this.sink.mouseMove?.(e.clientX-h.x,e.clientY-h.y,stamp(e,this.o.now));}return;}
  // A release the browser never reported (dragged out, alt-tab, focus steal) ends the drag.
  if(e.buttons===0){this.cancel(e.pointerId);return;}
  if(p.role==='ignored'){p.x=e.clientX;p.y=e.clientY;return;}
  const dx=e.clientX-p.x,dy=e.clientY-p.y;p.x=e.clientX;p.y=e.clientY;p.travel=Math.max(p.travel,Math.hypot(p.x-p.x0,p.y-p.y0));
  if(this.pinch){
   const d=this.spread(),t=stamp(e,this.o.now);
   // Coincident contacts (spread under 2 px) measure from the first usable spread, so zoom stays finite.
   if(!this.pinch.latched&&Math.abs(d-this.pinch.start)>=this.o.pinchLatchPx){this.pinch.latched=true;this.pinch.last=this.pinch.start>2?this.pinch.start:d;}
   if(this.pinch.latched&&d>2&&this.pinch.last>2){const notches=clampNotches(-PINCH_NOTCHES_PER_EFOLD*Math.log(d/this.pinch.last));this.pinch.last=d;this.sink.latch.zoom({notches,source:'pinch',t});}
   return;
  }
  if(!p.dragging&&p.travel>this.o.slop(p.type)){p.dragging=true;return;}
  if(p.dragging)this.sink.latch.look(dx*this.o.lookPerPx.x,dy*this.o.lookPerPx.y);
 }
 up(e:PointerSample){
  const p=this.pointers.get(e.pointerId);if(!p)return;
  this.pointers.delete(e.pointerId);
  const t=stamp(e,this.o.now);
  if(p.role==='primary'&&!p.dragging&&!this.pinch&&p.travel<=this.o.slop(p.type)&&t-p.t0<=this.o.tapMaxMs&&worldKind(this.sink.kind()))this.sink.latch.tap({x:e.clientX,y:e.clientY,t,duration:t-p.t0,pointerType:p.type});
  this.handOver(p);
 }
 /** pointercancel, lostpointercapture and lifecycle: end without a tap. */
 cancel(id:number){const p=this.pointers.get(id);if(!p)return;this.pointers.delete(id);this.handOver(p);}
 cancelAll(){this.pointers.clear();this.pinch=null;this.hover=null;}
 /** After a context change, fingers still down stay ignored until lifted. */
 ignoreActive(){for(const p of this.pointers.values()){p.role='ignored';p.dragging=true;}this.pinch=null;}
 private handOver(lifted:Tracked){
  if(lifted.role==='ignored')return;
  if(this.pinch){
   // Lifting one pinch finger hands over to a one-finger look drag from where the other finger is now.
   this.pinch=null;const rest=[...this.pointers.values()].find(p=>p.role!=='ignored');
   if(rest){rest.role='primary';rest.dragging=true;}
  }
 }
 private spread(){const live=[...this.pointers.values()].filter(p=>p.role!=='ignored');return live.length<2?0:Math.hypot(live[0].x-live[1].x,live[0].y-live[1].y);}
}

type Env={win?:EventTarget;doc?:EventTarget&{hidden?:boolean}};
type Surface=EventTarget&{setPointerCapture?(id:number):void;releasePointerCapture?(id:number):void;hasPointerCapture?(id:number):boolean};
/** Pointer Events only. Captures on down, suppresses the context menu and side-button navigation. */
export function attachPointer(surface:Surface,sink:InputSink,options:PointerOptions&Env&{signal:AbortSignal}){
 const g=new GestureRecognizer(sink,options),win=options.win??globalThis.window,doc=options.doc??globalThis.document,signal=options.signal;
 const release=(id:number)=>{try{if(surface.hasPointerCapture?.(id))surface.releasePointerCapture?.(id);}catch{}};
 const reset=()=>{for(const id of g.ids())release(id);g.cancelAll();};
 surface.addEventListener('pointerdown',ev=>{const e=ev as PointerEvent;if(e.pointerType==='mouse'&&e.button>0){if(e.button!==2)e.preventDefault();return;}if(g.down(e))try{surface.setPointerCapture?.(e.pointerId);}catch{}},{signal});
 surface.addEventListener('pointermove',ev=>{const e=ev as PointerEvent,had=g.ids().includes(e.pointerId);g.move(e);if(had&&!g.ids().includes(e.pointerId))release(e.pointerId);},{signal});
 surface.addEventListener('pointerup',ev=>{const e=ev as PointerEvent;if(e.pointerType==='mouse'&&e.button>0){if(e.button!==2)e.preventDefault();return;}g.up(e);},{signal});
 surface.addEventListener('pointercancel',e=>g.cancel((e as PointerEvent).pointerId),{signal});
 surface.addEventListener('lostpointercapture',e=>g.cancel((e as PointerEvent).pointerId),{signal});
 surface.addEventListener('contextmenu',e=>e.preventDefault(),{signal});
 win.addEventListener('blur',reset,{signal});win.addEventListener('pagehide',reset,{signal});win.addEventListener('resize',reset,{signal});
 doc.addEventListener('visibilitychange',()=>{if(doc.hidden)reset();},{signal});
 return g;
}
