import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {createRenderOnChange,stillSafeHook} from './render-on-change';
import {must} from '../../testing/must';
const renderer={domElement:{width:800,height:600},toneMapping:T.NoToneMapping,toneMappingExposure:1} as unknown as T.WebGLRenderer;
function viewer(){
 const scene=new T.Scene(),camera=new T.PerspectiveCamera(50,4/3,.1,50);camera.position.set(0,2,6);camera.lookAt(0,0,0);
 const material=new T.MeshStandardMaterial({color:'#88aacc'}),puck=new T.Mesh(new T.CylinderGeometry(.3,.3,.1),material),light=new T.DirectionalLight('#ffffff',2);
 scene.add(puck,light);return {scene,camera,material,puck,light,frames:createRenderOnChange()};
}
/** A change draws at once; the picture then settles within a couple of frames (a rescan after a camera move, one coasting frame) and stays still. */
const settles=(changed:()=>boolean)=>{let draws=0;while(changed())if(++draws>3)return false;return !changed()&&!changed();};
test('a still viewer draws once, then only when something visible changes',()=>{
 const {scene,camera,material,puck,light,frames}=viewer(),changed=()=>frames.changed(renderer,[scene,camera]);
 assert.equal(changed(),true);assert.ok(settles(changed));
 const checks:[string,()=>void][]=[
  ['puck moves',()=>{puck.position.x+=.01;}],['camera turns',()=>{camera.rotation.y+=.01;}],['zoom',()=>{camera.fov=40;camera.updateProjectionMatrix();}],
  ['colour',()=>material.color.set('#ff0000')],['opacity',()=>{material.opacity=.5;}],['emissive',()=>material.emissive.setRGB(.2,0,0)],['roughness',()=>{material.roughness=.2;}],
  ['texture upload',()=>{material.map=new T.CanvasTexture({width:4,height:4} as unknown as HTMLCanvasElement);}],['texture redraw',()=>{material.map!.needsUpdate=true;}],
  ['scrolling texture',()=>{material.map!.offset.x=.25;}],['hidden',()=>{puck.visible=false;}],['shown',()=>{puck.visible=true;}],
  ['deformed',()=>{puck.geometry.getAttribute('position').needsUpdate=true;}],['light dims',()=>{light.intensity=1;}],['background',()=>{scene.background=new T.Color('#102030');}],
  ['canvas resized',()=>{(renderer.domElement as {width:number}).width=801;}],['added',()=>{scene.add(new T.Mesh(new T.BoxGeometry(),material));}],
 ];
 for(const [name,change] of checks){change();assert.equal(changed(),true,name);assert.ok(settles(changed),name+' settles');}
 frames.invalidate();assert.equal(changed(),true);
});
test('three bumping a two-pass transparent material each draw is not a change',()=>{
 const {scene,camera,frames}=viewer(),changed=()=>frames.changed(renderer,[scene,camera]);
 const glass=new T.MeshBasicMaterial({transparent:true,side:T.DoubleSide});scene.add(new T.Mesh(new T.PlaneGeometry(),glass));changed();assert.ok(settles(changed));
 glass.needsUpdate=true;assert.equal(changed(),false);glass.opacity=.3;assert.equal(changed(),true);
});
test('shader time uniforms count as changes; unknown per-frame hooks always redraw',()=>{
 const {scene,camera,frames}=viewer(),changed=()=>frames.changed(renderer,[scene,camera]);
 const glow=new T.ShaderMaterial({uniforms:{uTime:{value:0}}});scene.add(new T.Mesh(new T.PlaneGeometry(),glow));changed();assert.ok(settles(changed));
 must(glow.uniforms.uTime).value=.1;assert.equal(changed(),true);assert.ok(settles(changed));
 const holo=new T.MeshBasicMaterial();holo.onBeforeRender=()=>{};const sign=new T.Mesh(new T.PlaneGeometry(),holo);scene.add(sign);
 for(let i=0;i<5;i++)assert.equal(changed(),true);sign.visible=false;assert.ok(settles(changed));
 const safe=new T.Mesh(new T.PlaneGeometry(),new T.MeshBasicMaterial());safe.onBeforeRender=stillSafeHook(()=>{});scene.add(safe);changed();assert.ok(settles(changed));
});
test('every pass of a two-view frame is compared',()=>{
 const {scene,camera,frames}=viewer(),face=new T.PerspectiveCamera(30,1,.1,10),changed=()=>frames.changed(renderer,[scene,camera],[scene,face]);
 changed();assert.ok(settles(changed));face.position.z=2;assert.equal(changed(),true);assert.ok(settles(changed));
});
test('after a long still spell a change still draws within two frames',()=>{
 const {scene,camera,puck,frames}=viewer(),changed=()=>frames.changed(renderer,[scene,camera]);
 changed();for(let i=0;i<40;i++)changed();puck.position.y=1;assert.equal(changed()||changed(),true);
});
