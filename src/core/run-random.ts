/** Named per-player visit streams. Local simulations still receive plain numeric seeds. */
import {wallClock} from './clock';
import {createRng,type Rng} from './rng';
import {appSaveStore} from './save/app-store';

export function createRunRandom(realNow:()=>number=wallClock.realNow){
 const streams=new Map<string,Map<string,Rng>>();
 const stream=(name:string,player:string)=>{
  let owned=streams.get(player);if(!owned){owned=new Map();streams.set(player,owned);}
  let value=owned.get(name);
  if(!value){value=createRng(`${JSON.stringify([player,name])}:${realNow()}`);owned.set(name,value);}
  return value;
 };
 return {
  stream,
  /** Keep the legacy simulation seed range; each new run advances only its own named stream. */
  seed:(name:string,player:string)=>stream(name,player).int(0,99999),
 };
}
const visits=createRunRandom();
let presentationSource:(()=>number)|undefined;
/** Test-only capture adapters can preserve the original global draw order without altering simulation seed streams. */
export function installPresentationRandomSource(source:()=>number):()=>void{
 const previous=presentationSource;presentationSource=source;return ()=>{presentationSource=previous;};
}
/** Read the player at the visit boundary, never in a simulation tick. */
export const runRandom={
 /** Presentation streams live for this tab session, isolated from run seeds and other owners. An explicit player scopes UI choices; boot/preview callers never create a save-store stand-in. */
 next:(name:`fx.${string}`|`ui.${string}`,player?:string)=>presentationSource?presentationSource():visits.stream(name,player??'presentation-session').next(),
 seed:(name:string,player=appSaveStore().activePlayer())=>visits.seed(name,player),
 stream:(name:string,player=appSaveStore().activePlayer())=>visits.stream(name,player),
};
