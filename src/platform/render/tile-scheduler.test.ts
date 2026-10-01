import test from 'node:test';
import assert from 'node:assert/strict';
import { createTileScheduler, type TileCaps } from './tile-scheduler';

const caps = (resident: number): TileCaps => ({ resident, concurrency: 4, uploadsPerFrame: 2, decodedBitmapCap: 8 });
const scheme = { id: 'test', key: (n: number) => String(n) };

test('residency is one global count per kind: two streams share the cap, and a full kind admits nothing', () => {
  const s = createTileScheduler(kind => caps(kind === 'sky' ? 3 : 10)), owner = new AbortController();
  const a = s.open(scheme, 'sky', owner.signal), b = s.open(scheme, 'sky', owner.signal), g = s.open(scheme, 'globe', owner.signal);
  assert.equal(a.admit(1), true); assert.equal(a.admit(1), true, 'readmitting a held tile is free');
  assert.equal(b.admit(2), true); assert.equal(b.admit(3), true);
  assert.equal(a.canAdmit(), false); assert.equal(a.admit(4), false); assert.equal(s.resident('sky'), 3);
  assert.equal(g.admit(1), true, 'kinds are counted apart');
  b.release(2); assert.equal(a.admit(4), true); assert.equal(s.resident('sky'), 3);
  assert.deepEqual([a.resident, b.resident, a.has(4), b.has(2)], [2, 1, true, false]);
});

test('closing a stream (or aborting its owner) returns its tiles; caps are read live', () => {
  let cap = 2;
  const s = createTileScheduler(() => caps(cap)), owner = new AbortController(), a = s.open(scheme, 'sky', owner.signal);
  a.admit(1); a.admit(2); assert.equal(a.admit(3), false);
  cap = 3; assert.equal(a.admit(3), true, 'a Graphics change applies at the next admit');
  owner.abort(); assert.equal(s.resident('sky'), 0); assert.equal(a.admit(4), false, 'a closed stream admits nothing');
});

test('pause stops everyone and resume wakes each open stream once', () => {
  const s = createTileScheduler(() => caps(4)), owner = new AbortController(), a = s.open(scheme, 'sky', owner.signal);
  let woke = 0; const stop = a.onResume(() => woke++);
  s.pause(true); assert.equal(a.paused, true); s.pause(true);
  s.pause(false); assert.equal(woke, 1); assert.equal(a.paused, false);
  stop(); s.pause(true); s.pause(false); assert.equal(woke, 1);
  a.onResume(() => woke++); a.close(); s.pause(true); s.pause(false); assert.equal(woke, 1, 'a closed stream is not woken');
});

import {createTileQueue} from './tile-scheduler';
const settle=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
function queueFixture(){
 const scheduler=createTileScheduler(()=>({resident:8,concurrency:2,decodedBitmapCap:3,uploadsPerFrame:1}));
 const owner=new AbortController(),stream=scheduler.open(scheme,'globe',owner.signal);
 const requests:{tile:number;signal:AbortSignal;resolve:(value:number)=>void;reject:(error:unknown)=>void}[]=[];
 const disposed:number[]=[],uploaded:number[]=[],failed:number[]=[];
 const queue=createTileQueue(stream,{key:String,has:n=>stream.has(n),
  load:(tile,signal)=>new Promise<number>((resolve,reject)=>requests.push({tile,signal,resolve,reject})),
  dispose:n=>disposed.push(n),upload:(tile,value)=>{if(!stream.admit(tile))return false;uploaded.push(value);return true;},failed:n=>failed.push(n)});
 return {scheduler,owner,stream,requests,disposed,uploaded,failed,queue};
}
test('shared queue bounds concurrent decodes and ready backlog, then uploads only the frame allowance',async()=>{
 const f=queueFixture();f.queue.setWanted([1,2,3,4,5]);await settle();assert.equal(f.requests.length,2);
 f.requests[0].resolve(1);f.requests[1].resolve(2);await settle();assert.equal(f.requests.length,3);
 f.requests[2].resolve(3);await settle();assert.equal(f.queue.ready,3);assert.equal(f.requests.length,3);
 f.queue.update();await settle();assert.deepEqual(f.uploaded,[1]);assert.equal(f.requests.length,4);
 f.queue.close();f.requests[3].resolve(4);await settle();assert.deepEqual(f.disposed.sort(),[2,3,4]);
});
test('A to B to A cancellation discards stale decode even when it ignores AbortSignal, and restarts the wanted key',async()=>{
 const f=queueFixture();f.queue.setWanted([1]);await settle();const first=f.requests[0];
 f.queue.setWanted([2]);f.queue.setWanted([1]);assert.equal(first.signal.aborted,true);
 await settle();first.resolve(100);await settle();assert.deepEqual(f.disposed,[100]);
 const current=f.requests.at(-1)!;assert.equal(current.tile,1);assert.equal(current.signal.aborted,false);
 current.resolve(1);await settle();f.queue.update();assert.deepEqual(f.uploaded,[1]);f.owner.abort();
});
test('hidden and covered work is cancelled, does not restart until visible, and never marks cancellation as failure',async()=>{
 const f=queueFixture();f.queue.setWanted([1,2,3]);await settle();f.scheduler.pause(true);
 assert.ok(f.requests.every(r=>r.signal.aborted));for(const r of f.requests)r.resolve(r.tile);await settle();
 assert.equal(f.requests.length,2);assert.equal(f.queue.ready,0);assert.deepEqual(f.failed,[]);
 f.scheduler.pause(false);await settle();assert.equal(f.requests.length,4);
 f.queue.pause(true);for(const r of f.requests.slice(2))r.reject(Error('cancelled'));await settle();
 assert.equal(f.requests.length,4);f.queue.pause(false);await settle();assert.equal(f.requests.length,6);f.owner.abort();
 for(const r of f.requests.slice(4))r.resolve(r.tile);await settle();assert.equal(f.queue.ready,0);assert.equal(f.scheduler.resident('globe'),0);
});
test('closed queue disposes pending decode and supports selective retry without retrying permanent failures',async()=>{
 const f=queueFixture();f.queue.setWanted([1,2]);await settle();for(const r of f.requests)r.reject(Error('missing'));await settle();
 f.queue.retry(tile=>tile===2);await settle();assert.equal(f.requests.length,3);assert.equal(f.requests[2].tile,2);
 f.owner.abort();f.requests[2].resolve(2);await settle();assert.deepEqual(f.disposed,[2]);assert.equal(f.queue.ready,0);
});
test('released residency wakes a blocked decoded tile without fetching it again',async()=>{
 const scheduler=createTileScheduler(()=>({resident:1,concurrency:1,decodedBitmapCap:1,uploadsPerFrame:1}));
 const owner=new AbortController(),a=scheduler.open(scheme,'globe',owner.signal),b=scheduler.open(scheme,'globe',owner.signal);
 a.admit(1);let loads=0,wakes=0,uploads=0;
 const queue=createTileQueue(b,{key:String,has:t=>b.has(t),load:async t=>{loads++;return t;},dispose:()=>{},
  upload:t=>{if(!b.admit(t))return false;uploads++;return true;},ready:()=>wakes++});
 queue.setWanted([2]);await settle();queue.update();assert.equal(uploads,0);assert.equal(queue.ready,1);
 const before=wakes;a.release(1);assert.equal(wakes,before+1);queue.update();assert.equal(uploads,1);assert.equal(loads,1);
 owner.abort();assert.equal(scheduler.resident('globe'),0);
});
test('closing before the first queued microtask never calls the decoder',async()=>{
 const f=queueFixture();f.queue.setWanted([1,2]);f.owner.abort();await settle();assert.equal(f.requests.length,0);
});

import {tileReadiness} from './tile-readiness';
test('capture readiness follows finite wanted work through fetch, decode, upload, failure, coverage and close',async()=>{
 const before=tileReadiness(),f=queueFixture();
 const delta=()=>{const s=tileReadiness();return Object.fromEntries(Object.entries(s).map(([k,v])=>[k,v-before[k as keyof typeof before]]));};
 f.queue.setWanted([81]);await settle();
 assert.deepEqual(delta(),{wanted:1,pending:1,decoded:0,unresolved:1,failed:0});
 f.requests[0].resolve(81);await settle();
 assert.deepEqual(delta(),{wanted:1,pending:0,decoded:1,unresolved:1,failed:0},'decoded is not yet presented');
 f.queue.update();assert.equal(delta().unresolved,0);
 f.queue.setWanted([82]);await settle();f.requests.at(-1)!.reject(Error('offline'));await settle();
 assert.equal(delta().failed,1);assert.equal(delta().unresolved,1,'failed visible tile cannot become a false ready');
 f.queue.pause(true);assert.deepEqual(delta(),{wanted:0,pending:0,decoded:0,unresolved:0,failed:0},'covered owner stays paused');
 f.queue.pause(false);assert.equal(delta().failed,1,'revealing restores the actual failed selection');
 f.queue.setWanted([]);assert.equal(delta().unresolved,0,'superseded intent no longer blocks');
 f.owner.abort();assert.deepEqual(tileReadiness(),before,'closed owner releases its observer');
});
