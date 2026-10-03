import test from 'node:test';import assert from 'node:assert/strict';import * as T from 'three';import {batchStaticMeshes} from './model-batching';
import {must} from '../../testing/must';
test('incompatible UV layouts batch separately without losing vertices or warning',()=>{
 const g=new T.Group(),m=new T.MeshStandardMaterial();for(let i=0;i<4;i++){const geo=new T.BoxGeometry(1,1,1);if(i>1)geo.deleteAttribute('uv');const mesh=new T.Mesh(geo,m);mesh.position.x=i*2;g.add(mesh);}const before=new T.Box3().setFromObject(g),errors:unknown[]=[];const old=console.error;console.error=(...a)=>errors.push(a);try{batchStaticMeshes(g);}finally{console.error=old;}
 assert.equal(g.children.length,2);assert.deepEqual(errors,[]);assert.ok(new T.Box3().setFromObject(g).equals(before));const drawn=(geo:T.BufferGeometry)=>geo.index?geo.index.count:geo.getAttribute('position').count;assert.equal(g.children.reduce((n,o)=>n+drawn((o as T.Mesh).geometry),0),144);
});
test('batch preserves hidden, shadow, layer and render order states',()=>{const g=new T.Group(),m=new T.MeshStandardMaterial();for(let i=0;i<4;i++){const mesh=new T.Mesh(new T.BoxGeometry(),m);mesh.visible=i<2;mesh.castShadow=i<2;mesh.renderOrder=i<2?4:8;mesh.layers.set(i<2?2:3);g.add(mesh);}batchStaticMeshes(g);assert.equal(g.children.length,2);for(const mesh of g.children as T.Mesh[]){assert.equal(mesh.renderOrder,mesh.visible?4:8);assert.equal(mesh.layers.mask,mesh.visible?4:8);assert.equal(mesh.castShadow,mesh.visible);}});
test('rig hooks, transparent sorting, instancing, and mirrored winding stay independent',()=>{const g=new T.Group(),m=new T.MeshStandardMaterial(),glass=new T.MeshStandardMaterial({transparent:true});const hook=new T.Mesh(new T.BoxGeometry(),m),mirror=new T.Mesh(new T.BoxGeometry(),m),instances=new T.InstancedMesh(new T.BoxGeometry(),m,2);mirror.scale.x=-1;const a=new T.Mesh(new T.BoxGeometry(),glass),b=a.clone();g.add(hook,mirror,instances,a,b);batchStaticMeshes(g,new Set([hook]));assert.deepEqual(g.children,[hook,mirror,instances,a,b]);});
test('shared geometry stays alive for a kept mesh and named parts keep their identity',()=>{
 const g=new T.Group(),m=new T.MeshStandardMaterial(),geo=new T.BoxGeometry();let disposed=0;geo.addEventListener('dispose',()=>disposed++);const hook=new T.Mesh(geo,m);hook.name='Engine attachment';g.add(hook,new T.Mesh(geo,m),new T.Mesh(geo,m));batchStaticMeshes(g);assert.equal(g.children.length,2);assert.equal(g.getObjectByName('Engine attachment'),hook);assert.equal(disposed,0);
});
test('indexed parts batch indexed, and a non-indexed part joins them with a sequential index',()=>{
 const g=new T.Group(),m=new T.MeshStandardMaterial();g.add(new T.Mesh(new T.SphereGeometry(1,16,10),m),new T.Mesh(new T.SphereGeometry(1,16,10),m),new T.Mesh(new T.DodecahedronGeometry(1,0),m));must(g.children[1]).position.x=3;must(g.children[2]).position.x=6;
 const sphere=new T.SphereGeometry(1,16,10),dodeca=new T.DodecahedronGeometry(1,0);batchStaticMeshes(g);assert.equal(g.children.length,1);const geo=(g.children[0] as T.Mesh).geometry;
 assert.equal(geo.getAttribute('position').count,sphere.getAttribute('position').count*2+dodeca.getAttribute('position').count);assert.equal(geo.index!.count,sphere.index!.count*2+dodeca.getAttribute('position').count);
});
test('bakeStaticMeshes flattens a scene per material across groups, leaving moving parts, skipped scopes and transparent glass',async()=>{
 const {bakeStaticMeshes}=await import('./model-batching');
 const scene=new T.Group(),wood=new T.MeshStandardMaterial(),glass=new T.MeshStandardMaterial({transparent:true,opacity:.5});
 const rack=new T.Group();rack.position.set(3,0,0);scene.add(rack);
 for(let i=0;i<3;i++){const m=new T.Mesh(new T.BoxGeometry(1,1,1),wood);m.position.y=i;rack.add(m);}
 const spinner=new T.Mesh(new T.BoxGeometry(),wood);scene.add(spinner);
 const desk=new T.Group();scene.add(desk);desk.add(new T.Mesh(new T.BoxGeometry(),wood),new T.Mesh(new T.BoxGeometry(),wood));
 scene.add(new T.Mesh(new T.PlaneGeometry(),glass),new T.Mesh(new T.PlaneGeometry(),glass));
 const merged=bakeStaticMeshes(scene,new Set([spinner]),new Set([desk]));
 assert.equal(merged,3,'the three rack boxes merge');
 assert.equal(rack.parent,null,'the emptied rack group is removed');
 assert.equal(spinner.parent,scene);assert.equal(desk.children.length,2,'the skipped desk is untouched');
 const baked=scene.children.find(o=>o.name==='Baked static surface') as T.Mesh;
 const box=new T.Box3().setFromObject(baked);assert.ok(Math.abs(box.min.x-2.5)<1e-6&&Math.abs(box.max.y-2.5)<1e-6,'baked in the scene’s space');
 assert.ok(baked.geometry.index,'indexed parts stay indexed');
 assert.equal(scene.children.filter(o=>(o as T.Mesh).material===glass).length,2,'transparent glass stays separate');
});
test('batching and baking merge from owned geometry (assets.owns) without disposing it, and dispose what they own',async()=>{
 const {pageResidents}=await import('../assets/app-ownership');const {bakeStaticMeshes}=await import('./model-batching');
 for(const run of [(g:T.Group)=>batchStaticMeshes(g),(g:T.Group)=>{bakeStaticMeshes(g);}]){
  const g=new T.Group(),m=new T.MeshStandardMaterial(),resident=pageResidents.adopt(new T.BoxGeometry()),own=new T.BoxGeometry();let residentDisposed=0,ownDisposed=0;
  resident.addEventListener('dispose',()=>residentDisposed++);own.addEventListener('dispose',()=>ownDisposed++);
  g.add(new T.Mesh(resident,m),new T.Mesh(resident,m),new T.Mesh(own,m));run(g);
  assert.equal(g.children.length,1);assert.equal(residentDisposed,0);assert.equal(ownDisposed,1);
 }
});

test('both bakes retain object-dependent semantics and partial geometry',async()=>{
 const {bakeStaticMeshes}=await import('./model-batching');
 for(const bake of [batchStaticMeshes,bakeStaticMeshes]){
  for(const mutate of [
   (m:T.Mesh)=>{m.userData.pick='target';},
   (m:T.Mesh)=>{m.geometry.setDrawRange(0,3);},
   (m:T.Mesh)=>{m.onBeforeRender=()=>{};},
   (m:T.Mesh)=>{m.customDepthMaterial=new T.MeshDepthMaterial();},
   (m:T.Mesh)=>{m.raycast=()=>{};},
   (m:T.Mesh)=>{(m.material as T.Material).onBeforeCompile=()=>{};},
  ]){
   const root=new T.Group(),material=new T.MeshStandardMaterial();
   const a=new T.Mesh(new T.BoxGeometry(),material),b=new T.Mesh(new T.BoxGeometry(),material);mutate(a);root.add(a,b);bake(root);
   assert.deepEqual(root.children,[a,b]);
  }
 }
});
test('baking preserves transformed positions, normals, UVs and ray hits under nonuniform scale',async()=>{
 const {bakeStaticMeshes}=await import('./model-batching');
 const root=new T.Group(),material=new T.MeshStandardMaterial();root.position.set(5,2,3);
 for(let i=0;i<2;i++){const group=new T.Group();group.position.x=i*4;group.rotation.y=.25;group.scale.set(2,1,.5);group.add(new T.Mesh(new T.BoxGeometry(),material));root.add(group);}
 root.updateMatrixWorld(true);
 const expected:T.BufferGeometry[]=[];root.traverse(o=>{if(o instanceof T.Mesh)expected.push(o.geometry.clone().applyMatrix4(root.matrixWorld.clone().invert().multiply(o.matrixWorld)));});
 const ray=new T.Raycaster(new T.Vector3(5,2,10),new T.Vector3(0,0,-1));const before=ray.intersectObject(root).map(h=>h.distance);
 bakeStaticMeshes(root);root.updateMatrixWorld(true);
 const mesh=root.children[0] as T.Mesh;
 for(const name of ['position','normal','uv']){
  const values=expected.flatMap(g=>Array.from(g.getAttribute(name).array));assert.deepEqual(Array.from(mesh.geometry.getAttribute(name).array),values);
 }
 const after=ray.intersectObject(root).map(h=>h.distance);assert.equal(after.length,before.length);after.forEach((v,i)=>assert.ok(Math.abs(v-must(before[i]))<1e-6));
});
test('sibling bake retains manual matrices and leaves nested semantic scopes alone on request',()=>{
 const root=new T.Group(),material=new T.MeshBasicMaterial(),nested=new T.Group();nested.name='toggle me';
 for(let i=0;i<2;i++){const mesh=new T.Mesh(new T.BoxGeometry(),material);mesh.matrixAutoUpdate=false;mesh.matrix.makeTranslation(i*3,0,0);root.add(mesh);nested.add(new T.Mesh(new T.BoxGeometry(),material));}
 root.add(nested);batchStaticMeshes(root,new Set(),{recursive:false});
 assert.equal(nested.children.length,2);assert.equal(root.getObjectByName('toggle me'),nested);
 const baked=root.getObjectByName('Batched static surface') as T.Mesh;baked.geometry.computeBoundingBox();assert.equal(baked.geometry.boundingBox!.max.x,3.5);
 nested.visible=false;assert.equal(nested.parent,root);
});
