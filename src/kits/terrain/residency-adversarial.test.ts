import {test} from 'node:test';import assert from 'node:assert/strict';import {createResidency} from './residency';
const settle=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
test('residency callback close/cancel cannot republish released output',async()=>{
 for(const action of ['close','cancel'] as const){const freed:number[]=[];const r=createResidency<number>({requests:1,resident:1,bytes:20},x=>freed.push(x));r.request('a',1,10,async()=>1);await settle();
 assert.equal(r.publish(1,20,()=>{if(action==='close')r.close();else r.cancel('a');return true;}),0);assert.equal(r.get('a'),undefined);assert.deepEqual(freed,[1]);assert.equal(r.stats().bytes,0);}
});
test('residency release callback reentry does not dispose the same output twice',async()=>{
 const freed:number[]=[];const r=createResidency<number>({requests:1,resident:1,bytes:20},x=>{freed.push(x);r.cancel('a');r.evict('a');});
 r.request('a',1,10,async()=>1);await settle();r.close();assert.deepEqual(freed,[1]);assert.equal(r.stats().bytes,0);
});
test('residency admission snapshots limits against external mutation',()=>{
 const limits={requests:1,resident:1,bytes:10},r=createResidency(limits,()=>{});limits.bytes=100;
 assert.equal(r.request('a',1,11,async()=>1),'saturated');r.close();
});
