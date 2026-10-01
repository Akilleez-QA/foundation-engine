import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {motionBounds,motionView} from './render-seen';

/** A 2 m arm on a 1 m post at (10, 0, 0), turning about the post. */
function turningArm(){
 const root=new T.Group();root.position.set(10,0,0);
 const arm=new T.Group();arm.position.y=1;root.add(arm);
 const bar=new T.Mesh(new T.BoxGeometry(2,.1,.1));bar.position.x=1;arm.add(bar);
 return {root,arm,bar};
}

test('motionBounds holds a turning part at every angle, and its shadow', () => {
 const {root,arm,bar}=turningArm(),bounds=motionBounds([root],root.position);
 for(let a=0;a<Math.PI*2;a+=.1){
  arm.rotation.y=a;root.updateMatrixWorld(true);
  const box=new T.Box3().setFromObject(bar);
  for(const x of [box.min.x,box.max.x])for(const z of [box.min.z,box.max.z])assert.ok(bounds.containsPoint(new T.Vector3(x,box.max.y,z)),`angle ${a.toFixed(1)}`);
 }
 // The outdoor sun is about 55° high: a shadow never falls further from its caster than the caster is tall.
 assert.ok(bounds.radius>=Math.hypot(2,1.05)+1.05);
 const fresh=turningArm().root;assert.equal(motionBounds([fresh],fresh.position,.5).radius,bounds.radius+.5);
});

test('motionView sees what is in front of this frame\'s view, and nothing hidden', () => {
 const {root,bar}=turningArm(),bounds=motionBounds([root],root.position),view=motionView();
 const camera=new T.PerspectiveCamera(50,1,.1,40);camera.position.set(10,3,8);camera.lookAt(10,0,0);camera.updateMatrixWorld();
 view.look(camera);assert.equal(view.sees(bounds,bar),true);
 root.visible=false;assert.equal(view.sees(bounds,bar),false,'a hidden ancestor hides it');root.visible=true;
 // Turned away, and beyond the far clip: not seen.
 camera.lookAt(10,0,20);camera.updateMatrixWorld();view.look(camera);assert.equal(view.sees(bounds),false);
 camera.position.set(10,3,80);camera.lookAt(10,0,0);camera.updateMatrixWorld();view.look(camera);assert.equal(view.sees(bounds),false);
 // An orthographic Map view straight down.
 const map=new T.OrthographicCamera(-5,5,5,-5,.1,100);map.position.set(0,30,0);map.lookAt(0,0,0);map.updateMatrixWorld();
 view.look(map);assert.equal(view.sees(bounds),false,'the arm is outside the Map frame');
 map.position.set(8,30,0);map.lookAt(8,0,0);map.updateMatrixWorld();view.look(map);assert.equal(view.sees(bounds),true);
});
