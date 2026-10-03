import test from 'node:test';
import assert from 'node:assert/strict';
import {createSaveStore,type Timers} from './store';
import {MemoryBackend} from './storage-port';
import type {SaveSection} from './section';
import { must } from '../../testing/must';

function setup(){
 const disk=new MemoryBackend(),tasks=new Map<number,()=>void>();let id=0;
 const timers:Timers={now:()=>0,set:fn=>{tasks.set(++id,fn);return id;},clear:key=>{tasks.delete(key as number);}};
 const store=createSaveStore({local:disk.port(),session:new MemoryBackend().port(0,'session'),build:'pending-test',timers});
 const section:SaveSection<number>={id:'test.value',scope:'device',version:1,initial:()=>0,parse:Number};
 const run=()=>{const batch=[...tasks.values()];tasks.clear();for(const fn of batch)fn();};
 return {store,disk,tasks,section,run};
}
test('pending observes eager debounce and batch state without changing bytes or scheduling',()=>{
 const {store,disk,tasks,section,run}=setup();
 assert.deepEqual(store.pending(),{dirty:0,eagerDirty:0,lazyDirty:0,scheduled:false,batching:false});
 store.batch(()=>{
  store.section(section).replace(7);
  assert.equal(store.pending().batching,true);assert.equal(store.pending().eagerDirty,1);assert.equal(tasks.size,0);
 });
 const bytes=[...disk.data],scheduled=[...tasks.keys()];
 for(let i=0;i<3;i++)assert.deepEqual(store.pending(),{dirty:1,eagerDirty:1,lazyDirty:0,scheduled:true,batching:false});
 assert.deepEqual([...disk.data],bytes);assert.deepEqual([...tasks.keys()],scheduled);assert.equal(disk.writes,0);
 run();assert.equal(store.pending().eagerDirty,0);assert.equal(store.pending().scheduled,false);assert.equal(disk.writes,1);
 store.dispose();
});
test('failed autosave stays dirty and schedules its real retry; lazy writes are reported separately',()=>{
 const {store,disk,section,run}=setup();
 disk.failSet=()=>true;store.section(section).replace(9);run();
 assert.equal(store.pending().scheduled,true);assert.equal(store.pending().eagerDirty,1);
 assert.equal(store.section(section).status(),'session');
 store.section({...section,id:'test.lazy',flush:'lazy'}).replace(4);
 assert.equal(store.pending().lazyDirty,1);assert.equal(store.pending().dirty,2);
 const before=disk.writes;store.pending();assert.equal(disk.writes,before);
 disk.failSet=()=>false;store.dispose();
});

test('lazy-only dirty cells do not invent an autosave timer',()=>{
 const {store,section,tasks}=setup();
 store.section({...section,flush:'lazy'}).replace(3);
 assert.deepEqual(store.pending(),{dirty:1,eagerDirty:0,lazyDirty:1,scheduled:false,batching:false});
 assert.equal(tasks.size,0);store.dispose();
});

test('disposal attempts the final save once and never retries a failed write', () => {
  const { store, disk, section, tasks, run } = setup();
  const handle = store.section(section);
  disk.failSet = () => true;
  handle.replace(9);
  store.dispose();
  assert.equal(tasks.size, 0);
  assert.equal(store.pending().dirty, 1);
  assert.equal(store.pending().scheduled, false);
  disk.failSet = () => false;
  run();
  store.dispose();
  assert.equal(disk.writes, 0);
  for (const operation of [
    () => handle.replace(10, { now: true }),
    () => handle.update(() => 11),
    () => handle.get(),
    () => handle.status(),
    () => handle.subscribe(() => {}),
    () => store.batch(() => handle.replace(12)),
    () => store.flush(),
    () => store.resetAll(),
  ]) assert.throws(operation, /SaveStore is disposed/);
  assert.equal(tasks.size, 0);
});

test('disposal saves dirty bytes once and is safe inside a notification or batch', () => {
  const { store, disk, section, tasks } = setup();
  const handle = store.section(section);
  let laterNotifications = 0;
  handle.subscribe(() => store.dispose());
  handle.subscribe(() => { laterNotifications++; handle.get(); });
  store.batch(() => handle.replace(7, { now: true }));
  assert.equal(disk.writes, 1);
  assert.equal(JSON.parse(must([...disk.data.values()][0], 'the written record')).data, 7);
  assert.equal(tasks.size, 0);
  assert.equal(laterNotifications, 0);
  store.dispose();
  assert.equal(disk.writes, 1);
});

test('final flush suppresses notifications and drains subscription cleanup after errors', () => {
  const disk = new MemoryBackend();
  const local = disk.port();
  const session = new MemoryBackend().port(0, 'session');
  const original = Error('unsubscribe failed');
  const cleanup: string[] = [];
  local.subscribe = () => () => { cleanup.push('local'); throw original; };
  session.subscribe = () => () => { cleanup.push('session'); };
  const tasks = new Map<number, () => void>();
  let id = 0;
  const store = createSaveStore({ local, session, build: 'test', timers: {
    now: () => 0, set: fn => { tasks.set(++id, fn); return id; }, clear: key => { tasks.delete(key as number); },
  } });
  const definition: SaveSection<number> = {
    id: 'test.merge', scope: 'device', version: 1, initial: () => 0, parse: Number,
    merge: (stored, incoming) => { store.dispose(); return stored + incoming; },
  };
  const handle = store.section(definition);
  handle.replace(2);
  disk.data.set('game|device|test.merge', JSON.stringify({ v: 1, data: 3 }));
  handle.subscribe(() => { handle.get(); handle.update(v => v + 1); });
  assert.throws(() => store.dispose(), error => error instanceof AggregateError && error.errors.includes(original));
  assert.deepEqual(cleanup, ['local', 'session']);
  assert.equal(JSON.parse(disk.data.get('game|device|test.merge')!).data, 5);
  assert.equal(tasks.size, 0);
  store.dispose();
});

test('subscriber disposal stops an import before later sections and orphan writes', () => {
  const { store, disk, section, tasks } = setup();
  const first = store.section(section);
  const later = { ...section, id: 'test.later' };
  store.section(later);
  first.subscribe(() => store.dispose());
  const file = JSON.stringify({ format: 'engine-profile', version: 2, sections: {
    [section.id]: { v: 1, data: 7 }, [later.id]: { v: 1, data: 8 },
  }, orphans: { 'missing.section': { v: 1, data: 9 } } });
  assert.throws(() => store.importPlayer(file), /SaveStore is disposed/);
  assert.equal(disk.writes, 1, 'only the value already committed before disposal is finally flushed');
  assert.equal(JSON.parse(disk.data.get('game|device|test.value')!).data, 7);
  assert.equal(disk.data.has('game|device|test.later'), false);
  assert.equal(disk.data.has('game|p:1|missing.section'), false);
  assert.equal(tasks.size, 0);
});

test('subscriber disposal during player change stops later subscriptions and player listeners', () => {
  const { store, section, tasks } = setup();
  const second = store.addPlayer();
  const first = store.section({ ...section, scope: 'player' });
  const observed: string[] = [];
  first.subscribe(() => { observed.push('first'); store.dispose(); });
  first.subscribe(() => { observed.push('later'); first.get(); });
  store.onPlayerChanged(() => observed.push('player'));
  store.setActivePlayer(second);
  assert.deepEqual(observed, ['first']);
  assert.equal(tasks.size, 0);
});


test('a retained replacement rejects before invoking its parser after disposal', () => {
  const { store, section } = setup();
  let parses = 0;
  const handle = store.section({ ...section, parse: value => { parses++; return Number(value); } });
  store.dispose();
  assert.throws(() => handle.replace(4), /SaveStore is disposed/);
  assert.equal(parses, 0);
});
