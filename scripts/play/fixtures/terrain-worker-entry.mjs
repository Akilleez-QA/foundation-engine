import {createWorkerHost} from '../../../src/platform/workers/host.ts';
import {prepareTerrainRecipe} from '../../../src/kits/terrain/recipe-job.ts';
import {createSurface} from '../../../src/kits/terrain/surface.ts';
import {createTerrainOwner,prepareTerrainGeneration} from '../../../src/kits/terrain/generation.ts';
const recipe={formatVersion:1,id:'tile',revision:1,originX:4,originZ:-2,spacing:1,cellsX:2,cellsZ:2,seed:7,steps:[{operator:'plane',version:1,parameters:'[2,-3,5]'},{operator:'height-scale',version:1,parameters:'[2,1]'}]};
const layout=[{key:'whole',startX:0,startZ:0,cellsX:2,cellsZ:2,stride:1}];
window.runTerrainWorkerCheck=async()=>{
 const host=createWorkerHost(),fallback=createWorkerHost({createWorker:null});
 const owner={id:'diagnostic',signal:new AbortController().signal};
 const initial=prepareTerrainGeneration(createSurface({...recipe,revision:0,baseHeight:0}),layout);
 const terrain=createTerrainOwner(initial,{maxBytes:initial.bytes*4});
 try{
  const result=await prepareTerrainRecipe(host,owner,recipe,new AbortController().signal);
  const inline=await prepareTerrainRecipe(fallback,owner,recipe,new AbortController().signal);
  if(result.status!=='done'||inline.status!=='done')throw Error('Generation unavailable');
  const sample=result.surface.sample(4.2,-1.3),before=terrain.current.surface.revision;
  terrain.request(1,initial.bytes,async()=>prepareTerrainGeneration(result.surface,layout));
  for(let i=0;i<8;i++)await Promise.resolve();
  const prepared=terrain.current.surface.revision;
  const declined=terrain.publish(()=>false),afterDecline=terrain.current.surface.revision;
  const accepted=terrain.publish(()=>true),after=terrain.current.surface.revision;
  const abort=new AbortController();abort.abort();
  const cancelled=await prepareTerrainRecipe(host,owner,{...recipe,revision:2},abort.signal);
  const stale=await prepareTerrainRecipe(host,owner,{...recipe,revision:0},new AbortController().signal);
  return {worker:host.stats(),fallback:fallback.stats(),mesh:result.surface.mesh(),inline:inline.surface.mesh(),sample,before,prepared,declined,afterDecline,accepted,after,cancelled:cancelled.status,stale:stale.status};
 }finally{terrain.close();host.dispose();fallback.dispose();}
};
