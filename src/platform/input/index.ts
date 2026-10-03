import {monotonicNow} from '../../core/clock';
import {ActionLatch,HeldInput,heldVector,toDisc,worldKind,type ActionEvent,type ButtonAction,type Direction,type InputFrame,type InputSink} from './frame-actions';
import {InputContextStack,observeDomModals,type ContextKind,type InputContext} from './context';
import {DeviceTracker} from './device';
import {GamepadInput,type GamepadOptions,type PadEdge} from './gamepad';
import {attachKeyboard,type KeyBindings} from './keyboard';
import {attachPointer,type PointerOptions} from './pointer';
import {trapFocus,UiNav} from './ui-nav';
import {attachWheel} from './wheel';

export * from './frame-actions';
export {InputContextStack,observeDomModals,type ContextKind,type InputContext} from './context';
export {DeviceTracker} from './device';
export {padFamily,type PadFamily} from './gamepad';
export {defaultKeyBindings,type KeyBindings} from './keyboard';
export {trapFocus,UiNav} from './ui-nav';

/** Read live every frame, so a settings panel can change them without re-creating the input. */
export type InputSettings={invertX?:boolean;invertY?:boolean;lookSensitivity?:number;nintendoSwap?:boolean;dpad?:'zoom'|'move';vibration?:boolean;singleKeyShortcuts?:boolean};
export type CreateInputOptions={
 /** The canvas that takes taps, drags, the wheel and pinches. */
 surface:EventTarget&{setPointerCapture?(id:number):void};
 signal:AbortSignal;
 /** Share one stack between screens; defaults to a private one. */
 contexts?:InputContextStack;
 /** Mirror viewOwnsInput(host) and .view-covered into a 'modal' context. */
 host?:HTMLElement;
 /** Classes on the host or an ancestor that cover the world, e.g. '.view-covered,.atlas-exploring'. */
 covered?:string;
 label?:string;
 settings?:InputSettings;
 bindings?:KeyBindings;
 pointer?:PointerOptions;
 getPads?:GamepadOptions['getPads'];
 win?:EventTarget&{innerHeight?:number};
 doc?:EventTarget&{hidden?:boolean;body?:{dataset:DOMStringMap}|null;activeElement?:Element|null};
 now?:()=>number;
 devices?:{keyboard?:boolean;pointer?:boolean;wheel?:boolean;gamepad?:boolean};
};
export type Input=ReturnType<typeof createInput>;
/** A sampled frame plus the top context; `mine` is true when the mover's own base context is on top. */
export type SampledFrame=InputFrame&{context:InputContext|null;mine:boolean};
/** Drag and trackpad look arrive per pointer event, not per frame: 60 Hz events against a 45–60 Hz frame give some frames
 *  two deltas and some none, and the view stutters along its orbit. Each frame's event look is spread over the next
 *  2 × LOOK_SPREAD_S seconds with a triangular weight (peak at LOOK_SPREAD_S): the total is kept exactly, the average
 *  delay is LOOK_SPREAD_S, and the per-frame rate stays within about 20% where raw events swing 75–100% (a flat
 *  window leaves a two-frame beat when events come in pairs). The gamepad's per-frame look is already smooth. */
export const LOOK_SPREAD_S=.05;
/** Share of a triangular spread (base 2h) that has passed after x seconds. */
const spreadShare=(x:number,h=LOOK_SPREAD_S)=>x<=0?0:x<=h?x*x/(2*h*h):x<2*h?1-(2*h-x)**2/(2*h*h):1;
const PAD_ACTIONS:Partial<Record<PadEdge,Pick<ActionEvent,'action'|'mode'>>>={confirm:{action:'interact'},back:{action:'back'},pause:{action:'pause'},view:{action:'cameraMode',mode:'cycle'},anchor:{action:'cameraMode',mode:'anchor'},recentre:{action:'recentre'}};

/** One input layer for a mover. Call sample(dt) once per frame, before the character and camera.
 * While another context (viewer, panel, modal) is on top, `frame.mine` is false and the frame is
 * empty; that layer's `onFrame` receives the input instead. */
export function createInput(options:CreateInputOptions){
 const {signal}=options,now=options.now??(monotonicNow),settings=options.settings??{},devices={keyboard:true,pointer:true,wheel:true,gamepad:true,...options.devices};
 const win=options.win??globalThis.window,doc=options.doc??globalThis.document;
 const contexts=options.contexts??new InputContextStack(),held=new HeldInput<Direction>(),latch=new ActionLatch();
 const coarse=(()=>{try{return !!globalThis.matchMedia?.('(pointer: coarse)').matches;}catch{return false;}})();
 const device=new DeviceTracker({body:doc?.body??null,initial:coarse?'touch':'keyboard-mouse'});
 // A layer's own element, else the dialog holding focus (native and DOM-observed modals).
 const scope=()=>{const top=contexts.top();return top&&!worldKind(top.kind)?top.element??doc.activeElement?.closest?.('dialog,[role="dialog"],[aria-modal="true"]')??null:null;};
 const nav=new UiNav({doc:doc as Document,scope});
 const sink:InputSink={held,latch,kind:()=>contexts.topKind(),device:(family,t)=>{device.note(family,t);},mouseMove:(dx,dy,t)=>{device.mouseMove(dx,dy,t);},nav:(direction,target)=>nav.move(direction,target)};
 const handlers=new Map<number,(frame:SampledFrame)=>void>(),plays=new Set<number>();
 /** A ui/modal layer opened with stick:'play' (a minigame) is on top: the sticks and bumpers play, the d-pad keeps menu focus. */
 const playing=()=>{const top=contexts.top();return !!top&&plays.has(top.id);};
 const gamepad=new GamepadInput({getPads:options.getPads,nintendoSwap:()=>!!settings.nintendoSwap,dpad:()=>settings.dpad??'zoom',vibration:()=>settings.vibration!==false,doc,stickNav:()=>!playing()});
 const keyboard=devices.keyboard?attachKeyboard(sink,{signal,win,doc,bindings:options.bindings,now,singleKeyShortcuts:()=>settings.singleKeyShortcuts!==false}):null;
 const pointer=devices.pointer?attachPointer(options.surface,sink,{...options.pointer,signal,win,doc,now}):null;
 const wheel=devices.wheel?attachWheel(options.surface,sink,{signal,win,doc,now}):null;
 let padMoving=false,lookClock=0;const spreading:{x:number;y:number;from:number}[]=[];
 /** Cancel everything held; the next input must be a fresh press, touch or neutral stick. */
 const cancel=()=>{held.clear();latch.clear();pointer?.ignoreActive();gamepad.requireNeutral();nav.reset();wheel?.gestureEnd();padMoving=false;spreading.length=0;};
 const lifecycle=()=>{held.clear();pointer?.cancelAll();gamepad.requireNeutral();gamepad.stopRumble();nav.reset();padMoving=false;spreading.length=0;};
 const stopWatching=contexts.onChange(cancel);
 win.addEventListener('blur',lifecycle,{signal});win.addEventListener('pagehide',lifecycle,{signal});
 doc.addEventListener('visibilitychange',()=>{if(doc.hidden)lifecycle();},{signal});
 const base=contexts.push('gameplay',{label:options.label??'mover'});
 const dom=options.host?observeDomModals(contexts,options.host,{signal,covered:options.covered}):null;
 signal.addEventListener('abort',()=>{stopWatching();base.pop();handlers.clear();gamepad.stopRumble();},{once:true});
 const pointerSource=(e:PointerEvent)=>'pointer:'+e.pointerId;
 /** B on a covering overlay that no layer handles (the travel map, a minigame card): Escape there, and a native dialog
  *  that nobody closed on it closes as Escape would. Never the screen that holds the mover itself. */
 const dismiss=()=>{
  const el=scope() as (HTMLElement&Partial<HTMLDialogElement>)|null;if(!el||options.host&&el.contains(options.host)||typeof KeyboardEvent!=='function')return false;
  const event=Object.assign(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true,cancelable:true}),{inputSynthetic:true}),focus=doc.activeElement;
  (focus&&el.contains(focus)?focus:el).dispatchEvent(event);
  if(el.tagName==='DIALOG'&&el.open&&!event.defaultPrevented){if(typeof el.requestClose==='function')el.requestClose();else{const cancel=new Event('cancel',{cancelable:true});if(el.dispatchEvent(cancel))el.close?.();}}
  return true;
 };

 return {
  contexts,base,device,held,gamepad,keyboard,pointer,wheel,nav,
  /** Latched input since the last call. dt in seconds (clamped to 0.1). */
  sample(dt:number):SampledFrame{
   const t=now(),step=Math.min(Math.max(Number.isFinite(dt)?dt:0,0),.1),top=contexts.top(),world=worldKind(contexts.topKind()),play=!world&&playing();
   let padMove={x:0,y:0},padLook={x:0,y:0};
   if(devices.gamepad){
    const pad=gamepad.poll(step,t);
    if(pad.meaningful)device.note('gamepad',t);
    for(const edge of pad.edges){
     if(!world&&edge==='confirm'){nav.activate();continue;}
     if(!world&&edge==='back'&&!handlers.has(top?.id??-1)&&dismiss())continue;
     const a=PAD_ACTIONS[edge];if(a&&(world||a.action==='back'||a.action==='pause'))latch.action({...a,t,device:'gamepad'});
    }
    if(world||play){for(const z of pad.zoom)latch.zoom(z);padLook=pad.look;const moving=!!(pad.move.x||pad.move.y);if(moving&&!padMoving)latch.moveStarted();padMoving=moving;padMove=pad.move;}
    if(!world)nav.step(pad.nav,t);if(!world&&!play)padMoving=false;
   }
   const out=latch.drain(),keys=world?heldVector(held):{x:0,y:0},move=toDisc(keys.x+padMove.x,keys.y+padMove.y);
   const start=lookClock;lookClock+=step;if(out.look.x||out.look.y)spreading.push({x:out.look.x,y:out.look.y,from:start});
   const spread={x:0,y:0};
   for(let i=spreading.length-1;i>=0;i--){const e=spreading[i]!/* i < spreading.length */,share=spreadShare(lookClock-e.from)-spreadShare(start-e.from);
    spread.x+=e.x*share;spread.y+=e.y*share;if(lookClock-e.from>=2*LOOK_SPREAD_S-1e-9)spreading.splice(i,1);}
   const k=settings.lookSensitivity??1,look={x:(spread.x+padLook.x)*k*(settings.invertX?-1:1),y:(spread.y+padLook.y)*k*(settings.invertY?-1:1)};
   const pressed=new Set<ButtonAction>(out.actions.map(a=>a.action)),mine=!!top&&top===base;
   const frame:SampledFrame={dt:step,move,moveStarted:out.moveStarted,look,zoom:out.zoom,actions:out.actions,pressed,taps:out.taps,cameraInput:!!(look.x||look.y||out.zoom.length||pressed.has('cameraMode')||pressed.has('recentre')),dragging:!!pointer?.dragging,pinching:!!pointer?.pinching,device:device.family,context:top,mine};
   if(mine)return frame;
   // Another context is on top: its layer gets the frame; the mover gets nothing to act on.
   if(top)handlers.get(top.id)?.(frame);
   return {...frame,move:{x:0,y:0},moveStarted:false,look:{x:0,y:0},zoom:[],actions:[],pressed:new Set(),taps:[],cameraInput:false};
  },
  /** Push a viewer, panel or modal layer. ui/modal layers trap focus in `element`, take the
   * d-pad and arrows for spatial navigation, and restore focus to the opener on pop. While the
   * layer is on top, each sampled frame (its actions, and for a viewer its look and zoom) goes to `onFrame`. */
  openLayer(kind:Exclude<ContextKind,'gameplay'>,layer:{element?:HTMLElement;label?:string;onFrame?:(frame:SampledFrame)=>void;initialFocus?:HTMLElement|null;restoreFocus?:()=>HTMLElement|null;stick?:'play'}={}){
   const release=layer.element&&!worldKind(kind)?trapFocus(layer.element,{doc:doc as Document,initial:layer.initialFocus,fallback:layer.restoreFocus}):null;
   const context=contexts.push(kind,{label:layer.label,element:layer.element,onPop:()=>{handlers.delete(context.id);plays.delete(context.id);release?.();}});
   if(layer.onFrame)handlers.set(context.id,layer.onFrame);if(layer.stick==='play'&&!worldKind(kind))plays.add(context.id);
   return context;
  },
  /** Bind an on-screen move pad: per-pointer holds with capture, plus Space/Enter on a focused button. */
  bindMovePad(buttons:Iterable<HTMLElement>,direction:(button:HTMLElement)=>string|undefined){
   for(const b of buttons){
    const dir=direction(b) as Direction|undefined;if(!dir)continue;
    b.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse'&&e.button!==0||!worldKind(contexts.topKind()))return;e.preventDefault();try{b.setPointerCapture(e.pointerId);}catch{}device.note(e.pointerType==='mouse'?'keyboard-mouse':'touch',e.timeStamp||now());if(held.press(pointerSource(e),dir))latch.moveStarted();},{signal});
    for(const type of ['pointerup','pointercancel','lostpointercapture'])b.addEventListener(type,e=>held.release(pointerSource(e as PointerEvent)),{signal});
    b.addEventListener('keydown',e=>{if(e.key!==' '&&e.key!=='Enter'||e.ctrlKey||e.metaKey||e.altKey||!worldKind(contexts.topKind()))return;e.preventDefault();device.note('keyboard-mouse',e.timeStamp||now());if(held.press('padkey:'+dir,dir,e.repeat))latch.moveStarted();},{signal});
    b.addEventListener('keyup',e=>{if(e.key===' '||e.key==='Enter')held.release('padkey:'+dir);},{signal});
    b.addEventListener('blur',()=>held.release('padkey:'+dir),{signal});
   }
  },
  /** Drop all held and in-flight input (e.g. a scripted camera takes over). */
  reset:cancel,
  rumble:(strength?:number,ms?:number)=>gamepad.rumble(strength,ms),
  syncDom:()=>dom?.sync(),
 };
}
