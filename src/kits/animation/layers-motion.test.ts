import test from 'node:test';
import assert from 'node:assert/strict';
import {createRootMotion,blendPoseLayers,solveTwoBone} from './index';
import { must } from '../../testing/must';
test('root cursor crosses loops, suppresses seeks and composes turning cycles',()=>{
 const walk=createRootMotion({duration:1,keys:[{at:0,x:0,z:0,yaw:0},{at:1,x:1,z:0,yaw:0}]},true);
 assert.deepEqual(walk.advance(2.5),{x:2.5,z:0,yaw:0});walk.seek(9);assert.deepEqual(walk.advance(9.5),{x:.5,z:0,yaw:0});assert.throws(()=>walk.advance(1),/seek/);
 const turn=createRootMotion({duration:1,keys:[{at:0,x:0,z:0,yaw:0},{at:1,x:1,z:0,yaw:Math.PI/2}]},true),d=turn.advance(2);
 assert.ok(Math.abs(d.x-1)<1e-9&&Math.abs(d.z+1)<1e-9);assert.equal(d.yaw,Math.PI);
});
test('masked pose blending preserves unmasked joints and does not mutate definitions',()=>{
 const base=[{joint:'hand',position:[0,0,0] as const,rotation:[0,0,0,1] as const},{joint:'leg',position:[0,0,0] as const,rotation:[0,0,0,1] as const}];
 const result=blendPoseLayers(base,[{mask:['hand'],weight:.5,pose:[{joint:'hand',position:[0,2,0],rotation:[0,0,0,1]}]}]);
 assert.equal(must(result[0]).position[1],1);assert.equal(must(result[1]).position[1],0);assert.equal(must(base[0]).position[1],0);
 assert.throws(()=>blendPoseLayers(base,[{mask:['absent'],weight:1,pose:[]}]),/unknown/);
});
test('two-link IK clamps unreachable targets and remains finite for coincident target and pole',()=>{
 const reached=solveTwoBone([0,0,0],[.7,.6,0],[0,0,1],.6,.6);assert.equal(reached.reachable,true);
 assert.ok(Math.hypot(...reached.tip.map((v,i)=>v-must([.7,.6,0][i])))<1e-8);
 for(const target of [[0,0,0],[100,0,0]]){const result=solveTwoBone([0,0,0],target,[0,0,0],.6,.6);assert.ok([...result.elbow,...result.tip,...result.shoulderRotation,...result.elbowRotation].every(Number.isFinite));}
});
