import test from 'node:test';import assert from 'node:assert/strict';
import {workerModule} from './module';import type {Services} from '../../core/services';import type {WorkerHost} from './host';
test('app worker service is lazy, owns one bounded host and closes its lifetime',async()=>{
 let service:WorkerHost|undefined,spawned=0;
 const module=workerModule({createWorker:()=>{spawned++;throw Error('test worker unavailable');},hardwareConcurrency:4});
 const lease=await module.install!({provide:(_key:string,value:WorkerHost)=>{service=value;},log:{error(){}}} as unknown as Services);
 assert.equal(spawned,0);assert.equal(service!.stats().workers,0);
 const owner=new AbortController();const result=await service!.run({kind:{id:'job.test',cancellation:{mode:'sliced',deadlineMs:10},fallback:{mode:'main-thread',slices:function*(){yield;return 7;}}},owner:{id:'test',signal:owner.signal},version:1,class:'background',bytes:{input:1,output:1,scratch:1},materialise:()=>({input:null})},owner.signal);
 assert.equal(result.status,'done');assert.ok(spawned<=2);lease?.dispose?.();assert.throws(()=>service!.size,/disposed/);
});

test('kit worker rows remain distinct from domain rows and reject non-worker paths',async()=>{
 const {kitJobId,domainJobId}=await import('./job-rows');
 assert.equal(kitJobId('../../kits/terrain/workers/patch.job.ts'),'job.kits.terrain.patch');
 assert.equal(domainJobId('../../domain/terrain/workers/patch.job.ts'),'job.terrain.patch');
 assert.equal(kitJobId('../../kits/terrain/patch.job.ts'),null);
});
