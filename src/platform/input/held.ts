/** Physical input owners stay separate: releasing W must not release a held
 * ArrowUp or touch pad. Repeats cannot re-arm input cleared by a lifecycle change.
 */
export class AliasHeldInput {
 private held=new Map<string,string>();
 private jump=false;
 press(source:string,action:string,repeat=false){
  if(repeat)return;
  this.held.set(source,action);
  if(action==='jump')this.jump=true;
 }
 release(source:string){this.held.delete(source);}
 has(action:string){for(const value of this.held.values())if(value===action)return true;return false;}
 delete(action:string){for(const [source,value] of this.held)if(value===action)this.held.delete(source);}
 clear(){this.held.clear();this.jump=false;}
 consumeJump(){const jump=this.jump;this.jump=false;return jump;}
}
