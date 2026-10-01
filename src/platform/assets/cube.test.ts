import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {leaseCube,type CubeSpec} from './cube';
import type {TextureLibrary} from './textures';
const spec:CubeSpec={faces:['px','nx','py','ny','pz','nz'],screenPx:8};
function fake(fail=''){
 const calls:string[]=[],released:string[]=[];
 const lib={variant:async()=>({width:16,height:16,path:'x',format:'png'}),texture:async(id:string)=>{calls.push(id);if(id===fail)throw Error('failed face');const value=new T.Texture({width:16,height:16} as HTMLImageElement);let done=false;return {value,release(){if(!done){done=true;released.push(id);}}};}} as unknown as TextureLibrary;
 return {lib,calls,released};
}
test('cube holds all face leases until aggregate release and keeps canonical order',async()=>{
 const f=fake(),life=new AbortController(),lease=await leaseCube(f.lib,spec,life.signal);let disposed=0;lease.value.addEventListener('dispose',()=>disposed++);
 assert.deepEqual(f.calls,spec.faces);assert.equal(f.released.length,0);assert.equal(lease.value.images.length,6);life.abort();lease.release();assert.equal(disposed,1);assert.deepEqual(f.released,spec.faces);
});
test('partial cube failure releases earlier faces and admission rejects before loading',async()=>{
 const f=fake('py');await assert.rejects(leaseCube(f.lib,spec,new AbortController().signal),/failed face/);assert.deepEqual(f.released,['px','nx']);
 const g=fake();await assert.rejects(leaseCube(g.lib,spec,new AbortController().signal,1),/budget/);assert.equal(g.calls.length,0);
});
test('late cube face cannot publish after owner abort',async()=>{
 const f=fake(),life=new AbortController();const old=f.lib.texture;f.lib.texture=async(...args)=>{const result=await old(...args);life.abort();return result;};
 await assert.rejects(leaseCube(f.lib,spec,life.signal),/abort/i);assert.deepEqual(f.released,['px']);
});
test('throwing cube disposal still releases every face exactly once',async()=>{
 const f=fake(),lease=await leaseCube(f.lib,spec,new AbortController().signal);
 lease.value.addEventListener('dispose',()=>{throw Error('GPU listener failed');});
 assert.throws(()=>lease.release(),AggregateError);assert.deepEqual(f.released,spec.faces);
 lease.release();assert.equal(f.released.length,6);
});
test('abort cleanup reports only after all faces are released and contains reporter failure',async()=>{
 const f=fake(),life=new AbortController();let reports=0;
 const lease=await leaseCube(f.lib,spec,life.signal,32*1024*1024,()=>{reports++;assert.equal(f.released.length,6);throw Error('report failed');});
 lease.value.addEventListener('dispose',()=>{throw Error('dispose failed');});
 life.abort();assert.equal(reports,1);lease.release();assert.equal(f.released.length,6);
});
test('partial admission preserves load failure when face cleanup also fails',async()=>{
 const f=fake('py'),texture=f.lib.texture;
 f.lib.texture=async(...args)=>{const lease=await texture(...args);return {...lease,release(){lease.release();throw Error('release failed');}};};
 const errors:unknown[]=[];
 await assert.rejects(leaseCube(f.lib,spec,new AbortController().signal,32*1024*1024,e=>errors.push(e)),/failed face/);
 assert.deepEqual(f.released,['px','nx']);assert.equal(errors.length,1);
});
