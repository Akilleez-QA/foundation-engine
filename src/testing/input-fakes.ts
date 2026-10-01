/** Node-only fakes for the input tests: events are plain Events with the fields the modules read. */
import {ActionLatch,HeldInput,type Direction,type DeviceFamily,type InputSink} from '../platform/input/frame-actions';
import type {ContextKind} from '../platform/input/context';
import type {PadLike} from '../platform/input/gamepad';

export function ev<T extends Record<string,unknown>>(type:string,fields:T={} as T):Event&T{
 const e=new Event(type,{cancelable:true,bubbles:true});
 for(const [k,v] of Object.entries(fields))Object.defineProperty(e,k,{value:v,configurable:true});
 if('target' in fields)Object.defineProperty(e,'composedPath',{value:()=>[fields.target]});
 return e as Event&T;
}
export const key=(type:'keydown'|'keyup',code:string,key:string,extra:Record<string,unknown>={})=>ev(type,{code,key,repeat:false,ctrlKey:false,metaKey:false,altKey:false,shiftKey:false,isComposing:false,keyCode:0,timeStamp:1,...extra});
export const ptr=(type:string,pointerId:number,x:number,y:number,extra:Record<string,unknown>={})=>ev(type,{pointerId,pointerType:'mouse',clientX:x,clientY:y,button:0,buttons:type==='pointerup'?0:1,timeStamp:0,...extra});
export const wheelEvent=(deltaY:number,extra:Record<string,unknown>={})=>ev('wheel',{deltaX:0,deltaY,deltaMode:0,ctrlKey:false,timeStamp:0,...extra});

export type RecordingSink=InputSink&{devices:DeviceFamily[];navs:Direction[];moves:number;setKind(kind:ContextKind):void;navResult:boolean};
export function recordingSink():RecordingSink{
 let kind:ContextKind='gameplay';
 const sink:RecordingSink={held:new HeldInput<Direction>(),latch:new ActionLatch(),kind:()=>kind,devices:[],navs:[],moves:0,navResult:true,
  device(family){sink.devices.push(family);},mouseMove(){sink.moves++;},nav(direction){sink.navs.push(direction);return sink.navResult;},setKind(k){kind=k;}};
 return sink;
}
export const env=()=>({win:Object.assign(new EventTarget(),{innerHeight:1000}),doc:Object.assign(new EventTarget(),{hidden:false,body:{dataset:{} as DOMStringMap},activeElement:null})});
export type FakePad={index:number;id:string;mapping:string;connected:boolean;axes:number[];buttons:{pressed:boolean;value:number}[];vibrationActuator?:PadLike['vibrationActuator']};
export function fakePad(index=0,id='Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)',mapping='standard'):FakePad&{press(i:number,value?:number):void;release(i:number):void;stick(i:number,x:number,y:number):void}{
 const pad={index,id,mapping,connected:true,axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0})),
  press(i:number,value=1){pad.buttons[i]={pressed:value>.5,value};},release(i:number){pad.buttons[i]={pressed:false,value:0};},stick(i:number,x:number,y:number){pad.axes[i*2]=x;pad.axes[i*2+1]=y;}};
 return pad;
}
/** Chrome-style snapshots: each getGamepads() call returns fresh copies. */
export const snapshots=(pads:(FakePad|null)[])=>{let calls=0;const get=()=>{calls++;return pads.map(p=>p&&{...p,axes:[...p.axes],buttons:p.buttons.map(b=>({...b}))});};return Object.defineProperty(get,'calls',{get:()=>calls}) as typeof get&{readonly calls:number};};
