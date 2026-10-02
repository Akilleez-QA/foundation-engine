// Test fixture outside src/: lint:arch's indexed-db rule scans src/ only; the fixture corrupts records directly.
import {openChunkStore} from '../../../src/core/save/chunk-store.ts';
import {CHUNK_DB_PREFIX,listChunkDatabases} from '../../../src/core/save/chunk-port.ts';
import {deriveSeed} from '../../../src/core/rng.ts';
import {cellularGridJob} from '../../../src/kits/procgen/cellular.ts';
import {createCellEdits} from '../../../src/kits/procgen/cell-edits.ts';
const idb=globalThis.indexedDB;
const done=r=>new Promise((ok,fail)=>{r.onsuccess=()=>ok(r.result);r.onerror=()=>fail(r.error);});
const raw=async(name,fn)=>{const db=await done(idb.open(CHUNK_DB_PREFIX+name));try{await new Promise((ok,fail)=>{const t=db.transaction(['records'],'readwrite');fn(t.objectStore('records'));t.oncomplete=ok;t.onerror=t.onabort=()=>fail(t.error);});}finally{db.close();}};
window.runChunkStoreCheck=async()=>{
 const name=`chunk-store-check-${Math.floor(performance.timeOrigin)}`,out={};
 const recipe={formatVersion:1,generatorVersion:1,id:'r',revision:1,seed:deriveSeed(9,'region',1,2),cellsX:32,cellsY:1,cellsZ:32,parameters:'[0.45,4,5,4]'};
 try{
  const a=await openChunkStore({name,schema:1});out.durability=a.stats().durability;
  const base=cellularGridJob.generateNow(recipe),edits=createCellEdits(base);
  edits.set(0,0,0,1-base.get(0,0,0));edits.set(17,0,9,1-base.get(17,0,9));
  out.write=(await a.write([{key:'region:1,2',revision:edits.revision,data:edits.encode()},{key:'other',revision:1,data:new Uint8Array(1000).fill(7)}])).status;
  const expected=Array.from(edits.materialize());a.close();
  const b=await openChunkStore({name,schema:1}),c=await openChunkStore({name,schema:1});
  out.reopened={records:b.stats().records,bytes:b.stats().bytes};
  const stored=await b.read('region:1,2');
  const again=createCellEdits(cellularGridJob.generateNow(recipe),{saved:stored.data,revision:stored.revision});
  out.roundTrip=JSON.stringify(Array.from(again.materialize()))===JSON.stringify(expected);
  out.tabNewer=(await c.write([{key:'other',revision:2,data:new Uint8Array(3)}])).status;
  out.tabStale=(await b.write([{key:'other',revision:2,data:new Uint8Array(4)}])).status;
  // two tabs writing at once: no lost update, exactly one winner for the same revision
  const both=await Promise.all([b.write([{key:'x',revision:1,data:new Uint8Array([1])}]),c.write([{key:'y',revision:1,data:new Uint8Array([2])}])]);
  const race=await Promise.all([b.write([{key:'z',revision:1,data:new Uint8Array([3])}]),c.write([{key:'z',revision:1,data:new Uint8Array([4])}])]);
  out.concurrent={both:both.map(r=>r.status),race:race.map(r=>r.status).sort(),x:(await c.read('x')).status,y:(await b.read('y')).status};
  b.close();c.close();
  await raw(name,s=>{const g=s.get('other');g.onsuccess=()=>{const v=g.result;v.data[0]^=0xff;s.put(v,'other');};});
  const d=await openChunkStore({name,schema:1});
  out.corrupt=(await d.read('other')).status;
  out.overwrite=(await d.write([{key:'other',revision:1,data:new Uint8Array(2)}])).status;
  const q=await d.quarantine();out.quarantine=Array.isArray(q)?q.map(r=>r.reason):q;
  // another tab upgrading the database closes this connection instead of blocking it
  const upgrade=idb.open(CHUNK_DB_PREFIX+name,2);upgrade.onupgradeneeded=()=>{};const up=await done(upgrade);up.close();
  out.afterVersionChange=(await d.read('other')).status;out.availableAfterVersionChange=d.stats().available;d.close();
  // a newer build's database is refused rather than replaced by a session store
  out.newerFormat=await openChunkStore({name,schema:1}).then(()=>'opened',e=>e.reason??String(e));
  out.listed=(await listChunkDatabases()).includes(name);
  await new Promise(r=>{const del=idb.deleteDatabase(CHUNK_DB_PREFIX+name);del.onsuccess=del.onerror=del.onblocked=()=>r();});
  const e=await openChunkStore({name,schema:1});await e.write([{key:'k',revision:1,data:new Uint8Array(1)}]);
  out.destroy=(await e.destroy()).status;out.listedAfterDestroy=(await listChunkDatabases()).includes(name);
  const s=await openChunkStore({name:'unused',schema:1,factory:null});out.fallback=s.stats().durability;s.close();
  return out;
 }finally{await new Promise(r=>{const del=idb.deleteDatabase(CHUNK_DB_PREFIX+name);del.onsuccess=del.onerror=del.onblocked=()=>r();});}
};
