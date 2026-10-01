/** Lifecycle ownership for frame-polled controllers. Like any held-input owner,
 * resuming control requires a neutral sample, including on controller replacement. */
export class GamepadFocusGate {
 private identity:string|null=null;
 private armed=false;
 reset(){this.armed=false;}
 accepts(pad:Pick<Gamepad,'index'|'id'|'connected'>|null|undefined,enabled:boolean,neutral:boolean){
  if(!enabled||!pad?.connected){this.reset();if(!pad)this.identity=null;return false;}
  const identity=`${pad.index}:${pad.id}`;
  if(identity!==this.identity){this.identity=identity;this.reset();}
  if(!this.armed){if(neutral)this.armed=true;return false;}
  return true;
 }
}
