import test from 'node:test';
import assert from 'node:assert/strict';
import { must } from '../testing/must';
import * as T from 'three';
import {World} from '../core/ecs/world';
import {Transform} from './defs';
import {Model} from './model';
import {ModelAttachment} from './model-attachment';
import {ModelPoseLink,normalizeModelPoseLinkLimits} from './model-pose-link';
import {createSceneModels} from './scene-model';
import {createModelLibrary} from '../platform/assets/models';
const mapping=[{source:'A',target:'A'},{source:'B',target:'B'}];
const link=(source:number)=>ModelPoseLink({source,nodes:mapping,inheritVisibility:true});
function rig(offset=0){
 const scene=new T.Group();scene.position.x=offset;
 const a=new T.Bone(),b=new T.Bone();a.name='A';b.name='B';b.position.x=1;a.add(b);scene.add(a);
 const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute([0,1,0,2,0,0,2,0,0],3));
 geometry.setAttribute('skinIndex',new T.Uint16BufferAttribute([0,0,0,0,1,0,0,0,0,1,0,0],4));geometry.setAttribute('skinWeight',new T.Float32BufferAttribute([1,0,0,0,1,0,0,0,.5,.5,0,0],4));
 const mesh=new T.SkinnedMesh(geometry,new T.MeshBasicMaterial());mesh.name='surface';scene.add(mesh);scene.updateMatrixWorld(true);mesh.bind(new T.Skeleton([a,b]));
 const clip=new T.AnimationClip('grow',1,[new T.VectorKeyframeTrack('B.scale',[0,1],[1,1,1,2,3,1])]);
 return {scene,animations:[clip]};
}
async function fixture(extra:Partial<Parameters<typeof createSceneModels>[0]>={},offset=0){
 const world=new World(),scene=new T.Scene(),life=new AbortController(),errors:unknown[]=[];
 const library=createModelLibrary({def:id=>({id,kind:'model',title:id,licence:'original',provenance:{},variants:[{path:id+'.glb',format:'glb'}]}),fetchBytes:async()=>new ArrayBuffer(4),parse:async(_bytes,url)=>{const result=rig(offset);result.scene.name=url;return result;}});
 const owner=createSceneModels({world,scene,library,signal:life.signal,poseLinks:normalizeModelPoseLinkLimits(),invalidate(){},report:e=>errors.push(e),...extra});
 const names=new Map<number,string>();
 const spawn=(asset:string,x=0)=>{const e=world.spawn(Transform({x}),Model({asset,playing:false}));names.set(e,asset);return e;};
 const ready=async(...ids:number[])=>{owner.sync();const end=Date.now()+2000;while(!ids.every(e=>owner.state(e).status==='ready')){assert.ok(Date.now()<end);await new Promise(r=>setTimeout(r,1));}};
 const root=(id:number)=>scene.children.find(r=>r.children[0]?.name===`/${names.get(id)}.glb`)!;
 return {world,scene,life,library,owner,spawn,ready,root,errors,close(){owner.dispose();library.dispose();}};
}
function vertices(root:T.Object3D){const mesh=root.getObjectByName('surface') as T.SkinnedMesh;return [0,1,2].map(i=>mesh.getVertexPosition(i,new T.Vector3()).applyMatrix4(mesh.matrixWorld).toArray());}
function near(actual:number[][],expected:number[][]){for(const [i,row] of actual.entries()){const want=must(expected[i],`expected row ${i}`);for(let j=0;j<3;j++)assert.ok(Math.abs(must(row[j])-must(want[j]))<1e-6,`${row} expected ${want}`);}}

test('weighted local pose, source placement and chains publish parent-first in both allocation orders',async()=>{
 for(const reverse of [false,true]){const f=await fixture();try{
  const ids=reverse?['tail','part','source']:['source','part','tail'],entities=new Map(ids.map(id=>[id,f.spawn(id,id==='source'?3:50)]));
  const source=entities.get('source')!,part=entities.get('part')!,tail=entities.get('tail')!;
  f.world.add(part,link(source));f.world.add(tail,link(part));await f.ready(source,part,tail);
  const partRoot=f.root(part),tailRoot=f.root(tail);assert.equal(partRoot.visible,false);
  f.world.get(source,Model)!.pose=[{node:'B',rotation:[0,0,Math.SQRT1_2,Math.SQRT1_2]}];f.owner.sync();
  assert.equal(f.owner.poseLinkState(part).status,'ready');assert.equal(f.owner.poseLinkState(tail).status,'ready');
  near(vertices(partRoot),[[3,1,0],[4,1,0],[4.5,.5,0]]);near(vertices(tailRoot),[[3,1,0],[4,1,0],[4.5,.5,0]]);
  assert.equal(f.world.get(part,Transform)!.x,50);assert.equal(f.owner.sync(),false);assert.deepEqual(f.errors,[]);
 }finally{f.close();}}
});
test('unlink restores mapped scale and ordinary placement before child native animation, including nonidentity asset root',async()=>{
 const f=await fixture({},2);try{const source=f.spawn('source',3),part=f.spawn('part',20);f.world.add(part,link(source));await f.ready(source,part);const child=f.root(part);
 f.world.get(source,Model)!.clip='grow';f.world.get(source,Model)!.playing=true;f.owner.sync(.5);assert.equal(f.owner.poseLinkState(part).status,'ready');assert.equal(child.getObjectByName('B')!.scale.x,1.5);
 f.world.remove(part,ModelPoseLink);f.owner.sync();assert.equal(f.owner.poseLinkState(part).status,'unlinked');assert.equal(child.position.x,20);assert.equal(must(child.children[0],'child node').position.x,2);assert.deepEqual(child.getObjectByName('B')!.scale.toArray(),[1,1,1]);near(vertices(child),[[22,1,0],[24,0,0],[24,0,0]]);
 }finally{f.close();}
});
test('combined rigid and weighted graph handles carrier, mapped sockets, mixed cycles and dual root authority',async()=>{
 const f=await fixture();try{const carrier=f.spawn('carrier',4),source=f.spawn('source'),part=f.spawn('part'),socket=f.spawn('socket');
 f.world.add(source,ModelAttachment({parent:carrier,socket:'B',unavailable:'hide',inheritVisibility:true}));f.world.add(part,link(source));f.world.add(socket,ModelAttachment({parent:part,socket:'B',unavailable:'hide',inheritVisibility:true}));
 await f.ready(carrier,source,part,socket);const partRoot=f.root(part),socketRoot=f.root(socket);f.owner.sync();assert.equal(f.owner.poseLinkState(part).status,'ready');near(vertices(partRoot),[[5,1,0],[7,0,0],[7,0,0]]);assert.equal(socketRoot.matrixWorld.elements[12],6);
 f.world.add(carrier,link(part));f.owner.sync();assert.equal(f.owner.poseLinkState(carrier).status,'cycle');assert.equal(f.owner.poseLinkState(part).status,'cycle');assert.equal(f.owner.attachmentState(socket).status,'blocked');assert.equal(socketRoot.visible,false);
 f.world.remove(carrier,ModelPoseLink);f.world.add(part,ModelAttachment({parent:carrier,socket:'A',unavailable:'hide',inheritVisibility:true}));f.owner.sync();assert.equal(f.owner.poseLinkState(part).reason,'root-authority');assert.equal(partRoot.visible,false);
 }finally{f.close();}
});
test('capacity and animation conflicts hide only linked presentation and never fail ordinary model readiness',async()=>{
 const f=await fixture({poseLinks:normalizeModelPoseLinkLimits({maxLinks:1})});try{const source=f.spawn('source'),a=f.spawn('a'),b=f.spawn('b');f.world.add(a,link(source));f.world.add(b,link(source));await f.ready(source,a,b);const ar=f.root(a),br=f.root(b);f.owner.sync();assert.equal(f.owner.poseLinkState(a).status,'ready');assert.equal(f.owner.poseLinkState(b).status,'over-budget');assert.equal(br.visible,false);assert.equal(f.owner.state(b).status,'ready');
 f.world.get(a,Model)!.clip='grow';f.owner.sync();assert.equal(f.owner.poseLinkState(a).reason,'animation-authority');assert.equal(ar.visible,false);
 f.world.remove(a,ModelPoseLink);f.owner.sync();assert.equal(f.owner.poseLinkState(b).status,'ready');assert.equal(br.visible,true);
 }finally{f.close();}
 const disabled=await fixture({poseLinks:undefined});try{const a=disabled.spawn('a'),b=disabled.spawn('b');disabled.world.add(b,link(a));await disabled.ready(a,b);disabled.owner.sync();assert.equal(disabled.owner.poseLinkState(b).status,'over-budget');assert.equal(disabled.owner.state(a).status,'ready');}finally{disabled.close();}
});
test('same-sync relation removal and capture supersession restore copied locals and never expose stale readiness',async()=>{
 const f=await fixture();try{const source=f.spawn('source',3),part=f.spawn('part',20),later=f.spawn('later',40);f.world.add(part,link(source));await f.ready(source,part,later);const child=f.root(part),sourceRoot=f.root(source);
 f.world.get(source,Model)!.clip='grow';f.world.get(source,Model)!.playing=true;f.owner.sync(.5);assert.equal(child.getObjectByName('B')!.scale.x,1.5);
 const native=sourceRoot.updateMatrixWorld.bind(sourceRoot);let once=true;sourceRoot.updateMatrixWorld=(force?:boolean)=>{native(force);if(once){once=false;f.world.remove(part,ModelPoseLink);}};
 f.owner.sync();assert.equal(f.owner.poseLinkState(part).status,'unlinked');assert.equal(child.matrixAutoUpdate,true);assert.equal(child.position.x,20);assert.equal(child.getObjectByName('B')!.scale.x,1);
 f.world.add(part,link(source));f.owner.sync();const input={source,nodes:mapping,inheritVisibility:true};Object.defineProperty(input,'source',{get(){f.world.remove(part,ModelPoseLink);return source;}});f.world.add(later,{type:ModelPoseLink,value:input});
 f.owner.sync();assert.equal(f.owner.poseLinkState(part).status,'unlinked');assert.equal(child.position.x,20);assert.equal(child.getObjectByName('B')!.scale.x,1);
 const replacement=link(source).value, self={source,nodes:mapping,inheritVisibility:true};Object.defineProperty(self,'source',{get(){f.world.add(later,{type:ModelPoseLink,value:replacement});return source;}});f.world.add(later,{type:ModelPoseLink,value:self});f.owner.sync();assert.equal(f.owner.poseLinkState(later).status,'unresolved');assert.equal(f.root(later).visible,false);
 }finally{f.close();}
});
test('source visibility, incompatible map, finite overflow and recovery cannot retain borrowed old pose',async()=>{
 const f=await fixture();try{const source=f.spawn('source'),part=f.spawn('part');f.world.add(part,link(source));await f.ready(source,part);const child=f.root(part);f.owner.sync();
 f.world.get(source,Model)!.visible=false;f.owner.sync();assert.equal(child.visible,false);assert.equal(f.owner.poseLinkState(part).status,'ready');f.world.add(part,ModelPoseLink({source,nodes:mapping,inheritVisibility:false}));f.owner.sync();assert.equal(child.visible,true);
 f.world.add(part,ModelPoseLink({source,nodes:[{source:'missing',target:'A'},{source:'B',target:'B'}],inheritVisibility:true}));f.owner.sync();assert.equal(f.owner.poseLinkState(part).reason,'mapping');assert.equal(child.visible,false);
 f.world.get(source,Model)!.visible=true;f.world.add(part,link(source));f.owner.sync();assert.equal(f.owner.poseLinkState(part).status,'ready');
 // Finite authored/root and local values compose to a nonfinite world matrix.
 f.world.get(source,Transform)!.scale=1e308;f.root(source).getObjectByName('B')!.scale.x=1e308;f.owner.sync();assert.equal(f.owner.poseLinkState(part).reason,'nonfinite');assert.equal(child.visible,false);
 f.world.get(source,Transform)!.scale=1;f.root(source).getObjectByName('B')!.scale.x=1;f.owner.sync();assert.equal(f.owner.poseLinkState(part).status,'ready');
 f.world.remove(source,Model);f.owner.sync();assert.equal(f.owner.poseLinkState(part).status,'waiting');assert.equal(child.visible,false);
 }finally{f.close();}
});
test('native publication callback retirement cannot revive a weighted owner',async()=>{
 const f=await fixture();try{const source=f.spawn('source'),part=f.spawn('part');f.world.add(part,link(source));await f.ready(source,part);f.owner.sync();const child=f.root(part),native=child.updateMatrixWorld.bind(child);let once=true;
 child.updateMatrixWorld=(force?:boolean)=>{native(force);if(once){once=false;f.owner.dispose();}};f.owner.sync();assert.equal(f.owner.poseLinkState(part).status,'absent');assert.equal(f.library.stats().instances,0);assert.equal(f.scene.children.length,0);
 }finally{f.close();}
});
test('total mapping admission counts the implicit instance root; bounded capture refusal preserves ordinary rendering',async()=>{
 for(const total of [2,3]){const f=await fixture({poseLinks:normalizeModelPoseLinkLimits({maxMappedNodesTotal:total})});try{const source=f.spawn('source'),part=f.spawn('part');f.world.add(part,link(source));await f.ready(source,part);f.owner.sync();assert.equal(f.owner.poseLinkState(part).status,total===2?'over-budget':'ready');}finally{f.close();}}
 const f=await fixture({poseLinks:normalizeModelPoseLinkLimits({maxRigNodesPerModel:0})});try{const source=f.spawn('source'),part=f.spawn('part');f.world.add(part,link(source));await f.ready(source,part);f.owner.sync();assert.equal(f.owner.poseLinkState(part).status,'over-budget');assert.equal(f.owner.state(source).status,'ready');assert.equal(f.root(source).visible,true);assert.deepEqual(f.errors,[]);}finally{f.close();}
});
test('source replacement invalidates mappings until the new instance is adopted; stale delayed loads cannot publish',async()=>{
 const world=new World(),scene=new T.Scene(),life=new AbortController(),pending=new Map<string,(value:ReturnType<typeof rig>)=>void>();
 const library=createModelLibrary({def:id=>({id,kind:'model',title:id,licence:'original',provenance:{},variants:[{path:id+'.glb',format:'glb'}]}),fetchBytes:async()=>new ArrayBuffer(4),parse:(_bytes,url)=>new Promise(resolve=>pending.set(url,resolve))});
 const owner=createSceneModels({world,scene,library,signal:life.signal,poseLinks:normalizeModelPoseLinkLimits(),invalidate(){},report:e=>{throw e;}});
 const source=world.spawn(Transform({x:3}),Model({asset:'first'})),part=world.spawn(Transform(),Model({asset:'part'}),link(source));
 const until=async(predicate:()=>boolean)=>{const end=Date.now()+2000;while(!predicate()){assert.ok(Date.now()<end);await new Promise(r=>setTimeout(r,1));}};
 try{owner.sync();await until(()=>pending.size===2);pending.get('/first.glb')!(rig());pending.get('/part.glb')!(rig());await until(()=>owner.state(source).status==='ready'&&owner.state(part).status==='ready');owner.sync();assert.equal(owner.poseLinkState(part).status,'ready');
 world.get(source,Model)!.asset='obsolete';owner.sync();assert.equal(owner.poseLinkState(part).status,'waiting');await until(()=>pending.has('/obsolete.glb'));
 world.get(source,Model)!.asset='latest';owner.sync();await until(()=>pending.has('/latest.glb'));pending.get('/obsolete.glb')!(rig());pending.get('/latest.glb')!(rig());await until(()=>owner.state(source).status==='ready');owner.sync();assert.equal(owner.state(source).adoptedAsset,'latest');assert.equal(owner.poseLinkState(part).status,'ready');assert.equal(library.stats().instances,2);
 }finally{owner.dispose();library.dispose();}
});
test('later native callbacks revoke reverse weighted chains and rigid followers of changed sources',async()=>{
 for(const sameAsset of [false,true]){const f=await fixture();try{
  const tail=f.spawn('tail'),part=f.spawn('part'),socket=f.spawn('socket'),source=f.spawn('source'),trigger=f.spawn('trigger');
  f.world.add(part,link(source));f.world.add(tail,link(part));f.world.add(socket,ModelAttachment({parent:part,socket:'A',unavailable:'hide',inheritVisibility:true}));f.world.add(trigger,link(source));await f.ready(tail,part,socket,source,trigger);f.owner.sync();
  const root=f.root(trigger),native=root.updateMatrixWorld.bind(root);let calls=0;
  root.updateMatrixWorld=(force?:boolean)=>{native(force);if(++calls===2)f.world.add(source,Model({asset:sameAsset?'source':'replacement',visible:false}));};
  f.owner.sync();assert.equal(f.owner.poseLinkState(part).status,'blocked');assert.equal(f.owner.poseLinkState(tail).status,'blocked');assert.equal(f.owner.attachmentState(socket).status,'blocked');assert.equal(f.root(part).visible,false);assert.equal(f.root(tail).visible,false);assert.equal(f.root(socket).visible,false);
 }finally{f.close();}}
});
test('pose queries do not call stale source requests ready or reconcile them as a read side effect',async()=>{
 const f=await fixture();try{const source=f.spawn('source'),part=f.spawn('part');f.world.add(part,link(source));await f.ready(source,part);f.owner.sync();assert.equal(f.owner.poseLinkState(part).status,'ready');const before=vertices(f.root(part));
 f.world.add(source,Model({asset:'source',pose:[{node:'B',rotation:[0,0,Math.SQRT1_2,Math.SQRT1_2]}]}));assert.equal(f.owner.poseLinkState(part).status,'unresolved');near(vertices(f.root(part)),before);f.owner.sync();assert.equal(f.owner.poseLinkState(part).status,'ready');near(vertices(f.root(part)),[[0,1,0],[1,1,0],[1.5,.5,0]]);
 }finally{f.close();}
});
test('ready queries reject direct asset mutation and changed transitive weighted or rigid ancestors without syncing',async()=>{
 for(const rigid of [false,true]){const f=await fixture();try{const a=f.spawn('a'),b=f.spawn('b'),c=f.spawn('c');
 if(rigid)f.world.add(b,ModelAttachment({parent:a,socket:'A',unavailable:'hide',inheritVisibility:true}));else f.world.add(b,link(a));f.world.add(c,link(b));await f.ready(a,b,c);f.owner.sync();assert.equal(f.owner.poseLinkState(c).status,'ready');
 const root=f.root(c),before=vertices(root);f.world.get(a,Model)!.asset='changed';assert.equal(f.owner.state(a).status,'loading');assert.equal(f.owner.poseLinkState(c).status,'unresolved');if(!rigid)assert.equal(f.owner.poseLinkState(b).status,'unresolved');near(vertices(root),before);
 f.world.get(a,Model)!.asset='a';f.world.add(a,Model({asset:'a',visible:false}));assert.equal(f.owner.poseLinkState(c).status,'unresolved');near(vertices(root),before);
 }finally{f.close();}}
});
test('late same-asset carrier replacement revokes rigid source and weighted descendants in one sync',async()=>{
 const f=await fixture();try{const tail=f.spawn('tail'),source=f.spawn('source'),carrier=f.spawn('carrier'),trigger=f.spawn('trigger');
 f.world.add(source,ModelAttachment({parent:carrier,socket:'A',unavailable:'hide',inheritVisibility:true}));f.world.add(tail,link(source));f.world.add(trigger,link(carrier));await f.ready(carrier,source,tail,trigger);f.owner.sync();
 const root=f.root(trigger),native=root.updateMatrixWorld.bind(root);let calls=0;root.updateMatrixWorld=(force?:boolean)=>{native(force);if(++calls===2)f.world.add(carrier,Model({asset:'carrier',visible:false}));};
 f.owner.sync();assert.equal(f.owner.attachmentState(source).status,'blocked');assert.equal(f.owner.poseLinkState(tail).status,'blocked');assert.equal(f.root(source).visible,false);assert.equal(f.root(tail).visible,false);
 }finally{f.close();}
});
