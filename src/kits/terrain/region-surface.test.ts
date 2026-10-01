import test from 'node:test';
import assert from 'node:assert/strict';
import { createTerrainRegion, patchTerrainRegion, type TerrainRegion } from './region';
import { patchSurface, surfaceBytes, surfaceParent } from './surface';
import { createTerrainGenerationBuilder, prepareTerrainGeneration } from './generation';
const lattice={id:'field',revision:1,baseX:0,baseZ:0,spacing:1};
const make=()=>createTerrainRegion({id:'core',lattice,startX:0,startZ:0,cellsX:8,cellsZ:4},p=>({height:p.x*p.x/8+p.z*p.z/4}));
test('TR-01 canonical core preserves fractional global axes and excludes halo from ray and sample',()=>{
  const region=createTerrainRegion({id:'fractional',lattice:{...lattice,baseX:.1,baseZ:.17,spacing:.1},startX:-1000,startZ:-1000,cellsX:4,cellsZ:4},()=>({height:2}));
  const surface=region.surface;
  assert.equal(surface.vertex(2,2).x,Math.fround(.1+-998*.1));
  assert.notEqual(surface.vertex(2,2).x,Math.fround(surface.originX+2*.1));
  const x=surface.vertex(2,2).x,z=surface.vertex(2,2).z;
  assert.equal(surface.raycast({x,y:5,z},{x:0,y:-1,z:0})!.distance,3);
  assert.equal(surface.sample(surface.originX-.05,z),null);
  assert.equal(surface.raycast({x:surface.originX-.05,y:5,z},{x:0,y:-1,z:0}),null);
  assert.equal(patchSurface(surface,2,[{x:2,z:2,height:4}]).surface.vertex(2,2).y,4);
  assert.equal(surface.vertex(2,2).y,2);
});
test('TR-01 halo-only patch rebuilds edge normals and dependent chunks without changing heights',()=>{
  const before=make(),tiles=[{key:'left',startX:0,startZ:0,cellsX:4,cellsZ:4,stride:1 as const},{key:'right',startX:4,startZ:0,cellsX:4,cellsZ:4,stride:2 as const}];
  const initial=prepareTerrainGeneration(before.surface,tiles);
  const {region,patch}=patchTerrainRegion(before,2,[{gx:-1,gz:1,height:3}]);
  assert.deepEqual(region.surface.mesh(),before.surface.mesh());
  assert.notDeepEqual(region.vertex(0,1).normal,before.vertex(0,1).normal);
  assert.ok(patch.dirty);assert.equal(patch.dirty.maxX,0);
  const builder=createTerrainGenerationBuilder(region.surface,tiles,{previous:initial,patch});builder.step(2);
  assert.notEqual(builder.result!.chunks[0]!.chunk,initial.chunks[0]!.chunk);
  assert.equal(builder.result!.chunks[1]!.chunk,initial.chunks[1]!.chunk);
  assert.ok(initial.bytes>=surfaceBytes(before.surface));
  assert.ok(surfaceBytes(before.surface)>surfaceBytes(surfaceParent(before.surface)!));
  const fresh=createTerrainRegion({id:'core',lattice:{...lattice,revision:2},startX:0,startZ:0,cellsX:8,cellsZ:4},p=>({height:p.gx===-1&&p.gz===1?3:p.x*p.x/8+p.z*p.z/4}));
  for(let z=0;z<=4;z++)for(let x=0;x<=8;x++)assert.deepEqual(region.vertex(x,z),fresh.vertex(x,z));
});
test('TR-01 unchanged private halo retains chunks, local core patches retain halo, failures preserve ancestor',()=>{
  const before=make(),tiles=[{key:'whole',startX:0,startZ:0,cellsX:8,cellsZ:4,stride:2 as const}],initial=prepareTerrainGeneration(before.surface,tiles);
  const {region,patch}=patchTerrainRegion(before,2,[{gx:-1,gz:-1,height:100}]);
  assert.equal(patch.dirty,null);const builder=createTerrainGenerationBuilder(region.surface,tiles,{previous:initial,patch});builder.step(1);
  assert.equal(builder.result!.chunks[0]!.chunk,initial.chunks[0]!.chunk);
  const local=patchSurface(before.surface,2,[{x:0,z:1,height:6}]);
  const global=patchTerrainRegion(before,2,[{gx:0,gz:1,height:6}]);
  for(let z=0;z<=4;z++)for(let x=0;x<=8;x++)assert.deepEqual(local.surface.vertex(x,z),global.region.vertex(x,z));
  assert.throws(()=>patchTerrainRegion(before,2,[{gx:-2,gz:0,height:0}]));
  assert.throws(()=>patchTerrainRegion(before,1,[{gx:0,gz:0,height:0}]));
  assert.throws(()=>patchTerrainRegion(before,2,[{gx:0,gz:0,height:1e100}]));
  assert.equal(before.surface.revision,1);
});

test('TR-01 captured edit bounds reject coercive proxy lengths and ignore overridden array hooks',async()=>{
  const {regionEdits,regionPatch}=await import('./region');
  const {captureCoreEdits,adoptGeneratedSurface,surfaceWire}=await import('./surface');
  const region=make();let reads=0,coerced=0;
  const bad=new Proxy([{x:0,z:0}],{get(target,key,receiver){if(key==='length'){reads++;return{valueOf(){coerced++;return 1;}};}return Reflect.get(target,key,receiver);}});
  assert.throws(()=>captureCoreEdits(region.surface,bad));assert.equal(reads,1);assert.equal(coerced,0);
  const globalBad=new Proxy([{gx:0,gz:0}],{get(target,key,receiver){if(key==='length'){reads++;return'1';}return Reflect.get(target,key,receiver);}});
  assert.throws(()=>regionEdits(region,globalBad));assert.equal(reads,2);
  const edits=[{x:0,z:0,height:2}];edits.map=()=>{throw Error('untrusted map');};
  assert.equal(patchSurface(region.surface,2,edits).surface.vertex(0,0).y,2);
  const legitimate=patchTerrainRegion(region,2,[{gx:0,gz:0,height:1}]);
  assert.throws(()=>regionPatch(region,{...legitimate.patch}));
  const parent=surfaceParent(region.surface)!,wire=surfaceWire(parent,true),expected={...parent};
  const short=new Float32Array([parent.originX]);
  assert.throws(()=>adoptGeneratedSurface(expected,{...wire,xs:short},{xs:short,zs:wire.zs}));
  const collapsed=wire.xs.slice();collapsed[1]=collapsed[0]!;
  assert.throws(()=>adoptGeneratedSurface(expected,{...wire,xs:collapsed},{xs:collapsed,zs:wire.zs}));
});

test('TR-01 independent nonplanar triangle oracle covers four patched seams and mixed LOD boundaries',async()=>{
  const {createTerrainOracle}=await import('./test-oracles');const {buildSurfaceChunk}=await import('./chunk');
  const frame={...lattice,baseX:.17,baseZ:-.29,spacing:.1};
  const source=(p:{gx:number;gz:number;x:number;z:number})=>p.gx*p.gz/16+p.gx*p.gx/32+p.gz*p.gz/8;
  const regions=[[-4,-4],[0,-4],[-4,0],[0,0]].map(([startX,startZ],i)=>createTerrainRegion({id:`r${i}`,lattice:frame,startX:startX!,startZ:startZ!,cellsX:4,cellsZ:4},p=>({height:source(p)})));
  const edit={gx:1,gz:0,height:3},patched=regions.map(region=>patchTerrainRegion(region,2,[edit]).region);
  for(const set of [regions,patched]){
    const seen=new Map<string,ReturnType<TerrainRegion['vertex']>>();
    for(const region of set){
      const field=(p:{gx:number;gz:number;x:number;z:number})=>set===patched&&p.gx===edit.gx&&p.gz===edit.gz?3:source(p);
      const expected=createTerrainOracle({...frame,...region},field),surface=region.surface;
      for(let z=0;z<=4;z++)for(let x=0;x<=4;x++){
        const actual=surface.vertex(x,z),reference=expected.vertex(x,z),key=`${region.startX+x},${region.startZ+z}`;
        for(const axis of ['x','y','z'] as const){assert.equal(actual[axis],reference[axis]);assert.ok(Math.abs(actual.normal[axis]-reference.normal[axis])<1e-12);}
        const prior=seen.get(key);if(prior)assert.deepEqual(actual,prior);else seen.set(key,actual);
      }
      for(const stride of [1,2,4] as const){
        const chunk=buildSurfaceChunk(surface,{startX:0,startZ:0,cellsX:4,cellsZ:4,stride}),positions=chunk.mesh.positions;
        for(let z=0;z<=4;z++)for(let x=0;x<=4;x++)if(x===0||x===4||z===0||z===4){
          const ref=expected.vertex(x,z);let found=false;
          for(let i=0;i<positions.length;i+=3)if(positions[i]===ref.x&&positions[i+1]===ref.y&&positions[i+2]===ref.z){found=true;for(const [k,axis] of ['x','y','z'].entries())assert.ok(Math.abs(chunk.mesh.normals![i+k]!-ref.normal[axis as 'x'|'y'|'z'])<1e-12);}
          assert.ok(found);
        }
      }
      for(const [u,v] of [[.21,.29],[.79,.63],[0,0],[1,1]]){
        const x=region.extent.minX+(region.extent.maxX-region.extent.minX)*u!,z=region.extent.minZ+(region.extent.maxZ-region.extent.minZ)*v!;
        assert.ok(Math.abs(surface.sample(x,z)!.height-expected.sample(x,z)!.y)<1e-10);
        for(const direction of [{x:0,y:-1,z:0},{x:.001,y:-1,z:-.002}]){
          const origin={x,y:10,z},actual=surface.raycast(origin,direction),reference=expected.raycast(origin,direction);
          assert.equal(!!actual,!!reference);if(actual&&reference)assert.ok(Math.abs(actual.distance-reference.distance)<1e-9);
        }
      }
    }
  }
});
