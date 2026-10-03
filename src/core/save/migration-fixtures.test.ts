/** Version-labelled example envelopes; preserve old bytes when extending this fixture contract. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MemoryBackend} from './storage-port';
import {createSaveStore, type Timers} from './store';
import type {SaveSection} from './section';

const key = 'game|p:1|compat.record';
const definition: SaveSection<{total:number; labels:string[]}> = {
  id:'compat.record', scope:'player', version:3, initial:()=>({total:0,labels:[]}),
  parse: raw=>{
    const value=raw as {total:number; labels:string[]};
    if(!Number.isInteger(value?.total)||!Array.isArray(value.labels)||value.labels.some(x=>typeof x!=='string')) throw Error('invalid record');
    return {total:value.total,labels:[...value.labels]};
  },
  migrations:{1:(old:{count:number})=>({total:old.count}),2:(old:{total:number})=>({...old,labels:[]})},
};
function owner(backend:MemoryBackend){
  const timers:Timers={now:()=>0,set:()=>0,clear:()=>{}};
  return createSaveStore({local:backend.port(),session:new MemoryBackend().port(0,'session'),build:'fixture@current',timers,sections:[definition]});
}
const fixtures=[
  {version:1,expected:{total:7,labels:[]}},
  {version:2,expected:{total:11,labels:[]}},
  {version:3,expected:{total:13,labels:['kept']}},
];
for(const {version,expected} of fixtures){
  const raw=readFileSync(new URL(`./fixtures/migrations/v${version}.json`,import.meta.url),'utf8');
  test(`retained v${version} envelope loads, flushes and reopens with a fresh owner`,()=>{
    const backend=new MemoryBackend();backend.data.set(key,raw);
    const first=owner(backend);
    try{
      assert.deepEqual(first.section(definition).get(),expected);first.flush();
      assert.equal(first.section(definition).status(),'saved');
      assert.equal(JSON.parse(backend.data.get(key)!).v,3);
      if(version<3)assert.equal(backend.data.get(`game-bak|${key}|v${version}`),raw,'exact pre-migration bytes retained');
      else assert.equal(backend.data.get(key),raw,'current envelope is not rewritten');
    }finally{first.dispose();}
    const writes=backend.writes,second=owner(backend);
    try{assert.deepEqual(second.section(definition).get(),expected);second.flush();assert.equal(backend.writes,writes,'reload does not migrate again');}
    finally{second.dispose();}
  });
  if(version<3)test(`v${version} backup refusal preserves the original through retry and fresh-owner reload`,()=>{
    const backend=new MemoryBackend();backend.data.set(key,raw);backend.failSet=k=>k.startsWith('game-bak|');
    const first=owner(backend);
    try{
      assert.deepEqual(first.section(definition).get(),expected);first.flush();
      assert.equal(first.section(definition).status(),'session');assert.equal(backend.data.get(key),raw);
      assert.equal(backend.data.has(`game-bak|${key}|v${version}`),false);
      backend.failSet=()=>false;first.flush();assert.equal(first.section(definition).status(),'saved');
      assert.equal(backend.data.get(`game-bak|${key}|v${version}`),raw);
      assert.deepEqual(JSON.parse(backend.data.get(key)!).data,expected);
    }finally{first.dispose();}
    const second=owner(backend);try{assert.deepEqual(second.section(definition).get(),expected);}finally{second.dispose();}
  });
}

test('invalid current fixture survives refused quarantine, retry and fresh-owner reload',()=>{
  const raw=readFileSync(new URL('./fixtures/migrations/v3-invalid.json',import.meta.url),'utf8');
  const backend=new MemoryBackend();backend.data.set(key,raw);backend.failSet=k=>k.startsWith('game-q|');
  const expected={total:17,labels:['recovered']},first=owner(backend);
  try{
    const handle=first.section(definition);assert.equal(handle.status(),'quarantined');
    handle.update(draft=>Object.assign(draft,expected));first.flush();
    assert.equal(backend.data.get(key),raw);assert.equal(backend.data.has(`game-q|${key}`),false);
    backend.failSet=()=>false;first.flush();assert.equal(handle.status(),'saved');
    assert.equal(backend.data.get(`game-q|${key}`),raw);
  }finally{first.dispose();}
  const second=owner(backend);try{assert.deepEqual(second.section(definition).get(),expected);}finally{second.dispose();}
});

test('unsupported future fixture remains unchanged through attempted edits and owner disposal',()=>{
  const raw=readFileSync(new URL('./fixtures/migrations/v4-unsupported.json',import.meta.url),'utf8');
  const backend=new MemoryBackend();backend.data.set(key,raw);
  for(let attempt=0;attempt<2;attempt++){
    const current=owner(backend);
    try{const handle=current.section(definition);assert.equal(handle.status(),'newer');handle.update(draft=>{draft.total=99;});current.flush();assert.equal(backend.data.get(key),raw);}
    finally{current.dispose();}
    assert.equal(backend.data.get(key),raw,'disposal cannot overwrite unsupported data');
  }
});
