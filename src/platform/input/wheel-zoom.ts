/**
 * Shared wheel, trackpad-pinch and Safari-gesture zoom. Deltas are normalized
 * to pixels (line ×16, page ×600) and clamped per event, so a Firefox notch, a
 * Chrome notch and a momentum burst all stay bounded. A ctrlKey wheel without a
 * physical Control key held is a trackpad pinch and gets extra gain.
 */
export const WHEEL_LINE_PX=16,WHEEL_PAGE_PX=600,WHEEL_CLAMP_PX=70,WHEEL_RATE=.002,PINCH_GAIN=10;
const MAX_STEP=Math.exp(WHEEL_CLAMP_PX*WHEEL_RATE);
/** Pixels for one wheel event. Reads deltaMode before deltaY: Firefox converts line units to pixels if a delta is read first. */
export function wheelPixels(e:{deltaMode:number;deltaY:number},pinch=false){const mode=e.deltaMode,delta=e.deltaY;return Math.max(-WHEEL_CLAMP_PX,Math.min(WHEEL_CLAMP_PX,delta*(mode===1?WHEEL_LINE_PX:mode===2?WHEEL_PAGE_PX:1)*(pinch?PINCH_GAIN:1)));}
/** Multiplicative distance factor (>1 zooms out). +N then −N returns exactly to the start. */
export function wheelZoomFactor(e:{deltaMode:number;deltaY:number},pinch=false){return Math.exp(wheelPixels(e,pinch)*WHEEL_RATE);}
export function trackpadZoomFactor(delta:number,mode=0,pinch=false){return wheelZoomFactor({deltaMode:mode,deltaY:delta},pinch);}
/** Factor for a Safari gesturechange: `ratio` is scale/lastScale, so spreading (>1) zooms in. Bounded like one wheel event. */
export function gestureZoomFactor(ratio:number){return ratio>0&&Number.isFinite(ratio)?Math.max(1/MAX_STEP,Math.min(MAX_STEP,1/ratio)):1;}
type Targets={window?:EventTarget;document?:EventTarget&{hidden?:boolean}};
/**
 * Installs wheel, pinch and Safari gesture zoom on `el`; everything is removed by `signal`.
 * `enabled` gates handling entirely (a disabled viewer lets the event through untouched).
 */
export function installWheelZoom(el:EventTarget,zoom:(factor:number)=>void,{signal,enabled=()=>true,capture=false,stopImmediate=false,window:win=globalThis.window,document:doc=globalThis.document}:{signal:AbortSignal;enabled?:()=>boolean;capture?:boolean;stopImmediate?:boolean}&Targets){
 // Physical Control state: a ctrlKey wheel without it is a trackpad pinch.
 let control=false,pinchWheelAt=-Infinity,gesture:{last:number;wheel:boolean}|null=null;const touches=new Set<number>();
 const reset=()=>{control=false;gesture=null;touches.clear();};
 const key=(e:Event)=>{control=(e as KeyboardEvent).ctrlKey;};
 win.addEventListener('keydown',key,{capture:true,signal});win.addEventListener('keyup',key,{capture:true,signal});win.addEventListener('blur',reset,{signal});
 doc.addEventListener('visibilitychange',()=>{if(doc.hidden)reset();},{signal});
 // iOS Safari also sends gesture events for a two-finger touch pinch the pointer handlers already zoom.
 el.addEventListener('pointerdown',e=>{if((e as PointerEvent).pointerType==='touch')touches.add((e as PointerEvent).pointerId);},{capture:true,signal});
 for(const name of ['pointerup','pointercancel','lostpointercapture'])el.addEventListener(name,e=>touches.delete((e as PointerEvent).pointerId),{capture:true,signal});
 el.addEventListener('wheel',event=>{if(!enabled())return;const e=event as WheelEvent;e.preventDefault();if(stopImmediate)e.stopImmediatePropagation();const pinch=e.ctrlKey&&!control;
  if(pinch){pinchWheelAt=e.timeStamp;if(gesture)gesture.wheel=true;}zoom(wheelZoomFactor(e,pinch));},{capture,passive:false,signal});
 // Safari: gesture scale is cumulative since gesturestart. Once Safari also sends ctrl-wheels for this pinch, those are the only zoom source.
 el.addEventListener('gesturestart',e=>{e.preventDefault();gesture={last:1,wheel:e.timeStamp-pinchWheelAt<250};},{passive:false,signal});
 el.addEventListener('gesturechange',e=>{e.preventDefault();const scale=(e as Event&{scale?:number}).scale??1;if(!gesture||!(scale>0))return;const ratio=scale/gesture.last;gesture.last=scale;if(gesture.wheel||touches.size||!enabled())return;zoom(gestureZoomFactor(ratio));},{passive:false,signal});
 el.addEventListener('gestureend',e=>{e.preventDefault();gesture=null;},{passive:false,signal});
 return {reset,get physicalControl(){return control;}};
}
