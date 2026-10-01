import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearCamera } from './clearance';
import { cameraSystem } from './index';
import { defineScene, Name, Transform, testScene } from '../../author';

test('camera footprint clamps to nearest obstruction after padding', () => {
  const pose = { position: [0, 0, 10] as [number,number,number], target: [0, 0, 0] as [number,number,number] };
  let queries = 0;
  const result = clearCamera(pose, from => { queries++; return from[0] > 0 ? 2 : 7; }, 0.5, 0.2);
  assert.equal(queries, 5); assert.equal(result.position[2], 1.8);
  assert.deepEqual(pose.position, [0,0,10]);
  assert.deepEqual(clearCamera(pose, () => null), pose);
});

test('camera handles vertical, coincident and obstructed-at-target poses', () => {
  assert.deepEqual(clearCamera({position:[1,2,3],target:[1,2,3]}, () => {throw Error('no segment');}), {position:[1,2,3],target:[1,2,3]});
  assert.deepEqual(clearCamera({position:[0,10,0],target:[0,0,0]}, () => 0).position, [0,0,0]);
  for (const n of [-1,NaN,Infinity,11]) assert.throws(() => clearCamera({position:[0,10,0],target:[0,0,0]},()=>n));
});

test('camera clears smoothed pose and resets discontinuous target history per world', async () => {
  const system = cameraSystem('follow', {smooth:1, teleportDistance:5, obstruction:()=>null});
  const scene = defineScene({id:'test',title:'Test',entities:[[Name({name:'player'}),Transform()]],systems:[system]});
  const a = await testScene(scene), b = await testScene(scene);
  a.run(1/60); const tr=a.world.get(a.ctx.named('player')!,Transform)!;
  tr.x=100; a.run(1/60);
  assert.equal(a.ctx.view.camera.target[0],100);
  b.run(1/60); assert.equal(b.ctx.view.camera.target[0],0);
});
test('losing a tracked entity holds the last view instead of following an invented origin',async()=>{
 const scene=defineScene({id:'lost',title:'Lost',entities:[[Name({name:'player'}),Transform({x:20})]],systems:[cameraSystem('follow',{smooth:0})]});
 const test=await testScene(scene);test.run(1/60);const target=[...test.ctx.view.camera.target];test.world.despawn(test.ctx.named('player')!);test.run(1/60);assert.deepEqual(test.ctx.view.camera.target,target);
});
