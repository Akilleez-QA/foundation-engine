import {test} from 'node:test';import assert from 'node:assert/strict';import {createPoseSampler,gaitPhase,type PoseClip} from './pose-clip';
const clip:PoseClip={id:'arm',duration:2,tracks:[{joint:'arm',keys:[{at:0,position:[0,0,0],rotation:[0,0,0,1]},{at:2,position:[2,0,0],rotation:[0,1,0,0]}]}]};
test('joint evaluation interpolates translation and shortest quaternion arc without mutating definitions',()=>{const s=createPoseSampler(clip),p=s.sample(1)[0];assert.deepEqual(p.position,[1,0,0]);assert.ok(Math.abs(p.rotation[1]-Math.SQRT1_2)<1e-12);assert.ok(Math.abs(p.rotation[3]-Math.SQRT1_2)<1e-12);assert.deepEqual(s.sample(3,true),s.sample(1));assert.deepEqual(s.sample(3),s.sample(2));assert.ok(Object.isFrozen(s.clip.tracks[0].keys[0].position));});
test('duplicate times and zero quaternion are rejected; gait phase follows travelled distance',()=>{assert.throws(()=>createPoseSampler({...clip,tracks:[{joint:'arm',keys:[clip.tracks[0].keys[0],clip.tracks[0].keys[0]]}]}));assert.throws(()=>createPoseSampler({...clip,tracks:[{joint:'arm',keys:[{at:0,position:[0,0,0],rotation:[0,0,0,0]}]}]}));assert.equal(gaitPhase(5,2),.5);assert.equal(gaitPhase(0,2),0);});

test('finite extreme quaternion magnitudes normalize to unit rotations',()=>{
 for(const magnitude of [Number.MIN_VALUE,Number.MAX_VALUE]){
  const sampler=createPoseSampler({id:'extreme',duration:1,tracks:[{joint:'root',keys:[{at:0,position:[0,0,0],rotation:[magnitude,magnitude,0,0]}]}]});
  const rotation=sampler.sample(0)[0].rotation;assert.ok(rotation.every(Number.isFinite));assert.ok(Math.abs(Math.hypot(...rotation)-1)<1e-14);
 }
});
