import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {createShadowCache,type ShadowPlan} from './shadow-cache';

/** A one-texel depth model of the light's map: each caster's depth at the texel is its `position.z`, and a map
 *  holds the nearest (minimum) depth, as a depth pass does. Independent of any GPU implementation. */
const depthOf=(casters:readonly T.Object3D[])=>casters.reduce((d,o)=>Math.min(d,o.position.z),Infinity);

/** Runs one due shadow frame the way an adopter must: rebuild the static-only layer, commit, then composite the
 *  movers over it; any path that cannot be presented from a committed layer draws the conventional full pass. */
function frame(cache:ReturnType<typeof createShadowCache>,scene:T.Scene,light:T.DirectionalLight,layer:{depth:number}){
 scene.updateMatrixWorld();const plan=cache.plan(scene,light);
 if(plan.path==='rebuild'){layer.depth=depthOf(plan.staticCasters);assert.equal(cache.commit(plan),true);}
 const path=cache.pathForPresent(plan);
 const depth=path==='full'?depthOf(plan.movingCasters):Math.min(layer.depth,depthOf(plan.movingCasters));
 return {plan,path,depth};
}
function stage(){
 const scene=new T.Scene(),light=new T.DirectionalLight('#fff',2);light.castShadow=true;light.position.set(0,10,0);scene.add(light,light.target);
 const caster=(z:number)=>{const m=new T.Mesh(new T.BoxGeometry(),new T.MeshStandardMaterial());m.castShadow=true;m.position.z=z;scene.add(m);return m;};
 const wall=caster(.8),mover=caster(.2);
 const cache=createShadowCache({supports:()=>true});cache.declareStatic(wall);
 return {scene,light,wall,mover,caster,cache,layer:{depth:NaN}};
}

test('pass 1.2 depth-invariant counterexample: the cache holds static depth only, so a mover leaves no ghost',()=>{
 const {scene,light,mover,cache,layer}=stage();
 const first=frame(cache,scene,light,layer);
 assert.equal(first.plan.path,'rebuild');assert.equal(first.depth,.2,'mover in front');assert.equal(layer.depth,.8,'cached layer is static-only');
 mover.position.z=.6;
 const second=frame(cache,scene,light,layer);
 assert.equal(second.plan.path,'hit','a mover alone does not invalidate the static generation');
 assert.equal(second.depth,.6,'composite = min(static .8, moving .6)');
 // ADR 0035's full-pass copy would have cached min(.8,.2) and kept .2 after the mover left: the counterexample.
 const polluted=Math.min(.8,.2);assert.equal(Math.min(polluted,.6),.2);assert.notEqual(Math.min(polluted,.6),second.depth);
 // Every presented frame equals what a conventional full pass over all casters produces (identical quality).
 for(const z of [.9,.1,.5,.8]){mover.position.z=z;const f=frame(cache,scene,light,layer);assert.equal(f.depth,Math.min(.8,z));assert.equal(f.plan.path,'hit');}
});

test('the cache invalidates when a static caster moves, and the first presented frame already uses new depth',()=>{
 const {scene,light,wall,mover,cache,layer}=stage();frame(cache,scene,light,layer);mover.position.z=.9;frame(cache,scene,light,layer);
 wall.position.z=.5;
 const moved=frame(cache,scene,light,layer);
 assert.equal(moved.plan.path,'rebuild');assert.equal(moved.plan.firstAfterInvalidation,true);assert.equal(moved.path,'composite');
 assert.equal(moved.depth,.5,'the invalidating frame itself shows the moved wall, not a frame later');
 assert.equal(frame(cache,scene,light,layer).plan.path,'hit');
 // Other key inputs: light pose, shadow projection, map size, membership, depth material state, geometry, context.
 const changes:[string,()=>void][]=[
  ['light moves',()=>{light.position.x=1;}],
  ['shadow frustum',()=>{light.shadow.camera.far=200;light.shadow.camera.updateProjectionMatrix();}],
  ['map size',()=>{light.shadow.mapSize.set(4096,4096);}],
  ['wall rotated',()=>{wall.rotation.y=.2;}],
  ['wall hidden',()=>{wall.visible=false;}],
  ['wall shown',()=>{wall.visible=true;}],
  ['alpha test',()=>{(wall.material as T.Material).alphaTest=.5;}],
  ['alpha map',()=>{(wall.material as T.MeshStandardMaterial).alphaMap=new T.DataTexture(new Uint8Array(4),1,1);}],
  ['side',()=>{(wall.material as T.Material).side=T.DoubleSide;}],
  ['displacement',()=>{(wall.material as T.MeshStandardMaterial).displacementScale=2;}],
  ['clipping',()=>{(wall.material as T.Material).clippingPlanes=[new T.Plane(new T.Vector3(0,1,0),0)];}],
  ['geometry edited',()=>{wall.geometry.getAttribute('position').needsUpdate=true;}],
  ['caster stops casting',()=>{wall.castShadow=false;}],
  ['caster casts again',()=>{wall.castShadow=true;}],
  ['demoted',()=>{cache.demote(wall);}],
 ];
 for(const [name,change] of changes){
  change();const f=frame(cache,scene,light,layer);
  const casting=wall.visible&&wall.castShadow;
  if(name==='demoted'||!casting)assert.equal(f.plan.path,'full',name+' (no static casters left: conventional pass)');
  else assert.equal(f.plan.path,'rebuild',name);
  assert.equal(f.depth,Math.min(casting?wall.position.z:Infinity,mover.position.z),name+' presented depth equals a full pass');
  if(name!=='demoted'&&casting)assert.equal(frame(cache,scene,light,layer).plan.path,'hit',name+' settles');
 }
 cache.declareStatic(wall);frame(cache,scene,light,layer);assert.equal(frame(cache,scene,light,layer).plan.path,'hit','promotion rebuilds once');
 cache.contextLost();assert.equal(frame(cache,scene,light,layer).plan.path,'full','context lost');
 cache.contextRestored();assert.equal(frame(cache,scene,light,layer).plan.path,'rebuild','context restore invalidates');
});

test('movers are never cached: undeclared, skinned, morphed, batched, hooked and custom-depth casters stay moving',()=>{
 const {scene,light,wall,cache,layer}=stage();
 const skinned=new T.SkinnedMesh(new T.BoxGeometry(),new T.MeshStandardMaterial());const bone=new T.Bone();skinned.add(bone);scene.add(skinned);scene.updateMatrixWorld(true);skinned.bind(new T.Skeleton([bone]));
 const morphed=new T.Mesh(new T.BoxGeometry(),new T.MeshStandardMaterial());morphed.geometry.morphAttributes.position=[morphed.geometry.getAttribute('position').clone()];morphed.updateMorphTargets();
 const batch=new T.BatchedMesh(2,100,300,new T.MeshStandardMaterial());batch.addInstance(batch.addGeometry(new T.BoxGeometry()));
 const hooked=new T.Mesh(new T.BoxGeometry(),new T.MeshStandardMaterial());hooked.onBeforeShadow=()=>{};
 const custom=new T.Mesh(new T.BoxGeometry(),new T.MeshStandardMaterial());custom.customDepthMaterial=new T.MeshDepthMaterial();
 const video=new T.Mesh(new T.BoxGeometry(),new T.MeshStandardMaterial({alphaTest:.5}));(video.material as T.MeshStandardMaterial).alphaMap=Object.assign(new T.Texture(),{isVideoTexture:true});
 const declared=[skinned,morphed,batch,hooked,custom,video];
 for(const o of declared){o.castShadow=true;if(!o.parent)scene.add(o);}
 cache.declareStatic(...declared);
 const expected:[T.Object3D,string][]=[[skinned,'skinned'],[morphed,'morphed'],[batch,'batched'],[hooked,'shadow hook'],[custom,'custom depth material'],[video,'animated depth texture']];
 for(const [o,reason] of expected)assert.deepEqual(cache.classify(o),{moving:true,reason});
 const f=frame(cache,scene,light,layer);
 assert.deepEqual(f.plan.staticCasters,[wall],'only the declared, eligible wall is cached');
 for(const o of [...declared,scene.children.find(o=>o!==wall&&(o as T.Mesh).isMesh)!])assert.ok(f.plan.movingCasters.includes(o),o.type+' drawn as moving');
 // Animating any of them never invalidates the static generation (they are drawn fresh every due frame).
 bone.position.x=1;morphed.morphTargetInfluences![0]=1;batch.setMatrixAt(0,new T.Matrix4().makeTranslation(1,0,0));
 assert.equal(frame(cache,scene,light,layer).plan.path,'hit');
 assert.deepEqual(cache.classify(new T.Mesh()),{moving:true,reason:'undeclared'},'unclassified defaults to moving');
});

test('fallback is the conventional full pass at identical quality: unproved lights, point lights, failed rebuilds',()=>{
 const {scene,light,wall,mover,layer}=stage();
 const unproved=createShadowCache();unproved.declareStatic(wall);
 const a=frame(unproved,scene,light,layer);assert.equal(a.plan.path,'full');assert.equal(a.plan.reason,'unproved path');assert.equal(a.depth,.2);
 assert.deepEqual([...a.plan.movingCasters].sort((x,y)=>x.id-y.id),[wall,mover].sort((x,y)=>x.id-y.id),'a full pass draws every caster');
 const point=new T.PointLight();point.castShadow=true;scene.add(point);
 const cache=createShadowCache({supports:()=>true});cache.declareStatic(wall);
 assert.equal(cache.plan(scene,point).path,'full');
 // A rebuild that fails is not published: the frame renders full, and the next frame rebuilds again.
 scene.updateMatrixWorld();const failed=cache.plan(scene,light);assert.equal(failed.path,'rebuild');cache.fail(failed);
 assert.equal(cache.pathForPresent(failed),'full');assert.equal(cache.plan(scene,light).path,'rebuild');
 assert.equal(cache.stats.failures,1);
});

test('first-presented-frame guard: an uncommitted rebuild or an invalidated hit is never composited',()=>{
 const {scene,light,cache,layer}=stage();
 scene.updateMatrixWorld();const uncommitted=cache.plan(scene,light);
 assert.equal(cache.pathForPresent(uncommitted),'full','static layer not committed yet');
 const stale:ShadowPlan=cache.plan(scene,light);assert.equal(stale.path,'rebuild','an unpublished key is rebuilt, not hit');
 assert.equal(cache.commit(uncommitted),false,'an older rebuild plan cannot publish');assert.equal(cache.commit(stale),true);
 const hit=frame(cache,scene,light,layer).plan;assert.equal(hit.path,'hit');
 cache.invalidate();assert.equal(cache.pathForPresent(hit),'full','invalidated between plan and present');
 assert.equal(frame(cache,scene,light,layer).plan.path,'rebuild');
 assert.equal(cache.residentBytes(),light.shadow.mapSize.x*light.shadow.mapSize.y*4,'the residency ledger counts the cached layer');
 const {stats}=cache;assert.equal(stats.staticRebuildDraws,3);assert.ok(stats.compositeDraws>=stats.hits);
});

test('withdrawing support drops a published generation before later reapproval',()=>{
 const {scene,light,wall}=stage();let supported=true;
 const cache=createShadowCache({supports:()=>supported});cache.declareStatic(wall);scene.updateMatrixWorld();
 const first=cache.plan(scene,light);assert.equal(cache.commit(first),true);
 supported=false;assert.equal(cache.plan(scene,light).path,'full');assert.equal(cache.pathForPresent(first),'full');
 supported=true;assert.equal(cache.plan(scene,light).path,'rebuild');
});


test('alpha-to-coverage observes its effective cutout maps even with alphaTest zero',()=>{
 const {scene,light,wall,cache,layer}=stage();
 wall.material.alphaToCoverage=true;wall.material.alphaTest=0;
 const alpha=new T.DataTexture(new Uint8Array([255,255,255,255]),1,1);wall.material.alphaMap=alpha;
 frame(cache,scene,light,layer);assert.equal(frame(cache,scene,light,layer).plan.path,'hit');
 (alpha.image.data as Uint8Array)[3]=0;alpha.needsUpdate=true;
 assert.equal(frame(cache,scene,light,layer).plan.path,'rebuild','r186 (as r183) approximates alphaToCoverage with alphaTest=.5');
 wall.material.map=new T.DataTexture(new Uint8Array([255,255,255,0]),1,1);
 assert.equal(frame(cache,scene,light,layer).plan.path,'rebuild','replacing the colour alpha source changes depth too');
});
