import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkerHost } from '../../platform/workers/host';
import { fakeWorkerFactory } from '../../platform/workers/fake-worker';
import { JobCancelledSignal } from '../../platform/workers/job';
import { basicTerrainRegionJob as job, createTerrainRegionJob, type TerrainRegionRecipe, type TerrainRegionJobInput } from './region-job';
import { prepareSurfacePatch, prepareTerrainRegionPatch } from './patch-job';
import registered from './workers/region.job';
import patchModule from './workers/patch.job';
import type { PatchInput } from './workers/patch.job';
import { createTerrainRegion, type TerrainRegion, patchTerrainRegion } from './region';
import { createTerrainOracle } from './test-oracles';
const options={id:'tile',lattice:{id:'field',revision:1,baseX:.1,baseZ:.17,spacing:.1},startX:-1000,startZ:-4,cellsX:4,cellsZ:4};
const recipe:TerrainRegionRecipe={formatVersion:1,evaluatorVersion:1,region:options,seed:7,parameters:'[2,-3,5]'};
const signal=()=>new AbortController().signal,owner=()=>({id:'terrain',signal:signal()});
const context={checkpoint:async()=>{},cancelled:()=>false};
function oracle(region:TerrainRegion,field=(p:{gx:number;gz:number;x:number;z:number})=>p.x*2-p.z*3+5){
  const reference=createTerrainOracle({...region.lattice,...region},field);
  for(let z=0;z<=4;z++)for(let x=0;x<=4;x++){
    const actual=region.surface.vertex(x,z),expected=reference.vertex(x,z);
    assert.equal(actual.x,expected.x);assert.equal(actual.y,expected.y);assert.equal(actual.z,expected.z);
    for(const k of ['x','y','z'] as const)assert.ok(Math.abs(actual.normal[k]-expected.normal[k])<1e-12);
  }
  for(const [x,z] of [[region.extent.minX,region.extent.minZ],[(region.extent.minX+region.extent.maxX)/2,(region.extent.minZ+region.extent.maxZ)/2]]){
    const p={x:x!,y:50,z:z!},d={x:.001,y:-1,z:.0005},hit=region.surface.raycast(p,d),expected=reference.raycast(p,d);
    assert.equal(!!hit,!!expected);if(hit&&expected)assert.ok(Math.abs(hit.distance-expected.distance)<1e-8);
  }
}
test('TR-01 registered region module, admitted fallback and owned transfer match independent oracle',async()=>{
  const host=createWorkerHost({createWorker:null});
  try{const result=await job.prepare(host,owner(),recipe,signal());assert.equal(result.status,'done');if(result.status==='done')oracle(result.region);}finally{host.dispose();}
  const wire=await registered.run({recipe},context),clone=structuredClone(wire.output,{transfer:[...wire.transfer!]});
  assert.equal(wire.output.data.heights.byteLength,0);
  const fake=fakeWorkerFactory(),worker=createWorkerHost({createWorker:fake.create});
  try{const pending=job.prepare(worker,owner(),recipe,signal());fake.workers[0]!.complete(clone);const result=await pending;assert.equal(result.status,'done');if(result.status==='done'){oracle(result.region);clone.data.heights.fill(0);oracle(result.region);}}finally{worker.dispose();}
});
test('TR-01 creator registered evaluator receives global indices and literal validation is enforced',async()=>{
  const custom=createTerrainRegionJob('job.test.regional',{version:9,validate:p=>p===null,evaluate:p=>({height:p.gx*p.gx/1024+p.gz/8+p.seed})});
  const host=createWorkerHost({createWorker:null});
  try{
    const result=await custom.prepare(host,owner(),{...recipe,evaluatorVersion:9,parameters:'null'},signal());
    assert.equal(result.status,'done');if(result.status==='done')assert.equal(result.region.vertex(2,1).y,Math.fround(998*998/1024-3/8+7));
    await assert.rejects(custom.prepare(host,owner(),{...recipe,evaluatorVersion:9,parameters:'false'},signal()));
    const truthy=createTerrainRegionJob('job.test.truthy',{version:1,validate:()=>1 as never,evaluate:()=>({height:0})});
    await assert.rejects(truthy.prepare(host,owner(),recipe,signal()));assert.equal(host.stats().reservedBytes,0);
  }finally{host.dispose();}
});
test('TR-01 region generation refuses before materialisation, captures queued descriptors and retires reservations',async()=>{
  const fake=fakeWorkerFactory(),host=createWorkerHost({createWorker:fake.create,hardwareConcurrency:8,profile:{maxSlots:1,maxPending:1,maxReservedBytes:64*1024*1024}}),lifetime=owner();
  let materialised=0;const wrapped:typeof host={...host,run(request,sig){return host.run({...request,materialise(){materialised++;return request.materialise();}},sig);}};
  try{
    const first=job.prepare(wrapped,lifetime,recipe,signal());
    const mutable=structuredClone({...recipe,region:{...options,id:'queued'}}),second=job.prepare(wrapped,lifetime,mutable,signal());
    (mutable.region.lattice as {baseX:number}).baseX=900;
    assert.equal((await job.prepare(wrapped,lifetime,{...recipe,region:{...options,id:'refused'}},signal())).status,'saturated');assert.equal(materialised,1);
    fake.workers[0]!.complete((await registered.run({recipe},context)).output);await first;
    const input=fake.workers[0]!.lastRun()!.input as TerrainRegionJobInput;
    assert.equal(input.recipe.region.lattice.baseX,.1);fake.workers[0]!.complete((await registered.run(input,context)).output);assert.equal((await second).status,'done');
    assert.equal(host.stats().reservedBytes,0);
  }finally{host.dispose();}
});
test('TR-01 cancellation checkpoints, supersession and malformed region output cannot publish',async()=>{
  for(const stop of [1,5,10,14]){let checkpoints=0;await assert.rejects(async()=>registered.run({recipe},{cancelled:()=>false,checkpoint:async()=>{if(++checkpoints===stop)throw new JobCancelledSignal();}}),JobCancelledSignal);}
  const fake=fakeWorkerFactory(),host=createWorkerHost({createWorker:fake.create}),lifetime=owner();
  try{
    const old=job.prepare(host,lifetime,recipe,signal()),newer=job.prepare(host,lifetime,{...recipe,region:{...options,lattice:{...options.lattice,revision:2}}},signal());
    assert.equal((await old).status,'superseded');host.dispose();assert.equal((await newer).status,'cancelled');
  }finally{host.dispose();}
  for(const corrupt of [(wire:Awaited<ReturnType<typeof registered.run>>['output'])=>{wire.data.xs[0]!+=1;},(wire:Awaited<ReturnType<typeof registered.run>>['output'])=>{(wire.descriptor.lattice as {id:string}).id='other';},(wire:Awaited<ReturnType<typeof registered.run>>['output'])=>{wire.data.normals![0]=NaN;}]){
    const workers=fakeWorkerFactory(),h=createWorkerHost({createWorker:workers.create});
    try{const pending=job.prepare(h,owner(),recipe,signal()),wire=structuredClone((await registered.run({recipe},context)).output);corrupt(wire);workers.workers[0]!.complete(wire);await assert.rejects(pending);assert.equal(h.stats().reservedBytes,0);}finally{h.dispose();}
  }
});
test('TR-01 fallback and worker regional halo patches preserve old backing and independent normals',async()=>{
  const region=createTerrainRegion(options,p=>({height:p.x*2-p.z*3+5})),edits=[{gx:options.startX-1,gz:options.startZ+1,height:100}];
  const field=(p:{gx:number;gz:number;x:number;z:number})=>p.gx===edits[0]!.gx&&p.gz===edits[0]!.gz?100:p.x*2-p.z*3+5;
  const host=createWorkerHost({createWorker:null});
  try{
    const result=await prepareTerrainRegionPatch(host,owner(),region,2,edits,signal());assert.equal(result.status,'done');
    if(result.status==='done')oracle(result.region,field);oracle(region);
    const local=await prepareSurfacePatch(host,owner(),region.surface,2,[{x:0,z:1,height:100}],signal());assert.equal(local.status,'done');
    if(local.status==='done')assert.deepEqual(local.patch.surface.vertex(0,1),patchTerrainRegion(region,2,[{gx:options.startX,gz:options.startZ+1,height:100}]).region.vertex(0,1));
  }finally{host.dispose();}
  const fake=fakeWorkerFactory(),worker=createWorkerHost({createWorker:fake.create});
  try{
    const pending=prepareTerrainRegionPatch(worker,owner(),region,2,edits,signal());
    const input=fake.workers[0]!.lastRun()!.input as PatchInput;
    assert.equal(input.data.cellsX,options.cellsX+2);const output=await patchModule.run(input,context);fake.workers[0]!.complete(output.output);
    const result=await pending;assert.equal(result.status,'done');if(result.status==='done')oracle(result.region,field);oracle(region);
  }finally{worker.dispose();}
});

test('TR-01 request lifetime and requested patch revision are rechecked after asynchronous delivery',async()=>{
  const region=createTerrainRegion(options,p=>({height:p.x*2-p.z*3+5}));
  for(const mode of ['cancel','revision'] as const){
    const host=createWorkerHost({createWorker:null}),ctrl=new AbortController();
    const wrapped:typeof host={...host,async run(request,sig){
      const result=await host.run(request,sig);
      if(result.status==='done'){
        if(mode==='cancel')ctrl.abort();
        else (result.output as {data:{revision:number}}).data.revision=99;
      }
      return result;
    }};
    try{
      const pending=prepareTerrainRegionPatch(wrapped,{id:'lifetime',signal:ctrl.signal},region,2,[{gx:options.startX-1,gz:options.startZ+1,height:0}],signal());
      if(mode==='cancel')assert.equal((await pending).status,'cancelled');else await assert.rejects(pending,/revision mismatch/);
      oracle(region);assert.equal(host.stats().reservedBytes,0);
    }finally{host.dispose();}
  }
  const host=createWorkerHost({createWorker:null}),ctrl=new AbortController();
  const wrapped:typeof host={...host,async run(request,sig){const result=await host.run(request,sig);ctrl.abort();return result;}};
  try{assert.equal((await job.prepare(wrapped,{id:'lifetime',signal:ctrl.signal},recipe,signal())).status,'cancelled');}finally{host.dispose();}
});
