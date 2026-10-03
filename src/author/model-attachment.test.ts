import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { World } from '../core/ecs/world';
import { Transform, defineScene } from './defs';
import { Model } from './model';
import { ModelAttachment, captureModelAttachment } from './model-attachment';
import { createSceneModels } from './scene-model';
import { createModelLibrary } from '../platform/assets/models';
import { testScene } from './testing';
import { must } from '../testing/must';
const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const relation = (parent: number, extra: Partial<Parameters<typeof captureModelAttachment>[0]> = {}) => ModelAttachment({ parent, socket: 'anchor', unavailable: 'hide', inheritVisibility: true, ...extra });
async function waitFor(predicate: () => boolean) {
  const until = Date.now() + 2000;
  while (!predicate()) { assert.ok(Date.now() < until, 'readiness deadline'); await new Promise(r => setTimeout(r, 1)); }
}
function fixture(limit = 8, duplicates = false) {
  const world = new World(), scene = new T.Scene(), life = new AbortController(), errors: unknown[] = [];
  const library = createModelLibrary({
    def: id => ({ id, kind: 'model', title: id, licence: 'original', provenance: {}, variants: [{ path: id + '.glb', format: 'glb' }] }),
    fetchBytes: async () => new ArrayBuffer(16),
    parse: async () => {
      const source = new T.Group(), joint = new T.Object3D(); joint.name = 'anchor'; joint.position.x = 1;
      joint.scale.set(2, 3, 1); source.add(joint);
      if (duplicates) { const duplicate = new T.Object3D(); duplicate.name = 'anchor'; source.add(duplicate); }
      // Definitions have distinct URLs; test sources use deterministic original geometry.
      const mesh = new T.Mesh(new T.BoxGeometry(1, 1, 1), new T.MeshBasicMaterial()); source.add(mesh);
      const clip = new T.AnimationClip('move', 1, [new T.VectorKeyframeTrack('anchor.position', [0, 1], [1, 0, 0, 1, 2, 0])]);
      return { scene: source, animations: [clip] };
    },
  });
  let invalidations = 0;
  const owner = createSceneModels({ world, scene, library, signal: life.signal, maxInstances: limit,
    invalidate() { invalidations++; }, report(error) { errors.push(error); } });
  const spawn = (asset = 'original', x = 0) => world.spawn(Transform({ x }), Model({ asset, playing: false }));
  const ready = async (...entities: number[]) => { owner.sync(); await waitFor(() => entities.every(e => owner.state(e).status === 'ready')); };
  const root = (entity: number) => {
    const matrix = owner.socket(entity, 'anchor')!.matrix;
    // Tests identify the native root via its unique joint, never duplicate production composition.
    return scene.children.find(r => { const node = r.getObjectByName('anchor'); node?.updateWorldMatrix(true, false); return node && node.matrixWorld.elements.every((v, i) => v === matrix[i]); })!;
  };
  return { world, scene, life, errors, library, owner, spawn, ready, root, invalidations: () => invalidations };
}

test('attachment constructor detaches affine input and requires explicit finite policies', () => {
  const matrix = identity(), input = { parent: 1, socket: 'anchor', offset: matrix, unavailable: 'hold' as const, inheritVisibility: false };
  const captured = ModelAttachment(input).value; matrix[12] = 99; input.parent = 2;
  assert.equal(captured.offset[12], 0); assert.equal(captured.parent, 1);
  assert.ok(Object.isFrozen(captured)); assert.ok(Object.isFrozen(captured.offset));
  for (const bad of [{ parent: 0 }, { socket: '' }, { unavailable: undefined }, { inheritVisibility: undefined }, { offset: [1] }, { offset: identity().map((n, i) => i === 3 ? 1 : n) }, { offset: identity().map((n, i) => i === 12 ? Infinity : n) }]) {
    assert.throws(() => ModelAttachment({ ...input, ...bad }), /attachment/);
  }
  Object.defineProperty(matrix, 'every', { value: () => { throw Error('caller method'); } });
  assert.doesNotThrow(() => ModelAttachment({ ...input, offset: matrix }));
});

test('same-frame native pose composes full affine attachment without simulation mutation or idle dirty churn', async () => {
  const f = fixture();
  try {
    const parent = f.spawn('parent', 3), child = f.spawn('child', 20);
    const offset = new T.Matrix4().makeRotationZ(Math.PI / 4); offset.setPosition(0, 1, 0);
    f.world.add(child, relation(parent, { offset: offset.elements }));
    const tr = { ...f.world.get(child, Transform)! };
    await f.ready(parent, child);
    const childRoot = must(f.scene.children[1], 'scene root 1'); assert.equal(childRoot.visible, false, 'async publication starts hidden');
    f.world.get(parent, Transform)!.x = 7;
    f.world.get(parent, Model)!.clip = 'move'; f.world.get(parent, Model)!.playing = true;
    f.owner.sync(.25);
    assert.equal(f.owner.attachmentState(child).status, 'ready');
    // Analytic columns: diagonal(2,3,1) times Z rotation; translation = parent + joint + scaled offset.
    const a = Math.SQRT1_2, expected = [2*a,3*a,0,0,-2*a,3*a,0,0,0,0,1,0,8,3.5,0,1];
    childRoot.matrixWorld.elements.forEach((n,i) => assert.ok(Math.abs(n-must(expected[i], `expected ${i}`)) < 1e-12, `matrix ${i}`));
    assert.deepEqual(f.world.get(child, Transform), tr);
    f.world.get(parent, Model)!.playing = false;
    f.owner.sync(); assert.equal(f.owner.sync(), false); assert.equal(f.owner.sync(), false);
    const before = f.invalidations(), stats = f.library.stats();
    for (let i=0;i<20;i++) assert.equal(f.owner.attachmentState(child).status, 'ready');
    assert.equal(f.invalidations(), before); assert.deepEqual(f.library.stats(), stats);
    f.world.remove(child, ModelAttachment); assert.equal(f.owner.sync(), true);
    assert.equal(childRoot.matrixAutoUpdate, true); assert.equal(childRoot.matrixWorld.elements[12],20);
    assert.equal(f.owner.attachmentState(child).status,'unattached'); assert.equal(f.owner.sync(),false);
  } finally { f.owner.dispose(); }
  assert.equal(f.library.stats().instances,0); assert.deepEqual(f.errors,[]);
});

test('reverse allocation chains resolve parent-first and cycles block descendants without moving them', async () => {
  const f=fixture();
  try {
    const last=f.spawn('last'), middle=f.spawn('middle'), first=f.spawn('first',5);
    f.world.add(last,relation(middle)); f.world.add(middle,relation(first)); await f.ready(last,middle,first); f.owner.sync();
    const lastRoot=must(f.scene.children[0], 'scene root 0'), middleRoot=must(f.scene.children[1], 'scene root 1');
    assert.equal(lastRoot.matrixWorld.elements[12],8); assert.equal(middleRoot.matrixWorld.elements[12],6);
    const old=lastRoot.matrixWorld.clone();
    f.world.add(first,relation(middle)); f.owner.sync();
    assert.equal(f.owner.attachmentState(first).status,'cycle'); assert.equal(f.owner.attachmentState(middle).status,'cycle');
    assert.equal(f.owner.attachmentState(last).status,'blocked'); assert.equal(lastRoot.visible,false); assert.ok(lastRoot.matrixWorld.equals(old));
    assert.equal(f.owner.sync(),false);
    f.world.remove(first,ModelAttachment); f.owner.sync(); assert.equal(lastRoot.visible,true); assert.equal(f.owner.attachmentState(last).status,'ready');
  } finally { f.owner.dispose(); }
});

test('hide and hold distinguish unavailable ancestry, visibility inheritance and changed relations', async () => {
  const f=fixture();
  try {
    const parent=f.spawn('parent',3), child=f.spawn('child'), grandchild=f.spawn('grandchild');
    f.world.add(child,relation(parent,{unavailable:'hold'})); f.world.add(grandchild,relation(child,{inheritVisibility:false}));
    await f.ready(parent,child,grandchild); f.owner.sync(); const childRoot=must(f.scene.children[1], 'scene root 1'), grandchildRoot=must(f.scene.children[2], 'scene root 2');
    f.world.get(parent,Model)!.visible=false; f.owner.sync(); assert.equal(childRoot.visible,false); assert.equal(grandchildRoot.visible,true);
    f.world.get(parent,Model)!.visible=true; f.owner.sync(); const matrix=childRoot.matrixWorld.clone();
    f.world.despawn(parent); f.owner.sync();
    assert.deepEqual(f.owner.attachmentState(child),{status:'waiting',held:true}); assert.equal(childRoot.visible,true); assert.ok(childRoot.matrixWorld.equals(matrix));
    assert.deepEqual(f.owner.attachmentState(grandchild),{status:'blocked',held:false}); assert.equal(grandchildRoot.visible,false);
    assert.equal(f.owner.sync(),false);
    f.world.add(child,relation(999,{unavailable:'hold'})); f.owner.sync(); assert.equal(childRoot.visible,false); assert.equal(f.owner.attachmentState(child).held,false);
    f.world.remove(child,ModelAttachment); f.owner.sync(); assert.equal(childRoot.visible,true); assert.equal(grandchildRoot.visible,true);
  } finally { f.owner.dispose(); }
});

test('missing sockets and overflowing composition remain hidden with observed failure', async () => {
  const f=fixture();
  try {
    const parent=f.spawn('parent'), child=f.spawn('child'); f.world.add(child,relation(parent,{socket:'absent'})); await f.ready(parent,child); f.owner.sync();
    assert.equal(f.owner.attachmentState(child).status,'missing-socket'); assert.equal(must(f.scene.children[1], 'scene root 1').visible,false);
    const offset=identity(); offset[12]=Number.MAX_VALUE; f.world.add(child,relation(parent,{offset})); f.owner.sync();
    assert.equal(f.owner.attachmentState(child).status,'invalid'); assert.equal(must(f.scene.children[1], 'scene root 1').visible,false); assert.equal(f.owner.sync(),false);
  } finally { f.owner.dispose(); }
});

test('headless attachment state does not pretend a model or native pose was rendered',async()=>{
  const visit=await testScene(defineScene({id:'attachment-test',title:'Attachment',entities:[[Transform(),Model({asset:'original'})]]}));
  const [e]=must([...visit.world.query(Model)][0], 'a model entity'); visit.world.add(e,relation(999));
  assert.deepEqual(visit.ctx.modelAttachmentState(e),{status:'unresolved',held:false});
  visit.run(.1); assert.equal(visit.ctx.modelAttachmentState(e).status,'unresolved'); visit.dispose(); assert.equal(visit.ctx.modelAttachmentState(e).status,'absent');
});


test('duplicate node names cannot resolve an attachment', async () => {
  const f=fixture(2,true);
  try {
    const parent=f.spawn('parent'), child=f.spawn('child'); f.world.add(child,relation(parent)); await f.ready(parent,child); f.owner.sync();
    assert.equal(f.owner.attachmentState(child).status,'ambiguous-socket'); assert.equal(must(f.scene.children[1], 'scene root 1').visible,false);
  } finally { f.owner.dispose(); }
});

test('later relation capture cannot publish a removed or replaced earlier relation', async () => {
  for (const remove of [true,false]) {
    const f=fixture();
    try {
      const parent=f.spawn('parent',5), first=f.spawn('first',20), later=f.spawn('later');
      f.world.add(first,relation(parent)); f.world.add(later,relation(parent)); await f.ready(parent,first,later); f.owner.sync();
      const firstRoot=must(f.scene.children[1], 'scene root 1');
      const raw={...relation(parent).value};
      Object.defineProperty(raw,'socket',{get(){
        if(remove) f.world.remove(first,ModelAttachment); else f.world.add(first,relation(999));
        return 'anchor';
      }});
      f.world.add(later,{type:ModelAttachment,value:raw}); f.owner.sync();
      assert.equal(f.owner.attachmentState(first).status,remove?'unattached':'unresolved');
      assert.equal(firstRoot.visible,remove); if(remove)assert.equal(firstRoot.matrixWorld.elements[12],20);
    } finally {f.owner.dispose();}
  }
});

test('native matrix callback cannot revive a disposed attachment owner',async()=>{
  const f=fixture();
  const parent=f.spawn('parent'),child=f.spawn('child');f.world.add(child,relation(parent)); await f.ready(parent,child);f.owner.sync();
  const node=must(f.scene.children[0], 'scene root 0').getObjectByName('anchor')!, original=node.updateWorldMatrix;
  let trigger=false;
  node.updateWorldMatrix=function(a,b){original.call(this,a,b);if(trigger)f.owner.dispose();}; trigger=true;
  assert.doesNotThrow(()=>f.owner.sync()); assert.equal(f.owner.attachmentState(child).status,'absent');
  assert.equal(f.scene.children.length,0);assert.equal(f.library.stats().instances,0);assert.equal(f.library.stats().residentMiB,0);
});

test('affine attachment uses world socket once even with a transformed scene container',async()=>{
  const f=fixture();
  try {
    f.scene.position.set(10,20,30);f.scene.scale.set(2,3,4);
    const parent=f.spawn('parent',5),child=f.spawn('child');f.world.add(child,relation(parent));await f.ready(parent,child);f.owner.sync();
    assert.equal(must(f.scene.children[1], 'scene root 1').matrixWorld.elements[12],22);
    assert.equal(must(f.scene.children[1], 'scene root 1').matrixWorld.elements[13],20);
    assert.equal(must(f.scene.children[1], 'scene root 1').matrixWorld.elements[14],30);
    assert.equal(f.owner.sync(),false);
  }finally{f.owner.dispose();}
});

test('parent replacement holds only prior valid presentation and late completion cannot restore obsolete attachment',async()=>{
  const f=fixture(2); f.owner.dispose(); let arrive:(()=>void)|undefined,lateReleased=0;
  const library={...f.library,async model(id:string, options:Parameters<typeof f.library.model>[1]){
    if(id!=='slow')return f.library.model(id,options);
    const lease=await f.library.model(id,{signal:new AbortController().signal});
    return new Promise<typeof lease>(resolve=>{arrive=()=>resolve({...lease,release(){lateReleased++;lease.release();}});});
  }};
  const owner=createSceneModels({world:f.world,scene:f.scene,library,signal:f.life.signal,maxInstances:2,invalidate(){},report:e=>f.errors.push(e)});
  try{
    const parent=f.spawn('parent',3),child=f.spawn('child');f.world.add(child,relation(parent,{unavailable:'hold'}));
    owner.sync();await waitFor(()=>owner.state(parent).status==='ready'&&owner.state(child).status==='ready');owner.sync();
    const childRoot=must(f.scene.children[1], 'scene root 1'), accepted=childRoot.matrix.clone();
    f.world.get(parent,Model)!.asset='slow';owner.sync();await waitFor(()=>!!arrive);
    assert.deepEqual(owner.attachmentState(child),{status:'waiting',held:true});assert.ok(childRoot.matrix.equals(accepted));assert.equal(childRoot.visible,true);
    f.world.get(parent,Transform)!.x=10;f.world.get(parent,Model)!.asset='replacement';owner.sync();await waitFor(()=>owner.state(parent).status==='ready');owner.sync();
    assert.equal(childRoot.matrixWorld.elements[12],11);arrive!();await waitFor(()=>lateReleased===1);owner.sync();
    assert.equal(childRoot.matrixWorld.elements[12],11);assert.equal(f.library.stats().instances,2);
    f.world.get(child,Model)!.asset='new-child';owner.sync();assert.equal(owner.attachmentState(child).held,false);
    await waitFor(()=>owner.state(child).status==='ready');assert.equal(f.scene.children.find(r=>r!==must(f.scene.children[0], 'scene root 0'))!.visible,false);owner.sync();
    assert.equal(owner.attachmentState(child).status,'ready');assert.deepEqual(f.errors,[]);
  }finally{owner.dispose();arrive?.();}
  assert.equal(f.library.stats().instances,0);assert.equal(f.library.stats().residentMiB,0);
});

test('native pose overrides precede attachment composition',async()=>{
  const f=fixture();try{
    const parent=f.spawn('parent',3),child=f.spawn('child');const offset=identity();offset[12]=1;f.world.add(child,relation(parent,{offset}));await f.ready(parent,child);
    f.world.get(parent,Model)!.pose=[{node:'anchor',position:[2,0,0],rotation:[0,0,Math.SQRT1_2,Math.SQRT1_2]}];f.owner.sync();
    const matrix=must(f.scene.children[1], 'scene root 1').matrixWorld.elements;assert.ok(Math.abs(matrix[12]-5)<1e-12);assert.ok(Math.abs(matrix[13]-2)<1e-12);assert.equal(f.owner.sync(),false);
  }finally{f.owner.dispose();}
});

test('a relation superseding itself during capture cannot leave prior socket presentation visible', async () => {
  for (const remove of [true,false]) {
    const f=fixture();
    try {
      const parent=f.spawn('parent',4),child=f.spawn('child',20);
      f.world.add(child,relation(parent));await f.ready(parent,child);f.owner.sync();const root=must(f.scene.children[1], 'scene root 1');
      assert.equal(root.matrixWorld.elements[12],5);
      const raw={...relation(parent).value};
      Object.defineProperty(raw,'socket',{get(){
        if(remove)f.world.remove(child,ModelAttachment);else f.world.add(child,relation(999));
        return 'anchor';
      }});
      f.world.add(child,{type:ModelAttachment,value:raw});f.owner.sync();
      assert.equal(f.owner.attachmentState(child).status,remove?'unattached':'unresolved');
      assert.equal(root.visible,remove);
      if(remove){assert.equal(root.matrixAutoUpdate,true);assert.equal(root.matrixWorld.elements[12],20);}
    }finally{f.owner.dispose();}
  }
});

test('native pose callback removing the last relation restores ordinary presentation in the same sync', async () => {
  const f=fixture();
  try {
    const parent=f.spawn('parent',4), child=f.spawn('child',20);
    f.world.add(child,relation(parent)); await f.ready(parent,child); f.owner.sync();
    const root=must(f.scene.children[1], 'scene root 1'), node=root.getObjectByName('anchor')!, original=node.updateWorldMatrix;
    assert.equal(root.matrixWorld.elements[12],5); let armed=true;
    node.updateWorldMatrix=function(parents,children){
      original.call(this,parents,children);
      if(armed){armed=false;f.world.remove(child,ModelAttachment);}
    };
    assert.equal(f.owner.sync(),true);
    assert.equal(f.owner.attachmentState(child).status,'unattached');
    assert.equal(root.matrixAutoUpdate,true); assert.equal(root.matrixWorld.elements[12],20);
    assert.equal(root.visible,true); assert.equal(f.owner.sync(),false);
  } finally {f.owner.dispose();}
});

test('sockets and chained attachments read current world matrices after the scene container moves (three r185+ updateWorldMatrix)', async () => {
  // three r185+ recomputes an ancestor in updateWorldMatrix(true, …) only when its own matrixWorldNeedsUpdate is set.
  // Attached roots keep a manual local matrix, so a moved container must still reach their sockets and descendants.
  const f=fixture();
  try {
    const last=f.spawn('last'), middle=f.spawn('middle'), first=f.spawn('first',5);
    f.world.add(last,relation(middle)); f.world.add(middle,relation(first)); await f.ready(last,middle,first); f.owner.sync();
    const before=new Set(f.scene.children), lastRoot=must(f.scene.children[0], 'scene root 0'), middleRoot=must(f.scene.children[1], 'scene root 1');
    assert.equal(middleRoot.matrixAutoUpdate,false);
    const s0=f.owner.socket(middle,'anchor')!.matrix, last0=lastRoot.matrixWorld.elements[12];
    // Move only the container (no full scene update): every read below must still see it.
    f.scene.position.set(100,0,-4);
    const s1=f.owner.socket(middle,'anchor')!.matrix;
    assert.equal(s1[12],must(s0[12])+100,'socket follows the moved container'); assert.equal(s1[14],must(s0[14])-4);
    // A new attachment to that socket resolves from the current container, not the pre-move world matrix.
    const extra=f.spawn('extra'); f.world.add(extra,relation(middle)); await f.ready(extra); f.owner.sync();
    assert.equal(f.owner.attachmentState(extra).status,'ready');
    const extraRoot=f.scene.children.find(r=>!before.has(r))!;
    f.scene.updateMatrixWorld(true);
    assert.equal(lastRoot.matrixWorld.elements[12],last0+100);
    assert.equal(extraRoot.matrixWorld.elements[12],lastRoot.matrixWorld.elements[12],'same socket, same offset, same world');
    assert.equal(extraRoot.matrixWorld.elements[14],lastRoot.matrixWorld.elements[14]);
  } finally { f.owner.dispose(); }
  assert.deepEqual(f.errors,[]);
});
