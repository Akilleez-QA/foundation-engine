import test from 'node:test';
import assert from 'node:assert/strict';
import { defineScene, testScene, Transform, Name } from '../../author';
import { Walls, Solid } from '../character';
import { createRootMotion } from '../animation';
import { applyRootMotion } from './index';
test('root movement resolves collision in bounded substeps and refuses lost authority', async () => {
 const t=await testScene(defineScene({id:'motion',title:'motion',entities:[[Name({name:'actor'}),Transform()],[Walls({minX:-5,maxX:5,minZ:-5,maxZ:5})],[Transform({x:1}),Solid({halfX:.1,halfZ:2})]]}));
 const actor=t.ctx.named('actor')!,tr=t.world.get(actor,Transform)!;
 const result=applyRootMotion(t.ctx,actor,{x:2,z:0,yaw:.5},{owns:()=>true,radius:.2});
 assert.ok(result.x<.8);assert.equal(tr.ry,.5);
 const before={...tr};assert.equal(applyRootMotion(t.ctx,actor,{x:1,z:0,yaw:1},{owns:()=>false}).applied,false);assert.deepEqual(tr,before);
 assert.throws(()=>applyRootMotion(t.ctx,actor,{x:1e6,z:0,yaw:0},{owns:()=>true}),/budget/);assert.deepEqual(tr,before);
});
test('turn-in-place applies yaw without translation and rejected ground never moves actor',async()=>{
 const t=await testScene(defineScene({id:'turn',title:'turn',entities:[[Name({name:'actor'}),Transform()]]})),e=t.ctx.named('actor')!;
 const track=createRootMotion({duration:1,keys:[{at:0,x:0,z:0,yaw:0},{at:1,x:0,z:0,yaw:1}]});
 applyRootMotion(t.ctx,e,track.advance(1),{owns:()=>true});assert.equal(t.world.get(e,Transform)!.ry,1);
 applyRootMotion(t.ctx,e,{x:1,z:0,yaw:0},{owns:()=>true,ground:()=>null});assert.equal(t.world.get(e,Transform)!.x,0);
});

test('locomotion: root motion and its application accept the deterministic math option', async () => {
  const run = async (math?: 'deterministic') => {
    const t = await testScene(defineScene({ id: 'rm', title: 'Root motion', entities: [[Name({ name: 'a' }), Transform({ ry: 0.4 })]], systems: [] }));
    const e = t.ctx.named('a')!, track = createRootMotion({ duration: 1, keys: [{ at: 0, x: 0, z: 0, yaw: 0 }, { at: 1, x: 1, z: 0.2, yaw: 0.5 }] }, true, { math });
    for (const time of [0.3, 0.9, 1.7, 2.2]) applyRootMotion(t.ctx, e, track.advance(time), { owns: () => true, math });
    const tr = t.world.get(e, Transform)!; return [tr.x, tr.z, tr.ry];
  };
  const a = await run(), b = await run('deterministic');
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(a[i]! - b[i]!) < 1e-12, `${a[i]} vs ${b[i]}`);
  assert.deepEqual(await run('deterministic'), b);
  assert.throws(() => createRootMotion({ duration: 1, keys: [{ at: 0, x: 0, z: 0, yaw: 0 }, { at: 1, x: 1, z: 0, yaw: 0 }] }, false, { math: 'x' as never }), RangeError);
});
