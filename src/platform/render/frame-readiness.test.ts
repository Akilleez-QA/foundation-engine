import test from 'node:test';import assert from 'node:assert/strict';
import {createFrameReadiness,FrameReadinessError} from './frame-readiness';
function fixture(){
 let status=0,lost=false,time=0;const calls:string[]=[],tasks=new Map<number,()=>void>();let serial=0;
 const gl={SYNC_GPU_COMMANDS_COMPLETE:1,ALREADY_SIGNALED:2,CONDITION_SATISFIED:3,WAIT_FAILED:4,isContextLost:()=>lost,fenceSync:()=>({}),flush:()=>{calls.push('flush');},deleteSync:()=>{calls.push('delete');},clientWaitSync:(_sync:unknown,flags:number,timeout:number)=>{assert.equal(flags,0);assert.equal(timeout,0);calls.push('poll');return status;}};
 const reader=createFrameReadiness(gl as never,()=>false,{now:()=>time,schedule:fn=>{tasks.set(++serial,fn);return serial;},cancel:id=>{tasks.delete(id as number);}});
 return {gl,reader,calls,tasks,tick(){const [id,fn]=tasks.entries().next().value!;tasks.delete(id);fn();},status:(s:number)=>status=s,lose:()=>lost=true,expire:()=>time=15001};
}
test('fence yields an actual scheduled task and uses only zero-timeout polls',async()=>{const f=fixture(),p=f.reader.wait(new AbortController().signal);assert.deepEqual(f.calls,['flush']);f.status(3);f.tick();assert.equal(await p,'ready');assert.deepEqual(f.calls,['flush','poll','delete']);assert.equal(f.tasks.size,0);});
test('abort, replacement and retirement delete owned syncs before further queries',async()=>{for(const mode of ['abort','retire','replace']){const f=fixture(),owner=new AbortController(),p=f.reader.wait(owner.signal);let next:Promise<unknown>|undefined;if(mode==='abort')owner.abort();else if(mode==='retire')f.reader.retire();else{next=f.reader.wait(owner.signal);f.reader.retire();}assert.equal(await p,'retired');if(next)await next;assert.equal(f.calls.includes('poll'),false);assert.equal(f.tasks.size,0);assert.equal(f.calls.filter(x=>x==='delete').length,mode==='replace'?2:1);}});
test('loss avoids invalid deletion; failure and timeout reject rather than publishing',async()=>{for(const mode of ['loss','failure','timeout']){const f=fixture(),p=f.reader.wait(new AbortController().signal);if(mode==='loss')f.lose();else if(mode==='failure')f.status(4);else f.expire();f.tick();if(mode==='loss'){assert.equal(await p,'retired');assert.equal(f.calls.includes('delete'),false);}else await assert.rejects(p,FrameReadinessError);assert.equal(f.tasks.size,0);}});
test('native callback cancellation cannot publish or leave polling scheduled',async()=>{for(const phase of ['fence','flush','poll']){const f=fixture(),owner=new AbortController();if(phase==='fence')f.gl.fenceSync=()=>{owner.abort();return {};};else if(phase==='flush')f.gl.flush=()=>owner.abort();else f.gl.clientWaitSync=()=>{owner.abort();return 3;};const p=f.reader.wait(owner.signal);if(phase==='poll')f.tick();assert.equal(await p,'retired');assert.equal(f.tasks.size,0);assert.equal(f.calls.filter(x=>x==='delete').length,1);}});
test('cleanup exceptions reject terminally, bounds reject before allocation',async()=>{const f=fixture();f.gl.deleteSync=()=>{throw Error('delete');};const p=f.reader.wait(new AbortController().signal);f.status(3);f.tick();await assert.rejects(p,/delete/);assert.equal(f.tasks.size,0);assert.throws(()=>createFrameReadiness(f.gl as never,()=>false,{maxWaitMs:60001}),/bounds/);});

test('throwing cancellation still removes owner listener and deletes the fence',async()=>{
 const f=fixture(),owner=new AbortController();let removed=0,deletes=0;const remove=owner.signal.removeEventListener.bind(owner.signal);owner.signal.removeEventListener=((...args:Parameters<typeof remove>)=>{removed++;remove(...args);}) as typeof remove;
 f.gl.deleteSync=()=>{deletes++;};const reader=createFrameReadiness(f.gl as never,()=>false,{schedule:()=>1,cancel:()=>{throw Error('cancel');}});
 const pending=reader.wait(owner.signal);reader.retire();await assert.rejects(pending,/cancel/);assert.equal(removed,1);assert.equal(deletes,1);
});
test('abort inside scheduling cancels returned handle; synchronous schedulers reject',async()=>{
 for(const mode of ['abort','sync']){const f=fixture(),owner=new AbortController();let canceled=0;
 const reader=createFrameReadiness(f.gl as never,()=>false,{schedule:fn=>{if(mode==='abort')owner.abort();else fn();return 9;},cancel:id=>{assert.equal(id,9);canceled++;}});
 const pending=reader.wait(owner.signal);if(mode==='abort')assert.equal(await pending,'retired');else await assert.rejects(pending,/must yield/);assert.equal(canceled,1);assert.equal(f.calls.filter(x=>x==='delete').length,1);
 }
});
