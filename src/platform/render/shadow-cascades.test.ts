import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {CASCADE_MAP_SIZE,cascadeShadows,directionalBlock,installCascadeChunks} from './shadow-cascades';
import {scheduleShadows,type ShadowTechnique} from './shadows';

type Knob='ultra'|'high'|'medium'|'low'|'off';
const ORIGINAL_LIGHTS=T.ShaderChunk.lights_fragment_begin,ORIGINAL_PARS=T.ShaderChunk.shadowmap_pars_fragment;

function scene(technique:ShadowTechnique='reference'){
 let knob:Knob='ultra';const quality={knob:(()=>knob) as never};
 const shadowMap={enabled:true,type:T.PCFShadowMap as T.ShadowMapType,autoUpdate:true,needsUpdate:false,render(_l:T.Light[]){}};
 const renderer={shadowMap,domElement:{width:800,height:600},toneMapping:T.ACESFilmicToneMapping,toneMappingExposure:1,dispose(){}} as unknown as T.WebGLRenderer;
 const scheduler=scheduleShadows(renderer,{technique,quality});
 const scene=new T.Scene(),camera=new T.PerspectiveCamera(50,1.6,.1,200);camera.position.set(0,6,14);camera.lookAt(0,0,0);scene.add(camera);
 const sun=new T.DirectionalLight('#fff0d6',3);sun.position.set(-7,16,9);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);
 Object.assign(sun.shadow.camera,{left:-13,right:13,top:13,bottom:-13,near:.5,far:80});sun.shadow.bias=-.00015;sun.shadow.normalBias=.035;scene.add(sun,sun.target);
 const box=new T.Mesh(new T.BoxGeometry(),new T.MeshStandardMaterial());box.castShadow=true;scene.add(box);
 const rig=technique==='reference'?cascadeShadows(renderer,scene,sun,{scheduler,quality}):null;
 /** One render: the scene hook (before lights are collected), then the shadow pass over visible shadow lights. */
 const frame=()=>{
  scene.updateMatrixWorld();camera.updateMatrixWorld();
  scene.onBeforeRender(renderer,scene,camera,null as never,null as never,null as never);
  const lights:T.DirectionalLight[]=[];scene.traverseVisible(o=>{const l=o as T.DirectionalLight;if(l.isLight&&l.castShadow){l.shadow.needsUpdate=false;lights.push(l);}});
  renderer.shadowMap.render(lights,scene,camera);
  return lights.filter(l=>l.shadow.needsUpdate).map(l=>l.name);
 };
 return {renderer,scene,camera,sun,box,rig,frame,setKnob:(k:Knob)=>{knob=k;}};
}

test('the chunks are patched once, gated, and keep three\'s directional block for every other program',()=>{
 const block=directionalBlock(ORIGINAL_LIGHTS);assert.ok(block,'the pinned three r186 directional block is found');
 assert.equal(installCascadeChunks(),true);assert.equal(installCascadeChunks(),true);
 const lights=T.ShaderChunk.lights_fragment_begin;
 assert.equal(lights.split(block.text).length-1,2,'the original block stays as the fallback branch and the #else branch');
 assert.ok(lights.includes('SHADOWMAP_TYPE_BASIC')&&lights.includes('NUM_DIR_LIGHT_SHADOWS == 3'),'compiled only for Basic maps with three directional shadows');
 assert.ok(T.ShaderChunk.shadowmap_pars_fragment.startsWith(ORIGINAL_PARS),'three\'s declarations are untouched');
 assert.equal(directionalBlock('not three'),null,'another engine text leaves the chunks alone');
});

test('on a Reference renderer at ultra, three 4096² cascades stand in for the sun',()=>{
 const {rig,sun,frame,renderer}=scene();assert.ok(rig);
 frame();
 assert.equal(rig.active,true);assert.equal(sun.visible,false,'the sun no longer lights: its cascades carry its light');
 assert.equal(sun.shadow.map,null,'the sun\'s own map is released');
 assert.equal(renderer.shadowMap.type,T.BasicShadowMap,'raw depth for the blocker search');
 assert.equal(rig.lights.length,3);
 for(const l of rig.lights){
  assert.equal(l.visible,true);assert.equal(l.intensity,sun.intensity);assert.ok(l.color.equals(sun.color));
  const map=l.shadow.map!;assert.equal(map.width,CASCADE_MAP_SIZE);assert.equal(map.depthTexture!.compareFunction,null);
  assert.equal(map.texture.format,T.RedFormat,'the colour attachment three requires is one byte a texel');
  // Every cascade shines the sun's way.
  const d=l.target.position.clone().sub(l.position).normalize(),s=sun.target.position.clone().sub(sun.position).normalize();assert.ok(d.dot(s)>.99999);
 }
 const widths=rig.lights.map(l=>l.shadow.camera.right-l.shadow.camera.left);assert.ok(widths[0]<widths[1]&&widths[1]<widths[2],'finer near the camera');
});

test('a still view redraws nothing; a small drift redraws nothing; a caster redraws every cascade',()=>{
 const {frame,camera,box}=scene();
 assert.equal(frame().length,3);
 assert.deepEqual(frame(),[]);assert.deepEqual(frame(),[]);
 camera.position.x+=.01;assert.deepEqual(frame(),[],'a drift inside the snapping grid moves no cascade');
 camera.fov+=.2;camera.updateProjectionMatrix();assert.deepEqual(frame(),[],'a field-of-view easing keeps the cascade sizes');
 box.position.x=1;assert.equal(frame().length,3);assert.deepEqual(frame(),[]);
 camera.position.x+=30;const moved=frame();assert.ok(moved.length>=1,'a long camera move shifts cascades');
 assert.deepEqual(frame(),[]);
});

test('below ultra, and when the player turns shadows off, the sun draws its own map as authored, live',()=>{
 const {rig,sun,frame,renderer,setKnob}=scene();frame();
 setKnob('high');frame();
 assert.equal(rig!.active,false);assert.equal(sun.visible,true);assert.equal(renderer.shadowMap.type,T.PCFShadowMap);
 for(const l of rig!.lights){assert.equal(l.visible,false);assert.equal(l.shadow.map,null,'cascade maps are released');}
 setKnob('ultra');frame();assert.equal(rig!.active,true);
 sun.castShadow=false;frame();assert.equal(rig!.active,false,'off: the light stops casting (liveShadowMap), so do its cascades');
 rig!.dispose();assert.equal(sun.visible,true);
});


test('referenceShadows loads the cascades on demand, then asks for the next frame; below ultra it loads nothing yet',async()=>{
 const {referenceShadows,shadowSchedulerOf}=await import('./shadows');
 let knob:Knob='high';const subs:(()=>void)[]=[];const quality={knob:(()=>knob) as never,subscribe:((f:()=>void)=>{subs.push(f);return ()=>{};}) as never};
 const shadowMap={enabled:true,type:T.PCFShadowMap as T.ShadowMapType,autoUpdate:true,needsUpdate:false,render(_l:T.Light[]){}};
 const renderer={shadowMap,domElement:{width:800,height:600},toneMapping:T.ACESFilmicToneMapping,toneMappingExposure:1,dispose(){}} as unknown as T.WebGLRenderer;
 scheduleShadows(renderer,{technique:'reference',quality});
 const scene=new T.Scene(),camera=new T.PerspectiveCamera(),sun=new T.DirectionalLight();sun.castShadow=true;scene.add(sun,sun.target,camera);
 const handle=referenceShadows(renderer,scene,sun,{quality});assert.ok(handle);
 const scheduler=shadowSchedulerOf(renderer)!;
 scene.onBeforeRender(renderer,scene,camera,null as never,null as never,null as never);
 assert.equal(sun.visible,true,'below ultra the sun draws its own map');
 knob='ultra';for(const f of subs)f();
 await new Promise(r=>setTimeout(r,50));
 assert.equal(scheduler.due(scene,camera),true,'loading the cascades makes the next frame due (an idle on-demand scene draws it)');
 scene.onBeforeRender(renderer,scene,camera,null as never,null as never,null as never);
 assert.equal(sun.visible,false,'the cascades stand in');
 handle!.dispose();assert.equal(sun.visible,true);
 // The pool records the technique at the lease and installs the scheduler later: the scene's call must not wait.
 const {setShadowTechnique}=await import('./shadow-technique');
 const leased={shadowMap:{...shadowMap},dispose(){}} as unknown as T.WebGLRenderer;setShadowTechnique(leased,'reference');
 const early=referenceShadows(leased,scene,sun,{quality});assert.ok(early,'a pooled renderer whose scheduler has not loaded yet still gets the Reference technique');early!.dispose();
 assert.equal(referenceShadows({shadowMap:{...shadowMap},dispose(){}} as unknown as T.WebGLRenderer,scene,sun),null,'staged areas and renderers outside the pool (no Reference scheduler) keep their authored map');
});
