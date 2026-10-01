import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installPlayerClockRuntime} from './player-clock-runtime';
import {FrameLoop} from './loop';
import {clockSection} from '../clock-section';
import {MemoryBackend} from '../save/storage-port';
import {createSaveStore,playersSection} from '../save/store';

function fixture(start=true){
 let wall=Date.UTC(2026,5,15),pending:((ms:number)=>void)|undefined;
 const disk=new MemoryBackend(),store=createSaveStore({local:disk.port(),session:new MemoryBackend().port(0,'session'),
  build:'clock-test',sections:[clockSection],timers:{set:()=>0,clear(){},now:()=>0}});
 store.section(playersSection).update(r=>({...r,players:[{id:'1'},{id:'2'}]}));
 const loop=new FrameLoop({layers:{coverage:()=> 'top',onChange:()=>()=>{}},calm:()=>false,
  now:()=>wall,scheduler:{request:fn=>{pending=fn;return 1;},cancel(){pending=undefined;}}});
 const runtime=installPlayerClockRuntime(store,loop,{realNow:()=>wall});if(start)runtime.start();
 return {store,disk,loop,runtime,step(ms:number){const next=pending;pending=undefined;assert.ok(next);next(ms);},
  wall(ms:number){wall=ms;},close(){runtime.dispose();loop.dispose();store.dispose();}};
}
test('runtime clock advances once per shared frame, while teaching tickers keep local dt under warp',()=>{
 const f=fixture(),start=f.runtime.clock.ut,local:number[]=[],universals:number[]=[];
 try{
  f.loop.add({owner:'lesson',mode:'continuous',update:x=>{local.push(x.dt);universals.push(x.ut);}});
  f.loop.add({owner:'second-scene',mode:'continuous'});
  f.runtime.clock.requestWarp({owner:'map',rate:1000,mode:'rails'});
  f.step(0);f.step(20);f.step(40);
  assert.deepEqual(local,[0,.02,.02]);assert.equal(f.runtime.clock.ut-start,40);
  assert.deepEqual(universals,[start,start+20,start+40]);
  assert.throws(()=>installPlayerClockRuntime(f.store,f.loop),/already has/);
  f.runtime.clock.pause('dialog');f.step(60);assert.equal(f.runtime.clock.ut-start,40);
  f.runtime.clock.resume('dialog');f.step(80);assert.equal(f.runtime.clock.ut-start,60);
 }finally{f.close();}
});
test('idle/hidden resume never catches up UT; calendar follows real date independently',()=>{
 const f=fixture(),start=f.runtime.clock.ut;
 try{
  const once=f.loop.add({owner:'still'});f.step(0);once.invalidate();f.step(500000);
  assert.equal(f.runtime.clock.ut,start,'no idle elapsed time');
  const moving=f.loop.add({owner:'moving',mode:'continuous'});f.step(500020);f.step(500040);
  const before=f.runtime.clock.ut,away:number[]=[];
  f.runtime.clock.onCatchUp(c=>away.push(c.awayRealS));f.loop.setHidden(true);
  f.wall(Date.UTC(2026,11,15));f.loop.setHidden(false);f.step(900000);
  assert.equal(f.runtime.clock.ut,before);assert.equal(f.runtime.clock.calendar().getMonth(),11);assert.equal(away.length,1);
  moving.remove();
 }finally{f.close();}
});
test('player switch, timeline import, flush and disposal preserve UT and retire old warp/alarms',()=>{
 const f=fixture(),start=f.runtime.clock.ut;
 try{
  f.loop.add({owner:'play',mode:'continuous'});f.step(0);f.step(20);
  f.runtime.clock.requestWarp({owner:'old',rate:1000,mode:'rails'});
  let fired=false;f.runtime.clock.schedule(start+1,()=>{fired=true;});
  f.store.setActivePlayer('2');assert.equal(f.runtime.clock.warp,1);
  const old=JSON.parse(f.disk.data.get('game|p:1|core.clock')!).data.ut;
  assert.ok(Math.abs(old-start-.02)<1e-6,'switch persists the final fraction before the periodic record');
  f.store.section(clockSection).of('2').replace({ut:100,lastRealMs:0});assert.equal(f.runtime.clock.ut,100);
  f.step(40);assert.equal(fired,false);
  const last=f.runtime.clock.ut;f.runtime.dispose();f.step(60);assert.equal(f.runtime.clock.ut,last);
  f.store.setActivePlayer('1');assert.equal(f.runtime.clock.ut,last,'disposed clock stops following players');
  assert.equal(f.store.section(clockSection).of('2').get()!.ut,last);
 }finally{f.close();}
});

test('beforeAdvance publishes the requested warp for the same frame and calendar readers share the service',()=>{
 let pending:((ms:number)=>void)|undefined,rate=1000;
 const store=createSaveStore({local:new MemoryBackend().port(),session:new MemoryBackend().port(0,'session'),build:'clock-test',sections:[clockSection],timers:{set:()=>0,clear(){},now:()=>0}});
 const loop=new FrameLoop({layers:{coverage:()=> 'top',onChange:()=>()=>{}},calm:()=>false,scheduler:{request:fn=>{pending=fn;return 1;},cancel(){pending=undefined;}}});
 const runtime=installPlayerClockRuntime(store,loop,{realNow:()=>0,beforeAdvance:()=>{runtime.clock.requestWarp({owner:'sim',rate,mode:'rails'});}});
 try{
  runtime.start();const start=runtime.clock.ut;loop.add({owner:'sim',mode:'continuous'});
  pending!(0);pending!(20);assert.equal(runtime.clock.ut-start,20);
  rate=1;pending!(40);assert.ok(Math.abs(runtime.clock.ut-start-20.02)<1e-6);
 }finally{runtime.dispose();loop.dispose();store.dispose();}
});

test('boot is paused until start; load catch-up reaches installed subscribers once without jumping UT',()=>{
 const f=fixture(false);
 try{
  f.store.section(clockSection).replace({ut:100,lastRealMs:0});
  const caught:string[]=[];f.runtime.clock.onCatchUp(c=>caught.push(c.reason));
  f.loop.add({owner:'loading',mode:'continuous'});f.step(0);f.step(20);
  assert.equal(f.runtime.clock.ut,100);assert.equal(f.runtime.clock.paused,true);
  f.runtime.start();f.runtime.start();assert.deepEqual(caught,['load']);assert.equal(f.runtime.clock.ut,100);
  f.step(40);assert.equal(f.runtime.clock.ut,100.02);
 }finally{f.close();}
});
