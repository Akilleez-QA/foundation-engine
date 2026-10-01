import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkerHost } from '../../platform/workers/host';
import { createTerrainRegion, patchTerrainRegion } from './region';
import { prepareSurfacePatch, prepareTerrainRegionPatch } from './patch-job';
import { adoptPatchWire, patchWireSlices, surfaceParent, surfaceWire, surfaceBytes, type SurfacePatchVertex } from './surface';
const options={id:'region',lattice:{id:'field',revision:1,baseX:0,baseZ:0,spacing:1},startX:0,startZ:0,cellsX:2,cellsZ:2};
test('TR-01 invalid optional patch values reject before host admission or materialisation',async()=>{
  const region=createTerrainRegion(options,()=>({height:0})),host=createWorkerHost({createWorker:null});
  let admitted=0,materialised=0;
  const wrapped:typeof host={...host,run(request,signal){admitted++;return host.run({...request,materialise(){materialised++;return request.materialise();}},signal);}};
  const ctrl=new AbortController(),owner={id:'region',signal:ctrl.signal};
  try{
    for(const bad of [{height:new Uint8Array(1024*1024)},{material:new Uint8Array(1024*1024)},{excluded:new Uint8Array(1024*1024)},{height:1e100},{material:65536},{excluded:1}]){
      await assert.rejects(prepareSurfacePatch(wrapped,owner,region.surface,2,[{x:0,z:0,...bad} as SurfacePatchVertex],ctrl.signal));
      await assert.rejects(prepareTerrainRegionPatch(wrapped,owner,region,2,[{gx:0,gz:0,...bad} as never],ctrl.signal));
      assert.throws(()=>patchTerrainRegion(region,2,[{gx:0,gz:0,...bad} as never]));
    }
    assert.equal(admitted,0);assert.equal(materialised,0);assert.equal(host.stats().reservedBytes,0);
    assert.equal(region.vertex(0,0).y,0);
  }finally{host.dispose();}
});
test('TR-01 patch adoption retains only tightly sized validated arrays and drops extra payload',()=>{
  const region=createTerrainRegion(options,()=>({height:0})),parent=surfaceParent(region.surface)!;
  const slices=patchWireSlices(surfaceWire(parent),2,[{x:1,z:1,height:1}]);let next=slices.next();while(!next.done)next=slices.next();
  const wire=next.value;
  const wide=new Float32Array(new ArrayBuffer(1024*1024),64,wire.data.heights.length);wide.set(wire.data.heights);wire.data.heights=wide;
  Object.assign(wire.data,{unrelated:new Uint8Array(1024*1024)});
  Object.assign(wire.bounds,{unrelated:new Uint8Array(1024*1024)});
  let hooks=0;
  Object.defineProperty(wide,'slice',{value:()=>{hooks++;throw Error('caller slice');}});
  Object.defineProperty(wide,Symbol.iterator,{value:()=>{hooks++;throw Error('caller iterator');}});
  Object.defineProperty(wide,'constructor',{get(){hooks++;throw Error('caller species');}});
  const patch=adoptPatchWire(parent,wire),owned=surfaceWire(patch.surface,true);
  assert.equal(owned.heights.buffer.byteLength,owned.heights.byteLength);
  assert.equal(Object.hasOwn(owned,'unrelated'),false);assert.equal(Object.hasOwn(patch.bounds,'unrelated'),false);assert.equal(hooks,0);
  for(const view of [owned.xs,owned.zs,owned.heights,owned.materials,owned.exclusions,owned.normals!])assert.equal(view.buffer.byteLength,view.byteLength);
  assert.equal(surfaceBytes(patch.surface),4096+owned.xs.byteLength+owned.zs.byteLength+owned.heights.byteLength+owned.materials.byteLength+owned.exclusions.byteLength+owned.normals!.byteLength);
  wide.fill(100);assert.equal(patch.surface.vertex(1,1).y,1);assert.equal(parent.vertex(1,1).y,0);
});
