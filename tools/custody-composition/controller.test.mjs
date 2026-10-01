import test from 'node:test';
import assert from 'node:assert/strict';
import {createSaveStore} from '../../src/core/save/store.ts';
import {MemoryBackend} from '../../src/core/save/storage-port.ts';
import {createCustodyController,createCustodyStoragePort,initialEnvelope,parseEnvelope,sectionDefinition,storageKey} from './controller.mjs';
function fixture(backend=new MemoryBackend(),tab=0){
 const port=createCustodyStoragePort(backend.port(tab)),timers=new Map();let timer=0,id=0;
 const store=createSaveStore({namespace:'custody-composition',build:'test',local:port,session:new MemoryBackend().port(0,'session'),timers:{now:()=>0,set:fn=>{timers.set(++timer,fn);return timer;},clear:id=>timers.delete(id)}});
 const handle=store.section(sectionDefinition),controller=createCustodyController({saveHandle:handle,readPersisted:()=>port.get(storageKey)});
 const command=(payload,name=String(++id))=>({epoch:controller.read().envelope.epoch,id:name,payload});
 const preview=(payload,name)=>{const request=command(payload,name),result=controller.preview(request);assert.equal(result.status,'prepared',JSON.stringify(result));return {...result,request};};
 const accept=(payload,name)=>{const p=preview(payload,name);assert.equal(controller.commit(p.candidate).status,'pending');assert.equal(controller.acknowledge().status,'accepted');return p.request;};
 return {backend,port,store,handle,controller,command,preview,accept,flush(){for(const [id,fn] of [...timers]){timers.delete(id);fn();}},close(){controller.dispose();store.dispose();}};
}
const item=(kind,item)=>({kind,item});
test('full bag refusal never touches storage; exact pickup/redrop retry and stale previews preserve unique identity',()=>{
 const f=fixture();try{const c=f.controller,initial=c.read().envelope;
 assert.equal(c.read().durable,false);assert.equal(c.preview(f.command(item('pickup','a'))).reason,'capacity');assert.equal(f.backend.data.has(storageKey),false);assert.equal(c.read().envelope,initial);
 const old=f.preview(item('equip','blocker'));f.accept(item('drop','blocker'));
 assert.equal(c.commit(old.candidate).status,'stale');
 const pickup=f.preview(item('pickup','a'),'pickup-a');const oldView=c.read().view;
 assert.equal(c.commit(pickup.candidate).status,'pending');assert.equal(c.read().view,oldView);assert.equal(c.read().canAcknowledge,true);assert.equal(c.read().view.world.some(i=>i.id==='a'),true);
 assert.equal(c.acknowledge().status,'accepted');assert.deepEqual(c.read().view.bag.map(i=>i.id),['a']);f.accept(item('drop','a'));
 const before=c.read().envelope;assert.equal(c.preview(pickup.request).status,'duplicate');assert.equal(c.read().envelope,before);assert.equal(c.read().view.world.filter(i=>i.id==='a').length,1);
 assert.equal(c.preview({...pickup.request,payload:item('pickup','b')}).reason,'conflict');
 const reload=fixture(f.backend,1);try{assert.equal(reload.controller.preview(pickup.request).status,'duplicate');assert.deepEqual(reload.controller.read().envelope,before);}finally{reload.close();}
 }finally{f.close();}
});
test('equip displacement and unequip obey the same bag capacity and saved partition',()=>{
 const f=fixture();try{f.accept(item('equip','blocker'));f.accept(item('pickup','a'));assert.equal(f.controller.preview(f.command(item('unequip','blocker'))).reason,'capacity');
 f.accept(item('equip','a'));assert.deepEqual(f.controller.read().view.equipped.map(i=>i.id),['a']);assert.deepEqual(f.controller.read().view.bag.map(i=>i.id),['blocker']);
 f.accept(item('drop','blocker'));f.accept(item('unequip','a'));assert.deepEqual(f.controller.read().view.equipped,[]);assert.deepEqual(f.controller.read().view.bag.map(i=>i.id),['a']);
 }finally{f.close();}
});
test('pinned reservation capacity refusal is editable; materialization and delivery publish one exact envelope',()=>{
 const f=fixture();try{f.accept({kind:'reserve'});const c=f.controller,request=c.read().view.reservation,before=c.read().envelope;
 assert.equal(c.read().view.stock,1);assert.equal(c.preview(f.command({kind:'settle',request})).reason,'capacity');assert.equal(c.read().envelope,before);assert.equal(c.read().pending,false);
 f.accept({kind:'cancel-reservation',request});assert.equal(c.read().view.stock,2);assert.equal(c.read().view.reservation,null);
 f.accept({kind:'reserve'});const nextRequest=c.read().view.reservation;assert.notEqual(nextRequest,request);f.accept(item('drop','blocker'));const receipt=f.accept({kind:'settle',request:nextRequest},'settlement');
 const state=c.read();assert.equal(state.view.issued,true);assert.deepEqual(state.view.bag.map(i=>i.id),['crafted']);assert.equal(state.view.reservation,null);assert.equal(state.view.stock,1);
 assert.equal(state.envelope.issuance[0].selection.definition.revision,1);assert.equal(state.envelope.issuance[0].selection.output.properties.grade,7);
 f.accept(item('equip','crafted'));f.accept(item('unequip','crafted'));f.accept(item('drop','crafted'));f.accept({kind:'checkpoint'});
 assert.equal(c.read().envelope.epoch,1);assert.equal(c.read().envelope.receipts.length,0);assert.equal(c.read().envelope.issuance.length,1);assert.equal(c.preview(receipt).reason,'epoch');assert.equal(c.preview(f.command({kind:'reserve'})).reason,'issued');
 const reload=fixture(f.backend,1);try{assert.equal(reload.controller.read().view.issued,true);assert.equal(reload.controller.read().view.world.filter(i=>i.id==='crafted').length,1);assert.equal(reload.controller.preview(reload.command({kind:'reserve'})).reason,'issued');}finally{reload.close();}
 }finally{f.close();}
});
test('failed write locks exact pending candidate; autosave success still needs explicit acknowledgement',()=>{
 const f=fixture();try{f.accept(item('drop','blocker'));const c=f.controller,accepted=c.read().envelope,raw=f.backend.data.get(storageKey),p=f.preview(item('pickup','a'));
 f.backend.failSet=k=>k===storageKey;assert.equal(c.commit(p.candidate).status,'pending');assert.equal(c.read().envelope,accepted);assert.equal(f.backend.data.get(storageKey),raw);
 assert.equal(c.cancel(p.candidate).reason,'pending');assert.equal(c.preview(f.command(item('pickup','b'))).reason,'pending');assert.equal(c.acknowledge().reason,'not-durable');
 f.backend.failSet=()=>false;f.flush();assert.equal(c.read().canAcknowledge,true);assert.equal(c.read().envelope,accepted);assert.equal(c.read().pending,true);
 assert.deepEqual(JSON.parse(f.backend.data.get(storageKey)).data,p.candidate.value);assert.equal(c.retry().status,'pending');assert.equal(c.acknowledge().status,'accepted');assert.equal(c.preview(p.request).status,'duplicate');
 }finally{f.close();}
});
test('checkpoint retry retains the prepared next epoch and old previews cannot cross lifetimes',()=>{
 const f=fixture();try{f.accept(item('drop','blocker'));const c=f.controller,old=f.preview(item('pickup','a')),checkpoint=f.preview({kind:'checkpoint'});f.backend.failSet=k=>k===storageKey;c.commit(checkpoint.candidate);
 assert.equal(c.read().envelope.epoch,0);f.backend.failSet=()=>false;c.retry();assert.equal(c.read().envelope.epoch,0);assert.equal(c.acknowledge().status,'accepted');assert.equal(c.read().envelope.epoch,1);assert.equal(c.commit(old.candidate).status,'stale');
 const reload=fixture(f.backend,1);try{assert.equal(reload.controller.commit(old.candidate).status,'stale');assert.equal(reload.controller.read().envelope.epoch,1);}finally{reload.close();}
 }finally{f.close();}
});
test('teardown can leave old or new coherent bytes but never publish through retired authority',()=>{
 for(const finalWriteSucceeds of [false,true]){const f=fixture();f.accept(item('drop','blocker'));const accepted=f.controller.read().envelope,p=f.preview(item('pickup','a'),'pickup');f.backend.failSet=k=>k===storageKey;f.controller.commit(p.candidate);
 f.controller.dispose();if(finalWriteSucceeds)f.backend.failSet=()=>false;f.store.dispose();assert.equal(f.controller.acknowledge().reason,'retired');assert.equal(f.controller.read().envelope,accepted);
 const reload=fixture(f.backend,1);try{assert.equal(reload.controller.read().envelope.revision,finalWriteSucceeds?2:1);assert.equal(reload.controller.preview(p.request).status,finalWriteSucceeds?'duplicate':'prepared');}finally{reload.close();}}
});
test('strict restore detects incoherent location, consumption, issuance, receipts, unknown facts and pinned definition edits',()=>{
 const f=fixture();try{f.accept(item('drop','blocker'));f.accept({kind:'reserve'});f.accept({kind:'settle',request:f.controller.read().view.reservation});const good=f.controller.read().envelope;
 const mutations=[v=>{v.locations.crafted='world';},v=>{v.issuance=[];},v=>{v.materialization=initialEnvelope().materialization;},v=>{v.equipment.items[0].definition='other';},v=>{v.issuance[0].selection.output.properties.grade=99;},v=>{v.receipts=[];},v=>{v.extra=true;}];
 for(const mutate of mutations){const corrupt=structuredClone(good);mutate(corrupt);assert.throws(()=>parseEnvelope(corrupt));}
 }finally{f.close();}
});
test('corruption, newer storage and initial read failure block fallback seed edits',()=>{
 for(const raw of ['broken',JSON.stringify({v:2,data:initialEnvelope()}),JSON.stringify({v:1,data:{...initialEnvelope(),issuance:[{}]}})]){const backend=new MemoryBackend();backend.data.set(storageKey,raw);const f=fixture(backend);try{assert.ok(f.controller.read().blocked);assert.equal(f.controller.preview(f.command(item('drop','blocker'))).status,'refused');}finally{f.close();}assert.equal(backend.data.get(storageKey),raw);}
 const backend=new MemoryBackend();backend.failGet=k=>k===storageKey;const f=fixture(backend);try{assert.ok(f.controller.read().blocked);}finally{f.close();}
});
test('external deletion or replacement between check and autonomous retry is preserved',()=>{
 for(const raw of [null,'external-malformed'])for(const teardown of [false,true]){const f=fixture();f.accept(item('drop','blocker'));const p=f.preview(item('pickup','a'));f.backend.failSet=k=>k===storageKey;f.controller.commit(p.candidate);f.backend.failSet=()=>false;
 if(raw===null)f.backend.data.delete(storageKey);else f.backend.data.set(storageKey,raw);
 if(teardown)f.close();else{f.flush();assert.ok(f.controller.read().blocked);assert.equal(f.controller.acknowledge().status,'refused');f.close();}assert.equal(f.backend.data.get(storageKey)??null,raw);}
});
test('authentic cancelled/foreign candidates, getter reentry and idle projections are bounded',()=>{
 const f=fixture();try{const c=f.controller;let nested;const p=c.preview({epoch:0,id:'captured',get payload(){nested=c.preview(f.command(item('drop','blocker')));return item('drop','blocker');}});assert.equal(p.status,'prepared');assert.equal(nested.reason,'busy');
 const view=c.read().view;assert.equal(c.read().view,view);assert.equal(c.cancel(p.candidate).status,'cancelled');assert.equal(c.commit(p.candidate).status,'stale');assert.equal(c.commit(new Proxy({},{get(){throw Error('forged getter');}})).status,'stale');
 f.accept(item('drop','blocker'));assert.notEqual(c.read().view,view);
 for(let i=0;i<15;i++)f.accept({kind:'checkpoint'},`checkpoint-${i}`);
 assert.equal(c.read().envelope.epoch,15);
 }finally{f.close();}
});
test('startup checks physical bytes against captured SaveStore memory before offering any edit',()=>{
 const other=fixture();other.accept(item('drop','blocker'));const replacement=other.backend.data.get(storageKey);other.close();
 for(const guarded of [false,true]){
  const backend=new MemoryBackend(),rawPort=backend.port(0),port=guarded?createCustodyStoragePort(rawPort):rawPort;
  const store=createSaveStore({namespace:'custody-composition',build:'test',local:port,session:new MemoryBackend().port(0,'session')});const handle=store.section(sectionDefinition);handle.get();
  // Same-tab write after section load but before controller capture: no subscription event.
  rawPort.set(storageKey,replacement);
  const controller=createCustodyController({saveHandle:handle,readPersisted:()=>port.get(storageKey)});
  assert.ok(controller.read().blocked);assert.equal(controller.preview({epoch:0,id:'edit',payload:item('equip','blocker')}).status,'refused');
  controller.dispose();store.dispose();assert.equal(backend.data.get(storageKey),replacement);
 }
});
test('current receipts and lifetime journal are enforced independently without erasing issuance evidence',()=>{
 const f=fixture();try{
  for(let i=0;i<16;i++)f.accept(item(i%2?'pickup':'drop','blocker'),`move-${i}`);
  assert.equal(f.controller.preview(f.command(item('drop','blocker'))).reason,'receipts-full');
  f.accept({kind:'checkpoint'});assert.equal(f.controller.read().envelope.receipts.length,0);
  for(let i=17;i<64;i++)f.accept({kind:'checkpoint'},`epoch-${i}`);
  const before=f.controller.read().envelope;assert.equal(before.journal.length,64);assert.equal(f.controller.preview(f.command({kind:'checkpoint'})).reason,'history-full');assert.equal(f.controller.read().envelope,before);
 }finally{f.close();}
});
test('saved status without exact physical candidate is never acknowledgement authority',()=>{
 const backend=new MemoryBackend(),raw=backend.port(0),port={...raw,set(key,value){if(key!==storageKey)raw.set(key,value);}};
 const store=createSaveStore({namespace:'custody-composition',build:'test',local:port,session:new MemoryBackend().port(0,'session')});
 const handle=store.section(sectionDefinition),controller=createCustodyController({saveHandle:handle,readPersisted:()=>raw.get(storageKey)});
 try{const before=controller.read().envelope,p=controller.preview({epoch:0,id:'drop',payload:item('drop','blocker')});assert.equal(controller.commit(p.candidate).status,'pending');assert.equal(handle.status(),'saved');assert.equal(controller.read().canAcknowledge,false);assert.equal(controller.acknowledge().reason,'not-durable');assert.equal(controller.read().envelope,before);}finally{controller.dispose();store.dispose();}
});
test('SaveStore notification reentry cannot cancel or publish a write while it is being attempted',()=>{
 const f=fixture();try{const p=f.preview(item('drop','blocker'));let cancel,ack,pending;
 const unsubscribe=f.handle.subscribe(()=>{pending=f.controller.read().pending;cancel=f.controller.cancel(p.candidate);ack=f.controller.acknowledge();});
 assert.equal(f.controller.commit(p.candidate).status,'pending');unsubscribe();assert.equal(pending,true);assert.equal(cancel.reason,'busy');assert.equal(ack.reason,'busy');assert.equal(f.controller.read().envelope.revision,0);assert.equal(f.controller.acknowledge().status,'accepted');
 }finally{f.close();}
});
