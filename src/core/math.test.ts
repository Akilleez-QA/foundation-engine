import test from 'node:test';
import assert from 'node:assert/strict';
import {clamp,clamp01,lerp,inverseLerp,smoothstep,wrapAngle,damp} from './math';

test('clamp and clamp01 keep the replaced copies\' semantics',()=>{
 assert.equal(clamp(5,0,3),3);assert.equal(clamp(-1,0,3),0);assert.equal(clamp(2,0,3),2);
 assert.equal(clamp(2,5,1),5,'lo wins when the bounds cross, like Math.max(lo,Math.min(hi,v))');
 assert.ok(Number.isNaN(clamp(NaN,0,1)));
 assert.equal(clamp01(1.5),1);assert.equal(clamp01(-.5),0);assert.equal(clamp01(.25),.25);
});
test('lerp, inverseLerp, smoothstep, wrapAngle and damp',()=>{
 assert.equal(lerp(2,6,.25),3);assert.equal(inverseLerp(2,6,3),.25);
 assert.equal(smoothstep(0,1,-1),0);assert.equal(smoothstep(0,1,2),1);assert.equal(smoothstep(0,1,.5),.5);assert.equal(smoothstep(10,20,15),.5);
 assert.ok(Math.abs(wrapAngle(3*Math.PI)-Math.PI)<1e-12);assert.ok(Math.abs(wrapAngle(-Math.PI/2- 4*Math.PI)+Math.PI/2)<1e-12);
 assert.equal(damp(0,10,3,0),0);assert.ok(Math.abs(damp(0,10,Math.LN2,1)-5)<1e-12);
});
