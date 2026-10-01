import test from 'node:test';import assert from 'node:assert/strict';
import {createHandover,type SceneEntry} from '../../core/router/handover';
import {createDependencyLease,type DependencyValue} from './dependency-lease';
const tick=()=>new Promise<void>(r=>setTimeout(r,0));
test('router critical readiness prevents early activation and superseded closure releases late completion',async()=>{
 const activated:string[]=[],released:string[]=[];let finish!:(v:DependencyValue<string>)=>void;
 const h=createHandover({player:()=> 'p',firstRender(){}});
 const pending:SceneEntry={id:'scene.pending',label:'pending',load:()=>null,enter(_module,visit){
  const owner=createDependencyLease({nodes:[{id:'contact',dependencies:[],bytes:1}],required:['contact'],maxPinnedBytes:1,maxConcurrent:1,signal:visit.signal,acquire:()=>new Promise<DependencyValue<string>>(r=>{finish=r;})});
  return {ready:owner.prepare(1),activate(){assert.equal(owner.get('contact'),'ready');activated.push('pending');},leave(){owner.dispose();}};
 }};
 const next:SceneEntry={id:'scene.next',label:'next',load:()=>null,enter:()=>({activate(){activated.push('next');},leave(){}})};
 const request=h.go(pending);await tick();assert.deepEqual(activated,[]);assert.equal(await h.go(next),'activated');finish({bytes:1,lease:{value:'ready',release(){released.push('late');}}});assert.equal(await request,'superseded');await tick();assert.deepEqual(activated,['next']);assert.deepEqual(released,['late']);h.leave();
});
test('critical preparation failure never activates a destination',async()=>{
 let activated=false;const h=createHandover({player:()=> 'p',firstRender(){}});
 const outcome=await h.go({id:'scene.failed',label:'failed',load:()=>null,enter(_module,visit){const owner=createDependencyLease({nodes:[{id:'contact',dependencies:[],bytes:1}],required:['contact'],maxPinnedBytes:1,maxConcurrent:1,signal:visit.signal,acquire:async()=>{throw Error('failed');}});return {ready:owner.prepare(1),activate(){activated=true;},leave(){owner.dispose();}};}});
 assert.equal(outcome,'failed');assert.equal(activated,false);
});
test('dependency preflight retains prior run until critical contact is ready, then releases before entering',async()=>{
 const events:string[]=[];let finish!:(v:DependencyValue<string>)=>void;let closure!:ReturnType<typeof createDependencyLease<string>>;
 const h=createHandover({player:()=> 'p',firstRender(){}});
 await h.go({id:'scene.previous',label:'previous',load:()=>null,enter:()=>({leave(){events.push('old-left');}})});
 const pending=h.go({id:'scene.destination',label:'destination',load:()=>null,prepare(_module,visit){closure=createDependencyLease({nodes:[{id:'contact',dependencies:[],bytes:1}],required:['contact'],maxPinnedBytes:1,maxConcurrent:1,signal:visit.signal,acquire:()=>new Promise<DependencyValue<string>>(r=>{finish=r;})});return closure.prepare(1);},enter(){events.push('new-entered');assert.equal(closure.get('contact'),'ready');return {leave(){closure.dispose();}};}});
 await tick();assert.deepEqual(events,[]);assert.equal(h.current()?.scene,'scene.previous');finish({bytes:1,lease:{value:'ready',release(){}}});assert.equal(await pending,'activated');assert.deepEqual(events,['old-left','new-entered']);h.leave();
});
test('failed dependency preflight leaves the previous run alive',async()=>{
 let left=false;const h=createHandover({player:()=> 'p',firstRender(){}});await h.go({id:'scene.previous',label:'previous',load:()=>null,enter:()=>({leave(){left=true;}})});
 const outcome=await h.go({id:'scene.failed',label:'failed',load:()=>null,prepare(_module,visit){return createDependencyLease({nodes:[{id:'contact',dependencies:[],bytes:1}],required:['contact'],maxPinnedBytes:1,maxConcurrent:1,signal:visit.signal,acquire:async()=>{throw Error('contact failed');}}).prepare(1);},enter(){throw Error('must not enter');}});
 assert.equal(outcome,'failed');assert.equal(left,false);assert.equal(h.current()?.scene,'scene.previous');h.leave();
});
