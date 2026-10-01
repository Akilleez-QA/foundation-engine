import test from 'node:test';
import assert from 'node:assert/strict';
import {createController} from './controller.mjs';
import {createProjection} from './projection.mjs';
import {initial,parseDocument,validDocument,storageKey} from './document.mjs';
import {World} from '../../src/core/ecs/world.ts';
import {createSaveStore} from '../../src/core/save/store.ts';
import {MemoryBackend} from '../../src/core/save/storage-port.ts';

function fixture(wrapProjection = projection => projection) {
  const backend = new MemoryBackend();
  const store = createSaveStore({namespace:'manual-authoring',build:'test',local:backend.port(),session:new MemoryBackend().port(0,'session')});
  const saveHandle = store.section({id:'authoring.document',scope:'device',version:1,initial:() => structuredClone(initial),parse:parseDocument});
  const world = new World(), projection = createProjection(world);
  const controller = createController({value:saveHandle.get(),saveHandle,projection:wrapProjection(projection),hasEnvelope:() => backend.data.has(storageKey)});
  return {controller,projection,backend,world,close() { controller.dispose(); store.dispose(); }};
}
const moved = {x:3,y:0,z:-2,ry:Math.PI/2};
test('S1: invalid form cancels the old candidate and one ghost, without a commit', () => {
  const f = fixture();
  try {
    f.controller.preview(moved); assert.equal(f.world.count,3);
    f.controller.preview({...moved,x:''});
    assert.equal(f.world.count,2); assert.equal(f.controller.state().preview,null);
    f.controller.commit(); assert.deepEqual(f.controller.state().value,initial);
    assert.equal(f.controller.state().history.entries,0);
  } finally { f.close(); }
});
test('S1: quota failure preserves accepted document, history and old bytes; retry persists', () => {
  const f = fixture();
  try {
    f.controller.save(); const old = f.backend.data.get(storageKey); assert.ok(old);
    f.backend.failSet = k => k === storageKey;
    f.controller.preview(moved); f.controller.commit(); f.controller.save();
    assert.equal(f.backend.data.get(storageKey),old); assert.equal(f.controller.state().saveStatus,'session');
    assert.match(f.controller.state().persistence,/Unsaved/); assert.equal(f.controller.state().history.entries,1);
    f.backend.failSet = () => false; f.controller.save();
    assert.equal(f.controller.state().persistence,'Saved locally');
    assert.equal(JSON.parse(f.backend.data.get(storageKey)).data.objects[0].x,3);
  } finally { f.close(); }
});
test('S1: failed projection blocks editing until explicit rebuild of accepted document', () => {
  const f = fixture();
  try {
    f.controller.preview(moved); f.projection.failNext(); f.controller.commit();
    assert.equal(f.controller.state().blocked,true); assert.equal(f.controller.state().value.objects[0].x,3);
    assert.equal(f.projection.inspect().objects[0].x,-2);
    f.controller.undo(); assert.equal(f.controller.state().value.objects[0].x,3);
    f.controller.recover(); assert.equal(f.controller.state().blocked,false);
    assert.equal(f.projection.inspect().objects[0].x,3);
    f.controller.undo(); assert.equal(f.projection.inspect().objects[0].x,-2);
  } finally { f.close(); }
});
test('S1: history stays bounded, redo clears after branching, disposal retires all entities', () => {
  const f = fixture();
  try {
    for (let i=0;i<25;i++) { f.controller.preview({...moved,x:i%4}); f.controller.commit(); }
    assert.equal(f.controller.state().history.entries,16); assert.ok(f.controller.state().history.bytes <= 65536);
    f.controller.undo(); f.controller.preview({...moved,x:-1}); f.controller.commit(); f.controller.redo();
    assert.equal(f.controller.state().value.objects[0].x,-1);
    f.controller.dispose(); assert.equal(f.world.count,0); assert.equal(f.controller.preview(moved).status,'retired');
  } finally { f.close(); }
});
test('S1: creator rejects duplicate IDs and nonfinite coordinates; reversed allocation keeps stable identity', () => {
  assert.equal(validDocument({...initial,objects:[initial.objects[0],initial.objects[0]]}),false);
  assert.equal(validDocument({...initial,objects:[{...initial.objects[0],x:Infinity}]}),false);
  const world = new World(), projection = createProjection(world,{reverse:true}); projection.apply(initial);
  assert.deepEqual(projection.inspect().objects.map(o => [o.id,o.runtime]),[['B',1],['A',2]]);
  projection.dispose(); assert.equal(world.count,0);
});

test('S1: throwing projection cleanup drains every owner and reports all errors once', () => {
  let fail = false, clears = 0, disposals = 0;
  const clearError = Error('ghost cleanup failed'), disposeError = Error('projection cleanup reported failure');
  const f = fixture(projection => ({...projection,
    clearGhost() { if (fail) { clears++; throw clearError; } projection.clearGhost(); },
    dispose() { disposals++; projection.dispose(); throw disposeError; },
  }));
  try {
    f.controller.preview(moved); f.controller.commit();
    f.controller.preview({...moved,x:1});
    assert.equal(f.world.count,3); assert.equal(f.controller.state().history.entries,1);
    fail = true;
    assert.throws(() => f.controller.dispose(), error => {
      assert.ok(error instanceof AggregateError); assert.deepEqual(error.errors,[clearError,disposeError]); return true;
    });
    assert.equal(f.world.count,0);
    const state = f.controller.state();
    assert.equal(state.retired,true); assert.equal(state.history.retired,true);
    assert.equal(state.history.entries,0); assert.equal(state.history.bytes,0); assert.equal(state.preview,null);
    assert.deepEqual(f.controller.preview(moved),{status:'retired'});
    assert.doesNotThrow(() => f.controller.dispose());
    assert.equal(clears,1); assert.equal(disposals,1);
  } finally { f.close(); }
});
