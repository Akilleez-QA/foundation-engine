import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {defineEnvironment} from './environment';
import {bindEnvironment} from './scene-environment';
const state=()=>defineEnvironment({background:0,ambient:{sky:0xffffff,ground:0,intensity:1},directional:{color:0xffffff,intensity:2,position:[1,2,3]},haze:null,points:[{direction:[0,0,-1],color:0xffffff}],pointSize:2});
test('environment translation follows its own camera without changing landmarks or another view',()=>{
 const a=new T.Scene(),b=new T.Scene(),aa=bindEnvironment(a),bb=bindEnvironment(b),ca=new T.PerspectiveCamera(),cb=new T.PerspectiveCamera();const s=state();
 aa.sync(s,ca);bb.sync(s,cb);const p=a.children.find(x=>x instanceof T.Points) as T.Points;
 const geometry=p.geometry;ca.position.set(7,3,9);assert.equal(aa.sync(s,ca),false);assert.deepEqual(p.position.toArray(),[7,3,9]);
 assert.deepEqual(b.children.find(x=>x instanceof T.Points)!.position.toArray(),[0,0,0]);assert.equal(p.geometry,geometry);
 assert.deepEqual(Array.from(geometry.getAttribute('position').array),[0,0,-100]);assert.equal((p.material as T.PointsMaterial).depthWrite,false);
 let disposed=0;geometry.addEventListener('dispose',()=>disposed++);aa.dispose();aa.dispose();assert.equal(disposed,1);assert.equal(a.children.length,0);bb.dispose();
});
test('environment validates boundaries and detaches authored data',()=>{const s=state(),copy=defineEnvironment(s);s.points[0].direction[0]=1;assert.equal(copy.points[0].direction[0],0);assert.throws(()=>defineEnvironment({...s,haze:{color:0,near:10,far:5}}));assert.throws(()=>defineEnvironment({...s,points:[{direction:[0,0,0],color:0}]}));});
test('environment retires changed GPU buffers and restores only its own scene state',()=>{
 const scene=new T.Scene(),original=new T.Color(0x123456);scene.background=original;const b=bindEnvironment(scene),camera=new T.PerspectiveCamera(),s=state();b.sync(s,camera);
 const points=scene.children.find(x=>x instanceof T.Points) as T.Points,geometry=points.geometry;let freed=0;geometry.addEventListener('dispose',()=>freed++);
 b.sync({...s,points:[...s.points,{direction:[1,0,0],color:0xffffff}]},camera);assert.equal(freed,1);assert.notEqual(points.geometry,geometry);
 const owned=points.geometry;let retired=0;owned.addEventListener('dispose',()=>retired++);b.dispose();assert.equal(retired,1);assert.equal(scene.background,original);
});
test('environment follows parented camera world position and rejects normalization overflow',()=>{
 const scene=new T.Scene(),binding=bindEnvironment(scene),parent=new T.Object3D(),camera=new T.PerspectiveCamera();parent.position.set(10,0,0);parent.add(camera);camera.position.set(2,0,0);binding.sync(state(),camera);
 assert.equal(scene.children.find(x=>x instanceof T.Points)!.position.x,12);
 assert.throws(()=>defineEnvironment({...state(),points:[{direction:[Number.MAX_VALUE,Number.MAX_VALUE,0],color:0}]}));binding.dispose();
});
