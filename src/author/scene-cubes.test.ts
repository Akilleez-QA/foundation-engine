import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {bindSceneCubes, type CubeLoader} from './scene-cubes';
import type {CubeSpec} from '../platform/assets/cube';
import type {Lease} from '../platform/assets/lease-cache';
import type {TextureLibrary} from '../platform/assets/textures';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function until(ready:()=>boolean){
 const deadline=performance.now()+2000;
 while(!ready()){if(performance.now()>deadline)assert.fail('cube binding did not reach expected state');await flush();}
}
test('cube replacement retains usable old background and separate reflection until ready',async()=>{
 let unblock:()=>void=()=>{};const paused=new Promise<void>(r=>unblock=r);let released=0;
 const library={variant:async()=>({width:2,height:2}),texture:async(id:string)=>{if(id==='later')await paused;return {value:new T.Texture({width:2,height:2} as HTMLImageElement),release(){released++;}};}} as unknown as TextureLibrary;
 const scene=new T.Scene(),life=new AbortController(),errors:unknown[]=[];const owner=bindSceneCubes(scene,library,life.signal,()=>{},e=>errors.push(e));
 const spec=(id:string)=>({faces:[id,id,id,id,id,id] as [string,string,string,string,string,string],screenPx:1});
 owner.sync(spec('first'));await until(()=>scene.background instanceof T.CubeTexture);const old=scene.background;assert.ok(old instanceof T.CubeTexture);assert.equal(scene.environment,null);
 owner.sync(spec('later'));await flush();assert.equal(scene.background,old);assert.equal(released,0);
 unblock();await until(()=>scene.background!==old);assert.notEqual(scene.background,old);assert.equal(released,6);
 owner.sync(undefined,undefined,0x112233);assert.equal((scene.background as unknown as T.Color).getHex(),0x112233);assert.equal(released,12);owner.dispose();assert.deepEqual(errors,[]);
});
test('replacement and two-binding teardown finish despite disposal failures',async()=>{
 let released=0,invalidations=0;const errors:unknown[]=[];
 const library={variant:async()=>({width:2,height:2}),texture:async()=>({value:new T.Texture({width:2,height:2} as HTMLImageElement),release(){released++;}})} as unknown as TextureLibrary;
 const scene=new T.Scene(),life=new AbortController();
 const owner=bindSceneCubes(scene,library,life.signal,()=>{invalidations++;},e=>errors.push(e));
 const spec=(id:string)=>({faces:[id,id,id,id,id,id] as [string,string,string,string,string,string],screenPx:1});
 owner.sync(spec('old'),spec('reflection'));await until(()=>!!scene.background&&!!scene.environment);
 (scene.background as T.CubeTexture).addEventListener('dispose',()=>{throw Error('old listener');});
 owner.sync(spec('new'),spec('reflection'));await until(()=>invalidations===3);
 assert.equal(released,6);assert.equal(invalidations,3);assert.equal(errors.length,1);
 (scene.background as T.CubeTexture).addEventListener('dispose',()=>{throw Error('new listener');});
 (scene.environment as T.CubeTexture).addEventListener('dispose',()=>{throw Error('reflection listener');});
 life.abort();assert.equal(released,18);assert.equal(scene.background,null);assert.equal(scene.environment,null);
 assert.equal(errors.length,2);owner.dispose();assert.equal(released,18);
});
test('throwing invalidation and reporter cannot create unhandled replacement rejection',async()=>{
 const library={variant:async()=>({width:2,height:2}),texture:async()=>({value:new T.Texture({width:2,height:2} as HTMLImageElement),release(){}})} as unknown as TextureLibrary;
 const scene=new T.Scene();let reports=0;
 const owner=bindSceneCubes(scene,library,new AbortController().signal,()=>{throw Error('invalidate');},()=>{reports++;throw Error('report');});
 owner.sync({faces:['a','a','a','a','a','a'],screenPx:1});await until(()=>reports===1);
 assert.equal(reports,1);assert.ok(scene.background instanceof T.CubeTexture);owner.dispose();
});

const cubeSpec=(id:string):CubeSpec=>({faces:[id,id,id,id,id,id],screenPx:1});
function deferred<T>(){
 let resolve!:(value:T)=>void;
 const promise=new Promise<T>(r=>{resolve=r;});
 return {promise,resolve};
}

test('cube module is cold until requested and immediate abort prevents even its loader',async()=>{
 let loads=0;
 const load:CubeLoader=async()=>{loads++;throw Error('must remain cold');};
 const life=new AbortController();
 const owner=bindSceneCubes(new T.Scene(),{} as TextureLibrary,life.signal,()=>{},()=>{},load);
 owner.sync();await flush();assert.equal(loads,0);
 owner.sync(cubeSpec('a'));life.abort();await flush();assert.equal(loads,0);
});

test('delayed cube module checks replacement before allocation and snapshots authored request',async()=>{
 const module=deferred<Awaited<ReturnType<CubeLoader>>>();
 let loads=0,released=0;
 const requests:CubeSpec[]=[];
 const scene=new T.Scene();
 const owner=bindSceneCubes(scene,{} as TextureLibrary,new AbortController().signal,()=>{},error=>assert.fail(String(error)),()=>{loads++;return module.promise;});
 owner.sync(cubeSpec('old'));await until(()=>loads===1);
 const mutable:{faces:[string,string,string,string,string,string];screenPx:number}={faces:['new','new','new','new','new','new'],screenPx:1};
 owner.sync(mutable);await until(()=>loads===2);
 mutable.faces[0]='mutated';mutable.screenPx=999;
 module.resolve({leaseCube:async(_library,spec)=>{
   requests.push(spec);
   return {key:'test',value:new T.CubeTexture(),release(){released++;}};
 }});
 await until(()=>scene.background instanceof T.CubeTexture);
 assert.equal(requests.length,1,'superseded request never allocates');
 assert.deepEqual(requests[0],cubeSpec('new'));
 owner.dispose();assert.equal(released,1);
});

test('abort during module loading prevents allocation and stale lease completions are released',async()=>{
 const module=deferred<Awaited<ReturnType<CubeLoader>>>();
 let loads=0,allocations=0;
 const life=new AbortController();
 const owner=bindSceneCubes(new T.Scene(),{} as TextureLibrary,life.signal,()=>{},error=>assert.fail(String(error)),()=>{loads++;return module.promise;});
 owner.sync(cubeSpec('a'));await until(()=>loads===1);life.abort();
 module.resolve({leaseCube:async()=>{allocations++;throw Error('must not allocate');}});
 await flush();assert.equal(allocations,0);

 const lease=deferred<Lease<T.CubeTexture>>();
 let requests=0,releases=0;
 const scene=new T.Scene();
 const second=bindSceneCubes(scene,{} as TextureLibrary,new AbortController().signal,()=>{},error=>assert.fail(String(error)),async()=>({leaseCube:()=>{requests++;return lease.promise;}}));
 second.sync(cubeSpec('b'));await until(()=>requests===1);second.sync();
 lease.resolve({key:'late',value:new T.CubeTexture(),release(){releases++;}});
 await until(()=>releases===1);assert.equal(scene.background,null);second.dispose();assert.equal(releases,1);
});

test('malformed faces during request snapshot are reported without throwing or losing the existing binding',async()=>{
 const scene=new T.Scene();
 let reports=0,loads=0,releases=0;
 const owner=bindSceneCubes(scene,{} as TextureLibrary,new AbortController().signal,()=>{},()=>{
   reports++;throw Error('report failure');
 },async()=>{
   loads++;
   return {leaseCube:async()=>({key:'cube',value:new T.CubeTexture(),release(){releases++;}})};
 });
 owner.sync(cubeSpec('working'));await until(()=>!!scene.background);
 const previous=scene.background;
 assert.doesNotThrow(()=>owner.sync({faces:null,screenPx:1} as unknown as CubeSpec,cubeSpec('reflection')));
 await until(()=>!!scene.environment);
 assert.equal(reports,1);assert.equal(loads,2,'malformed request never loads the module');
 assert.equal(scene.background,previous);assert.equal(releases,0);
 owner.dispose();assert.equal(releases,2);
});
