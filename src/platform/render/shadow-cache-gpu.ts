import * as T from 'three';
import {staticShadowPolicyOf,type StaticShadowPolicy} from './shadow-cache-policy';
import {isReferenceShadowLight} from './shadow-technique';
import {createShadowCache, type ShadowLight, type ShadowPlan} from './shadow-cache';

/** r183 WebGLShadowMap adapter. Uses the stock depth pass (including material variants,
 * groups, culling and skinning) for both layers. No engine-private framebuffer access.
 * The temporary caster flags and composite belong only to this synchronous shadow pass;
 * the scene graph seen by the colour pass is restored even when a depth hook throws.
 *
 * Production adoption is an art-owned policy backed by a 4K pixel
 * sequence. An explicit predicate is reserved for candidate verification; it must
 * never turn an arbitrary light type into blanket production approval.
 */
export interface ShadowGPUOptions {
 approved?:(scene:T.Scene, light:ShadowLight, camera:T.Camera)=>boolean;
}
export type ShadowPass=(lights:T.Light[],scene:T.Scene,camera:T.Camera)=>void;
export function createShadowGPUCache(renderer:T.WebGLRenderer, options:ShadowGPUOptions={}) {
 const cache=createShadowCache({supports:()=>true}),adopted=new WeakMap<T.Scene,StaticShadowPolicy>(),policyReleases=new Map<StaticShadowPolicy,()=>void>();
 const targets=new Map<ShadowLight,T.WebGLRenderTarget>(),owners=new Map<ShadowLight,T.Scene>();
 const stats={staticRebuildDraws:0,dynamicDraws:0,compositeDraws:0,fullDraws:0,failures:0};
 let composite:T.Mesh<T.BufferGeometry,T.ShaderMaterial>|null=null;
 let lost=false,disposed=false,failed=false,restoredPass=false,lastType=renderer.shadowMap.type;
 const release=(light:ShadowLight)=>{const t=targets.get(light);if(t){if(composite?.material.uniforms.staticDepth.value===t.depthTexture)composite.material.uniforms.staticDepth.value=null;t.dispose();targets.delete(light);owners.delete(light);}cache.invalidate();};
 const releaseAll=()=>{if(composite)composite.material.uniforms.staticDepth.value=null;for(const t of targets.values())t.dispose();targets.clear();owners.clear();cache.invalidate();};
 const getComposite=()=>{
  if(composite)return composite;
  const geometry=new T.BufferGeometry();
  geometry.setAttribute('position',new T.Float32BufferAttribute([-1,-1,0,3,-1,0,-1,3,0],3));
  const material=new T.ShaderMaterial({
   uniforms:{staticDepth:{value:null}},side:T.DoubleSide,shadowSide:T.DoubleSide,depthFunc:T.AlwaysDepth,blending:T.NoBlending,
   vertexShader:'void main(){gl_Position=vec4(position.xy,0.,1.);}',
   fragmentShader:'uniform sampler2D staticDepth; void main(){gl_FragDepth=texelFetch(staticDepth,ivec2(gl_FragCoord.xy),0).r;gl_FragColor=vec4(1.);}',
  });
  composite=new T.Mesh(geometry,material);composite.customDepthMaterial=material;
  composite.castShadow=true;composite.frustumCulled=false;
  return composite;
 };
 const supported=(scene:T.Scene,light:ShadowLight,camera:T.Camera)=>{
  const policy=staticShadowPolicyOf(scene);
  if(renderer.shadowMap.enabled===false||(!options.approved&&!policy)||disposed||lost||failed||T.REVISION!=='183'||!(light as T.DirectionalLight).isDirectionalLight)return false;
  if(renderer.shadowMap.type!==T.PCFShadowMap&&renderer.shadowMap.type!==T.BasicShadowMap)return false;
  if(renderer.capabilities.reversedDepthBuffer||renderer.capabilities.logarithmicDepthBuffer||renderer.localClippingEnabled||renderer.clippingPlanes.length)return false;
  if(light.shadow.getViewportCount()!==1||light.shadow.getFrameExtents().x!==1||light.shadow.getFrameExtents().y!==1)return false;
  if(light.shadow.mapSize.x>renderer.capabilities.maxTextureSize||light.shadow.mapSize.y>renderer.capabilities.maxTextureSize)return false;
  const target=light.shadow.map;
  if(target&&(target.samples!==0||target.depthTexture?.type!==T.UnsignedIntType||target.depthTexture.format!==T.DepthFormat))return false;
  // Arbitrary depth hooks can mutate other casters during the pass, outside the key.
  // Custom depth programs can use order-dependent depth tests or side effects.
  // Demotion alone is insufficient: compositing moves all static depth before them.
  let hooks=false;scene.traverse(o=>{const caster=o as T.Mesh;if(o.castShadow&&(caster.customDepthMaterial||caster.customDistanceMaterial||o.onBeforeShadow!==T.Object3D.prototype.onBeforeShadow||o.onAfterShadow!==T.Object3D.prototype.onAfterShadow))hooks=true;});
  if(hooks)return false;
  if(options.approved){try{return options.approved(scene,light,camera)===true;}catch{return false;}}
  return !!policy&&(renderer.shadowMap.type===T.PCFShadowMap||isReferenceShadowLight(light));
 };
 const draw=(pass:ShadowPass,scene:T.Scene,camera:T.Camera,light:ShadowLight,kind:'full'|'static'|'composite'='full')=>{
  // Stock render clears both flags. Each subpass must explicitly request its map.
  renderer.shadowMap.needsUpdate=true;light.shadow.needsUpdate=true;
  const before=renderer.info.render.calls;
  try{pass([light],scene,camera);}finally{
   const calls=renderer.info.render.calls-before;
   if(kind==='full')stats.fullDraws+=calls;
   else if(kind==='static')stats.staticRebuildDraws+=calls;
   else {stats.compositeDraws+=Math.min(1,calls);stats.dynamicDraws+=Math.max(0,calls-1);}
  }
 };
 const split=(pass:ShadowPass,scene:T.Scene,camera:T.Camera,plan:ShadowPlan)=>{
  const light=plan.light,shadow=light.shadow,final=shadow.map;
  const output=renderer.getRenderTarget(),face=renderer.getActiveCubeFace(),mip=renderer.getActiveMipmapLevel();
  const flags=new Map<T.Object3D,boolean>();
  scene.traverse(o=>{if(o.castShadow&&((o as T.Mesh).isMesh||(o as T.Line).isLine||(o as T.Points).isPoints))flags.set(o,true);});
  let quad:T.Mesh|null=null;
  const debug=renderer.debug,check=debug?.checkShaderErrors,onError=debug?.onShaderError;
  if(debug){debug.checkShaderErrors=true;debug.onShaderError=(...args)=>{onError?.(...args);throw new Error('shadow shader compilation failed');};}
  try{
   owners.set(light,scene);
   let target=targets.get(light);
   if(!target||target.width!==shadow.mapSize.x||target.height!==shadow.mapSize.y){
    target?.dispose();target=new T.WebGLRenderTarget(shadow.mapSize.x,shadow.mapSize.y,{minFilter:T.NearestFilter,magFilter:T.NearestFilter,generateMipmaps:false});
    target.depthTexture=new T.DepthTexture(target.width,target.height,T.UnsignedIntType);
    target.depthTexture.compareFunction=null;target.depthTexture.minFilter=target.depthTexture.magFilter=T.NearestFilter;
    targets.set(light,target);owners.set(light,scene);
   }
   if(plan.path==='rebuild'){
    const statics=new Set(plan.staticCasters);for(const o of flags.keys())o.castShadow=statics.has(o);
    shadow.map=target;
    draw(pass,scene,camera,light,'static');
    if(renderer.getContext().isContextLost()||!cache.commit(plan))throw new Error('static generation was not committed');
   }
   shadow.map=final;
   if(cache.pathForPresent(plan)!=='composite')throw new Error('stale static generation');
   const movers=new Set(plan.movingCasters);for(const o of flags.keys())o.castShadow=movers.has(o);
   quad=getComposite();quad.layers.mask=camera.layers.mask;
   (quad.material as T.ShaderMaterial).uniforms.staticDepth.value=target.depthTexture;
   // Only the shadow traversal sees this first child. The colour render list already exists.
   scene.children.unshift(quad);quad.parent=scene;
   draw(pass,scene,camera,light,'composite');
   if(renderer.getContext().isContextLost()||cache.pathForPresent(plan)!=='composite')throw new Error('generation invalidated during composite');
  }finally{
   if(debug){debug.checkShaderErrors=check!;debug.onShaderError=onError!;}
   // On success the stock pass may have allocated the final map. Do not replace it with null.
   if(shadow.map===targets.get(light))shadow.map=final;
   if(quad){const i=scene.children.indexOf(quad);if(i!==-1)scene.children.splice(i,1);quad.parent=null;}
   for(const [o,flag] of flags)o.castShadow=flag;
   renderer.setRenderTarget(output,face,mip);
  }
 };
 return {
  stats,cache,
  declareStatic(...objects:T.Object3D[]){cache.declareStatic(...objects);},
  demote(...objects:T.Object3D[]){cache.demote(...objects);},
  invalidate(){cache.invalidate();},
  /** Stock maps are owned by three; this ledger counts every extra allocation, valid or not:
   * RGBA8 colour + uint32 depth = 8 bytes/texel, plus the private triangle's 36-byte buffer. */
  residentBytes(){let bytes=composite?36:0;for(const t of targets.values())bytes+=t.width*t.height*8;return bytes;},
  release(light:ShadowLight){release(light);},
  contextLost(){
   lost=true;cache.contextLost();
   // r183 may dispose final attachments on its restored PCF -> Basic transition.
   // Release them while the old context is lost, so its retained dispose callbacks
   // never delete old-context handles after restoration. Stock/CSM recreates them.
   for(const light of targets.keys()){light.shadow.map?.dispose();light.shadow.map=null;}
   releaseAll();
  },
  contextRestored(){lost=false;failed=false;restoredPass=true;cache.contextRestored();releaseAll();},
  render(pass:ShadowPass,lights:T.Light[],scene:T.Scene,camera:T.Camera){
   const policy=staticShadowPolicyOf(scene),previous=adopted.get(scene);
   if(policy!==previous){
    if(previous){cache.demote(...previous.casters);policyReleases.get(previous)?.();policyReleases.delete(previous);}
    if(policy){
     cache.declareStatic(...policy.casters);adopted.set(scene,policy);
     policyReleases.set(policy,policy.onDispose(()=>{
      if(adopted.get(scene)===policy){adopted.delete(scene);cache.demote(...policy.casters);for(const light of targets.keys())if(owners.get(light)===scene)release(light);}
      policyReleases.get(policy)?.();policyReleases.delete(policy);
     }));
    }else adopted.delete(scene);
    cache.invalidate();
   }
   const typeChanged=lastType!==renderer.shadowMap.type;
   if(typeChanged){releaseAll();if(lights.length)lastType=renderer.shadowMap.type;renderer.shadowMap.needsUpdate=true;for(const l of lights){const light=l as ShadowLight;if(light.shadow)light.shadow.needsUpdate=true;}}
   // A pooled renderer may now serve another private scene. Retain no previous light/scene.
   const live=new Set(lights);for(const light of targets.keys())if(owners.get(light)===scene&&!live.has(light))release(light);
   // Keep the conventional multi-light call untouched when no guarded candidate exists.
   const candidates=new Set(lights.filter(l=>{const light=l as ShadowLight;return light.shadow&&supported(scene,light,camera);}));
   if(!candidates.size||typeChanged){for(const light of targets.keys())if(owners.get(light)===scene)release(light);const before=renderer.info?.render?.calls??0;pass(lights,scene,camera);stats.fullDraws+=(renderer.info?.render?.calls??before)-before;if(lights.length)restoredPass=false;return;}
   // The restored r183 engine starts its internal filter state at PCF. Initialise
   // it on the real shadow lights, never on an empty background pass, before
   // handing it a private static target (a filter transition replaces targets).
   if(restoredPass&&lights.length){
    renderer.shadowMap.needsUpdate=true;for(const l of lights){const light=l as ShadowLight;if(light.shadow)light.shadow.needsUpdate=true;}
    const before=renderer.info?.render?.calls??0;pass(lights,scene,camera);stats.fullDraws+=(renderer.info?.render?.calls??before)-before;
    restoredPass=false;for(const l of lights){const light=l as ShadowLight;if(light.shadow)light.shadow.needsUpdate=true;}
   }
   for(const l of lights){
    const light=l as ShadowLight;if(!light.shadow||!light.shadow.autoUpdate&&!light.shadow.needsUpdate)continue;
    if(failed||!candidates.has(light)){if(targets.has(light))release(light);draw(pass,scene,camera,light);continue;}
    // Let stock three initialise its final attachment and internal filter mode first.
    // Bootstrap once, then prepare the composite in this same pre-activation frame.
    if(!light.shadow.map)draw(pass,scene,camera,light);
    if(!light.shadow.map)continue;
    if(light.shadow.map.width!==light.shadow.mapSize.x||light.shadow.map.height!==light.shadow.mapSize.y)light.shadow.map.setSize(light.shadow.mapSize.x,light.shadow.mapSize.y);
    // Projection/view must be current BEFORE the key is captured, not one frame later.
    light.shadow.updateMatrices(light);
    const plan=cache.plan(scene,light,{cameraLayers:camera.layers.mask,shadowType:renderer.shadowMap.type});
    if(plan.path==='full'){if(targets.has(light))release(light);draw(pass,scene,camera,light);continue;}
    try{split(pass,scene,camera,plan);}catch{
     cache.fail(plan);stats.failures++;failed=true;releaseAll();
     // A failed shader may remain cached by three. Never retry it silently on another
     // light/frame; only context restoration recreates the renderer program cache.
     // Restored flags and stock target: never present a partially rebuilt generation.
     draw(pass,scene,camera,light);
    }
   }
  },
  dispose(){disposed=true;for(const off of policyReleases.values())off();policyReleases.clear();releaseAll();composite?.geometry.dispose();composite?.material.dispose();composite=null;},
 };
}
export type ShadowGPUCache=ReturnType<typeof createShadowGPUCache>;
