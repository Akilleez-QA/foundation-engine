import test from 'node:test';
import assert from 'node:assert/strict';
import {createSaveStore} from '../../src/core/save/store.ts';
import {authorSaveHandle} from '../../src/author/save-handle.ts';
import {MemoryBackend} from '../../src/core/save/storage-port.ts';
import {initialGraph} from './graph.mjs';
import {createRuntimeController,createRuntimeStoragePort,runtimeSectionDefinition,runtimeStorageKey,parseRuntimeEnvelope,initialRuntimeEnvelope} from './runtime-controller.mjs';
function fixture(backend=new MemoryBackend(),tab=0,source){const port=createRuntimeStoragePort(backend.port(tab)),timers=new Map();let serial=0,sequence=0;const store=createSaveStore({namespace:'objective-workbench',build:'test',local:port,session:new MemoryBackend().port(0,'session'),timers:{now:()=>0,set:fn=>{timers.set(++serial,fn);return serial;},clear:id=>timers.delete(id)}});const handle=authorSaveHandle(store,{kind:'save-section',id:runtimeSectionDefinition.id,section:runtimeSectionDefinition}),controller=createRuntimeController({saveBuild:'test',saveHandle:handle,readPersisted:()=>port.get(runtimeStorageKey),...(source?{source}:{})});const preview=(payload,id=`cmd${++sequence}`)=>{const p=controller.preview({id,payload});assert.equal(p.status,'prepared',JSON.stringify(p));return {...p,request:{id,payload}};};const accept=(payload,id)=>{const p=preview(payload,id);assert.equal(controller.commit(p.candidate).status,'pending');assert.equal(controller.acknowledge().status,'accepted');return p;};return {backend,port,store,handle,controller,preview,accept,flush(){for(const [id,fn] of [...timers]){timers.delete(id);fn();}},close(){controller.dispose();store.dispose();}};}
const work=(f,name='left',id='fact')=>{assert.equal(f.controller.acquireWork(name).status,'admitted');assert.equal(f.controller.emitWork({id,event:'work',amount:1}).status,'emitted');assert.equal(f.controller.acknowledge().status,'accepted');f.controller.reconcileWork();};
test('two consumers share source; cancel one keeps survivor, and old callback has no authority after adoption',()=>{
 const f=fixture();try{const c=f.controller;c.acquireWork('left');c.acquireWork('right');const late=c.captureWork('left');assert.equal(c.read().work.consumers,2);assert.equal(c.read().work.listeners,1);
 f.accept({kind:'cancel-run',consumer:'left'});assert.equal(c.read().work.consumers,1);assert.equal(c.read().work.listeners,1);assert.equal(late({id:'late',event:'work',amount:1}),false);
 c.emitWork({id:'one',event:'work',amount:1});assert.equal(c.read().view.runs[1].ready,false);c.acknowledge();assert.equal(c.read().view.runs[1].ready,true);assert.equal(c.read().view.runs[0].status,'cancelled');
 const sibling=c.captureWork('right');f.accept({kind:'adopt',graph:initialGraph()});const before=c.read().envelope;assert.equal(c.read().view.adoption,1);assert.equal(sibling({id:'same',event:'work',amount:1}),false);assert.equal(c.read().envelope,before);assert.equal(c.read().work.consumers,0);
 }finally{f.close();}
});
test('per-consumer pending refusal preserves fact; exact retries never double progress',()=>{
 const f=fixture();try{const c=f.controller;c.acquireWork('left');c.acquireWork('right');f.backend.failSet=k=>k===runtimeStorageKey;c.emitWork({id:'one',event:'work',amount:1});assert.equal(c.read().pending,true);assert.equal(c.read().view.runs.every(r=>!r.ready),true);assert.equal(c.cancel({}).reason,'pending');
 f.backend.failSet=()=>false;c.retry();c.acknowledge();assert.equal(c.read().view.runs[0].ready,true);assert.equal(c.read().view.runs[1].ready,false);c.reconcileWork();assert.equal(c.read().pending,true);c.acknowledge();c.reconcileWork();assert.equal(c.read().view.runs.every(r=>r.ready),true);assert.equal(c.read().work.delivered,2);assert.equal(c.read().envelope.receipts.length,2);c.reconcileWork();assert.equal(c.read().pending,false);
 }finally{f.close();}
});
test('terminal branch capacity refusal is atomic; selected outcome retries and reloads with old provenance',()=>{
 const f=fixture();try{work(f);const before=f.controller.read().envelope;assert.equal(f.controller.preview({id:'short',payload:{kind:'choose',consumer:'left',choice:'short'}}).reason,'capacity');assert.equal(f.controller.read().envelope,before);
 f.accept({kind:'free'});const p=f.preview({kind:'choose',consumer:'left',choice:'short'},'short');f.backend.failSet=k=>k===runtimeStorageKey;f.controller.commit(p.candidate);assert.equal(f.controller.read().view.units,0);f.backend.failSet=()=>false;f.flush();assert.equal(f.controller.read().view.units,0);f.controller.acknowledge();assert.equal(f.controller.read().view.units,1);assert.deepEqual(f.controller.read().view.capabilities,['route-short']);assert.equal(f.controller.preview(p.request).status,'duplicate');
 const edited=structuredClone(initialGraph());edited.definition.revision=2;edited.outcomes[0].units=3;edited.outcomes[0].capability='different';f.accept({kind:'adopt',graph:edited});assert.equal(f.controller.read().view.units,1);work(f,'left','second');f.accept({kind:'choose',consumer:'left',choice:'short'},'new-short');assert.equal(f.controller.read().view.units,4);assert.deepEqual(f.controller.read().view.capabilities,['route-short','different']);
 const reload=fixture(f.backend,1);try{assert.deepEqual(reload.controller.read().envelope,f.controller.read().envelope);assert.equal(reload.controller.read().view.graph.definition.revision,2);assert.equal(reload.controller.read().envelope.adoptions[0].graph.definition.revision,1);}finally{reload.close();}
 const bad=structuredClone(f.controller.read().envelope);bad.adoptions[0].graph.outcomes[0].units=3;assert.throws(()=>parseRuntimeEnvelope(bad));
 }finally{f.close();}
});
test('long route earns its own distinct outcome and stale stage callback is rejected',()=>{
 const f=fixture();try{f.accept({kind:'free'});work(f);const late=f.controller.captureWork('left');f.accept({kind:'choose',consumer:'left',choice:'continue'});assert.equal(late({id:'oldstage',event:'work',amount:1}),false);assert.equal(f.controller.resetWork().status,'reset');work(f,'left','confirm');f.accept({kind:'choose',consumer:'left',choice:'finish'});assert.equal(f.controller.read().view.units,2);assert.deepEqual(f.controller.read().view.capabilities,['route-long']);assert.equal(f.controller.read().envelope.consequences[0].choice,'finish');}finally{f.close();}
});
test('pending adoption never retires old work before acknowledgement; teardown permits old or new durable version',()=>{
 for(const successful of [false,true]){const f=fixture();f.controller.acquireWork('left');const late=f.controller.captureWork('left'),p=f.preview({kind:'adopt',graph:initialGraph()});f.backend.failSet=k=>k===runtimeStorageKey;f.controller.commit(p.candidate);assert.equal(f.controller.read().view.adoption,0);assert.equal(f.controller.read().work.consumers,1);assert.equal(late({id:'during',event:'work',amount:1}),false);
 f.controller.dispose();if(successful)f.backend.failSet=()=>false;f.store.dispose();assert.equal(late({id:'after',event:'work',amount:1}),false);assert.equal(f.controller.acknowledge().reason,'retired');const reload=fixture(f.backend,1);try{assert.equal(reload.controller.read().view.adoption,successful?1:0);}finally{reload.close();}}
});
test('strict restore and changed physical bytes never create fallback runtime authority',()=>{
 for(const raw of ['invalid',JSON.stringify({v:2,data:initialRuntimeEnvelope()})]){const backend=new MemoryBackend();backend.data.set(runtimeStorageKey,raw);const f=fixture(backend);try{assert.ok(f.controller.read().blocked);assert.equal(f.controller.acquireWork('left').status,'refused');assert.equal(f.controller.preview({id:'adopt',payload:{kind:'adopt',graph:initialGraph()}}).status,'refused');}finally{f.close();}assert.equal(backend.data.get(runtimeStorageKey),raw);}
 const f=fixture();try{f.accept({kind:'free'});const original=f.controller.read().envelope;for(const key of ['inventory','capabilities','adoptions']){const bad=structuredClone(original);bad[key]=[];assert.throws(()=>parseRuntimeEnvelope(bad));}f.backend.data.delete(runtimeStorageKey);assert.ok(f.controller.read().blocked);}finally{f.close();}
});
test('adoption capacity and callback admission failures preserve ownership and exact snapshots',()=>{
 const f=fixture();try{for(let i=1;i<16;i++)f.accept({kind:'adopt',graph:initialGraph()},`a${i}`);const before=f.controller.read().envelope;assert.equal(f.controller.preview({id:'over',payload:{kind:'adopt',graph:initialGraph()}}).reason,'adoption-capacity');assert.equal(f.controller.read().envelope,before);}finally{f.close();}
 const g=fixture(undefined,0,()=>({read:()=>null,subscribe(){throw Error('refused-subscribe');},emit(){}}));try{assert.equal(g.controller.acquireWork('left').reason,'refused-subscribe');assert.equal(g.controller.read().work.consumers,0);assert.equal(g.controller.read().envelope.revision,0);}finally{g.close();}
});
test('old command retries retain original adoption authority after fresh adoption and reload',()=>{
 const f=fixture();try{f.accept({kind:'free'});work(f);const choice=f.accept({kind:'choose',consumer:'left',choice:'short'},'old-route');f.accept({kind:'adopt',graph:initialGraph()});const before=f.controller.read().envelope;assert.equal(f.controller.preview(choice.request).status,'duplicate');assert.equal(f.controller.read().envelope,before);assert.equal(f.controller.preview({id:'old-route',payload:{kind:'choose',consumer:'right',choice:'short'}}).reason,'conflict');const reload=fixture(f.backend,1);try{assert.equal(reload.controller.preview(choice.request).status,'duplicate');}finally{reload.close();}}finally{f.close();}
});
test('already complete source reconciles via the same saved pending path without attaching an idle listener',()=>{
 let attached=0;const f=fixture(undefined,0,()=>({read:()=>({id:'cached',event:'work',amount:1}),subscribe(){attached++;return ()=>{};},emit(){return {status:'refused'};}}));try{assert.equal(f.controller.acquireWork('left').status,'admitted');assert.equal(attached,0);assert.equal(f.controller.read().pending,true);assert.equal(f.controller.read().view.runs[0].ready,false);f.controller.acknowledge();f.controller.reconcileWork();assert.equal(f.controller.read().view.runs[0].ready,true);assert.equal(f.controller.read().envelope.receipts.length,1);}finally{f.close();}
});
test('cancelled and foreign candidates never write; getter reentry cannot admit work during mutation',()=>{
 const f=fixture();try{let nested;const p=f.controller.preview({id:'adopt',get payload(){nested=f.controller.acquireWork('left');return {kind:'adopt',graph:initialGraph()};}});assert.equal(p.status,'prepared');assert.equal(nested.reason,'busy');f.controller.cancel(p.candidate);assert.equal(f.controller.commit(p.candidate).status,'stale');assert.equal(f.controller.commit(new Proxy({},{get(){throw Error('forged');}})).status,'stale');assert.equal(f.backend.data.has(runtimeStorageKey),false);}finally{f.close();}
});
test('receipt capacity refuses new work without pruning completed adoption provenance',()=>{
 const f=fixture();try{const graph=structuredClone(initialGraph());graph.definition.stages[0].requirements[0].target=100;f.accept({kind:'adopt',graph});f.controller.acquireWork('left');const callback=f.controller.captureWork('left');for(let i=0;i<63;i++){callback({id:`fact${i}`,event:'work',amount:1});assert.equal(f.controller.acknowledge().status,'accepted');}const before=f.controller.read().envelope;assert.equal(before.receipts.length,64);assert.equal(before.adoptions[1].runs.left.objective.events.length,63);assert.equal(callback({id:'exhausted',event:'work',amount:1}),false);assert.equal(f.controller.read().pending,false);assert.equal(f.controller.read().envelope,before);assert.equal(f.controller.read().view.runs[0].progress[0].count,63);}finally{f.close();}
});
test('startup and saved readback are checked independently of SaveStore default or cached status',()=>{
 const donor=fixture();donor.accept({kind:'free'});const rawNew=donor.backend.data.get(runtimeStorageKey);donor.close();
 const backend=new MemoryBackend(),port=backend.port(0),store=createSaveStore({namespace:'objective-workbench',build:'test',local:port,session:new MemoryBackend().port(0,'session')}),handle=store.section(runtimeSectionDefinition);handle.get();port.set(runtimeStorageKey,rawNew);const c=createRuntimeController({saveBuild:'test',saveHandle:handle,readPersisted:()=>port.get(runtimeStorageKey)});assert.ok(c.read().blocked);assert.equal(c.acquireWork('left').status,'refused');c.dispose();store.dispose();
 const raw=new MemoryBackend().port(0),noop={...raw,set(){}};const noStore=createSaveStore({namespace:'objective-workbench',build:'test',local:noop,session:new MemoryBackend().port(0,'session')}),noHandle=noStore.section(runtimeSectionDefinition),noController=createRuntimeController({saveBuild:'test',saveHandle:noHandle,readPersisted:()=>raw.get(runtimeStorageKey)});const p=noController.preview({id:'free',payload:{kind:'free'}});noController.commit(p.candidate);assert.equal(noHandle.status(),'saved');assert.equal(noController.read().canAcknowledge,false);assert.equal(noController.acknowledge().reason,'not-durable');assert.equal(noController.read().envelope.revision,0);noController.dispose();noStore.dispose();
});
test('throwing source cleanup on adoption cannot resurrect old leases or misreport durable adoption as rolled back',()=>{
 let oldCallback;const f=fixture(undefined,0,()=>({read:()=>null,subscribe(fn){oldCallback=fn;return ()=>{throw Error('cleanup');};},emit(){}}));try{f.controller.acquireWork('left');const delivery=f.controller.captureWork('left'),old=oldCallback;f.accept({kind:'adopt',graph:initialGraph()});assert.equal(f.controller.read().view.adoption,1);assert.equal(f.controller.read().work.consumers,0);assert.equal(delivery({id:'late',event:'work',amount:1}),false);assert.equal(old({id:'late',event:'work',amount:1}),false);}finally{f.close();}
});
test('a completed source fact cannot silently advance another stage of the same consumer',()=>{
 const f=fixture();try{f.controller.acquireWork('left');f.controller.acquireWork('right');f.controller.emitWork({id:'one',event:'work',amount:1});f.controller.acknowledge();f.controller.reconcileWork();f.controller.acknowledge();f.controller.reconcileWork();f.accept({kind:'choose',consumer:'left',choice:'continue'});const before=f.controller.read().envelope;assert.equal(f.controller.acquireWork('left').reason,'reset-required');assert.equal(f.controller.read().envelope,before);assert.equal(f.controller.read().pending,false);assert.equal(f.controller.resetWork().reason,'active');f.controller.releaseWork('right');assert.equal(f.controller.resetWork().status,'reset');work(f,'left','new-stage');assert.equal(f.controller.read().view.runs[0].ready,true);}finally{f.close();}
});
test('physical wrapper capacity refuses the exact near-limit adoption before locking or writing',()=>{
 const f=fixture();try{
  const graph=structuredClone(initialGraph());graph.definition.id='g'.repeat(56);graph.definition.stages=[];graph.outcomes=[];
  for(let i=0;i<64;i++){const stage=`s${i}`+'s'.repeat(90),choice='x'.repeat(15);graph.definition.stages.push({id:stage,requirements:[{id:'r'.repeat(91),event:'e'.repeat(96),target:1}],choices:[{id:choice,to:null}]});graph.outcomes.push({stage,choice,units:0,capability:'c'.repeat(64)});}
  graph.definition.start=graph.definition.stages[0].id;
  const before=f.controller.read().envelope;
  assert.deepEqual(f.controller.preview({id:'xx',payload:{kind:'adopt',graph}}),{status:'refused',reason:'storage-capacity'});
  assert.equal(f.controller.read().pending,false);assert.equal(f.controller.read().envelope,before);assert.equal(f.port.get(runtimeStorageKey),null);
  f.accept({kind:'free'});assert.equal(f.controller.read().view.blocker,0);
 }finally{f.close();}
});
test('save build metadata is explicit and primitive before controller construction',()=>{
 for(const saveBuild of [undefined,null,{},'', 'x'.repeat(257)])assert.throws(()=>createRuntimeController({saveBuild,readPersisted:()=>null,saveHandle:{}}),/save-build/);
});
