import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkerHost } from '../../platform/workers/host';
import { fakeWorkerFactory } from '../../platform/workers/fake-worker';
import { JobCancelledSignal } from '../../platform/workers/job';
import { basicTerrainRecipeJob as job, createTerrainRecipeJob } from './recipe-job';
import registered from './workers/recipe.job';
import type { TerrainRecipe } from './recipe';
import { createSurface, type Surface } from './surface';
const recipe: TerrainRecipe = { formatVersion: 1, id: 'tile', revision: 1, originX: 4, originZ: -2, spacing: 1, cellsX: 2, cellsZ: 2, seed: 7, steps: [{ operator: 'plane', version: 1, parameters: '[2,-3,5]' }, { operator: 'height-scale', version: 1, parameters: '[2,1]' }] };
const signal = () => new AbortController().signal;
const owner = () => ({ id: 'terrain', signal: signal() });
const context = { checkpoint: async () => {}, cancelled: () => false };
function oracle(surface: Surface) {
  assert.deepEqual(surface.mesh().positions.filter((_v, i) => i % 3 === 1), [39,43,47,33,37,41,27,31,35]);
  const sample = surface.sample(4.2,-1.3)!;
  assert.ok(Math.abs(sample.height - 35.6) < 1e-10);
  assert.ok(Math.abs(sample.normal.x + 4 / Math.sqrt(53)) < 1e-10);
  assert.ok(Math.abs(sample.normal.z - 6 / Math.sqrt(53)) < 1e-10);
}
test('T3 registered module and admitted fallback agree with independent plane oracle', async () => {
  const host = createWorkerHost({ createWorker: null });
  try {
    const result = await job.prepare(host, owner(), recipe, signal());
    assert.equal(result.status, 'done'); if (result.status !== 'done') return; oracle(result.surface);
    const wire = await registered.run(structuredClone({recipe}), context);
    const clone = structuredClone(wire.output, {transfer: [...wire.transfer!]});
    assert.equal(wire.output.heights.byteLength, 0);
    const fake = fakeWorkerFactory(), workerHost = createWorkerHost({createWorker: fake.create});
    try {
      const pending = job.prepare(workerHost, owner(), recipe, signal());
      fake.workers[0]!.complete(clone);
      const delivered = await pending; assert.equal(delivered.status,'done');
      if (delivered.status === 'done') { oracle(delivered.surface); clone.heights.fill(0); oracle(delivered.surface); }
    } finally { workerHost.dispose(); }
  } finally { host.dispose(); }
});
test('T3 cancellation checkpoints interrupt sampling, intake and normal preparation', async () => {
  // Three sampling rows, three copied rows, then normal accumulation/normalization.
  for (const stop of [1,4,7,9]) {
    let checkpoints=0;
    await assert.rejects(async () => job.module.run({recipe}, {cancelled:()=>false, checkpoint:async()=>{if (++checkpoints===stop) throw new JobCancelledSignal();}}), JobCancelledSignal);
    assert.equal(checkpoints,stop);
  }
});
test('T3 refusal never materialises payload; queued input is captured and live surface stays intact', async () => {
  const fake=fakeWorkerFactory(), host=createWorkerHost({createWorker:fake.create, hardwareConcurrency:8, profile:{maxSlots:1,maxPending:1,maxReservedBytes:64*1024*1024}});
  const lifetime=owner(); const live=createSurface({id:'live',seed:0,baseHeight:0,revision:0,originX:0,originZ:0,cellsX:2,cellsZ:2,spacing:1,layers:[]}); const before=live.mesh();
  let materialised=0;
  const wrapped: typeof host = {...host, run(request,sig) {return host.run({...request,materialise(){materialised++;return request.materialise();}},sig);}};
  try {
    const first=job.prepare(wrapped,lifetime,recipe,signal());
    const mutable={...recipe,id:'queued',steps:recipe.steps.map(s=>({...s}))};
    const queued=job.prepare(wrapped,lifetime,mutable,signal()); mutable.steps[0]!.parameters='[0,0,99]';
    assert.deepEqual(await job.prepare(wrapped,lifetime,{...recipe,id:'refused'},signal()),{status:'saturated'}); assert.equal(materialised,1);
    fake.workers[0]!.complete((await job.module.run({recipe},context)).output); await first;
    const input=fake.workers[0]!.lastRun()!.input as {recipe:TerrainRecipe}; assert.equal(input.recipe.steps[0]!.parameters,'[2,-3,5]');
    fake.workers[0]!.complete((await job.module.run(input,context)).output); assert.equal((await queued).status,'done');
    assert.deepEqual(live.mesh(),before);
  } finally {host.dispose();}
});
test('T3 stale revision and owner cancellation never publish a candidate', async()=>{
  const fake=fakeWorkerFactory(), host=createWorkerHost({createWorker:fake.create,hardwareConcurrency:8,profile:{maxSlots:1,maxPending:2,maxReservedBytes:64*1024*1024}});
  const ctrl=new AbortController(), lifetime={id:'owner',signal:ctrl.signal};
  try {
    const old=job.prepare(host,lifetime,recipe,signal());
    const newer=job.prepare(host,lifetime,{...recipe,revision:2},signal());
    assert.equal((await old).status,'superseded');
    assert.equal((await job.prepare(host,lifetime,recipe,signal())).status,'superseded');
    ctrl.abort(); assert.equal((await newer).status,'cancelled');
  }finally{host.dispose();}
});
test('T3 callback failure retires reservation and malformed worker output cannot be adopted',async()=>{
  const bad=createTerrainRecipeJob('job.test.bad',[{id:'bad',version:1,reads:[],writes:['height'],validate:()=>true,evaluate:()=>{throw Error('creator failed');}}]);
  const host=createWorkerHost({createWorker:null});
  try {await assert.rejects(bad.prepare(host,owner(),{...recipe,steps:[{operator:'bad',version:1,parameters:'null'}]},signal()),/creator failed/);assert.equal(host.stats().reservedBytes,0);}finally{host.dispose();}
  const fake=fakeWorkerFactory(), workerHost=createWorkerHost({createWorker:fake.create});
  try {const pending=job.prepare(workerHost,owner(),recipe,signal());const output=(await job.module.run({recipe},context)).output;output.heights[0]=NaN;fake.workers[0]!.complete(output);await assert.rejects(pending,/invalid/);}finally{workerHost.dispose();}
});

test('T3 prepared jobs integrate with generation ownership without implicit publication', async () => {
  const { createTerrainOwner, prepareTerrainGeneration } = await import('./generation');
  const layout = [{key:'whole',startX:0,startZ:0,cellsX:2,cellsZ:2,stride:1 as const}];
  const initial = prepareTerrainGeneration(createSurface({id:'tile',revision:0,originX:4,originZ:-2,cellsX:2,cellsZ:2,spacing:1,seed:7,baseHeight:0}),layout);
  const terrain = createTerrainOwner(initial,{maxBytes:initial.bytes*4});
  const fake=fakeWorkerFactory(),host=createWorkerHost({createWorker:fake.create});
  let finished!:()=>void; const completed=new Promise<void>(resolve=>{finished=resolve;});
  try {
    assert.equal(terrain.request(1,initial.bytes,async signal=>{
      const candidate=await job.prepare(host,owner(),recipe,signal);
      assert.equal(candidate.status,'done'); if(candidate.status!=='done') throw Error('candidate unavailable');
      const generation=prepareTerrainGeneration(candidate.surface,layout); finished(); return generation;
    }),'accepted');
    await Promise.resolve();
    assert.equal(terrain.current,initial);
    fake.workers[0]!.complete((await job.module.run({recipe},context)).output);
    await completed; for(let i=0;i<8;i++) await Promise.resolve();
    assert.equal(terrain.current,initial);
    assert.equal(terrain.publish(()=>false),false); assert.equal(terrain.current,initial);
    assert.equal(terrain.publish(()=>true),true); oracle(terrain.current.surface);
  }finally{terrain.close();host.dispose();}
});
