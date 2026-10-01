/** One visit can own several private scenes but only present some of them. Keep fetch ownership independent
 * of simulation time and scene transforms: covering the visit suspends every queue; returning resumes only
 * the current view, never a scene which happened to be visible before a frame transition. */
export function createTileViews<K extends string>(streams:Record<K,{pause(paused:boolean):void}>){
 let visible=new Set<K>(),covered=false;
 const sync=()=>{for(const key of Object.keys(streams) as K[])streams[key].pause(covered||!visible.has(key));};
 sync();
 return {
  show(keys:readonly K[]){if(keys.length===visible.size&&keys.every(key=>visible.has(key)))return;visible=new Set(keys);sync();},
  pause(value:boolean){if(covered===value)return;covered=value;sync();},
 };
}
