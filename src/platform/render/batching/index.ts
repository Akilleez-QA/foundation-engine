import {hasStaticBakeMaterial} from './material';
import {hasPaintingMaterialLease,transferPaintingMaterial} from '../../assets/painted-surfaces';
import * as T from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import type {ResourceOwner} from '../../assets/ownership';
const unowned:ResourceOwner={owns:()=>false};
/** A bake cannot preserve object-dependent shaders, picking overrides or render callbacks. */
function supported(o:T.Mesh){
 return o.constructor===T.Mesh && o.raycast===T.Mesh.prototype.raycast
  && o.onBeforeRender===T.Object3D.prototype.onBeforeRender && o.onAfterRender===T.Object3D.prototype.onAfterRender
  && o.onBeforeShadow===T.Object3D.prototype.onBeforeShadow && o.onAfterShadow===T.Object3D.prototype.onAfterShadow
  && !o.customDepthMaterial && !o.customDistanceMaterial && !o.children.length && !Object.keys(o.userData).length
  && o.geometry.drawRange.start===0 && o.geometry.drawRange.count===Infinity
  && !Array.isArray(o.material) && !o.material.type.includes('Shader')
  && !((o.material as T.MeshPhysicalMaterial).transmission>0) && !(o.material as T.MeshStandardMaterial).displacementMap
  && ((o.material.onBeforeCompile===T.Material.prototype.onBeforeCompile
   && o.material.customProgramCacheKey===T.Material.prototype.customProgramCacheKey)||hasStaticBakeMaterial(o.material));
}
/** Batch compatible opaque static siblings; retain rig hooks, sorting and render state.
 * Geometry the asset library owns (assets.owns: shared caches, leases) is merged from, never disposed. */
export function batchStaticMeshes(group:T.Group,keep=new Set<T.Object3D>(),owner:ResourceOwner=unowned,{recursive=true}:{recursive?:boolean}={}){
 const references=new Map<T.BufferGeometry,number>();group.traverse(o=>{if(o instanceof T.Mesh)references.set(o.geometry,(references.get(o.geometry)??0)+1);});
 function visit(parent:T.Group){
  const buckets=new Map<T.Material,Map<string,T.Mesh[]>>();
  for(const o of [...parent.children]){
   if(recursive&&o instanceof T.Group)visit(o);
   if(!(o instanceof T.Mesh)||!supported(o)||o instanceof T.SkinnedMesh||o instanceof T.InstancedMesh||o.children.length||o.name||Object.keys(o.userData).length||Array.isArray(o.material)||o.material.transparent||keep.has(o)||Object.keys(o.geometry.morphAttributes).length||o.geometry.drawRange.start!==0||o.geometry.drawRange.count!==Infinity)continue;
   if(Object.values(o.geometry.attributes).some(a=>(a as T.InterleavedBufferAttribute).isInterleavedBufferAttribute))continue;
   if(o.matrixAutoUpdate)o.updateMatrix();if(o.matrix.determinant()<=0)continue;
   const attributes=(Object.entries(o.geometry.attributes) as [string,T.BufferAttribute|T.InterleavedBufferAttribute][]).sort(([a],[b])=>a.localeCompare(b)).map(([name,a])=>`${name}:${a.itemSize}:${a.normalized}:${a.array.constructor.name}`).join('|');
   const key=`${attributes};${o.visible};${o.castShadow};${o.receiveShadow};${o.renderOrder};${o.layers.mask};${o.frustumCulled}`;
   const states=buckets.get(o.material)??new Map<string,T.Mesh[]>(),list=states.get(key)??[];list.push(o);states.set(key,list);buckets.set(o.material,states);
  }
  for(const [material,states]of buckets)for(const meshes of states.values()){
   if(meshes.length<2)continue;
   // Indexed parts stay indexed (a sphere de-indexed is ~5× the vertices); a non-indexed part gets a sequential index.
   const indexed=meshes.some(o=>o.geometry.index),transformed=meshes.map(o=>{const g=o.geometry.clone();if(indexed&&!g.index)g.setIndex([...Array(g.getAttribute('position').count).keys()]);g.applyMatrix4(o.matrix);return g;});
   const merged=mergeGeometries(transformed);transformed.forEach(g=>g.dispose());if(!merged)continue;
   const first=meshes[0],batched=new T.Mesh(merged,material);batched.name='Batched static surface';batched.visible=first.visible;batched.castShadow=first.castShadow;batched.receiveShadow=first.receiveShadow;batched.renderOrder=first.renderOrder;batched.layers.mask=first.layers.mask;batched.frustumCulled=first.frustumCulled;parent.add(batched);
   for(const o of meshes){parent.remove(o);const remaining=(references.get(o.geometry)??1)-1;references.set(o.geometry,remaining);if(remaining===0&&!owner.owns(o.geometry))o.geometry.dispose();}
  }
 }
 visit(group);
}

/**
 * Bake a whole scene's static art per material, across nested groups, in `scope`'s space (the flat
 * counterpart of batchStaticMeshes, which merges siblings only). `moving` objects and everything
 * under them, and `skipScopes` subtrees (tappable groups, which can be baked on their own),
 * are left as they are, as are named, transparent, multi-material, instanced, skinned, hidden and
 * render-ordered meshes. Indexed parts stay indexed. Shared cached geometry is merged from, never
 * disposed. Groups emptied by the bake are removed, except named ones with `keepNamedGroups` (a baked scene keeps
 * its authored footprints and names for lookup). Returns how many meshes were merged.
 */
export function bakeStaticMeshes(scope:T.Object3D,moving:ReadonlySet<T.Object3D>=new Set(),skipScopes:ReadonlySet<T.Object3D>=new Set(),{keepNamedGroups=false,owner=unowned}:{keepNamedGroups?:boolean;owner?:ResourceOwner}={}){
 // Preserve the established scope update and floating-point evaluation order. Refreshing
 // ancestors here changes inverse(scopeWorld) * meshWorld cancellation in existing bakes.
 scope.updateMatrixWorld(true);const inverse=scope.matrixWorld.clone().invert();
 const references=new Map<T.BufferGeometry,number>();scope.traverse(o=>{if(o instanceof T.Mesh)references.set(o.geometry,(references.get(o.geometry)??0)+1);});
 const batches=new Map<string,T.Mesh[]>();
 const visit=(o:T.Object3D)=>{
  if(moving.has(o)||skipScopes.has(o)||!o.visible||(o instanceof T.Group&&o.renderOrder!==0))return;
  if(o instanceof T.Mesh&&supported(o)&&!(o instanceof T.SkinnedMesh)&&!(o instanceof T.InstancedMesh)&&!Array.isArray(o.material)&&!o.material.transparent&&!o.name&&o.renderOrder===0&&!Object.keys(o.geometry.morphAttributes).length
   &&!Object.values(o.geometry.attributes).some(a=>(a as T.InterleavedBufferAttribute).isInterleavedBufferAttribute)&&o.matrixWorld.determinant()>0){
   const signature=(Object.entries(o.geometry.attributes) as [string,T.BufferAttribute][]).sort(([a],[b])=>a.localeCompare(b)).map(([name,a])=>`${name}:${a.itemSize}:${a.normalized}:${a.array.constructor.name}`).join('|');
   const key=`${o.material.uuid}|${o.castShadow}|${o.receiveShadow}|${o.layers.mask}|${o.frustumCulled}|${signature}`,batch=batches.get(key)??[];batch.push(o);batches.set(key,batch);
  }
  o.children.forEach(visit);
 };
 scope.children.forEach(visit);
 let merged=0;
 for(const batch of batches.values()){
  if(batch.length<2)continue;
  const indexed=batch.some(m=>m.geometry.index);
  const parts=batch.map(m=>{const g=m.geometry.clone();if(indexed&&!g.index)g.setIndex([...Array(g.getAttribute('position').count).keys()]);return g.applyMatrix4(inverse.clone().multiply(m.matrixWorld));});
  const geometry=mergeGeometries(parts);parts.forEach(g=>g.dispose());if(!geometry)continue;
  const first=batch[0],mesh=new T.Mesh(geometry,first.material);mesh.name='Baked static surface';mesh.castShadow=first.castShadow;mesh.receiveShadow=first.receiveShadow;mesh.layers.mask=first.layers.mask;mesh.frustumCulled=first.frustumCulled;scope.add(mesh);
  for(const m of batch){m.removeFromParent();const left=(references.get(m.geometry)??1)-1;references.set(m.geometry,left);if(left===0&&!owner.owns(m.geometry))m.geometry.dispose();}
  merged+=batch.length;
 }
 const empty:T.Object3D[]=[];scope.traverse(o=>{if(o!==scope&&o.type==='Group'&&!o.children.length&&!(keepNamedGroups&&o.name)&&!moving.has(o)&&!skipScopes.has(o))empty.push(o);});empty.forEach(o=>o.removeFromParent());
 return merged;
}

/**
 * One instance for identical plain materials under `root` (MeshStandardMaterial or MeshBasicMaterial, same colour,
 * finish, maps and render state), so `bakeStaticMeshes` can merge parts that builders gave a copy each. Materials
 * with a custom shader hook, user data or a name (shared cached materials carry user data) are left alone.
 * Call it before the first render: a duplicate is only dropped, never disposed, since it may still be used outside
 * `root`. `skip` subtrees keep their materials. Returns how many meshes were pointed at a shared instance.
 */
export function shareEqualMaterials(root:T.Object3D,skip:ReadonlySet<T.Object3D>=new Set(),options:{consumePainted?:boolean}={}){
 const plain=(m:T.Material):m is T.MeshStandardMaterial|T.MeshBasicMaterial=>(m.type==='MeshStandardMaterial'||m.type==='MeshBasicMaterial')&&(options.consumePainted||!hasPaintingMaterialLease(m))&&!m.name&&!Object.keys(m.userData).length&&m.onBeforeCompile===T.Material.prototype.onBeforeCompile;
 const key=(m:T.MeshStandardMaterial|T.MeshBasicMaterial)=>{
  const s=m as T.MeshStandardMaterial,maps=['map','alphaMap','aoMap','bumpMap','displacementMap','emissiveMap','envMap','lightMap','metalnessMap','normalMap','roughnessMap','specularMap'].map(k=>(m as unknown as Record<string,T.Texture|null|undefined>)[k]?.uuid??'');
  return [m.type,m.color.getHexString(),s.emissive?.getHexString(),s.emissiveIntensity,s.roughness,s.metalness,s.envMapIntensity,s.flatShading,s.bumpScale,m.vertexColors,m.side,m.transparent,m.opacity,m.alphaTest,m.depthTest,m.depthWrite,m.colorWrite,m.visible,m.toneMapped,m.fog,m.wireframe,m.blending,m.polygonOffset,m.polygonOffsetFactor,m.polygonOffsetUnits,m.dithering,m.premultipliedAlpha,JSON.stringify((m as T.Material&{defines?:object}).defines??{}),...maps].join('|');
 };
 const shared=new Map<string,T.Material>();let count=0;
 const visit=(o:T.Object3D)=>{
  if(skip.has(o))return;
  if(o instanceof T.Mesh&&!Array.isArray(o.material)&&plain(o.material)){
   const k=key(o.material),first=shared.get(k);
   if(!first)shared.set(k,o.material);else if(first!==o.material){if(options.consumePainted)transferPaintingMaterial(o.material,first);o.material=first;count++;}
  }
  o.children.forEach(visit);
 };
 visit(root);
 return count;
}
