import test from 'node:test';import assert from 'node:assert/strict';
import {scheduleTask} from './task-yield';
const turn=()=>new Promise<void>(resolve=>setTimeout(resolve,10));
async function withScheduler(value:unknown,run:()=>Promise<void>){const old=Object.getOwnPropertyDescriptor(globalThis,'scheduler');Object.defineProperty(globalThis,'scheduler',{value,configurable:true});try{await run();}finally{if(old)Object.defineProperty(globalThis,'scheduler',old);else delete(globalThis as {scheduler?:unknown}).scheduler;}}

test('task scheduler uses native tasks with owned abort and no repeated continuation',async()=>{
 let callback!:()=>void,signal!:AbortSignal,count=0;
 await withScheduler({postTask(fn:()=>void,options:{signal:AbortSignal;priority:string}){callback=fn;signal=options.signal;assert.equal(options.priority,'user-visible');return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));}},async()=>{
  const cancel=scheduleTask(()=>count++);assert.equal(count,0);cancel();callback();await turn();assert.equal(count,0);assert.equal(signal.aborted,true);
  scheduleTask(()=>count++);callback();callback();assert.equal(count,1);
 });
});
for(const mode of ['missing','throws','rejects','inline'])test(`task scheduler ${mode} uses a later timer without hanging or inline work`,async()=>{
 const adapter=mode==='missing'?undefined:{postTask(fn:()=>void){if(mode==='throws')throw Error('scheduler');if(mode==='rejects')return Promise.reject(Error('scheduler'));fn();return Promise.resolve();}};
 await withScheduler(adapter,async()=>{let count=0;scheduleTask(()=>count++);assert.equal(count,0);await turn();assert.equal(count,1);const cancel=scheduleTask(()=>count++);cancel();await turn();assert.equal(count,1);});
});
