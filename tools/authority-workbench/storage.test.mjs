import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { initializeAuthorityStorage, openAuthorityStorage } from './storage.mjs';
const version=process.versions.node.split('.').map(Number);
const supported=version[0]>22||(version[0]===22&&version[1]>=13);
const optional=(name,fn)=>test(name,{skip:supported?false:'Optional SQLite reference requires Node >=22.13',timeout:10000},fn);
const json=(revision=0,state=revision)=>JSON.stringify({version:1,lineage:'world-a',schema:'sample-v1',revision,state,streams:revision?[{id:'principal-a',through:revision,receipts:[]}]:[]});
const request=(revision=0)=>({lineage:'world-a',schema:'sample-v1',revision,json:json(revision+1)});
async function fixture(t){
  const dir=mkdtempSync(join(tmpdir(),'foundation-authority-storage-')),path=join(dir,'world.db');
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  await initializeAuthorityStorage({path,initialJson:json()});return {dir,path};
}
async function inspect(path){const {DatabaseSync}=await import('node:sqlite');const db=new DatabaseSync(path,{readOnly:true});try{return db.prepare('SELECT lineage,schema_id,revision,envelope FROM checkpoint').get();}finally{db.close();}}
optional('SQLite CAS commits one coherent envelope and verifies effective configuration',async t=>{
  const {path}=await fixture(t),s=await openAuthorityStorage({path});t.after(()=>s.close());
  assert.equal(s.configuration.journalMode,'wal');assert.equal(s.configuration.synchronous,2);assert.equal(s.configuration.busyTimeout,0);assert.ok(Object.isFrozen(s.configuration));
  assert.equal(await s.compareAndSwap(request()),'committed');await s.settle();const stored=await inspect(path);
  assert.equal(stored.revision,1);assert.equal(stored.envelope,json(1));assert.equal(await s.read(),json(1));
  assert.equal(await s.compareAndSwap(request()),'rejected');assert.equal((await inspect(path)).revision,1);
});
optional('SQLite initialization never overwrites and normal open never seeds missing or invalid files',async t=>{
  const {dir,path}=await fixture(t);await assert.rejects(initializeAuthorityStorage({path,initialJson:json()}));
  const absent=join(dir,'missing.db');await assert.rejects(openAuthorityStorage({path:absent}));assert.equal(existsSync(absent),false);
  for(const [name,content] of [['empty',''],['corrupt','not a sqlite database']]){const invalid=join(dir,name);writeFileSync(invalid,content);await assert.rejects(openAuthorityStorage({path:invalid}));}
  assert.equal((await inspect(path)).revision,0);
});
optional('SQLite malformed shape, lineage, schema and revision refuse before writing',async t=>{
  const {path}=await fixture(t),s=await openAuthorityStorage({path});t.after(()=>s.close());
  for(const value of [{...request(),json:'{'},{...request(),json:'{}'},{...request(),schema:'other'},{...request(),lineage:'other'},
    {...request(),json:json(2)},{...request(),revision:-1},{...request(),extra:true},{...request(),json:JSON.stringify({...JSON.parse(json(1)),extra:1})}])
    assert.equal(await s.compareAndSwap(value),'rejected');
  assert.equal((await inspect(path)).revision,0);
});
optional('SQLite read bounds physical row bytes before returning JSON and refuses metadata mismatch',async t=>{
  const {path}=await fixture(t),{DatabaseSync}=await import('node:sqlite');const db=new DatabaseSync(path);t.after(()=>db.close());
  db.prepare('UPDATE checkpoint SET envelope=?').run(' '.repeat(65537));await assert.rejects(openAuthorityStorage({path}),/checkpoint/);
  db.prepare('UPDATE checkpoint SET envelope=?').run(json(1));await assert.rejects(openAuthorityStorage({path}),/metadata mismatch/);
  db.prepare('UPDATE checkpoint SET envelope=?').run(json());db.exec('PRAGMA user_version=2');await assert.rejects(openAuthorityStorage({path}),/format/);
});
optional('SQLite precommit failure rolls back; postcommit failure is unknown and readback resolves facts',async t=>{
  const {path}=await fixture(t);let s=await openAuthorityStorage({path,hooks:{beforeCommit(){throw Error('fault');}}});
  assert.equal(await s.compareAndSwap(request()),'rejected');assert.equal((await inspect(path)).revision,0);s.close();
  s=await openAuthorityStorage({path,hooks:{afterCommit(){throw Error('lost outcome');}}});t.after(()=>s.close());
  assert.equal(await s.compareAndSwap(request()),'unknown');await s.settle();assert.equal(JSON.parse(await s.read()).revision,1);
  assert.equal(await s.compareAndSwap(request()),'rejected');
});
optional('SQLite hooks must be synchronous and reentrant writes cannot interleave',async t=>{
  const {path}=await fixture(t);let nested,settlement,s;
  s=await openAuthorityStorage({path,hooks:{beforeCommit(){nested=s.compareAndSwap(request());settlement=s.settle().catch(e=>e.message);return Promise.resolve();}}});t.after(()=>s.close());
  assert.equal(await s.compareAndSwap(request()),'rejected');assert.equal(await nested,'rejected');assert.equal(await settlement,'authority storage busy');assert.equal((await inspect(path)).revision,0);
});
optional('SQLite external held writer refuses promptly and owner can retry after lock release',async t=>{
  const {path}=await fixture(t),s=await openAuthorityStorage({path}),{DatabaseSync}=await import('node:sqlite');t.after(()=>s.close());const other=new DatabaseSync(path);t.after(()=>other.close());
  other.exec('BEGIN IMMEDIATE');assert.equal(await s.compareAndSwap(request()),'rejected');other.exec('ROLLBACK');assert.equal(await s.compareAndSwap(request()),'committed');
});
async function childWorker(dir,path,phase){
  const file=join(dir,`worker-${phase}-${Math.random().toString(16).slice(2)}.mjs`);
  writeFileSync(file,`import{openAuthorityStorage}from${JSON.stringify(new URL('./storage.mjs',import.meta.url).href)};
  const phase=${JSON.stringify(phase)};const hooks={};
  if(phase!=='race')hooks[phase]=()=>{process.send({type:'barrier',phase});Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,8000);};
  const store=await openAuthorityStorage({path:${JSON.stringify(path)},hooks});process.send({type:'ready'});
  process.on('message',async()=>{const outcome=await store.compareAndSwap(${JSON.stringify(request())});process.send({type:'result',outcome});store.close();process.disconnect();});`);
  return fork(file,[],{execArgv:['--import','tsx'],stdio:['ignore','ignore','ignore','ipc']});
}
for(const phase of ['beforeCommit','afterCommit'])optional(`SQLite actual parent SIGKILL at ${phase} followed by independent reopen`,async t=>{
  const {dir,path}=await fixture(t),child=await childWorker(dir,path,phase);t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});
  assert.equal((await once(child,'message'))[0].type,'ready');const barrier=once(child,'message');child.send('go');assert.equal((await barrier)[0].type,'barrier');
  const exit=once(child,'exit');child.kill('SIGKILL');await exit;
  const expected=phase==='afterCommit'?1:0,stored=await inspect(path);assert.equal(stored.revision,expected);assert.equal(stored.envelope,json(expected));
  const reopened=await openAuthorityStorage({path});await reopened.settle();assert.equal(await reopened.read(),json(expected));reopened.close();
});
optional('SQLite separate processes with the same expected revision cannot both commit',async t=>{
  const {dir,path}=await fixture(t),a=await childWorker(dir,path,'race'),b=await childWorker(dir,path,'race');
  t.after(()=>{for(const c of[a,b])if(c.exitCode===null)c.kill('SIGKILL');});
  await Promise.all([once(a,'message'),once(b,'message')]);const results=[once(a,'message'),once(b,'message')];a.send('go');b.send('go');
  const outcomes=(await Promise.all(results)).map(([r])=>r.outcome).sort();assert.deepEqual(outcomes,['committed','rejected']);assert.equal((await inspect(path)).revision,1);
});

optional('SQLite refuses corruption introduced after open without overwriting the physical bytes',async t=>{
  const {path}=await fixture(t),s=await openAuthorityStorage({path}),{DatabaseSync}=await import('node:sqlite');
  t.after(()=>s.close());const external=new DatabaseSync(path);t.after(()=>external.close());
  for(const corrupt of ['{',json(7)]) {
    external.prepare('UPDATE checkpoint SET envelope=?').run(corrupt);
    assert.equal(await s.compareAndSwap(request()),'rejected');
    assert.equal(external.prepare('SELECT envelope FROM checkpoint').get().envelope,corrupt);
  }
});
optional('SQLite drains rejected async diagnostic hooks while rolling back',async t=>{
  const {path}=await fixture(t),s=await openAuthorityStorage({path,hooks:{beforeCommit(){return Promise.reject(Error('unsupported async hook'));}}});
  t.after(()=>s.close());assert.equal(await s.compareAndSwap(request()),'rejected');
  await new Promise(resolve=>setImmediate(resolve));assert.equal((await inspect(path)).revision,0);
});
