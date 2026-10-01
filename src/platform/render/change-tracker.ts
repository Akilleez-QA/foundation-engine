import * as T from 'three';
// Named, not destructured from the namespace: a namespace used as a value makes the bundler build all of three's
// exports into an object in the entry chunk (7 KiB of first-load JS).
import {Mesh,Group,Object3D,Bone,DoubleSide,DetachedBindMode} from 'three';
import {isStillSafe} from './still-safe';

/**
 * Render change detection that observes, never guesses (STD-REN-38; ADRs 0055, 0056, 0057).
 *
 * Two trackers share one signature machinery:
 * - the **colour** tracker decides whether a view's next frame differs from the last presented one;
 * - the **shadow** tracker decides whether any shadow map in a scene is due.
 *
 * Each scan writes every observed render input into a flat numeric signature and compares it, value by value, with
 * the signature of the last due scan. There is no hashing (so no collisions) and no dirty flag: a change is seen
 * because its input differs. Anything the scan cannot observe (an application-authored render hook, a video or
 * render-target texture, a bone outside the scanned graph, a batch whose private state is missing) **forces** the
 * scan due, so a missed change costs a frame and never freezes the picture. No object type forces by itself.
 *
 * Batches and skeletons are followed through their full dependency closure regardless of node visibility:
 * a batch's matrix/colour texture versions, ordered instance state and geometry ranges; a skinned mesh's ordered
 * bones, their ancestor chains, inverse binds and bind mode/matrices. Engine outputs (the bone palette texture, a
 * batch's indirect texture) are not observed: they are results of a render, not inputs to it.
 *
 * The encoding is self-delimiting (kind tags, flags and counts precede every variable part), so two different input
 * states never write the same sequence. The colour pass and the depth pass are observed separately: the colour
 * tracker reads what the colour pass draws, the shadow tracker what the depth pass draws; a frame is due when
 * either is. `change-tracker.coverage.test.ts` proves the observed set against the engine's own fields.
 *
 * Cost (`scripts/perf/tracker-scan.ts`). A still scan does the same complete reads, cheaply:
 * - the signature is compared in place: values go into a small record and are compared with the baseline one block
 *   at a time, and nothing is written until the first difference (a still scan stores nothing);
 * - the traversal is split by exact constructor, so each visitor's property reads see one or a few object shapes
 *   (inline-cached) instead of every shape in the scene;
 * - shared geometries, materials and textures are read once per scan through id-indexed stamp tables;
 * - the fields of the material classes the engine draws with are read by name (keyed reads are the slowest access the
 *   engine has); every field a named reader does not list is still read by key;
 * - flags, layer masks, child counts and material ids are packed exactly into shared values;
 * - the depth signature holds shadow lights and casters only (a node that draws no depth acts through them).
 *
 * Private engine state is read only through the adapter below (`readBatchState`), pinned to three 0.183 by the
 * contract test in `change-tracker.test.ts`. Call a scan after simulation and animation, before deciding to skip;
 * the shadow scan additionally expects world matrices to be current (call it after `updateMatrixWorld`, e.g. from
 * `scene.onBeforeRender`). The shadow scheduler (shadows.ts) is its user.
 */

/** A root drawn by a camera; several views make one frame (every pass of a multi-view frame is compared). */
export type View=readonly [root:T.Object3D,camera:T.Camera];
/** What the colour tracker reads from the output surface (a WebGLRenderer satisfies it). */
export type Surface={readonly domElement:{readonly width:number;readonly height:number};readonly toneMapping:number;readonly toneMappingExposure:number};
/** The outcome of one scan. `forcedBy` names the first unobservable input when the scan was forced. */
export type ScanResult={readonly due:boolean;readonly forcedBy:string|null};
export type TrackerStats={scans:number;due:number;forced:number;values:number};

export {stillSafe} from './still-safe';
const safe=isStillSafe;

const objectRenderHook=T.Object3D.prototype.onBeforeRender,objectShadowHook=T.Object3D.prototype.onBeforeShadow;
/** three's own BatchedMesh hooks, read from the base-most prototype that defines the batch API (its own
 *  `setGeometryIdAt`): exact identity without naming the class, so the class (16 KiB of three) stays out of the
 *  bundles of scenes that draw no batch. A subclass's own hook is still not the built-in one, and forces. */
let batchHooks:{render:unknown;shadow:unknown}|null=null;
const builtInBatchHooks=(b:T.BatchedMesh)=>{
 if(batchHooks)return batchHooks;
 // The base-most prototype owning the API is three's class, whatever subclass the first batch is.
 let base:{onBeforeRender:unknown;onBeforeShadow:unknown}|null=null;
 for(let p=Object.getPrototypeOf(b);p&&p!==Object.prototype;p=Object.getPrototypeOf(p))if(Object.prototype.hasOwnProperty.call(p,'setGeometryIdAt'))base=p;
 return base?batchHooks={render:base.onBeforeRender,shadow:base.onBeforeShadow}:{render:null,shadow:null};
};
const materialHook=T.Material.prototype.onBeforeRender,compileHook=T.Material.prototype.onBeforeCompile;
const customKey=T.Material.prototype.customProgramCacheKey;
// Engine constants and classes read once: hot paths never look them up through the module namespace.
/** The child-count scene of a node's packed value: above 4 flag bits and a 32-bit layer mask (exact below 2^53). */
const PACK_CHILDREN=2**36;

// ---------------------------------------------------------------------------------------------------------------
// Pinned adapter: the only scene that reads three's private BatchedMesh state.

/** The private BatchedMesh fields the trackers observe (three 0.183). */
export type BatchState={
 readonly matrices:T.DataTexture;
 readonly colors:T.DataTexture|null;
 readonly instances:readonly {readonly active:boolean;readonly visible:boolean;readonly geometryIndex:number}[];
 readonly geometries:readonly {readonly active:boolean;readonly vertexStart:number;readonly vertexCount:number;readonly indexStart:number;readonly indexCount:number;readonly start:number;readonly count:number}[];
};
/** Reads a batch's private draw state, or `null` if the engine no longer exposes it (then the batch is forced). */
export function readBatchState(batch:T.BatchedMesh):BatchState|null{
 const b=batch as unknown as {_matricesTexture?:T.DataTexture|null;_colorsTexture?:T.DataTexture|null;_instanceInfo?:BatchState['instances'];_geometryInfo?:BatchState['geometries']};
 const matrices=b._matricesTexture,instances=b._instanceInfo,geometries=b._geometryInfo;
 if(!matrices||!(matrices as T.Texture).isTexture||!Array.isArray(instances)||!Array.isArray(geometries)||b._colorsTexture===undefined)return null;
 return {matrices,colors:b._colorsTexture??null,instances,geometries};
}

// ---------------------------------------------------------------------------------------------------------------
// Signature: a growable numeric record compared exactly with the last accepted one.

/** An exact, collision-free signature of render inputs. Also the shadow cache's generation key.
 *
 *  Compared in place: `begin(this)` makes the signature its own baseline. While every value read so far equals the
 *  baseline value at the same position, `push` only reads and compares (no store); at the first difference it
 *  starts overwriting from that position on, so after the scan the buffer holds exactly the values just read. The
 *  prefix it skipped storing is identical by construction. A still scan therefore touches the baseline once and
 *  writes nothing; the verdict is the same exact, value-by-value comparison as a separate copy would give. */
export class Signature{
 data=new Float64Array(1024);n=0;
 /** Baseline length (-1: no baseline, everything differs) and the length of the prefix still known to match it. */
 private base=-1;private match=0;
 /** Start writing, comparing every value with `against` as it arrives (`this`: compare in place, no copy). */
 begin(against:Signature|null){
  if(against===null){this.base=-1;this.match=0;}
  else{if(against!==this)this.copyFrom(against);this.base=this.n;this.match=this.n;}
  this.n=0;
 }
 push(v:number){
  const n=this.n;
  if(n<this.match){
   // NaN equals NaN, so an undefined input does not pin a route.
   const r=this.data[n];if(r===v||r!==r&&v!==v){this.n=n+1;return;}
   this.match=n;
  }
  if(n===this.data.length)this.grow();
  this.data[n]=v;this.n=n+1;
 }
 /** `push` for the first `count` values of `src`, in order: one call and one tight compare loop for a block. */
 pushN(src:Float64Array,count:number){
  let n=this.n,i=0;const end=n+count;
  if(n<this.match){
   const d=this.data,stop=end<this.match?end:this.match;
   for(;n<stop;n++,i++){const r=d[n],v=src[i];if(r!==v&&(r===r||v===v)){this.match=n;break;}}
  }
  if(i<count){
   while(end>this.data.length)this.grow();
   const d=this.data;for(;i<count;i++,n++)d[n]=src[i];
  }
  this.n=end;
 }
 private grow(){const grown=new Float64Array(this.data.length*2);grown.set(this.data);this.data=grown;}
 matrix(m:T.Matrix4|T.Matrix3){const e=m.elements;for(let i=0;i<e.length;i++)this.push(e[i]);}
 /** After writing: identical to the signature passed to `begin` (same length, every value equal). */
 same(){return this.match===this.base&&this.n===this.base;}
 /** Equal length and every value identical (NaN equals NaN). */
 equals(o:Signature){if(this.n!==o.n)return false;const a=this.data,b=o.data;for(let i=0;i<this.n;i++){const x=a[i],y=b[i];if(x!==y&&(x===x||y===y))return false;}return true;}
 copyFrom(o:Signature){if(o===this)return;if(this.data.length<o.n)this.data=new Float64Array(o.data.length);this.data.set(o.data.subarray(0,o.n));this.n=o.n;}
}

const ids=new WeakMap<object,number>();let nextId=1;
/** A stable numeric identity for objects three does not number (skeletons, sources, clipping planes). */
const idOf=(o:object)=>{let id=ids.get(o);if(id===undefined)ids.set(o,id=nextId++);return id;};

const materialId=(m:T.Material)=>(m as unknown as {id:number}).id;
const attributeVersion=(a:T.BufferAttribute|T.InterleavedBufferAttribute|null|undefined)=>!a?-1:(a as T.InterleavedBufferAttribute).isInterleavedBufferAttribute?(a as T.InterleavedBufferAttribute).data.version:(a as T.BufferAttribute).version;
const attributeId=(a:T.BufferAttribute|T.InterleavedBufferAttribute)=>idOf((a as T.InterleavedBufferAttribute).isInterleavedBufferAttribute?(a as T.InterleavedBufferAttribute).data:a);

/** Capacity of the observer's scratch record: larger than any fixed block stored into it at once. */
const RECORD=512;

/** Scan state shared by the trackers and the shadow cache. `force` records the first unobservable input.
 *
 *  Values are stored directly into a small scratch record and compared with the signature one block at a time
 *  (`flush`), so a still scan costs a store and a compare per value instead of a call per value. Reading `sig`
 *  flushes first, so any caller that pushes into the signature directly keeps the exact order. */
export class Observer{
 private readonly out=new Signature();
 /** The signature, holding every value read so far. */
 get sig(){this.flush();return this.out;}
 forcedBy:string|null=null;stamp=0;
 /** The scratch record and its fill (`scene`, then store from the returned index and set `k`). */
 readonly rec=new Float64Array(RECORD);k=0;
 private chained=new WeakMap<object,number>();
 /** Start a scan compared with `against` (`null`: no baseline, the scan differs). */
 begin(against:Signature|null=null){this.k=0;this.out.begin(against);this.forcedBy=null;this.stamp++;}
 /** Start a scan compared in place with this observer's own last signature (`false`: no baseline). */
 rescan(valid:boolean){this.k=0;this.out.begin(valid?this.out:null);this.forcedBy=null;this.stamp++;}
 force(reason:string){if(this.forcedBy===null)this.forcedBy=reason;}
 /** True the first time a bone chain reads node `o` in this scan (shared ancestors are read once). */
 firstNode(o:object){if(this.chained.get(o)===this.stamp)return false;this.chained.set(o,this.stamp);return true;}
 // Per-family scan stamps indexed by three's own ids, for the dedup reads on every mesh. Material, geometry and
 // texture ids are assigned once per family by their constructors and are not writable (pinned by the contract
 // test), so an id names exactly one object and a stamp table is an exact, allocation-free visited set.
 materialStamps:Uint32Array=new Uint32Array(256);geometryStamps:Uint32Array=new Uint32Array(256);private textureStamps:Uint32Array=new Uint32Array(256);
 private static mark(table:Uint32Array,id:number,stamp:number):Uint32Array|null{
  if(id>=table.length){let size=table.length;while(size<=id)size*=2;const grown=new Uint32Array(size);grown.set(table);grown[id]=stamp;return grown;}
  if(table[id]===stamp)return null;table[id]=stamp;return table;
 }
 /** True the first time material `m` is read in this scan. */
 firstMaterial(m:T.Material){const t=Observer.mark(this.materialStamps,materialId(m),this.stamp);if(!t)return false;this.materialStamps=t;return true;}
 /** True the first time geometry `g` is read in this scan. */
 firstGeometry(g:T.BufferGeometry){const t=Observer.mark(this.geometryStamps,g.id,this.stamp);if(!t)return false;this.geometryStamps=t;return true;}
 /** True the first time texture `x` is read in this scan. */
 firstTexture(x:T.Texture){const t=Observer.mark(this.textureStamps,x.id,this.stamp);if(!t)return false;this.textureStamps=t;return true;}
 /** Compare the record's values with the signature and empty it. */
 flush(){if(this.k!==0){this.out.pushN(this.rec,this.k);this.k=0;}}
 /** Make room for `n` direct stores (n ≤ RECORD); returns the index to store from. */
 room(n:number){if(this.k+n>RECORD)this.flush();return this.k;}
 push(v:number){if(this.k===RECORD)this.flush();this.rec[this.k++]=v;}
 matrix(m:T.Matrix4|T.Matrix3){const e=m.elements,n=e.length,r=this.rec;let k=this.room(n);for(let i=0;i<n;i++)r[k++]=e[i];this.k=k;}
 /** The authoritative local transform, including manually managed matrices. */
 local(o:T.Object3D){
  const r=this.rec;let k=this.room(37);r[k++]=o.id;
  // One flags value first makes the transform encoding self-delimiting: which parts follow is part of the input.
  const auto=o.matrixAutoUpdate,pivot=auto?o.pivot:null,world=!o.matrixWorldAutoUpdate;
  r[k++]=(auto?1:0)+(pivot?2:0)+(world?4:0);
  if(auto){
   const p=o.position,q=o.quaternion,s=o.scale;r[k++]=p.x;r[k++]=p.y;r[k++]=p.z;r[k++]=q.x;r[k++]=q.y;r[k++]=q.z;r[k++]=q.w;r[k++]=s.x;r[k++]=s.y;r[k++]=s.z;
   // `updateMatrix` rotates and scales about the pivot when one is set.
   if(pivot){r[k++]=pivot.x;r[k++]=pivot.y;r[k++]=pivot.z;}
  }else{const e=o.matrix.elements;for(let i=0;i<16;i++)r[k++]=e[i];}
  // A world matrix managed by hand is itself an input; one updated automatically is implied by the locals.
  if(world){const e=o.matrixWorld.elements;for(let i=0;i<16;i++)r[k++]=e[i];}
  this.k=k;
 }
 texture(t:T.Texture|null|undefined){
  if(!t){this.push(-1);return;}this.push(t.id);if(!this.firstTexture(t))return;
  const r=this.rec;let k=this.room(12);
  // The upload state (image, wrap, filters, format, colour space, mipmaps) takes effect only through an upload,
  // which bumps `version`; the PMREM version drives environment-map regeneration.
  r[k++]=t.version;r[k++]=idOf(t.source);r[k++]=t.pmremVersion;r[k++]=t.offset.x;r[k++]=t.offset.y;r[k++]=t.repeat.x;r[k++]=t.repeat.y;r[k++]=t.center.x;r[k++]=t.center.y;r[k++]=t.rotation;r[k++]=t.channel;
  r[k++]=t.matrixAutoUpdate?1:0;this.k=k;
  if(!t.matrixAutoUpdate)this.matrix(t.matrix);
  if((t as T.VideoTexture).isVideoTexture&&!safe(t))this.force('video texture');
  // A render target's contents change when something renders into it; nothing in the scene says when.
  if((t as T.Texture&{isRenderTargetTexture?:boolean}).isRenderTargetTexture&&!safe(t))this.force('render-target texture');
 }
 geometry(g:T.BufferGeometry){this.push(g.id);if(this.firstGeometry(g))this.geometryBody(g);}
 /** A geometry's draw inputs, read once per scan after its id (`geometry`). */
 geometryBody(g:T.BufferGeometry){
  // The attribute list ends in -1 (never an attribute id) and morph lists carry counts: self-delimiting encodings.
  for(const key in g.attributes){const a=g.attributes[key];this.push(attributeId(a));this.push(attributeVersion(a));this.push(a.count);}
  this.push(-1);
  const morphs=g.morphAttributes as Record<string,(T.BufferAttribute|T.InterleavedBufferAttribute)[]>;
  let lists=0;for(const key in morphs)if(morphs[key])lists++;
  this.push(lists);for(const key in morphs){const list=morphs[key];if(!list)continue;this.push(list.length);for(const a of list){this.push(attributeId(a));this.push(attributeVersion(a));}}
  // Frustum culling tests the bounding sphere; it is an input once set (three computes it lazily when null).
  const sphere=g.boundingSphere;if(sphere){this.push(1);this.push(sphere.center.x);this.push(sphere.center.y);this.push(sphere.center.z);this.push(sphere.radius);}else this.push(0);
  this.push(g.morphTargetsRelative?1:0);
  this.push(g.index?attributeId(g.index):-1);this.push(attributeVersion(g.index));this.push(g.drawRange.start);this.push(g.drawRange.count);
  this.push(g.groups.length);for(const x of g.groups){this.push(x.start);this.push(x.count);this.push(x.materialIndex??0);}
 }
 /** Every draw input of a batch, through the pinned adapter; its engine hooks are exempt only by exact identity. */
 batch(b:T.BatchedMesh,colour:boolean){
  const state=readBatchState(b);if(!state){this.force('batch state unreadable');return;}
  const hooks=builtInBatchHooks(b);
  if(colour&&b.onBeforeRender!==hooks.render&&!safe(b.onBeforeRender))this.force('custom batch render hook');
  if(b.onBeforeShadow!==hooks.shadow&&!safe(b.onBeforeShadow))this.force('custom batch shadow hook');
  if(b.customSort!==null)this.force('custom batch sort');
  this.push(b.perObjectFrustumCulled?1:0);this.push(b.sortObjects?1:0);this.push(b.maxInstanceCount);
  this.push(state.matrices.id);this.push(state.matrices.version);// Per-instance colour is a colour-pass input only; the depth pass ignores it.
  if(colour){this.push(state.colors?state.colors.id:-1);this.push(state.colors?state.colors.version:-1);}
  this.push(state.instances.length);for(const x of state.instances){this.push(x.active?1:0);this.push(x.visible?1:0);this.push(x.geometryIndex);}
  this.push(state.geometries.length);for(const x of state.geometries){this.push(x.active?1:0);this.push(x.vertexStart);this.push(x.vertexCount);this.push(x.indexStart);this.push(x.indexCount);this.push(x.start);this.push(x.count);}
 }
 /** A skinned mesh's deformation closure: ordered bones, inverse binds, bind state and each bone's ancestors up to
  *  `root` regardless of visibility. `world` reads current world matrices (shadow scan, after propagation);
  *  otherwise authoritative local transforms along the chain (colour scan). A bone that does not reach `root`
  *  is outside anything the scan can see and forces. */
 skeleton(mesh:T.SkinnedMesh,root:T.Object3D,world:boolean){
  const sk=mesh.skeleton;
  if(!sk){this.force('skinned mesh without skeleton');return;}
  this.push(idOf(sk));this.push(mesh.bindMode===DetachedBindMode?1:0);this.matrix(mesh.bindMatrix);
  // `updateMatrixWorld` re-derives the bind inverse from the world or bind matrix; it is an input only when that
  // propagation is switched off for this mesh.
  if(!mesh.matrixWorldAutoUpdate)this.matrix(mesh.bindMatrixInverse);
  this.push(sk.bones.length);this.push(sk.boneInverses.length);
  for(let i=0;i<sk.bones.length;i++){
   const bone=sk.bones[i];if(!bone){this.force('missing bone');this.push(-1);continue;}
   this.push(bone.id);const inverse=sk.boneInverses[i];if(inverse)this.matrix(inverse);else this.push(-1);
   // ADR 0057: reparenting a bone is a change even where its world matrix is preserved (`attach`).
   if(world){this.push(bone.parent?bone.parent.id:-1);this.matrix(bone.matrixWorld);if(!this.reaches(bone,root))this.force('bone outside scanned graph');continue;}
   // Traversal the chain once per scan; a node already read (a shared ancestor, or one the visible traversal read) stops it.
   let o:T.Object3D|null=bone;
   for(;o&&o!==root;o=o.parent){if(!this.firstNode(o))break;this.push(o.parent?o.parent.id:-1);this.local(o);}
   if(!o)this.force('bone outside scanned graph');
  }
 }
 /** Whether `o` descends from `root`. Nodes proved in this scan are remembered, so a chain of bones is visited once
  *  (linear in the rig, not quadratic). */
 private reaches(o:T.Object3D,root:T.Object3D){
  let x:T.Object3D|null=o;
  for(;x&&x!==root;x=x.parent)if(this.chained.get(x)===this.stamp)break;
  if(!x)return false;
  for(let y:T.Object3D|null=o;y&&y!==x;y=y.parent)this.chained.set(y,this.stamp);
  return true;
 }
}

/** An object-level culling sphere (instanced, skinned and batched meshes own one; three computes it lazily when
 *  null and culls against it once set). Plain meshes cull against their geometry's sphere, read with the geometry. */
function cullingSphere(obs:Observer,o:T.Object3D){
 const sphere=(o as T.InstancedMesh).boundingSphere;
 if(sphere===undefined)return;
 if(sphere){const c=sphere.center;obs.push(1);obs.push(c.x);obs.push(c.y);obs.push(c.z);obs.push(sphere.radius);}else obs.push(0);
}

// ---------------------------------------------------------------------------------------------------------------
// Colour tracker: does a view's next frame differ from the last presented one?

const eulerOrders=['XYZ','YZX','ZXY','XZY','YXZ','ZYX'];
/** Any render-input value, prefixed by a kind tag so that every encoding is self-delimiting (a value changing kind,
 *  or appearing where there was none, can never read as the same sequence): numbers and booleans, colours,
 *  textures, vectors, quaternions, Eulers (with their order), matrices, planes, arrays and typed arrays, and plain
 *  objects (uniform structs, `defines`) by their own keys. Absent values and strings are tag 0: a material string
 *  (precision, shader source) takes effect only through a program rebuild, which bumps the version the scan reads.
 *  Any other object is an unknown dependency and forces the scan. */
export function observeValue(obs:Observer,v:unknown,depth=0):void{
 if(typeof v==='number'){obs.push(1);obs.push(v);return;}
 if(typeof v==='boolean'){obs.push(1);obs.push(v?1:0);return;}
 if(v===null||typeof v!=='object'){obs.push(0);return;}
 const x=v as T.Vector4&T.Color&T.Euler&T.Plane&T.Matrix4&T.Texture&{isVector2?:boolean;isVector3?:boolean;isVector4?:boolean;isQuaternion?:boolean;isMatrix3?:boolean};
 if(x.isColor){obs.push(3);obs.push(x.r);obs.push(x.g);obs.push(x.b);}
 else if(x.isTexture){obs.push(4);obs.texture(x);}
 else if(x.isVector2){obs.push(5);obs.push(x.x);obs.push(x.y);}
 else if(x.isVector3){obs.push(6);obs.push(x.x);obs.push(x.y);obs.push(x.z);}
 else if(x.isVector4||x.isQuaternion){obs.push(x.isVector4?7:8);obs.push(x.x);obs.push(x.y);obs.push(x.z);obs.push(x.w);}
 else if(x.isEuler){obs.push(9);obs.push(x.x);obs.push(x.y);obs.push(x.z);obs.push(eulerOrders.indexOf(x.order));}
 else if(x.isMatrix4||x.isMatrix3){obs.push(x.isMatrix4?11:10);obs.matrix(x);}
 else if(x.isPlane){obs.push(12);obs.push(x.normal.x);obs.push(x.normal.y);obs.push(x.normal.z);obs.push(x.constant);}
 else if(Array.isArray(v)||ArrayBuffer.isView(v)){
  const list=v as ArrayLike<unknown>;obs.push(13);obs.push(list.length);
  if(depth>8){obs.force('nested value too deep');return;}
  if(v instanceof DataView||v instanceof BigInt64Array||v instanceof BigUint64Array){obs.force('unobservable value');return;}
  if(ArrayBuffer.isView(v)){for(let i=0;i<list.length;i++)obs.push(list[i] as number);}else for(let i=0;i<list.length;i++)observeValue(obs,list[i],depth+1);
 }
 else if(Object.getPrototypeOf(v)===Object.prototype){
  const record=v as Record<string,unknown>,keys=Object.keys(record);obs.push(14);obs.push(keys.length);
  if(depth>8){obs.force('nested value too deep');return;}
  for(const key of keys)observeValue(obs,record[key],depth+1);
 }
 else{obs.push(15);obs.force('unobservable value');}
}

// Material readers. The complete input set of a material is every own enumerable field (read generically, by key).
// Keyed reads of varying names are the slowest property access the engine has, so the fields of the materials the engine
// draws with are read by name below. A reader is only an accelerator: it lists exactly the keys it reads (a test
// proves the list against a recording proxy), and every key it does not cover is still read generically. Coverage
// is decided per material and version, from the material's own keys, so nothing a reader omits is ever skipped.

type MaterialRecord=Record<string,unknown>;
type Reader={readonly numbers:readonly string[];readonly colors:readonly string[];readonly textures:readonly string[];readonly other:readonly string[];readonly read:(m:MaterialRecord,obs:Observer)=>void};

const colourOf=(obs:Observer,c:unknown)=>{const x=c as T.Color|null;if(x&&x.isColor){obs.push(x.r);obs.push(x.g);obs.push(x.b);}else obs.push(-1);};
const textureOf=(obs:Observer,t:unknown)=>{const x=t as T.Texture|null;obs.texture(x&&x.isTexture?x:null);};

/** `Material` itself: every numeric field of the base class, and the blend colour. */
const baseReader:Reader={
 numbers:['isMaterial','blending','side','vertexColors','opacity','transparent','alphaHash','blendSrc','blendDst','blendEquation','blendAlpha','depthFunc','depthTest','depthWrite','stencilWriteMask','stencilFunc','stencilRef','stencilFuncMask','stencilFail','stencilZFail','stencilZPass','stencilWrite','clipIntersection','clipShadows','colorWrite','polygonOffset','polygonOffsetFactor','polygonOffsetUnits','dithering','alphaToCoverage','premultipliedAlpha','forceSinglePass','allowOverride','visible','toneMapped','_alphaTest'],
 colors:['blendColor'],textures:[],
 other:['blendSrcAlpha','blendDstAlpha','blendEquationAlpha','clippingPlanes','shadowSide','precision'],
 read(m,obs){
  const r=obs.rec;let k=obs.room(36);
  r[k++]=+(m.isMaterial as number);r[k++]=+(m.blending as number);r[k++]=+(m.side as number);r[k++]=+(m.vertexColors as number);r[k++]=+(m.opacity as number);r[k++]=+(m.transparent as number);r[k++]=+(m.alphaHash as number);
  r[k++]=+(m.blendSrc as number);r[k++]=+(m.blendDst as number);r[k++]=+(m.blendEquation as number);r[k++]=+(m.blendAlpha as number);r[k++]=+(m.depthFunc as number);r[k++]=+(m.depthTest as number);r[k++]=+(m.depthWrite as number);
  r[k++]=+(m.stencilWriteMask as number);r[k++]=+(m.stencilFunc as number);r[k++]=+(m.stencilRef as number);r[k++]=+(m.stencilFuncMask as number);r[k++]=+(m.stencilFail as number);r[k++]=+(m.stencilZFail as number);r[k++]=+(m.stencilZPass as number);r[k++]=+(m.stencilWrite as number);
  r[k++]=+(m.clipIntersection as number);r[k++]=+(m.clipShadows as number);r[k++]=+(m.colorWrite as number);r[k++]=+(m.polygonOffset as number);r[k++]=+(m.polygonOffsetFactor as number);r[k++]=+(m.polygonOffsetUnits as number);r[k++]=+(m.dithering as number);
  r[k++]=+(m.alphaToCoverage as number);r[k++]=+(m.premultipliedAlpha as number);r[k++]=+(m.forceSinglePass as number);r[k++]=+(m.allowOverride as number);r[k++]=+(m.visible as number);r[k++]=+(m.toneMapped as number);r[k++]=+(m._alphaTest as number);
  obs.k=k;colourOf(obs,m.blendColor);
  observeValue(obs,m.blendSrcAlpha);observeValue(obs,m.blendDstAlpha);observeValue(obs,m.blendEquationAlpha);observeValue(obs,m.clippingPlanes);observeValue(obs,m.shadowSide);observeValue(obs,m.precision);
 },
};
/** `MeshStandardMaterial` (and the standard part of `MeshPhysicalMaterial`). */
const standardReader:Reader={
 numbers:['isMeshStandardMaterial','roughness','metalness','lightMapIntensity','aoMapIntensity','emissiveIntensity','bumpScale','normalMapType','displacementScale','displacementBias','envMapIntensity','wireframe','wireframeLinewidth','flatShading','fog'],
 colors:['color','emissive'],
 textures:['map','lightMap','aoMap','emissiveMap','bumpMap','normalMap','displacementMap','roughnessMap','metalnessMap','alphaMap','envMap'],
 other:['defines','normalScale','envMapRotation'],
 read(m,obs){
  const r=obs.rec;let k=obs.room(15);
  r[k++]=+(m.isMeshStandardMaterial as number);r[k++]=+(m.roughness as number);r[k++]=+(m.metalness as number);r[k++]=+(m.lightMapIntensity as number);r[k++]=+(m.aoMapIntensity as number);r[k++]=+(m.emissiveIntensity as number);r[k++]=+(m.bumpScale as number);
  r[k++]=+(m.normalMapType as number);r[k++]=+(m.displacementScale as number);r[k++]=+(m.displacementBias as number);r[k++]=+(m.envMapIntensity as number);r[k++]=+(m.wireframe as number);r[k++]=+(m.wireframeLinewidth as number);r[k++]=+(m.flatShading as number);r[k++]=+(m.fog as number);
  obs.k=k;colourOf(obs,m.color);colourOf(obs,m.emissive);
  textureOf(obs,m.map);textureOf(obs,m.lightMap);textureOf(obs,m.aoMap);textureOf(obs,m.emissiveMap);textureOf(obs,m.bumpMap);textureOf(obs,m.normalMap);textureOf(obs,m.displacementMap);textureOf(obs,m.roughnessMap);textureOf(obs,m.metalnessMap);textureOf(obs,m.alphaMap);textureOf(obs,m.envMap);
  observeValue(obs,m.defines);observeValue(obs,m.normalScale);observeValue(obs,m.envMapRotation);
 },
};
/** The fields `MeshPhysicalMaterial` adds to the standard ones (its accessors' backing fields included). */
const physicalReader:Reader={
 numbers:['isMeshPhysicalMaterial','anisotropyRotation','clearcoatRoughness','ior','iridescenceIOR','sheenRoughness','thickness','attenuationDistance','specularIntensity','_anisotropy','_clearcoat','_dispersion','_iridescence','_sheen','_transmission'],
 colors:['sheenColor','attenuationColor','specularColor'],
 textures:['anisotropyMap','clearcoatMap','clearcoatRoughnessMap','clearcoatNormalMap','iridescenceMap','iridescenceThicknessMap','sheenColorMap','sheenRoughnessMap','transmissionMap','thicknessMap','specularIntensityMap','specularColorMap'],
 other:['clearcoatNormalScale','iridescenceThicknessRange'],
 read(m,obs){
  const r=obs.rec;let k=obs.room(15);
  r[k++]=+(m.isMeshPhysicalMaterial as number);r[k++]=+(m.anisotropyRotation as number);r[k++]=+(m.clearcoatRoughness as number);r[k++]=+(m.ior as number);r[k++]=+(m.iridescenceIOR as number);r[k++]=+(m.sheenRoughness as number);r[k++]=+(m.thickness as number);r[k++]=+(m.attenuationDistance as number);
  r[k++]=+(m.specularIntensity as number);r[k++]=+(m._anisotropy as number);r[k++]=+(m._clearcoat as number);r[k++]=+(m._dispersion as number);r[k++]=+(m._iridescence as number);r[k++]=+(m._sheen as number);r[k++]=+(m._transmission as number);
  obs.k=k;colourOf(obs,m.sheenColor);colourOf(obs,m.attenuationColor);colourOf(obs,m.specularColor);
  textureOf(obs,m.anisotropyMap);textureOf(obs,m.clearcoatMap);textureOf(obs,m.clearcoatRoughnessMap);textureOf(obs,m.clearcoatNormalMap);textureOf(obs,m.iridescenceMap);textureOf(obs,m.iridescenceThicknessMap);
  textureOf(obs,m.sheenColorMap);textureOf(obs,m.sheenRoughnessMap);textureOf(obs,m.transmissionMap);textureOf(obs,m.thicknessMap);textureOf(obs,m.specularIntensityMap);textureOf(obs,m.specularColorMap);
  observeValue(obs,m.clearcoatNormalScale);observeValue(obs,m.iridescenceThicknessRange);
 },
};
/** `MeshBasicMaterial`. */
const basicReader:Reader={
 numbers:['isMeshBasicMaterial','lightMapIntensity','aoMapIntensity','combine','reflectivity','refractionRatio','wireframe','wireframeLinewidth','fog'],
 colors:['color'],
 textures:['map','lightMap','aoMap','specularMap','alphaMap','envMap'],
 other:['envMapRotation'],
 read(m,obs){
  const r=obs.rec;let k=obs.room(9);
  r[k++]=+(m.isMeshBasicMaterial as number);r[k++]=+(m.lightMapIntensity as number);r[k++]=+(m.aoMapIntensity as number);r[k++]=+(m.combine as number);r[k++]=+(m.reflectivity as number);r[k++]=+(m.refractionRatio as number);r[k++]=+(m.wireframe as number);r[k++]=+(m.wireframeLinewidth as number);r[k++]=+(m.fog as number);
  obs.k=k;colourOf(obs,m.color);
  textureOf(obs,m.map);textureOf(obs,m.lightMap);textureOf(obs,m.aoMap);textureOf(obs,m.specularMap);textureOf(obs,m.alphaMap);textureOf(obs,m.envMap);
  observeValue(obs,m.envMapRotation);
 },
};
/** The named readers that apply to a material (by its own class flags); the rest of its keys are read by key. */
export const materialReaders=(m:T.Material):readonly Reader[]=>{
 const x=m as unknown as MaterialRecord,list:Reader[]=[baseReader];
 if(x.isMeshStandardMaterial===true)list.push(standardReader);
 if(x.isMeshPhysicalMaterial===true)list.push(physicalReader);
 if(x.isMeshBasicMaterial===true)list.push(basicReader);
 return list;
};
export type {Reader as MaterialReader};

/** One material version's read plan: the named readers, then every key they do not cover, by kind. */
type MaterialFields={version:number;readers:readonly Reader[];numbers:string[];colors:string[];textures:string[];other:string[]};
/** Plans a material's reads. The generic classification is the definition of completeness: a key goes to a reader
 *  only if that reader lists it under the same kind the generic pass gives it; everything else is read by key. */
function planMaterial(m:T.Material):MaterialFields{
 const record=m as unknown as MaterialRecord,readers=materialReaders(m);
 const f:MaterialFields={version:m.version,readers,numbers:[],colors:[],textures:[],other:[]};
 const covered=(kind:'numbers'|'colors'|'textures'|'other',key:string)=>{for(const r of readers)if(r[kind].includes(key))return true;return false;};
 for(const key of Object.keys(record)){
  const v=record[key] as {isColor?:boolean;isTexture?:boolean}|null;
  // The listener table is dispatch state, not a render input; `version` is read separately (see `material`).
  if(key==='uniforms'||key==='userData'||key==='version'||key==='_listeners'||typeof v==='string'||typeof v==='function')continue;
  const kind=typeof v==='number'||typeof v==='boolean'?'numbers':v?.isColor?'colors':v?.isTexture||v===null&&/map$/i.test(key)?'textures':'other';
  if(covered(kind,key))continue;
  f[kind].push(key);
 }
 return f;
}

/** Creates the on-demand colour tracker. `scan(surface, ...views)` returns `due` when anything a render of those
 *  views would draw differs from the last due scan, and records that scan as the new baseline. Every call scans
 *  the complete scene: there is no alternate-frame shortcut, so a mutation after any still interval reaches the
 *  very next presented frame. */
export function createColourTracker(){
 const obs=new Observer();let valid=false;const fields=new WeakMap<T.Material,MaterialFields>();
 const stats:TrackerStats={scans:0,due:0,forced:0,values:0};
 const value=(v:unknown)=>observeValue(obs,v);
 function material(m:T.Material){obs.push(materialId(m));if(obs.firstMaterial(m))materialBody(m);}
 /** A material's inputs, read once per scan after its id (`material`). */
 function materialBody(m:T.Material){
  // three bumps the version of a two-pass (transparent, double-sided) material on every draw; its fields are read below.
  if(!(m.transparent&&m.side===DoubleSide&&!m.forceSinglePass))obs.push(m.version);
  if(m.onBeforeRender!==materialHook&&!safe(m.onBeforeRender))obs.force('material render hook');
  if(m.onBeforeCompile!==compileHook&&!safe(m.onBeforeCompile))obs.force('material compile hook');
  if(m.customProgramCacheKey!==customKey&&!safe(m.onBeforeCompile))obs.force('custom program key');
  const record=m as unknown as MaterialRecord;let f=fields.get(m);
  if(!f||f.version!==m.version)fields.set(m,f=planMaterial(m));
  const readers=f.readers;obs.push(readers.length);for(let i=0;i<readers.length;i++)readers[i].read(record,obs);
  // The key lists are cached per version.
  const numbers=f.numbers;obs.push(numbers.length);for(let i=0;i<numbers.length;i++)obs.push(+(record[numbers[i]] as number));
  for(const key of f.colors)colourOf(obs,record[key]);
  for(const key of f.textures)textureOf(obs,record[key]);
  for(const key of f.other)value(record[key]);
  const uniforms=(m as T.ShaderMaterial).uniforms;if(uniforms)for(const key of Object.keys(uniforms)){const u=uniforms[key];value(u?u.value:undefined);}
 }
 function drawable(o:T.Object3D,root:T.Object3D,batched:boolean){
  const mesh=o as T.Mesh&T.InstancedMesh&T.SkinnedMesh,geometry=mesh.geometry,materials=mesh.material;
  if(!geometry||!materials)return;
  obs.geometry(geometry);
  // A single material is -1 and an array its length: an array draws by geometry groups, so the two differ.
  if(Array.isArray(materials)){obs.push(materials.length);for(const m of materials)material(m);}else{obs.push(-1);material(materials);}
  obs.push(mesh.castShadow?1:0);obs.push(mesh.receiveShadow?1:0);
  const morph=mesh.morphTargetInfluences;if(morph){obs.push(morph.length);for(let i=0;i<morph.length;i++)obs.push(morph[i]);}else obs.push(-1);
  if(mesh.isInstancedMesh){obs.push(mesh.count);obs.push(mesh.instanceMatrix.version);obs.push(attributeVersion(mesh.instanceColor));obs.texture(mesh.morphTexture);}
  if(mesh.isSkinnedMesh)obs.skeleton(mesh,root,false);
  if(batched)obs.batch(o as T.BatchedMesh,true);
  cullingSphere(obs,o);
  if((o as T.Sprite).isSprite){obs.push((o as T.Sprite).center.x);obs.push((o as T.Sprite).center.y);}
 }
 // The traversal is split by exact constructor so that each visitor's property reads see one or a few object shapes
 // (inline-cached) instead of every shape in the scene. The shared head is deliberately repeated in each visitor:
 // a shared helper would share one megamorphic feedback vector. Exact constructor identity is a sound selector:
 // three sets its `is*` class flags once, in its constructors, and dispatches on them itself, so a plain Mesh has no
 // instance, skeleton, batch, sprite or light state, and a plain Group, Object3D or Bone draws nothing. Every other
 // constructor (subclasses included) takes the complete set of checks.
 function visit(o:T.Object3D,parent:T.Object3D,root:T.Object3D,mask:number){
  const ctor=o.constructor;
  if(ctor===Mesh)visitMesh(o as T.Mesh,parent,root,mask);
  else if(ctor===Group||ctor===Object3D||ctor===Bone)visitNode(o,parent,root,mask);
  else visitAny(o,parent,root,mask);
 }
 function visitMesh(o:T.Mesh,parent:T.Object3D,root:T.Object3D,mask:number){
  // A hidden node is one marker (-1; ids are never negative), so the pre-order record stays self-delimiting.
  if(!o.visible){obs.push(-1);return;}
  // Structure is the pre-order of ids and child counts; three composes world matrices through `parent`, so a node
  // whose link disagrees with the children list it was reached through cannot be read from the order and forces.
  if(o.parent!==parent)obs.force('parent link disagrees with children');
  // Id, one packed value (transform mode, culling, layers seen by the camera, child count), the authoritative local
  // transform (including manually managed matrices) and the draw order. The packing is exact: four flag bits,
  // a 32-bit layer mask and a child count below 65535 (at or above it the count follows in full).
  const children=o.children,n=children.length,r=obs.rec;let k=obs.room(41);r[k++]=o.id;
  const auto=o.matrixAutoUpdate,pivot=auto?o.pivot:null,world=!o.matrixWorldAutoUpdate;
  r[k++]=(auto?1:0)+(pivot?2:0)+(world?4:0)+(o.frustumCulled?8:0)+16*((o.layers.mask&mask)>>>0)+PACK_CHILDREN*(n<65535?n:65535);
  if(n>=65535)r[k++]=n;
  if(auto){
   const p=o.position,q=o.quaternion,s=o.scale;r[k++]=p.x;r[k++]=p.y;r[k++]=p.z;r[k++]=q.x;r[k++]=q.y;r[k++]=q.z;r[k++]=q.w;r[k++]=s.x;r[k++]=s.y;r[k++]=s.z;
   if(pivot){r[k++]=pivot.x;r[k++]=pivot.y;r[k++]=pivot.z;}
  }else{const e=o.matrix.elements;for(let i=0;i<16;i++)r[k++]=e[i];}
  if(world){const e=o.matrixWorld.elements;for(let i=0;i<16;i++)r[k++]=e[i];}
  r[k++]=o.renderOrder;obs.k=k;
  if(o.onBeforeRender!==objectRenderHook&&!safe(o.onBeforeRender))obs.force('object render hook');
  const geometry=o.geometry,materials=o.material;
  if(geometry&&materials){
   // Ids inline; the shared geometry and material bodies are read on first sight in this scan (exact stamp sets).
   const stamp=obs.stamp,gid=geometry.id;k=obs.room(2);r[k++]=gid;obs.k=k;
   const gs=obs.geometryStamps;if((gid>=gs.length||gs[gid]!==stamp)&&obs.firstGeometry(geometry))obs.geometryBody(geometry);
   // A single material is one negative value packing its id with the shadow and morph flags; an array is its
   // length, its materials, then the flags: an array draws by geometry groups, so the two never read alike.
   const morph=o.morphTargetInfluences,flags=(o.castShadow?1:0)+(o.receiveShadow?2:0)+(morph?4:0);
   if(Array.isArray(materials)){obs.push(materials.length);for(const m of materials)material(m);obs.push(flags);}
   else{
    const mid=materialId(materials);k=obs.room(1);r[k++]=-1-flags-8*mid;obs.k=k;
    const ms=obs.materialStamps;if((mid>=ms.length||ms[mid]!==stamp)&&obs.firstMaterial(materials))materialBody(materials);
   }
   if(morph){obs.push(morph.length);for(let i=0;i<morph.length;i++)obs.push(morph[i]);}
  }
  for(let i=0;i<n;i++)visit(children[i],o,root,mask);
 }
 function visitNode(o:T.Object3D,parent:T.Object3D,root:T.Object3D,mask:number){
  // A hidden node is one marker (-1; ids are never negative), so the pre-order record stays self-delimiting.
  if(!o.visible){obs.push(-1);return;}
  // Structure is the pre-order of ids and child counts; three composes world matrices through `parent`, so a node
  // whose link disagrees with the children list it was reached through cannot be read from the order and forces.
  if(o.parent!==parent)obs.force('parent link disagrees with children');
  // Id, one packed value (transform mode, culling, layers seen by the camera, child count), the authoritative local
  // transform (including manually managed matrices) and the draw order. The packing is exact: four flag bits,
  // a 32-bit layer mask and a child count below 65535 (at or above it the count follows in full).
  const children=o.children,n=children.length,r=obs.rec;let k=obs.room(41);r[k++]=o.id;
  const auto=o.matrixAutoUpdate,pivot=auto?o.pivot:null,world=!o.matrixWorldAutoUpdate;
  r[k++]=(auto?1:0)+(pivot?2:0)+(world?4:0)+(o.frustumCulled?8:0)+16*((o.layers.mask&mask)>>>0)+PACK_CHILDREN*(n<65535?n:65535);
  if(n>=65535)r[k++]=n;
  if(auto){
   const p=o.position,q=o.quaternion,s=o.scale;r[k++]=p.x;r[k++]=p.y;r[k++]=p.z;r[k++]=q.x;r[k++]=q.y;r[k++]=q.z;r[k++]=q.w;r[k++]=s.x;r[k++]=s.y;r[k++]=s.z;
   if(pivot){r[k++]=pivot.x;r[k++]=pivot.y;r[k++]=pivot.z;}
  }else{const e=o.matrix.elements;for(let i=0;i<16;i++)r[k++]=e[i];}
  if(world){const e=o.matrixWorld.elements;for(let i=0;i<16;i++)r[k++]=e[i];}
  r[k++]=o.renderOrder;obs.k=k;
  if(o.onBeforeRender!==objectRenderHook&&!safe(o.onBeforeRender))obs.force('object render hook');
  for(let i=0;i<n;i++)visit(children[i],o,root,mask);
 }
 function visitAny(o:T.Object3D,parent:T.Object3D,root:T.Object3D,mask:number){
  // A hidden node is one marker (-1; ids are never negative), so the pre-order record stays self-delimiting.
  if(!o.visible){obs.push(-1);return;}
  // Structure is the pre-order of ids and child counts; three composes world matrices through `parent`, so a node
  // whose link disagrees with the children list it was reached through cannot be read from the order and forces.
  if(o.parent!==parent)obs.force('parent link disagrees with children');
  // Id, one packed value (transform mode, culling, layers seen by the camera, child count), the authoritative local
  // transform (including manually managed matrices) and the draw order. The packing is exact: four flag bits,
  // a 32-bit layer mask and a child count below 65535 (at or above it the count follows in full).
  const children=o.children,n=children.length,r=obs.rec;let k=obs.room(41);r[k++]=o.id;
  const auto=o.matrixAutoUpdate,pivot=auto?o.pivot:null,world=!o.matrixWorldAutoUpdate;
  r[k++]=(auto?1:0)+(pivot?2:0)+(world?4:0)+(o.frustumCulled?8:0)+16*((o.layers.mask&mask)>>>0)+PACK_CHILDREN*(n<65535?n:65535);
  if(n>=65535)r[k++]=n;
  if(auto){
   const p=o.position,q=o.quaternion,s=o.scale;r[k++]=p.x;r[k++]=p.y;r[k++]=p.z;r[k++]=q.x;r[k++]=q.y;r[k++]=q.z;r[k++]=q.w;r[k++]=s.x;r[k++]=s.y;r[k++]=s.z;
   if(pivot){r[k++]=pivot.x;r[k++]=pivot.y;r[k++]=pivot.z;}
  }else{const e=o.matrix.elements;for(let i=0;i<16;i++)r[k++]=e[i];}
  if(world){const e=o.matrixWorld.elements;for(let i=0;i<16;i++)r[k++]=e[i];}
  r[k++]=o.renderOrder;obs.k=k;
  const batched=(o as T.BatchedMesh).isBatchedMesh===true;
  if(!batched&&o.onBeforeRender!==objectRenderHook&&!safe(o.onBeforeRender))obs.force('object render hook');
  drawable(o,root,batched);
  if((o as T.Light).isLight)light(o as T.Light);
  // A LOD picks its visible level from the camera distance while rendering: its levels are inputs.
  const lod=o as T.LOD;if(lod.isLOD){obs.push(lod.autoUpdate?1:0);obs.push(lod.levels.length);for(const x of lod.levels){obs.push(x.distance);obs.push(x.hysteresis);obs.push(x.object.id);}}
  for(let i=0;i<n;i++)visit(children[i],o,root,mask);
 }
 function light(l:T.Light){
  const x=l as T.SpotLight&T.HemisphereLight&T.DirectionalLight&T.RectAreaLight&T.PointLight;
  value(x.color);obs.push(x.intensity);value(x.groundColor);obs.push(x.distance??0);obs.push(x.angle??0);obs.push(x.penumbra??0);obs.push(x.decay??0);obs.push(x.width??0);obs.push(x.height??0);
  obs.push(x.castShadow?1:0);if(x.shadow)shadowState(obs,x.shadow,true);else obs.push(-1);
  if((x as T.SpotLight).map!==undefined)obs.texture((x as T.SpotLight).map);
  if(x.target){obs.push(x.target.parent?x.target.parent.id:-1);obs.local(x.target);if(x.target.parent)obs.matrix(x.target.parent.matrixWorld);}
  // A light probe's irradiance is its spherical-harmonic coefficients.
  const probe=l as T.LightProbe;if(probe.isLightProbe){const c=probe.sh.coefficients;obs.push(c.length);for(const v of c){obs.push(v.x);obs.push(v.y);obs.push(v.z);}}
 }
 return {
  stats,
  scan(surface:Surface,...views:View[]):ScanResult{
   obs.rescan(valid);stats.scans++;
   const canvas=surface.domElement;obs.push(canvas.width);obs.push(canvas.height);obs.push(surface.toneMapping);obs.push(surface.toneMappingExposure);
   obs.push(views.length);
   for(const [root,camera] of views){
    obs.local(root);if(root.parent)obs.matrix(root.parent.matrixWorld);obs.local(camera);if(camera.parent)obs.matrix(camera.parent.matrixWorld);
    obs.matrix(camera.projectionMatrix);obs.push(camera.layers.mask);
    const scene=root as T.Scene;
    if(scene.isScene){
     value(scene.background);obs.push(scene.backgroundIntensity);obs.push(scene.backgroundBlurriness);value(scene.backgroundRotation);value(scene.environment);obs.push(scene.environmentIntensity);value(scene.environmentRotation);
     if(scene.fog){const fog=scene.fog as T.Fog&T.FogExp2;obs.push(fog.isFogExp2?2:1);value(fog.color);obs.push(fog.near??0);obs.push(fog.far??0);obs.push(fog.density??0);}else obs.push(-1);
     if(scene.overrideMaterial)material(scene.overrideMaterial);else obs.push(-1);
     if(scene.onBeforeRender!==objectRenderHook&&!safe(scene.onBeforeRender))obs.force('scene render hook');
    }
    const children=root.children,n=children.length;obs.push(n);for(let i=0;i<n;i++)visit(children[i],root,root,camera.layers.mask);
   }
   const sig=obs.sig;stats.values=sig.n;
   const due=!valid||obs.forcedBy!==null||!sig.same();
   if(due){stats.due++;if(obs.forcedBy)stats.forced++;valid=true;}
   return {due,forcedBy:obs.forcedBy};
  },
  /** The next scan is due whatever it reads (context restore, a new surface). */
  invalidate(){valid=false;},
 };
}

// ---------------------------------------------------------------------------------------------------------------
// Shadow tracker: is any shadow map in the scene due?

export type ShadowScanOptions={
 /** The viewing camera's layer mask: three's depth pass tests caster layers against it. Default: all layers. */
 readonly cameraLayers?:number;
 /** True when the renderer uses VSM, which also draws `receiveShadow` meshes into the map. */
 readonly vsm?:boolean;
};

/** Every input of the depth pass that one caster contributes, read in world space (after matrix propagation). */
export function observeCaster(obs:Observer,o:T.Mesh|T.Line|T.Points,root:T.Object3D){
 const m=o as T.Mesh&T.InstancedMesh&T.SkinnedMesh,r=obs.rec,w=o.matrixWorld.elements;
 // Depth depends on where a caster is, not on which parent put it there: world matrix, no structure.
 let k=obs.room(19);r[k++]=o.id;for(let i=0;i<16;i++)r[k++]=w[i];r[k++]=o.layers.mask;r[k++]=(o.frustumCulled?1:0)+(o.castShadow?2:0);obs.k=k;
 obs.geometry(m.geometry);
 const materials=m.material;
 if(Array.isArray(materials)){obs.push(materials.length);for(const x of materials)depthMaterial(obs,x);}else{obs.push(-1);depthMaterial(obs,materials);}
 // A custom depth material may run arbitrary shader code: its inputs cannot be enumerated.
 if(m.customDepthMaterial||m.customDistanceMaterial)obs.force('custom depth material');
 const batched=(o as unknown as T.BatchedMesh).isBatchedMesh===true;
 if(batched)obs.batch(o as unknown as T.BatchedMesh,false);
 else if(o.onBeforeShadow!==objectShadowHook&&!safe(o.onBeforeShadow))obs.force('object shadow hook');
 if(o.onAfterShadow!==T.Object3D.prototype.onAfterShadow&&!safe(o.onAfterShadow))obs.force('object after-shadow hook');
 if(m.isInstancedMesh){obs.push(m.count);obs.push(m.instanceMatrix.version);obs.texture(m.morphTexture);}
 const morph=m.morphTargetInfluences;if(morph){obs.push(morph.length);for(let i=0;i<morph.length;i++)obs.push(morph[i]);}else obs.push(-1);
 if(m.isSkinnedMesh)obs.skeleton(m,root,true);
 cullingSphere(obs,o);
}
/** The material state three copies into the depth material (`WebGLShadowMap.getDepthMaterial`). */
export function depthMaterial(obs:Observer,m:T.Material){obs.push(materialId(m));if(obs.firstMaterial(m))depthMaterialBody(obs,m);}
function depthMaterialBody(obs:Observer,m:T.Material){
 const x=m as T.MeshStandardMaterial&T.LineBasicMaterial;
 const r=obs.rec;let k=obs.room(6);r[k++]=m.visible?1:0;r[k++]=m.side;r[k++]=m.shadowSide??-1;r[k++]=x.wireframe?1:0;r[k++]=m.alphaTest;r[k++]=m.alphaToCoverage?1:0;obs.k=k;
 // The depth pass reads colour and alpha maps only to discard (alphaTest, alphaHash): without either, a map's upload
 // or swap changes no depth, and a late texture must not redraw every shadow map.
 // r183 approximates alpha-to-coverage with alphaTest=.5 in the depth pass.
 const discards=m.alphaTest>0||m.alphaHash===true||m.alphaToCoverage===true;obs.push(m.alphaHash?1:0);
 if(discards){obs.texture(x.alphaMap);obs.texture(x.map);}
 obs.texture(x.displacementMap);obs.push(x.displacementScale??0);obs.push(x.displacementBias??0);
 obs.push(m.clipShadows?1:0);obs.push(m.clipIntersection?1:0);const planes=m.clippingPlanes;obs.push(planes?planes.length:-1);
 if(planes)for(const p of planes){obs.push(p.normal.x);obs.push(p.normal.y);obs.push(p.normal.z);obs.push(p.constant);}
 obs.push(x.wireframeLinewidth??0);obs.push(x.linewidth??0);
}
/** A light shadow's own state: filtering and bias (colour pass only), the shadow camera's frustum,
 *  depth range and layers, map size and type, and whether it updates. An orthographic shadow camera's projection is
 *  set by its owner (`updateProjectionMatrix`), so its matrix is read too; a perspective one is re-derived by three
 *  from the light's angle, focus and distance, which are read instead. */
export function shadowState(obs:Observer,shadow:T.LightShadow,colour:boolean){
 const c=shadow.camera as T.OrthographicCamera&T.PerspectiveCamera;
 // Bias and intensity apply where the map is sampled (colour pass); radius and samples also blur a VSM map.
 if(colour){obs.push(shadow.bias);obs.push(shadow.normalBias);obs.push(shadow.intensity);}
 obs.push(shadow.radius);obs.push(shadow.blurSamples);
 obs.push(shadow.mapSize.x);obs.push(shadow.mapSize.y);obs.push(shadow.mapType);obs.push(shadow.autoUpdate?1:0);obs.push((shadow as T.SpotLightShadow).focus??1);
 obs.push(c.left??c.fov);obs.push(c.right??c.aspect);obs.push(c.top??0);obs.push(c.bottom??0);obs.push(c.near);obs.push(c.far);obs.push(c.zoom);obs.push(c.layers.mask);
 if(c.isOrthographicCamera)obs.matrix(c.projectionMatrix);
}
/** A shadow light's complete map inputs: pose, target, shadow camera (view, projection, depth range), map size. */
export function observeShadowLight(obs:Observer,l:T.Light&{target?:T.Object3D;shadow:T.LightShadow}){
 // Negative (never a caster id) so light and caster records never read alike.
 obs.push(-1-l.id);obs.matrix(l.matrixWorld);if(l.target)obs.matrix(l.target.matrixWorld);
 shadowState(obs,l.shadow,false);obs.push((l as T.SpotLight).angle??0);obs.push((l as T.PointLight).distance??0);
}

/** Creates the shadow tracker. `scan(scene)` is due when a shadow light or any rendered caster's depth input
 *  changed: world transforms (bones included, under hidden ancestors too), geometry, depth material state,
 *  instance/batch state and morph weights. Call after world matrices are current. */
export function createShadowTracker(){
 const obs=new Observer();let valid=false;const stats:TrackerStats={scans:0,due:0,forced:0,values:0};
 // Split by exact constructor for the same reason and on the same grounds as the colour traversal. The signature
 // is the ordered list of shadow lights and casters only: a node that draws no depth changes the map only through
 // the casters it shows or hides and the world matrices it gives them, and those are read on the casters.
 const visit=(o:T.Object3D,root:T.Object3D,mask:number,vsm:boolean)=>{
  const ctor=o.constructor;
  if(ctor===Mesh)visitMesh(o as T.Mesh,root,mask,vsm);
  else if(ctor===Group||ctor===Object3D||ctor===Bone)visitNode(o,root,mask,vsm);
  else visitAny(o,root,mask,vsm);
 };
 // The depth pass stops at an invisible node, exactly as `WebGLShadowMap.renderObject` does.
 function visitNode(o:T.Object3D,root:T.Object3D,mask:number,vsm:boolean){
  if(!o.visible)return;
  const children=o.children,n=children.length;for(let i=0;i<n;i++)visit(children[i],root,mask,vsm);
 }
 function visitMesh(o:T.Mesh,root:T.Object3D,mask:number,vsm:boolean){
  if(!o.visible)return;
  if((o.castShadow||vsm&&o.receiveShadow)&&(o.layers.mask&mask)!==0){
   // `observeCaster` for a plain Mesh: no batch, instance, skeleton or object culling sphere (see `visit`).
   const r=obs.rec,w=o.matrixWorld.elements,morph=o.morphTargetInfluences;
   // Packed exactly: three flag bits over the 32-bit layer mask; a single material is -1 - its id.
   let k=obs.room(19);r[k++]=o.id;for(let i=0;i<16;i++)r[k++]=w[i];r[k++]=(o.frustumCulled?1:0)+(o.castShadow?2:0)+(morph?4:0)+8*(o.layers.mask>>>0);obs.k=k;
   const stamp=obs.stamp,geometry=o.geometry,gid=geometry.id;k=obs.room(1);r[k++]=gid;obs.k=k;
   const gs=obs.geometryStamps;if((gid>=gs.length||gs[gid]!==stamp)&&obs.firstGeometry(geometry))obs.geometryBody(geometry);
   const materials=o.material;
   if(Array.isArray(materials)){obs.push(materials.length);for(const x of materials)depthMaterial(obs,x);}
   else{
    const mid=materialId(materials);k=obs.room(1);r[k++]=-1-mid;obs.k=k;
    const ms=obs.materialStamps;if((mid>=ms.length||ms[mid]!==stamp)&&obs.firstMaterial(materials))depthMaterialBody(obs,materials);
   }
   if(o.customDepthMaterial||o.customDistanceMaterial)obs.force('custom depth material');
   if(o.onBeforeShadow!==objectShadowHook&&!safe(o.onBeforeShadow))obs.force('object shadow hook');
   if(o.onAfterShadow!==T.Object3D.prototype.onAfterShadow&&!safe(o.onAfterShadow))obs.force('object after-shadow hook');
   if(morph){obs.push(morph.length);for(let i=0;i<morph.length;i++)obs.push(morph[i]);}
  }
  const children=o.children,n=children.length;for(let i=0;i<n;i++)visit(children[i],root,mask,vsm);
 }
 function visitAny(o:T.Object3D,root:T.Object3D,mask:number,vsm:boolean){
  if(!o.visible)return;
  const l=o as T.DirectionalLight;
  if(l.isLight&&l.castShadow&&l.shadow)observeShadowLight(obs,l);
  const m=o as T.Mesh;
  if((m.isMesh||(o as T.Line).isLine||(o as T.Points).isPoints)&&(m.castShadow||vsm&&m.receiveShadow)&&(o.layers.mask&mask)!==0)observeCaster(obs,m,root);
  const children=o.children,n=children.length;for(let i=0;i<n;i++)visit(children[i],root,mask,vsm);
 }
 return {
  stats,
  scan(scene:T.Object3D,options:ShadowScanOptions={}):ScanResult{
   obs.rescan(valid);stats.scans++;const mask=options.cameraLayers??0xffffffff,vsm=options.vsm===true;
   obs.push(mask);obs.push(vsm?1:0);visit(scene,scene,mask,vsm);
   const sig=obs.sig;stats.values=sig.n;
   const due=!valid||obs.forcedBy!==null||!sig.same();
   if(due){stats.due++;if(obs.forcedBy)stats.forced++;valid=true;}
   return {due,forcedBy:obs.forcedBy};
  },
  /** The next scan is due whatever it reads (context restore). */
  invalidate(){valid=false;},
 };
}
