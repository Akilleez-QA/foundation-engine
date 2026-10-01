/** Read-only view of each stream's current finite selection, supplied by its actual queue owner.
 * Covered/closed streams do not block the foreground capture; this never resumes or drains them. */
export interface TileReadiness { wanted:number; pending:number; decoded:number; unresolved:number; failed:number }
const owners = new Set<() => TileReadiness>();
export function observeTileReadiness(read:()=>TileReadiness):()=>void {
 owners.add(read);return ()=>{owners.delete(read);};
}
export function tileReadiness():TileReadiness {
 const result:TileReadiness={wanted:0,pending:0,decoded:0,unresolved:0,failed:0};
 for(const read of owners){const state=read();for(const key of Object.keys(result) as (keyof TileReadiness)[])result[key]+=state[key];}
 return result;
}
