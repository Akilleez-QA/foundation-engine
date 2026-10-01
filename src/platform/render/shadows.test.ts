import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {onDemandFrames,scheduleShadows,shadowSchedulerOf,shadowTechniqueOf,throttleShadow} from './shadows';
import {setShadowTechnique} from './shadow-technique';

type Knob='ultra'|'high'|'medium'|'low'|'off';
/** A renderer as far as the scheduler sees one: its shadow map's `render`, called by three after updateMatrixWorld. */
function fakeRenderer(){
 const drawn:boolean[]=[];
 const shadowMap={enabled:true,type:T.PCFShadowMap,render(lights:T.Light[]){for(const l of lights as T.DirectionalLight[])drawn.push(l.shadow.autoUpdate||l.shadow.needsUpdate);}};
 let disposed=0;
 const domElement=Object.assign(new EventTarget(),{width:800,height:600});
 const renderer={shadowMap,domElement,toneMapping:T.ACESFilmicToneMapping,toneMappingExposure:1,dispose(){disposed++;}} as unknown as T.WebGLRenderer;
 return {renderer,drawn,disposed:()=>disposed};
}
/** One render as three runs it: world matrices, then the shadow pass over the visible shadow lights. */
const render=(renderer:T.WebGLRenderer,scene:T.Scene,camera:T.Camera)=>{
 scene.updateMatrixWorld();const lights:T.Light[]=[];
 scene.traverseVisible(o=>{const l=o as T.DirectionalLight;if(l.isLight&&l.castShadow){l.shadow.needsUpdate=false;lights.push(l);}});
 renderer.shadowMap.render(lights,scene,camera);
 return (lights as T.DirectionalLight[]).some(l=>l.shadow.needsUpdate);
};
function fixture(knob:Knob='ultra',clock=()=>0){
 const scene=new T.Scene(),camera=new T.PerspectiveCamera(),sun=new T.DirectionalLight();sun.castShadow=true;scene.add(sun,sun.target,camera);
 const caster=new T.Mesh(new T.BoxGeometry(),new T.MeshStandardMaterial());caster.castShadow=true;
 const floor=new T.Mesh(new T.PlaneGeometry(),new T.MeshStandardMaterial());floor.receiveShadow=true;
 const crowd=new T.InstancedMesh(new T.BoxGeometry(),new T.MeshStandardMaterial(),4);crowd.castShadow=true;
 scene.add(caster,floor,crowd);
 const fake=fakeRenderer(),shadows=scheduleShadows(fake.renderer,{quality:{knob:(()=>knob) as never},clock});
 return {scene,camera,sun,caster,floor,crowd,shadows,...fake,frame:()=>render(fake.renderer,scene,camera)};
}

test('a still scene draws its shadow map once, then only when a caster or the light changes',()=>{
 const {scene,sun,caster,floor,crowd,shadows,frame}=fixture();
 assert.equal(frame(),true);assert.equal(sun.shadow.autoUpdate,false);
 assert.equal(frame(),false);assert.equal(frame(),false);
 floor.position.x=3;assert.equal(frame(),false,'receivers alone do not redraw the depth map');
 caster.position.x=1;assert.equal(frame(),true);assert.equal(frame(),false);
 caster.rotation.y=.5;assert.equal(frame(),true);
 caster.visible=false;assert.equal(frame(),true);caster.visible=true;assert.equal(frame(),true);
 (caster.material as T.Material).visible=false;assert.equal(frame(),true);(caster.material as T.Material).visible=true;frame();
 caster.geometry.attributes.position.needsUpdate=true;assert.equal(frame(),true,'deformed geometry');
 crowd.setMatrixAt(1,new T.Matrix4().makeTranslation(2,0,0));crowd.instanceMatrix.needsUpdate=true;assert.equal(frame(),true);
 crowd.count=2;assert.equal(frame(),true);
 sun.position.set(4,9,1);assert.equal(frame(),true);sun.target.position.x=2;assert.equal(frame(),true);
 sun.shadow.mapSize.set(1024,1024);assert.equal(frame(),true,'a resized map (the Graphics screen) redraws');
 const late=new T.Mesh(new T.SphereGeometry(),new T.MeshStandardMaterial());late.castShadow=true;scene.add(late);assert.equal(frame(),true);
 late.castShadow=false;assert.equal(frame(),true);assert.equal(frame(),false);
 shadows.invalidate(scene);assert.equal(frame(),true);
 assert.deepEqual(shadows.stats,{checks:21,updates:16,forced:0});
});

test('no mesh type forces a redraw: a posed, still skinned caster draws its map once (ADR 0055, 0056)',()=>{
 const {scene,frame}=fixture();
 const bones=[new T.Bone(),new T.Bone()];bones[0].add(bones[1]);scene.add(bones[0]);
 const rig=new T.SkinnedMesh(new T.BoxGeometry(),new T.MeshStandardMaterial());rig.castShadow=true;scene.add(rig);scene.updateMatrixWorld(true);rig.bind(new T.Skeleton(bones));
 assert.equal(frame(),true);assert.equal(frame(),false);assert.equal(frame(),false);
 bones[1].rotation.z=.4;assert.equal(frame(),true,'a new pose redraws');assert.equal(frame(),false);
});

test('an input the tracker cannot observe redraws every frame (unknown means changed)',()=>{
 const {caster,shadows,frame}=fixture();
 caster.onBeforeShadow=()=>{};
 assert.equal(frame(),true);assert.equal(frame(),true);assert.ok(shadows.stats.forced>=2);
});

test('installed once per renderer, and ended with the renderer',()=>{
 const {renderer,shadows,disposed,scene,camera}=fixture();
 assert.equal(scheduleShadows(renderer),shadows);assert.equal(shadowSchedulerOf(renderer),shadows);
 renderer.dispose();assert.equal(disposed(),1);assert.equal(shadowSchedulerOf(renderer),undefined);
 // Back to three's own per-frame update: the scheduler no longer touches the lights.
 const sun=scene.children.find(o=>(o as T.DirectionalLight).isDirectionalLight) as T.DirectionalLight;sun.shadow.autoUpdate=true;
 render(renderer,scene,camera);assert.equal(sun.shadow.autoUpdate,true);
});

test('on Reference a throttled caster redraws at once (STD-REN-14)',()=>{
 let now=0;const {scene,frame}=fixture('ultra',()=>now);
 const bug=throttleShadow(new T.Group(),.1),leg=new T.Mesh(new T.BoxGeometry(),new T.MeshStandardMaterial());leg.castShadow=true;bug.add(leg);scene.add(bug);
 frame();const step=(dt:number)=>{now+=dt;bug.position.x+=.01;return frame();};
 assert.deepEqual([step(.03),step(.03),step(.03)],[true,true,true]);
});

test('below Reference throttled casters redraw at their own interval, other changes at once',()=>{
 let now=0;const {scene,caster,shadows,frame}=fixture('high',()=>now);
 const bug=throttleShadow(new T.Group(),.1),leg=new T.Mesh(new T.BoxGeometry(),new T.MeshStandardMaterial());leg.castShadow=true;bug.add(leg);scene.add(bug);
 assert.equal(frame(),true);
 const step=(dt:number)=>{now+=dt;bug.position.x+=.01;leg.rotation.y+=.2;return frame();};
 assert.deepEqual([step(.03),step(.03),step(.03),step(.03)],[false,false,false,true],'wandering waits 0.1 s');
 assert.equal(step(.01),false);now+=.001;caster.position.x=4;assert.equal(frame(),true,'the player moving redraws immediately');
 assert.equal(frame(),false);bug.visible=false;assert.equal(frame(),true,'a hidden bug redraws immediately');
 bug.visible=true;assert.equal(frame(),true);now+=5;assert.equal(frame(),false,'a resting bug never redraws');
 bug.removeFromParent();assert.equal(frame(),true,'a bug leaving the scene redraws immediately');
 assert.equal(shadows.stats.updates,6);
});

test('an on-demand scene presents a frame when either tracker is due, and the render reuses the shadow verdict',()=>{
 const {renderer,scene,camera,caster,shadows}=fixture();
 const frames=onDemandFrames(),present=()=>{const due=frames.changed(renderer,[scene,camera]);if(due)render(renderer,scene,camera);return due;};
 // The first render turns the lights' own per-frame update off, which the colour tracker reads: one settling frame.
 assert.equal(present(),true);present();assert.equal(present(),false);assert.equal(present(),false);
 caster.position.x=2;assert.equal(present(),true);assert.equal(present(),false);
 const checks=shadows.stats.checks;caster.onBeforeShadow=()=>{};
 assert.equal(present(),true,'a shadow hook is invisible to the colour tracker and forces a frame');
 assert.equal(shadows.stats.checks,checks+1,'the render reused the verdict instead of scanning again');
});

test('a scene with no shadow light never asks for a frame through the shadow tracker',()=>{
 const scene=new T.Scene(),camera=new T.PerspectiveCamera(),box=new T.Mesh(new T.BoxGeometry(),new T.MeshStandardMaterial());box.castShadow=true;scene.add(box);
 const {renderer}=fakeRenderer();const frames=onDemandFrames(),present=()=>{const due=frames.changed(renderer,[scene,camera]);if(due)render(renderer,scene,camera);return due;};
 assert.equal(present(),true);assert.equal(present(),false);assert.equal(present(),false);
});

test('a restored context redraws every map and presents the next frame (ADR 0037; STD-REN-17)',()=>{
 const {renderer,scene,camera,frame}=fixture();
 const frames=onDemandFrames(),present=()=>{const due=frames.changed(renderer,[scene,camera]);if(due)render(renderer,scene,camera);return due;};
 present();present();assert.equal(present(),false);assert.equal(frame(),false);
 renderer.domElement.dispatchEvent(new Event('webglcontextrestored'));
 assert.equal(present(),true,'the lost picture is drawn again');
 renderer.domElement.dispatchEvent(new Event('webglcontextrestored'));assert.equal(frame(),true,'the lost maps are redrawn');
});

test('the technique the pool recorded at the lease is the one the scheduler installs with',()=>{
 const a=fakeRenderer().renderer,b=fakeRenderer().renderer;setShadowTechnique(a,'reference');
 scheduleShadows(a);scheduleShadows(b);assert.equal(shadowTechniqueOf(a),'reference');assert.equal(shadowTechniqueOf(b),'authored');
});

test('nothing of a lease stays on the pooled canvas after its renderer is disposed',()=>{
 const {renderer}=fixture();let heard=0;
 const scheduler=shadowSchedulerOf(renderer)!;scheduler.onRestored(()=>{heard++;});
 renderer.domElement.dispatchEvent(new Event('webglcontextrestored'));assert.equal(heard,1);
 renderer.dispose();renderer.domElement.dispatchEvent(new Event('webglcontextrestored'));assert.equal(heard,1,'the listener ended with the renderer');
});

test('a newly installed after-shadow hook wakes the first frame after idle',()=>{
 const {renderer,scene,camera,caster,frame}=fixture('high');const frames=onDemandFrames();
 frames.changed(renderer,[scene,camera]);frame();
 for(let i=0;i<120;i++){frames.changed(renderer,[scene,camera]);frame();}
 caster.onAfterShadow=()=>{};
 assert.equal(frames.changed(renderer,[scene,camera]),true,'depth-only unknown input wakes colour presentation');
 assert.equal(frame(),true);
});

test('r183 context restoration replaces shadowMap: existing scheduler rebinds before first presentation',()=>{
 const {renderer,scene,camera,shadows,frame}=fixture('high');frame();
 const old=renderer.shadowMap;let calls=0;
 renderer.shadowMap={...old,render(lights:T.Light[]){calls++;assert.ok(lights.every(l=>(l as T.DirectionalLight).shadow.needsUpdate));}};
 renderer.domElement.dispatchEvent(new Event('webglcontextrestored'));
 assert.equal(shadowSchedulerOf(renderer),shadows);assert.equal(scheduleShadows(renderer),shadows);
 render(renderer,scene,camera);assert.equal(calls,1);renderer.dispose();assert.equal(shadowSchedulerOf(renderer),undefined);
});
