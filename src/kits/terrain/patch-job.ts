import type { WorkerHost } from '../../platform/workers/host';
import type { JobKind, JobOwner } from '../../platform/workers/job';
import { surfaceWire, adoptPatchWire, captureCoreEdits, projectSurfacePatch, surfaceParent, type Surface, type SurfacePatchVertex, type PatchWire } from './surface';
import { regionEdits, regionPatch, type TerrainRegion, type TerrainRegionEdit } from './region';
import { slices, type PatchInput } from './workers/patch.job';
const patchKind:JobKind<PatchInput,PatchWire>={id:'job.kits.terrain.patch',cancellation:{mode:'sliced',deadlineMs:100},fallback:{mode:'main-thread',slices}};
/** Existing app worker host owns scheduling, byte admission, cancellation and fallback. */
export async function prepareSurfacePatch(host:WorkerHost,owner:JobOwner,previous:Surface,revision:number,edits:readonly SurfacePatchVertex[],signal:AbortSignal){
  if(!Number.isSafeInteger(revision)||revision<=previous.revision)throw Error('terrain: invalid patch revision');
  const parent=surfaceParent(previous),backing=parent??previous;
  const recipe=captureCoreEdits(previous,edits).map(e=>parent?{...e,x:e.x+1,z:e.z+1}:e);
  const count=(backing.cellsX+1)*(backing.cellsZ+1);
  // Includes padded samples, retained normal output, detached adoption, core projection and scratch.
  const result=await host.run({kind:patchKind,owner,version:revision,key:previous.id,class:'foreground',bytes:{input:count*16+recipe.length*64+4096,output:count*96+4096,scratch:count*128+4096},materialise:()=>({input:{data:surfaceWire(backing),revision,edits:structuredClone(recipe)}})},signal);
  if(result.status!=='done')return result;
  if(signal.aborted||owner.signal.aborted)return{status:'cancelled' as const};
  if(result.output.data.revision!==revision)throw Error('terrain: worker patch revision mismatch');
  const patch=adoptPatchWire(backing,result.output);
  return{status:'done' as const,patch:parent?projectSurfacePatch(previous,patch):patch};
}
/** Global core/halo edits to one region; routing coherent neighbor updates is creator-owned. */
export async function prepareTerrainRegionPatch(host:WorkerHost,owner:JobOwner,previous:TerrainRegion,revision:number,edits:readonly TerrainRegionEdit[],signal:AbortSignal){
  const recipe=regionEdits(previous,edits),parent=surfaceParent(previous.surface)!;
  const result=await prepareSurfacePatch(host,owner,parent,revision,recipe,signal);
  if(result.status!=='done')return result;
  if(signal.aborted||owner.signal.aborted)return{status:'cancelled' as const};
  return{status:'done' as const,...regionPatch(previous,projectSurfacePatch(previous.surface,result.patch))};
}
