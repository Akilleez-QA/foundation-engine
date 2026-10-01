import test from 'node:test';
import assert from 'node:assert/strict';
import { createTerrainRegion, terrainRegionSlices, type TerrainRegionPoint, type TerrainRegionOptions } from './region';
import { createTerrainCoverage } from './region-coverage';
import { createSampledSurface } from './surface';
const lattice={id:'world',revision:1,baseX:0,baseZ:0,spacing:1};
const options:TerrainRegionOptions={id:'region',lattice,startX:-2,startZ:-2,cellsX:2,cellsZ:2};
const source=(p:TerrainRegionPoint)=>({height:p.x*p.x+2*p.z*p.z});
const near=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-12,`${a} != ${b}`);
test('T4 independently generated core corners match monolith and canonical Surface normals',()=>{
  const monolith=createTerrainRegion({...options,startX:-3,startZ:-3,cellsX:6,cellsZ:6},source);
  const heights:number[]=[];for(let z=-4;z<=4;z++)for(let x=-4;x<=4;x++)heights.push(x*x+2*z*z);
  const canonical=createSampledSurface({id:'oracle',revision:1,originX:-4,originZ:-4,spacing:1,cellsX:8,cellsZ:8,heights});
  for(const startX of [-2,0])for(const startZ of [-2,0]) {
    const region=createTerrainRegion({...options,startX,startZ},source);
    for(let z=0;z<=2;z++)for(let x=0;x<=2;x++) {
      const actual=region.vertex(x,z),gx=startX+x,gz=startZ+z;
      assert.deepEqual(actual,monolith.vertex(gx+3,gz+3));assert.deepEqual(actual,canonical.vertex(gx+4,gz+4));
      near(actual.normal.x,-2*gx/Math.hypot(2*gx,1,4*gz));near(actual.normal.z,-4*gz/Math.hypot(2*gx,1,4*gz));
    }
  }
});
test('T4 global fractional coordinates and negative indices match a monolith exactly',()=>{
  const descriptor={...lattice,baseX:0.17,baseZ:-0.29,spacing:0.1};
  const monolith=createTerrainRegion({...options,lattice:descriptor,startX:-5,startZ:-5,cellsX:10,cellsZ:10},source);
  for(const startX of [-4,0])for(const startZ of [-4,0]){
    const region=createTerrainRegion({...options,lattice:descriptor,startX,startZ,cellsX:4,cellsZ:4},source);
    for(let z=0;z<=4;z++)for(let x=0;x<=4;x++) {
      const actual=region.vertex(x,z);assert.equal(actual.x,Math.fround(0.17+(startX+x)*0.1));assert.deepEqual(actual,monolith.vertex(startX+x+5,startZ+z+5));
    }
  }
});
test('T4 edited global source refreshes halo-dependent corner normal to independent oracle',()=>{
  const edit=(p:TerrainRegionPoint)=>({height:p.x*p.x+2*p.z*p.z+(p.gx===1&&p.gz===0?3:0)});
  for(const startX of [-2,0])for(const startZ of [-2,0]){
    const old=createTerrainRegion({...options,startX,startZ},source);
    const updated=createTerrainRegion({...options,startX,startZ,lattice:{...lattice,revision:2}},edit);
    const n=updated.vertex(-startX,-startZ).normal;near(n.x,-2/3);near(n.y,2/3);near(n.z,-1/3);
    assert.deepEqual(old.vertex(-startX,-startZ).normal,{x:0,y:1,z:0});
    assert.ok(updated.dependency.minX<=1&&updated.dependency.maxX>=1&&updated.dependency.minZ<=0&&updated.dependency.maxZ>=0);
  }
});
test('T4 query coverage excludes halo and mesh/query results cannot mutate retained data',()=>{
  const region=createTerrainRegion(options,p=>({height:2*p.x-3*p.z+5,material:p.gx===-1?8:1,excluded:p.gz===-1}));
  assert.equal(region.query(-2.5,-1).status,'outside');
  const hit=region.query(-1.8,-1.7);assert.equal(hit.status,'covered');if(hit.status==='covered'){near(hit.sample.height,6.5);near(hit.sample.normal.x,-2/Math.sqrt(14));assert.equal(hit.sample.excluded,true);}
  const first=region.vertex(0,0);const mesh=region.mesh();mesh.positions.fill(999);mesh.normals!.fill(0);assert.deepEqual(region.vertex(0,0),first);
  assert.throws(()=>region.vertex(-1,0));assert.throws(()=>region.query(NaN,0));
});
test('T4 metadata is snapshotted, dimensions include halo, and slices can be abandoned',()=>{
  const mutable={...options,lattice:{...lattice}},slices=terrainRegionSlices(mutable,source);mutable.startX=100;mutable.lattice.baseX=100;
  let next=slices.next();while(!next.done)next=slices.next();assert.equal(next.value.vertex(0,0).x,-2);
  let calls=0;const cancelled=terrainRegionSlices(options,p=>{calls++;return source(p);});cancelled.next();assert.equal(calls,5);cancelled.return(undefined as never);assert.equal(calls,5);
  assert.throws(()=>createTerrainRegion({...options,cellsX:255},source));assert.throws(()=>createTerrainRegion({...options,startX:0.5},source));
  assert.throws(()=>createTerrainRegion({...options,lattice:{...lattice,baseX:1e20}},source));
  assert.throws(()=>createTerrainRegion(options,()=>({height:NaN})));assert.throws(()=>createTerrainRegion(options,()=>({height:0,material:65536})));
});
test('T5 coverage distinguishes unavailable work from outside and leaves boundary policy explicit',()=>{
  const ready=createTerrainRegion(options,source),pending={status:'pending' as const,id:'next',extent:{minX:0,minZ:-2,maxX:2,maxZ:0}};
  const snapshot=createTerrainCoverage([{status:'ready',region:ready},pending,{status:'failed',id:'broken',extent:{minX:4,minZ:0,maxX:6,maxZ:2}},{status:'unavailable',id:'absent',extent:{minX:8,minZ:0,maxX:10,maxZ:2}}]);
  pending.extent.minX=100;
  assert.equal(snapshot.query(-1,-1).status,'covered');assert.deepEqual(snapshot.query(1,-1),{status:'pending',id:'next'});assert.equal(snapshot.query(5,1).status,'failed');assert.equal(snapshot.query(9,1).status,'unavailable');assert.equal(snapshot.query(20,20).status,'outside');assert.deepEqual(snapshot.query(0,-1),{status:'ambiguous',ids:['region','next']});
  assert.throws(()=>createTerrainCoverage([{status:'ready',region:{...ready}}]));
  assert.throws(()=>createTerrainCoverage(Array(65).fill(pending)));assert.throws(()=>createTerrainCoverage([],65));
  const poisoned=[{status:'ready' as const,region:ready}];Object.defineProperty(poisoned,'map',{value:()=>assert.fail('caller map')});assert.equal(createTerrainCoverage(poisoned).query(-1,-1).status,'covered');
});

test('T4 nonplanar queries match canonical triangle contact on both halves and outer edges',()=>{
  const region=createTerrainRegion({...options,startX:0,startZ:0},p=>({height:p.gx*p.gx+2*p.gz*p.gz,material:p.gx+3,excluded:p.gx===1&&p.gz===1}));
  const heights:number[]=[],materials:number[]=[],exclusions:number[]=[];
  for(let z=0;z<=2;z++)for(let x=0;x<=2;x++){heights.push(x*x+2*z*z);materials.push(x+3);exclusions.push(+(x===1&&z===1));}
  const surface=createSampledSurface({id:'oracle',revision:1,originX:0,originZ:0,spacing:1,cellsX:2,cellsZ:2,heights,materials,exclusions});
  for(const [x,z] of [[0.2,0.3],[0.8,0.7],[2,2],[2,0.8],[0,0]]) {
    const actual=region.query(x!,z!);assert.equal(actual.status,'covered');if(actual.status==='covered')assert.deepEqual(actual.sample,surface.sample(x!,z!));
  }
});
