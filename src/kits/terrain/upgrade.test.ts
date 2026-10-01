import test from 'node:test';
import assert from 'node:assert/strict';
import {createSurface,patchSurface} from './surface';
import {buildSurfaceChunk} from './chunk';
import {createTerrainGenerationBuilder,prepareTerrainGeneration} from './generation';
import {createSurfaceScatter} from './scatter';
import {projectedSurfaceError,selectSurfaceLod} from './lod';
const surface=()=>createSurface({id:'grid',revision:1,originX:-8,originZ:-8,spacing:1,cellsX:16,cellsZ:16,seed:2,baseHeight:0,layers:[{kind:'noise',amplitude:0.2,frequency:0.2}]});
const tiles=[{key:'left',startX:0,startZ:0,cellsX:8,cellsZ:16,stride:1 as const},{key:'right',startX:8,startZ:0,cellsX:8,cellsZ:16,stride:1 as const}];
test('canonical area-weighted normals are identical at mixed LOD seams and detached',()=>{
 const s=surface(),a=buildSurfaceChunk(s,tiles[0]!),b=buildSurfaceChunk(s,{...tiles[1]!,stride:4});
 const seam=(c:typeof a)=>{const result=[];for(let i=0;i<c.mesh.positions.length;i+=3)if(c.mesh.positions[i]===0)result.push([c.mesh.positions[i+2],...c.mesh.normals!.slice(i,i+3)]);return result.sort((a,b)=>a[0]!-b[0]!);};
 assert.deepEqual(seam(a),seam(b));
 const v=s.vertex(8,8);assert.ok(Object.isFrozen(v.normal));assert.ok(Math.abs(Math.hypot(...Object.values(v.normal))-1)<1e-10);
 a.mesh.normals![0]=99;assert.notEqual(s.vertex(0,0).normal.x,99);
 assert.throws(()=>s.vertex(0.5,0));assert.throws(()=>s.vertex(17,0));
});
test('material transitions force canonical topology while homogeneous tiles simplify',()=>{
 const s=surface(),patch=patchSurface(s,2,[{x:2,z:2,material:1}]);
 assert.equal(buildSurfaceChunk(patch.surface,{...tiles[0]!,stride:4}).stride,1);
 assert.equal(buildSurfaceChunk(patch.surface,{...tiles[1]!,stride:4}).stride,4);
});
test('local edits invalidate normal margins, retain untouched chunks, and reject forged ancestry',()=>{
 const s=surface(),old=prepareTerrainGeneration(s,tiles),patch=patchSurface(s,2,[{x:2,z:4,height:3}]);
 const builder=createTerrainGenerationBuilder(patch.surface,tiles,{previous:old,patch});assert.equal(builder.step(1),1);assert.equal(builder.result,undefined);builder.step(1);
 assert.equal(builder.result!.chunks[1]!.chunk,old.chunks[1]!.chunk);assert.notEqual(builder.result!.chunks[0]!.chunk,old.chunks[0]!.chunk);
 assert.equal(s.vertex(2,4).y,surface().vertex(2,4).y);assert.equal(patch.surface.vertex(2,4).y,3);
 const near=patchSurface(s,3,[{x:7,z:4,height:3}]),both=createTerrainGenerationBuilder(near.surface,tiles,{previous:old,patch:near});both.step(2);
 assert.notEqual(both.result!.chunks[1]!.chunk,old.chunks[1]!.chunk,'one-cell incident normal dependency crosses tile boundary');
 const forged={...patch,bounds:{minX:100,minZ:100,maxX:100,maxZ:100}};
 assert.throws(()=>createTerrainGenerationBuilder(patch.surface,tiles,{previous:old,patch:forged}));
 for(const edits of [[{x:1,z:1,height:Infinity}],[{x:1,z:1},{x:1,z:1}],[{x:17,z:0}]])assert.throws(()=>patchSurface(s,2,edits));
});
test('scatter queries are bounded, tile-order independent, stable across edits and exclude pads',()=>{
 const s=surface(),base={seed:42,layer:'stones',startX:-2,startZ:-2,columns:4,rows:4,cellSize:4};
 const q=createSurfaceScatter(s,base);assert.equal(q.step(3).worked,3);const whole=q.step(13);assert.equal(whole.status,'complete');assert.equal(whole.points.length,16);
 const left=createSurfaceScatter(s,{...base,columns:2}).step(16).points,right=createSurfaceScatter(s,{...base,startX:0,columns:2}).step(16).points;
 const sort=(p:typeof left)=>[...p].sort((a,b)=>a.id.localeCompare(b.id));assert.deepEqual(sort([...right,...left]),sort(whole.points));
 const changed=patchSurface(s,2,[{x:0,z:0,height:5}]);assert.deepEqual(createSurfaceScatter(changed.surface,base).step(16).points.map(p=>[p.id,p.x,p.z]),whole.points.map(p=>[p.id,p.x,p.z]));
 const excluded=createSurface({id:'pad',revision:1,originX:-8,originZ:-8,spacing:1,cellsX:16,cellsZ:16,seed:1,baseHeight:0,pads:[{x:0,z:0,radius:20,height:0,excluded:true}]});assert.equal(createSurfaceScatter(excluded,base).step(16).points.length,0);
 const stale=createSurfaceScatter(s,base);assert.equal(stale.step(1,2).status,'cancelled');assert.equal(stale.step(16).worked,0);
});
test('projected error responds to camera resolution and near plane with hysteresis',()=>{
 const chunk=buildSurfaceChunk(surface(),{...tiles[0]!,stride:4}),view={position:[0,30,0],target:[0,0,0],verticalFov:50,viewportHeight:800,near:0.1};
 const e=projectedSurfaceError(chunk,view);assert.ok(e>0);assert.equal(projectedSurfaceError(chunk,{...view,viewportHeight:1600}),e*2);
 assert.ok(projectedSurfaceError(chunk,{...view,position:[0,100,0]})<e);assert.equal(projectedSurfaceError(chunk,{...view,position:[0,0,0],target:[0,-1,0]}),Infinity);
 assert.throws(()=>selectSurfaceLod(Infinity,2,Infinity,2));
 assert.equal(selectSurfaceLod(2.5,1),1);assert.equal(selectSurfaceLod(2.5,2),2);assert.equal(selectSurfaceLod(4,2),1);assert.equal(selectSurfaceLod(1,1),2);
});

test('worker and sliced fallback patch results match canonical edits without detaching live data',async()=>{
 const {prepareSurfacePatch}=await import('./patch-job');const {createWorkerHost}=await import('../../platform/workers/host');
 const {surfaceWire,patchWireSlices,adoptPatchWire}=await import('./surface');
 const s=surface(),edits=[{x:8,z:8,height:2,material:3,excluded:true}],expected=patchSurface(s,2,edits),host=createWorkerHost({createWorker:null}),lifetime=new AbortController();
 const output=await prepareSurfacePatch(host,{id:'test',signal:lifetime.signal},s,2,edits,lifetime.signal);assert.equal(output.status,'done');
 if(output.status==='done')for(let z=0;z<=16;z++)for(let x=0;x<=16;x++)assert.deepEqual(output.patch.surface.vertex(x,z),expected.surface.vertex(x,z));
 assert.deepEqual(s.mesh(),surface().mesh());assert.equal(host.stats().reservedBytes,0);
 const work=patchWireSlices(surfaceWire(s),3,edits);let slices=0,next=work.next();while(!next.done){slices++;next=work.next();}assert.ok(slices>=16);assert.equal(adoptPatchWire(s,next.value).surface.revision,3);
 lifetime.abort();assert.notEqual((await prepareSurfacePatch(host,{id:'test',signal:lifetime.signal},s,4,edits,lifetime.signal)).status,'done');host.dispose();
});

test('worker adoption rejects corrupt topology, normals, hidden edits and bounds before branding',async()=>{
 const {surfaceWire,patchWireSlices,adoptPatchWire}=await import('./surface');const s=surface(),work=patchWireSlices(surfaceWire(s),2,[{x:2,z:2,height:3}]);let next=work.next();while(!next.done)next=work.next();const good=next.value;
 for(const corrupt of [(r:typeof good)=>{r.data.normals![0]=NaN;},(r:typeof good)=>{r.data.xs[0]=NaN;},(r:typeof good)=>{r.bounds={...r.bounds,minX:NaN};},(r:typeof good)=>{r.data.heights[200]=3;},(r:typeof good)=>{r.data.cellsX=4;}]){const bad=structuredClone(good);corrupt(bad);assert.throws(()=>adoptPatchWire(s,bad));}
 const adopted=adoptPatchWire(s,good);good.data.heights[2+2*17]=9;assert.equal(adopted.surface.vertex(2,2).y,3);
});
