import {Repeater,type Direction,type Vec2,type ZoomStep} from './frame-actions';

/** Frame-polled gamepad reader. getGamepads() is called once per poll and only primitives are
 * kept (Chrome returns frozen snapshots). After connect, reset or a context change a pad must be
 * seen in neutral before it counts, so the wake press and held buttons never fire. */
export type PadButtonLike={pressed:boolean;value:number};
export type PadLike={index:number;id:string;mapping:string;connected:boolean;axes:readonly number[];buttons:readonly PadButtonLike[];vibrationActuator?:{playEffect?(type:string,params:object):Promise<unknown>;reset?():Promise<unknown>}|null};
export type PadFamily='xbox'|'playstation'|'nintendo'|'steamdeck'|'generic';
export type PadEdge='confirm'|'back'|'pause'|'view'|'anchor'|'recentre';
export type PadFrame={connected:boolean;family:PadFamily|null;move:Vec2;look:Vec2;edges:PadEdge[];zoom:ZoomStep[];nav:Direction|null;meaningful:boolean;disconnected:boolean};
export type GamepadOptions={
 getPads?:(()=>readonly (PadLike|null)[])|undefined;
 /** Nintendo layout: the right face button confirms and the bottom one goes back. */
 nintendoSwap?:()=>boolean;
 /** 'zoom': d-pad up/down zooms; 'move': the d-pad moves, for digital-only play. LB/RB zoom either way. */
 dpad?:()=>'zoom'|'move';
 /** Full-tilt look speed, radians per second. */
 lookRate?:{x:number;y:number};
 doc?:{hidden?:boolean};
 vibration?:()=>boolean;
 /** False while a play layer owns the left stick: only the d-pad moves menu focus then. */
 stickNav?:()=>boolean;
};
export const MOVE_DEAD=.18,LOOK_DEAD=.15,OUTER_DEAD=.95,LOOK_CURVE=1.6,TRIGGER_PRESS=.55,TRIGGER_RELEASE=.45,MENU_ENGAGE=.5,MENU_RELEASE=.35;
export const ZOOM_REPEAT_DELAY=400,ZOOM_REPEAT_INTERVAL=150;
/** Scaled radial dead zone: no kick at the edge, full range kept, magnitude ≤ 1, then the curve. */
export function scaledRadial(x:number,y:number,inner:number,outer=OUTER_DEAD,curve=1):Vec2{
 if(!Number.isFinite(x)||!Number.isFinite(y))return {x:0,y:0};
 const m=Math.hypot(x,y);if(m<=inner)return {x:0,y:0};
 const k=Math.pow(Math.min(1,(m-inner)/(outer-inner)),curve)/m;return {x:x*k,y:y*k};
}
/** Digital reading with hysteresis: pressed from .55, released at .45 (worn triggers still work). */
export const buttonDown=(b:PadButtonLike|undefined,was:boolean)=>{if(!b)return false;const v=Math.max(Number.isFinite(b.value)?b.value:0,b.pressed&&!(b.value>0)?1:0);return was?v>TRIGGER_RELEASE:v>=TRIGGER_PRESS;};
export function padFamily(id:string):PadFamily{
 const vendor=(/vendor:\s*([0-9a-f]{1,4})/i.exec(id)??/^([0-9a-f]{1,4})-[0-9a-f]{1,4}-/i.exec(id))?.[1]?.toLowerCase().padStart(4,'0');
 if(vendor==='28de'||/steam/i.test(id))return 'steamdeck';
 if(vendor==='057e'||/nintendo|pro controller|joy-con/i.test(id))return 'nintendo';
 if(vendor==='054c'||/dualsense|dualshock|playstation/i.test(id))return 'playstation';
 if(vendor==='045e'||/xinput|xbox/i.test(id))return 'xbox';
 return 'generic';
}
/** Non-standard pads often report the d-pad as one hat axis (commonly 9): −1 up, clockwise in
 * steps of 2/7, about 1.29 at rest. Values off the eight steps are not a hat. */
export function hatDirection(v:number|undefined):{x:number;y:number}{
 if(v===undefined||!Number.isFinite(v))return {x:0,y:0};
 const step=Math.round((v+1)/(2/7));if(step<0||step>7||Math.abs(-1+step*2/7-v)>.05)return {x:0,y:0};
 const angle=step*Math.PI/4;return {x:Math.round(Math.sin(angle)),y:Math.round(Math.cos(angle))};
}
const identity=(p:PadLike)=>`${p.index}:${p.id}`;
type Read={buttons:boolean[];move:Vec2;look:Vec2;dpad:{x:number;y:number};stick:Vec2};
type PadState={buttons:boolean[];armed:boolean;strongFrames:number};
const STANDARD={confirm:0,back:1,view:8,pause:9,anchor:11,recentre:3,zoomOut:4,zoomIn:5,up:12,down:13,left:14,right:15};

export class GamepadInput{
 private states=new Map<string,PadState>();private active:string|null=null;private activeIndex=-1;private everActive=false;
 private zoomRepeat=new Repeater(ZOOM_REPEAT_DELAY,ZOOM_REPEAT_INTERVAL);private navHeld:Direction|null=null;
 family:PadFamily|null=null;
 constructor(private options:GamepadOptions={}){}
 private pads():PadLike[]{try{const list=(this.options.getPads??(()=>(globalThis.navigator?.getGamepads?.()??[]) as readonly (PadLike|null)[]))();return Array.from(list??[]).filter((p):p is PadLike=>!!p&&p.connected);}catch{return [];}}
 /** Call once per frame. dt in seconds, now in ms. */
 poll(dt:number,now:number):PadFrame{
  const frame:PadFrame={connected:false,family:null,move:{x:0,y:0},look:{x:0,y:0},edges:[],zoom:[],nav:null,meaningful:false,disconnected:false};
  const pads=this.pads(),seen=new Set(pads.map(identity));
  for(const key of [...this.states.keys()])if(!seen.has(key))this.states.delete(key);
  if(this.active&&!seen.has(this.active)){
   // The active pad vanished: pause, drop held state and repeat timers.
   frame.disconnected=this.everActive;this.active=null;this.activeIndex=-1;this.everActive=false;this.family=null;this.zoomRepeat.reset();this.navHeld=null;
   if(frame.disconnected)frame.edges.push('pause');
  }
  if(!pads.length)return frame;
  const reads=pads.map(p=>({pad:p,read:this.read(p)}));
  // Most recent meaningful input picks the active pad; a lying-around pad cannot steer by drift.
  for(const {pad,read} of reads){const s=this.state(pad);const edge=read.buttons.some((b,i)=>b&&!s.buttons[i]);if(s.armed&&(edge||Math.hypot(read.move.x,read.move.y)>MENU_ENGAGE)&&identity(pad)!==this.active){this.active=identity(pad);this.activeIndex=pad.index;this.zoomRepeat.reset();}}
  const chosen=reads.find(r=>identity(r.pad)===this.active)??reads.find(r=>r.pad.mapping==='standard')??reads[0]!; // pads (and so reads) is non-empty here
  if(!this.active){this.active=identity(chosen.pad);this.activeIndex=chosen.pad.index;}
  frame.connected=true;this.family=frame.family=padFamily(chosen.pad.id);
  for(const {pad,read} of reads){
   const s=this.state(pad);
   if(!s.armed){const neutral=!read.buttons.some(Boolean)&&!read.move.x&&!read.move.y&&!read.look.x&&!read.look.y&&!read.dpad.x&&!read.dpad.y;s.buttons=read.buttons;if(neutral)s.armed=true;continue;}
   if(pad!==chosen.pad){s.buttons=read.buttons;continue;}
   const prev=s.buttons,pressed=(i:number)=>read.buttons[i]&&!prev[i];s.buttons=read.buttons;
   const swap=this.options.nintendoSwap?.()??false,confirm=swap?STANDARD.back:STANDARD.confirm,back=swap?STANDARD.confirm:STANDARD.back;
   if(pressed(confirm))frame.edges.push('confirm');if(pressed(back))frame.edges.push('back');
   if(pressed(STANDARD.pause))frame.edges.push('pause');if(pressed(STANDARD.view))frame.edges.push('view');
   if(pressed(STANDARD.anchor))frame.edges.push('anchor');if(pressed(STANDARD.recentre))frame.edges.push('recentre');
   // A play layer (stickNav off) keeps the d-pad for menu focus only: it neither moves nor zooms.
   const play=this.options.stickNav?.()===false,dpadMove=!play&&(this.options.dpad?.()??'zoom')==='move';
   frame.move=dpadMove&&(read.dpad.x||read.dpad.y)?{x:read.dpad.x/Math.hypot(read.dpad.x,read.dpad.y),y:read.dpad.y/Math.hypot(read.dpad.x,read.dpad.y)}:read.move;
   const rate=this.options.lookRate??{x:120*Math.PI/180,y:70*Math.PI/180},step=Math.min(Math.max(dt,0),.1);
   frame.look={x:read.look.x*rate.x*step,y:read.look.y*rate.y*step};
   // The bumpers always zoom (LB out, RB in), so a moving d-pad (dpad 'move') keeps a zoom control.
   const zoomKey=!dpadMove&&!play&&read.dpad.y?(read.dpad.y>0?'in':'out'):read.buttons[STANDARD.zoomIn]?'in':read.buttons[STANDARD.zoomOut]?'out':null,z=this.zoomRepeat.update(zoomKey,now);
   const notches=zoomKey==='in'?-1:1;if(z.first)frame.zoom.push({notches,source:'pad',t:now});for(let i=0;i<z.repeats;i++)frame.zoom.push({notches,source:'repeat',t:now});
   frame.nav=this.menuDirection(read);
   const strong=Math.hypot(read.move.x,read.move.y)>MENU_ENGAGE||Math.hypot(read.look.x,read.look.y)>MENU_ENGAGE;s.strongFrames=strong?s.strongFrames+1:0;
   frame.meaningful=s.strongFrames>=2||read.buttons.some((_,i)=>i!==16&&pressed(i));
   if(frame.meaningful||frame.zoom.length)this.everActive=true;
  }
  return frame;
 }
 /** After a context change, reset, blur or return from hidden: everything must be released first. */
 requireNeutral(){for(const s of this.states.values())s.armed=false;this.zoomRepeat.reset();this.navHeld=null;}
 /** Short, gentle, feature-detected; never while hidden. */
 rumble(strength=.3,ms=80){
  if(this.activeIndex<0||this.options.doc?.hidden||globalThis.document?.hidden||this.options.vibration?.()===false)return false;
  try{const pad=this.pads().find(p=>p.index===this.activeIndex),effect=pad?.vibrationActuator?.playEffect;if(!effect)return false;const m=Math.max(0,Math.min(.5,strength));effect.call(pad!.vibrationActuator,'dual-rumble',{duration:Math.max(0,Math.min(200,ms)),startDelay:0,strongMagnitude:m,weakMagnitude:m}).catch(()=>{});return true;}catch{return false;}
 }
 stopRumble(){try{for(const pad of this.pads())pad.vibrationActuator?.reset?.()?.catch?.(()=>{});}catch{}}
 private state(pad:PadLike){const key=identity(pad);let s=this.states.get(key);if(!s){s={buttons:[],armed:false,strongFrames:0};this.states.set(key,s);}return s;}
 private read(p:PadLike):Read{
  const was=this.states.get(identity(p))?.buttons??[];
  const buttons=Array.from({length:Math.max(17,p.buttons.length)},(_,i)=>buttonDown(p.buttons[i],!!was[i]));
  const ax=(i:number)=>{const v=p.axes[i];return v!==undefined&&Number.isFinite(v)?v:0;};
  const standard=p.mapping==='standard',move=scaledRadial(ax(0),ax(1),MOVE_DEAD);
  // Unknown layouts often put triggers resting at −1 on axes 2–5, so only the standard mapping looks.
  const look=standard?scaledRadial(ax(2),ax(3),LOOK_DEAD,OUTER_DEAD,LOOK_CURVE):{x:0,y:0};
  let dpad={x:Number(buttons[15])-Number(buttons[14]),y:Number(buttons[12])-Number(buttons[13])};
  if(!standard&&!dpad.x&&!dpad.y){dpad=hatDirection(p.axes[9]);for(const i of [12,13,14,15])buttons[i]=i===12?dpad.y>0:i===13?dpad.y<0:i===14?dpad.x<0:dpad.x>0;}
  return {buttons,move:{x:move.x,y:-move.y||0},look,dpad,stick:{x:ax(0),y:-ax(1)||0}};
 }
 private menuDirection(read:Read):Direction|null{
  if(read.dpad.y)return this.navHeld=read.dpad.y>0?'up':'down';
  if(read.dpad.x)return this.navHeld=read.dpad.x>0?'right':'left';
  if(this.options.stickNav?.()===false)return this.navHeld=null;
  // Raw stick magnitude with hysteresis, so a thumb resting near the threshold cannot stream presses.
  const {x,y}=read.stick,m=Math.hypot(x,y);
  if(m<MENU_RELEASE||!this.navHeld&&m<MENU_ENGAGE)return this.navHeld=null;
  return this.navHeld=Math.abs(x)>Math.abs(y)?(x>0?'right':'left'):(y>0?'up':'down');
 }
}
