import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as T from 'three';
import { World, type Entity } from '../core/ecs/world';
import type { SceneVisit } from '../core/router/handover';
import { createModelLibrary } from '../platform/assets/models';
import { Model } from './model';
import { Transform } from './defs';
import { createSceneModels } from './scene-model';
import { createSceneModelInspector, inspectModel, type ModelInspection } from './model-inspection';
import { sceneId } from './ids';
function observed(value: ModelInspection) { assert.equal(value.status, 'observed'); if (value.status !== 'observed') throw Error('unavailable'); return value; }
async function ready(owner: ReturnType<typeof createSceneModels>, entity: Entity) {
  const deadline = Date.now() + 3000;
  while (observed(owner.inspect!({entity})).state !== 'ready') { assert.ok(Date.now() < deadline); await new Promise(r => setTimeout(r, 1)); }
}
function fixture() {
  const world = new World(), scene = new T.Scene(), signal = new AbortController();
  const source = new T.Group(), geometry = new T.BoxGeometry(2, 2, 2); geometry.computeBoundingBox();
  source.add(new T.Mesh(geometry, new T.MeshBasicMaterial()));
  const hand = new T.Bone(); hand.name = 'hand'; source.add(hand);
  for (let i = 0; i < 2; i++) { const duplicate = new T.Group(); duplicate.name = 'duplicate'; source.add(duplicate); }
  const clip = new T.AnimationClip('wave', 1, [new T.VectorKeyframeTrack('hand.position', [0, 1], [0, 0, 0, 0, 2, 0])]);
  const library = createModelLibrary({ def: id => ({id,kind:'model',title:id,licence:'original',provenance:{},variants:[{path:`${id}.glb`,format:'glb'}]}),fetchBytes:async()=>new ArrayBuffer(16),parse:async()=>({scene:source.clone(true),animations:[clip]}) });
  const owner = createSceneModels({world,scene,library,signal:signal.signal,inspection:true,invalidate(){},report(){}});
  const entity = world.spawn(Transform({x:3}),Model({asset:'first',clip:'wave',loop:false}));
  return {world,scene,signal,library,owner,entity};
}
test('adopted variant, cached bounds, actual playback and explicit socket states follow the model owner', async () => {
  const f=fixture();
  assert.equal(observed(f.owner.inspect!({entity:f.entity})).state,'unrequested');
  f.owner.sync(); assert.equal(observed(f.owner.inspect!({entity:f.entity,sockets:['hand']})).sockets[0].status,'not-ready');
  await ready(f.owner,f.entity);f.owner.sync(.25);
  const read=()=>observed(f.owner.inspect!({entity:f.entity,sockets:['hand','missing','duplicate']}));
  const value=read();assert.equal(value.adopted!.path.value,'first.glb');assert.equal(value.playback.clip!.value,'wave');assert.equal(value.playback.appliedRestartRevision,0);assert.equal(value.playback.time,.25);
  assert.deepEqual(value.sockets.map(s=>s.status),['ready','absent','ambiguous']);assert.equal(value.sockets[0].matrix![12],3);assert.equal(value.sockets[0].matrix![13],.5);
  assert.deepEqual(value.bounds!.min,[2,-1,-1]);assert.deepEqual(value.bounds!.max,[4,1,1]);assert.equal(value.bounds!.status,'available');
  const model=f.world.get(f.entity,Model)!;model.playing=false;f.owner.sync(.25);assert.equal(read().playback.time,.25);assert.equal(read().playback.paused,true);
  model.revision=1;f.owner.sync(0);assert.equal(read().playback.appliedRestartRevision,1);assert.equal(read().playback.time,0);
  model.pose=[{node:'hand',position:[0,3,0]}];assert.equal(read().pose.complete,false);f.owner.sync(0);assert.equal(read().pose.complete,true);assert.equal(read().sockets[0].matrix![13],3);
  // Inspection compares supported fields without invoking arbitrary authored serialization.
  Object.defineProperty(model.pose[0], 'toJSON', {value(){throw Error('inspection serialized authored pose');}});
  assert.equal(read().pose.complete,true);
  model.pose=[{node:'hand',position:[0,4,0]}];assert.equal(read().pose.complete,false);
  value.sockets[0].matrix![12]=999;assert.equal(read().sockets[0].matrix![12],3);
  model.pose=[];f.owner.sync(0);assert.equal(read().pose.applied,0);
  model.clip='missing';f.owner.sync(0);assert.equal(read().playback.clip,null);assert.equal(read().playback.appliedRestartRevision,null);
  model.asset='second';assert.equal(read().replacementPending,true);assert.equal(read().adopted!.asset.value,'first');
  f.owner.sync();await ready(f.owner,f.entity);f.owner.sync();assert.equal(read().adopted!.asset.value,'second');
  const before=f.library.stats();for(let i=0;i<5;i++)read();assert.deepEqual(f.library.stats(),before);
  f.signal.abort();assert.equal(f.owner.inspect!({entity:f.entity}).status,'unavailable');assert.equal(f.library.stats().instances,0);f.library.dispose();
});
test('node traversal, pages, socket reads and labels are bounded and report incomplete geometry honestly', async () => {
  const f=fixture();f.owner.sync();await ready(f.owner,f.entity);f.owner.sync();
  const small=observed(f.owner.inspect!({entity:f.entity,maxNodes:1,maxLabelLength:2,clipLimit:1}));
  assert.equal(small.bounds!.visited,1);assert.equal(small.bounds!.truncated,true);assert.equal(small.bounds!.status,'unavailable');assert.deepEqual(small.adopted!.asset,{value:'fi',truncated:true});
  const root=new T.Group(), geometry=new T.BoxGeometry(), material=new T.MeshBasicMaterial();
  geometry.computeBoundingBox();root.add(new T.Mesh(geometry,material));
  const uncomputed=new T.Mesh(new T.BoxGeometry(),material);root.add(uncomputed);
  root.add(new T.SkinnedMesh(geometry,material));
  const morph=geometry.clone();morph.morphAttributes.position=[new T.Float32BufferAttribute([0,0,0],3)];root.add(new T.Mesh(morph,material));root.updateWorldMatrix(true,true);
  const source={slot:{asset:'bounded',ready:true,root}};
  const data=observed(inspectModel({entity:0 as Entity,maxNodes:5},()=>source));
  assert.equal(data.bounds!.visited,5);assert.equal(data.bounds!.truncated,false);assert.equal(data.bounds!.status,'partial');assert.deepEqual(data.bounds!.skipped,{skinned:1,instanced:0,morphed:1,uncomputed:1,nonfinite:0});
  const names=['hand'];Object.defineProperty(names,'map',{get(){throw Error('caller map');}});
  assert.equal(observed(f.owner.inspect!({entity:f.entity,sockets:names})).sockets[0].status,'ready');
  for(const args of [{maxNodes:4097},{clipLimit:65},{maxLabelLength:257},{sockets:Array(33).fill('hand')}])assert.throws(()=>f.owner.inspect!({entity:f.entity,...args}),RangeError);
  const clips=observed(f.owner.inspect!({entity:f.entity,clipOffset:1})).clips;assert.equal(clips.items.length,0);assert.equal(clips.nextOffset,null);
  f.owner.dispose();f.library.dispose();geometry.dispose();morph.dispose();uncomputed.geometry.dispose();material.dispose();
});
test('visit epochs, supersession and request-accessor retirement cannot expose a ended model owner', async () => {
  const f=fixture();const visitAbort=new AbortController();let current=true;
  const visit:SceneVisit={epoch:7,scene:sceneId('sample'),params:{},player:'local',signal:visitAbort.signal,current:()=>current};
  const inspect=createSceneModelInspector(f.owner.inspect!,visit,f.signal.signal);
  assert.deepEqual(inspect({entity:f.entity,expectedEpoch:6}),{status:'stale',epoch:7});
  assert.equal(inspect({entity:f.entity,expectedEpoch:7}).status,'ready');
  current=false;assert.equal(inspect({entity:f.entity,expectedEpoch:7}).status,'unavailable');current=true;
  assert.equal(inspect({entity:f.entity,expectedEpoch:7,get maxNodes(){f.signal.abort();return 1;}}).status,'unavailable');
  f.library.dispose();
});
test('original beacon uses default GLB parser; inspection borrows real adopted variant, clip and skeleton', async () => {
  const bytes=readFileSync(new URL('../../public/models/mechanics/beacon.glb',import.meta.url));
  const world=new World(),scene=new T.Scene(),life=new AbortController();
  const library=createModelLibrary({def:()=>({id:'beacon',kind:'model',title:'Beacon',licence:'original',provenance:{},variants:[{path:'models/mechanics/beacon.glb',format:'glb'}]}),fetchBytes:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)});
  const owner=createSceneModels({world,scene,library,signal:life.signal,inspection:true,invalidate(){},report(error){throw error;}});
  const entity=world.spawn(Transform(),Model({asset:'beacon',clip:'pulse'}));owner.sync();await ready(owner,entity);owner.sync(.25);
  const value=observed(owner.inspect!({entity,sockets:['hand','shoulder']}));
  assert.equal(value.adopted!.path.value,'models/mechanics/beacon.glb');assert.equal(value.clips.items[0].name.value,'pulse');assert.equal(value.playback.clip!.value,'pulse');assert.ok(value.sockets.every(s=>s.status==='ready'));assert.ok(value.sockets[1].matrix![13]>.1);
  assert.ok(value.bounds!.skipped.skinned>0);assert.notEqual(value.bounds!.status,'available');
  const before=library.stats();owner.inspect!({entity});assert.deepEqual(library.stats(),before);owner.dispose();assert.equal(library.stats().instances,0);library.dispose();
});
test('stock opt-out allocates no inspector function',()=>{const f=fixture();const owner=createSceneModels({world:f.world,scene:f.scene,library:f.library,signal:f.signal.signal,invalidate(){},report(){}});assert.equal(owner.inspect,undefined);owner.dispose();f.owner.dispose();f.library.dispose();});


test('adopted instanced models use only cached instance bounds and report missing caches as incomplete', async () => {
  for (const cached of [true, false]) {
    const geometry = new T.BoxGeometry(2, 2, 2); geometry.computeBoundingBox();
    const material = new T.MeshBasicMaterial(), mesh = new T.InstancedMesh(geometry, material, 2);
    mesh.setMatrixAt(0, new T.Matrix4().makeTranslation(100, 0, 0));
    mesh.setMatrixAt(1, new T.Matrix4().makeTranslation(200, 0, 0));
    if (cached) mesh.computeBoundingBox();
    const world = new World(), scene = new T.Scene(), life = new AbortController();
    const library = createModelLibrary({def: id => ({id,kind:'model',title:id,licence:'original',provenance:{},variants:[{path:'instances.glb',format:'glb'}]}),fetchBytes:async()=>new ArrayBuffer(1),parse:async()=>({scene:mesh,animations:[]})});
    const owner = createSceneModels({world,scene,library,signal:life.signal,inspection:true,invalidate(){},report(error){throw error;}});
    try {
      const entity = world.spawn(Transform({x:3}),Model({asset:'instances'}));
      owner.sync(); await ready(owner,entity); owner.sync();
      const adopted = scene.children[0].children[0] as T.InstancedMesh;
      assert.equal(adopted.isInstancedMesh,true);
      adopted.computeBoundingBox = () => { throw Error('inspection must not compute instance bounds'); };
      adopted.getMatrixAt = () => { throw Error('inspection must not enumerate instance transforms'); };
      const before = library.stats(), value = observed(owner.inspect!({entity}));
      assert.equal(value.adopted!.path.value,'instances.glb');
      if (cached) {
        assert.equal(value.bounds!.status,'available');assert.deepEqual(value.bounds!.min,[102,-1,-1]);assert.deepEqual(value.bounds!.max,[204,1,1]);assert.equal(value.bounds!.skipped.instanced,0);
        value.bounds!.min![0]=999;assert.deepEqual(observed(owner.inspect!({entity})).bounds!.min,[102,-1,-1]);
      } else {
        assert.equal(value.bounds!.status,'unavailable');assert.equal(value.bounds!.included,0);assert.equal(value.bounds!.skipped.instanced,1);assert.equal(value.bounds!.min,null);assert.equal(adopted.boundingBox,null);
        const rigid = new T.Mesh(geometry,material);scene.children[0].add(rigid);scene.updateMatrixWorld(true);
        const mixed = observed(owner.inspect!({entity}));assert.equal(mixed.bounds!.status,'partial');assert.equal(mixed.bounds!.skipped.instanced,1);assert.deepEqual(mixed.bounds!.min,[2,-1,-1]);assert.deepEqual(mixed.bounds!.max,[4,1,1]);
      }
      assert.deepEqual(library.stats(),before);
    } finally { owner.dispose(); library.dispose(); }
  }
});
