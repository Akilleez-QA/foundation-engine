import test from 'node:test';
import assert from 'node:assert/strict';
import {createTileViews} from './tile-views';
import {createTileQueue,createTileScheduler} from './tile-scheduler';
import {must} from '../../testing/must';
const settle=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};

test('a private scene switch while covered never resumes the previously drawn scene',()=>{
 const state={hall:false,atlas:false,map:false,lake:false};
 const views=createTileViews(Object.fromEntries(Object.keys(state).map(key=>[key,{pause:(value:boolean)=>{state[key as keyof typeof state]=value;}}])));
 assert.ok(Object.values(state).every(Boolean),'preparation starts with every queue paused');
 views.show(['hall']);assert.deepEqual(state,{hall:false,atlas:true,map:true,lake:true});
 views.pause(true);views.show(['map']);assert.ok(Object.values(state).every(Boolean));
 views.pause(false);assert.deepEqual(state,{hall:true,atlas:true,map:false,lake:true});
 views.show([]);assert.ok(Object.values(state).every(Boolean),'the terrain frame draws none of the globe scenes');
});
test('leaving and revisiting a view owns new queues; late decodes from the old visit cannot upload',async()=>{
 const scheduler=createTileScheduler(()=>({resident:4,concurrency:2,decodedBitmapCap:4,uploadsPerFrame:1}));
 const pending:{signal:AbortSignal;resolve:(v:number)=>void}[]=[],disposed:number[]=[],uploaded:number[]=[];
 function visit(){
  const owner=new AbortController(),stream=scheduler.open({id:'terrain',key:String},'globe',owner.signal);
  const queue=createTileQueue<number,number>(stream,{key:String,has:k=>stream.has(k),load:(_k,signal)=>new Promise(resolve=>pending.push({signal,resolve})),dispose:v=>disposed.push(v),upload:(k,v)=>{if(!stream.admit(k))return false;uploaded.push(v);return true;}});
  const views=createTileViews({lake:queue});queue.setWanted([1]);return {owner,views,queue};
 }
 const first=visit();await settle();assert.equal(pending.length,0);first.views.show(['lake']);await settle();assert.equal(pending.length,1);
 first.owner.abort();const second=visit();second.views.show(['lake']);await settle();assert.equal(pending.length,2);
 must(pending[0]).resolve(100);must(pending[1]).resolve(200);await settle();first.queue.update();second.queue.update();
 assert.deepEqual(disposed,[100]);assert.deepEqual(uploaded,[200]);second.owner.abort();assert.equal(scheduler.resident('globe'),0);
});
