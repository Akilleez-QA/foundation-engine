import test from 'node:test';
import assert from 'node:assert/strict';
import {createSaveStore} from '../../src/core/save/store.ts';
import {MemoryBackend} from '../../src/core/save/storage-port.ts';
import {createJournalController,initialEnvelope,parseEnvelope,storageKey} from './controller.mjs';
function fixture(backend=new MemoryBackend()){
 const store=createSaveStore({namespace:'stage-journal',build:'test',local:backend.port(),session:new MemoryBackend().port(0,'session')});
 const handle=store.section({id:'journal.session',scope:'device',version:1,initial:initialEnvelope,parse:parseEnvelope});
 const controller=createJournalController({saveHandle:handle,hasEnvelope:()=>backend.data.has(storageKey)});
 return {backend,handle,store,controller,close(){controller.dispose();store.dispose();}};
}
function complete(c){c.start();c.advance(.5);c.choose();c.start();c.advance(1);c.choose();}
test('S1 journal consumer distinguishes accepted work, ready and terminal; reward capacity denial changes no consequences',()=>{
 const f=fixture();try{const c=f.controller;c.start();assert.equal(c.state().view.progress[0].count,0);c.advance(.2);assert.equal(c.state().view.ready,false);
 c.advance(.5);assert.equal(c.state().view.ready,true);assert.equal(c.state().view.status,'active');c.deliver();assert.equal(c.state().receipt,null);
 c.choose();assert.equal(c.state().view.stage,'confirm');c.start();c.advance(1);assert.equal(c.state().view.status,'active');c.choose();
 assert.equal(c.state().view.status,'complete');const before=f.handle.get();c.deliver();assert.match(c.state().message,/capacity/);assert.deepEqual(f.handle.get(),before);
 c.free();c.deliver();assert.equal(c.state().reward,1);assert.equal(c.state().capability,true);assert.ok(c.state().receipt);
 c.deliver();assert.equal(c.state().reward,1);assert.deepEqual(parseEnvelope(f.handle.get()),f.handle.get());
 }finally{f.close();}
});
test('S1 storage failure leaves coherent accepted reward but old durable bytes; retry and reload do not duplicate',()=>{
 const f=fixture();try{complete(f.controller);f.controller.free();const old=f.backend.data.get(storageKey);f.backend.failSet=k=>k===storageKey;
 f.controller.deliver();assert.equal(f.controller.state().reward,1);assert.equal(f.controller.state().capability,true);assert.match(f.controller.state().persistence,/Unsaved/);assert.equal(f.backend.data.get(storageKey),old);
 f.controller.deliver();assert.equal(f.controller.state().reward,1);f.backend.failSet=()=>false;f.controller.save();assert.equal(f.controller.state().persistence,'Saved locally');
 const reload=fixture(f.backend);try{assert.equal(reload.controller.state().view.status,'complete');reload.controller.deliver();assert.equal(reload.controller.state().reward,1);assert.equal(reload.controller.state().capability,true);}finally{reload.close();}
 }finally{f.close();}
});
test('S1 cancelled or disposed scene work cannot progress later and cancellation restores',()=>{
 const f=fixture();try{const c=f.controller;c.start();c.cancel();c.advance(3);assert.equal(c.state().view.status,'cancelled');assert.equal(c.state().view.progress[0].count,0);assert.equal(c.state().pending,null);
 const reload=fixture(f.backend);try{assert.equal(reload.controller.state().view.status,'cancelled');reload.controller.start();reload.controller.advance(1);assert.equal(reload.controller.state().reward,0);}finally{reload.close();}
 }finally{f.close();}
 const g=fixture();try{g.controller.start();g.controller.dispose();g.controller.advance(3);assert.equal(g.controller.state().view.progress[0].count,0);assert.equal(g.controller.state().pending,null);}finally{g.close();}
});
test('S1 restore rejects separated reward receipt, grant or inventory consequences',()=>{
 const f=fixture();try{complete(f.controller);f.controller.free();f.controller.deliver();const saved=f.handle.get();
 assert.throws(()=>parseEnvelope({...saved,receipt:null}));assert.throws(()=>parseEnvelope({...saved,capabilities:initialEnvelope().capabilities}));assert.throws(()=>parseEnvelope({...saved,objective:initialEnvelope().objective}));
 }finally{f.close();}
});

test('S1 retired inspection stays available after the save owner closes',()=>{const f=fixture();f.controller.start();f.close();assert.equal(f.controller.state().retired,true);assert.equal(f.controller.state().pending,null);assert.equal(f.controller.start().retired,true);});
