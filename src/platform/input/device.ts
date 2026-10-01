import type {DeviceFamily} from './frame-actions';

/** Last-used device family for prompts, with a dwell so two live devices cannot flicker.
 * Mouse movement alone switches to keyboard-mouse only after 24 px within 250 ms, and never away
 * from the gamepad: a Steam Deck trackpad moves the mouse while the stick is in use. The gamepad
 * reader reports only button edges and sustained post-dead-zone stick input, never noise. */
export type DeviceTrackerOptions={dwellMs?:number;initial?:DeviceFamily;body?:{dataset:DOMStringMap}|null;onChange?:(family:DeviceFamily)=>void};
export class DeviceTracker{
 family:DeviceFamily;private changedAt=-Infinity;private moves:{t:number;d:number}[]=[];
 private readonly dwell:number;private readonly body:{dataset:DOMStringMap}|null;
 constructor(private options:DeviceTrackerOptions={}){
  this.dwell=options.dwellMs??500;this.family=options.initial??'keyboard-mouse';
  this.body=options.body!==undefined?options.body:(globalThis.document?.body??null);this.publish();
 }
 /** A meaningful input: keydown, press, touch, gamepad edge. Returns whether the family changed. */
 note(family:DeviceFamily,t:number){
  if(family===this.family)return false;
  if(t-this.changedAt<this.dwell)return false;
  this.family=family;this.changedAt=t;this.moves=[];this.publish();this.options.onChange?.(family);return true;
 }
 /** Hover movement of a mouse (or a trackpad pretending to be one). */
 mouseMove(dx:number,dy:number,t:number){
  if(this.family==='keyboard-mouse'||this.family==='gamepad')return false;
  this.moves.push({t,d:Math.hypot(dx,dy)});this.moves=this.moves.filter(m=>t-m.t<=250);
  return this.moves.reduce((sum,m)=>sum+m.d,0)>24?this.note('keyboard-mouse',t):false;
 }
 private publish(){if(this.body)this.body.dataset.inputDevice=this.family;}
}
