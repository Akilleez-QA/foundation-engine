/**
 * platform/render/shadow-cascades.ts: the Reference shadow technique: three
 * cascades of 4096² each from three's CSM addon, filtered with contact-hardening soft shadows (PCSS, the technique of
 * three's `webgl_shadowmap_pcss` example).
 *
 * `cascadeShadows(renderer, scene, sun)` gives a scene's sun cascades when `shadows.quality` is `ultra` and the
 * renderer's scheduler was installed for the Reference technique (the renderer pool's leases, except staged areas,
 * which keep their authored look; ADR 0061, STD-REN-27). Below `ultra`, and whenever the sun stops casting (the
 * player's `off`), the sun draws its own single map exactly as authored, live.
 *
 * How it draws:
 * - The CSM addon fits three cascades to the viewing camera's frustum, from its near plane to `maxFar` (at least the
 *   diagonal of the sun's authored shadow box, so shadows reach at least as far as before), split by its practical
 *   scheme and snapped to whole shadow texels (a still camera never moves a cascade). Each cascade is a directional
 *   light that carries the sun's colour, intensity and direction; the sun itself is hidden from lighting while its
 *   cascades stand in, and its own map is released.
 * - A cascade's depth range is proportional to its width (`DEPTH_PER_WIDTH`), with the light placed half of it
 *   sunward of the cascade's slice: casters up to that far toward the sun still cast into the view. That fixed ratio
 *   lets the shader turn depth differences into world distances without per-material uniforms.
 * - Lighting: `lights_fragment_begin` gains one branch, compiled only for a Basic-type shadow map with exactly three
 *   directional shadow lights and taken only when those three share one direction and colour (the cascades): the sun
 *   lights the fragment once, shadowed by the finest cascade that holds it (blended with the next near a cascade's
 *   edge). Every other program compiles three's chunk unchanged. The chunks are patched once, by exact text: an
 *   engine whose chunk text differs leaves them alone and the technique off (the authored single map draws).
 * - Filter: 16 blocker samples within `MAX_PENUMBRA_M` find the average blocker depth, the penumbra is (receiver −
 *   blocker) × tan(sun radius), and 32 compare samples filter over it, on a Vogel disk rotated per pixel; a slope term
 *   keeps tilted receivers from self-shadowing across the wider filter. Basic maps are sampled raw (hardware compare
 *   cannot give blocker depths). A cascade's `shadow.radius`, which Basic maps do not read, carries its width (m).
 * - Stability: each cascade is `SLACK` wider than its slice and snaps to a coarse whole-texel grid, and the scheduler
 *   decides each cascade apart (`ShadowScheduler.apart`): a still or gently settling camera redraws no cascade, a
 *   long camera move redraws the cascades it shifted, and a moving caster redraws all three.
 * - An orthographic view (an overhead camera) gives three nearly equal cascades: correct, but the
 *   finest covers the view and the other two are drawn for its edges only (a follow-up for the shadow caches).
 *
 * The shadow scheduler (`shadows.ts`) schedules the cascades like any shadow light: they redraw only when a caster,
 * the sun or the camera's snapped cascade moved. Memory: each cascade is a 4096² 32-bit depth texture plus the one-
 * byte colour attachment three requires, 80 MiB, 240 MiB for the three, replacing the sun's 32 MiB map.
 */
import * as T from 'three';
import {markReferenceShadowLight} from './shadow-technique';
import {CSM} from 'three/addons/csm/CSM.js';
import {CSMFrustum} from 'three/addons/csm/CSMFrustum.js';
import {appQuality} from './quality-runtime';
import type {Quality} from './quality';
import {stillSafe} from './change-tracker';

export const CASCADES=3;
export const CASCADE_MAP_SIZE=4096;
/** A cascade's depth range as a multiple of its width (the shader constant ENGINE_DEPTH_PER_WIDTH). */
export const DEPTH_PER_WIDTH=16;
/** tan of the sun's apparent radius for the penumbra (1.5°: a soft sky-scattered sun; the shader's ENGINE_SUN_TAN). */
export const SUN_TAN=Math.tan(1.5*Math.PI/180);
/** Each cascade is SLACK wider than its frustum slice, and its centre snaps to a grid of about SNAP of its width in
 *  whole texels (410 at 4096), less than the half-slack on each side, so the slice always stays inside. */
export const SLACK=1.25,SNAP=.1;
/** The widest penumbra the filter searches for (m). */
export const MAX_PENUMBRA_M=.15;

// --------------------------------------------------------------------------------------------------- the chunks
const DIR_BLOCK_START='#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )\n';
const CASCADE_GATE='defined( USE_SHADOWMAP ) && defined( SHADOWMAP_TYPE_BASIC ) && ( NUM_DIR_LIGHT_SHADOWS == 3 )';

const PARS=/* glsl */`
#if ${CASCADE_GATE}
	// Engine Reference shadows (platform/render/shadow-cascades.ts): PCSS over three cascades.
	#define ENGINE_SUN_TAN ${SUN_TAN.toFixed(6)}
	#define ENGINE_DEPTH_PER_WIDTH ${DEPTH_PER_WIDTH.toFixed(1)}
	// The widest penumbra searched (m): blockers up to about 6 m above a receiver. Wider searches mix in unrelated blockers.
	#define ENGINE_MAX_PENUMBRA_M ${MAX_PENUMBRA_M.toFixed(3)}
	#define ENGINE_EDGE_BAND 0.08
	float engineNoise( vec2 p ) { return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) ); }
	vec2 engineDisk( int i, int n, float phi ) {
		float r = sqrt( ( float( i ) + 0.5 ) / float( n ) ), t = float( i ) * 2.399963229728653 + phi;
		return vec2( cos( t ), sin( t ) ) * r;
	}
	// Distance to the nearest edge of the cascade (uv), negative outside it.
	float engineEdge( vec4 coord ) {
		vec3 c = coord.xyz / coord.w;
		return c.z > 1.0 ? -1.0 : min( min( c.x, 1.0 - c.x ), min( c.y, 1.0 - c.y ) );
	}
	// A cascade's shadowRadius holds its width in metres (Basic maps do not read the radius).
	float enginePCSS( sampler2D map, DirectionalLightShadow s, vec4 coord, float slope, float phi ) {
		vec3 c = coord.xyz / coord.w;
		float texel = 1.0 / s.shadowMapSize.x, z = c.z + s.shadowBias;
		// Depth change per uv on a receiver tilted away from the light (depth range = width × ENGINE_DEPTH_PER_WIDTH).
		float tilt = slope / ENGINE_DEPTH_PER_WIDTH;
		float search = max( ENGINE_MAX_PENUMBRA_M / s.shadowRadius, 2.0 * texel ), blockers = 0.0, found = 0.0;
		for ( int i = 0; i < 16; i ++ ) {
			vec2 o = engineDisk( i, 16, 0.0 ) * search;
			float d = texture2D( map, c.xy + o ).r;
			if ( d < z - length( o ) * tilt ) { blockers += d; found += 1.0; }
		}
		if ( found == 0.0 ) return 1.0;
		float penumbra = ( z - blockers / found ) * ENGINE_DEPTH_PER_WIDTH * ENGINE_SUN_TAN;
		float radius = clamp( penumbra, 1.25 * texel, search ), lit = 0.0;
		for ( int i = 0; i < 32; i ++ ) {
			vec2 o = engineDisk( i, 32, phi + 1.7 ) * radius;
			lit += step( z - length( o ) * tilt, texture2D( map, c.xy + o ).r );
		}
		return lit / 32.0;
	}
	float engineCascadeShadow( float dotNL ) {
		if ( dotNL <= 0.0 ) return 1.0;
		float slope = min( sqrt( max( 1.0 - dotNL * dotNL, 0.0 ) ) / dotNL, 8.0 );
		float phi = engineNoise( gl_FragCoord.xy ) * 6.283185307;
		float e0 = engineEdge( vDirectionalShadowCoord[ 0 ] ), e1 = engineEdge( vDirectionalShadowCoord[ 1 ] ), e2 = engineEdge( vDirectionalShadowCoord[ 2 ] );
		float shadow = 1.0;
		if ( e0 > 0.0 ) {
			shadow = enginePCSS( directionalShadowMap[ 0 ], directionalLightShadows[ 0 ], vDirectionalShadowCoord[ 0 ], slope, phi );
			if ( e0 < ENGINE_EDGE_BAND && e1 > 0.0 ) shadow = mix( enginePCSS( directionalShadowMap[ 1 ], directionalLightShadows[ 1 ], vDirectionalShadowCoord[ 1 ], slope, phi ), shadow, e0 / ENGINE_EDGE_BAND );
		} else if ( e1 > 0.0 ) {
			shadow = enginePCSS( directionalShadowMap[ 1 ], directionalLightShadows[ 1 ], vDirectionalShadowCoord[ 1 ], slope, phi );
			if ( e1 < ENGINE_EDGE_BAND && e2 > 0.0 ) shadow = mix( enginePCSS( directionalShadowMap[ 2 ], directionalLightShadows[ 2 ], vDirectionalShadowCoord[ 2 ], slope, phi ), shadow, e1 / ENGINE_EDGE_BAND );
		} else if ( e2 > 0.0 ) {
			// The farthest cascade fades out at its edge instead of ending in a line.
			shadow = mix( 1.0, enginePCSS( directionalShadowMap[ 2 ], directionalLightShadows[ 2 ], vDirectionalShadowCoord[ 2 ], slope, phi ), min( 1.0, e2 / ENGINE_EDGE_BAND ) );
		}
		return mix( 1.0, shadow, directionalLightShadows[ 0 ].shadowIntensity );
	}
#endif
`;

const CASCADE_BRANCH=/* glsl */`
#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct ) && ${CASCADE_GATE}
	// The three shadow lights are the sun's cascades when they share one direction and colour.
	bool engineCascaded = dot( directionalLights[ 0 ].direction, directionalLights[ 1 ].direction ) > 0.99999 && dot( directionalLights[ 0 ].direction, directionalLights[ 2 ].direction ) > 0.99999
		&& all( lessThan( abs( directionalLights[ 0 ].color - directionalLights[ 1 ].color ), vec3( 1e-4 ) ) ) && all( lessThan( abs( directionalLights[ 0 ].color - directionalLights[ 2 ].color ), vec3( 1e-4 ) ) );
	if ( engineCascaded ) {
		getDirectionalLightInfo( directionalLights[ 0 ], directLight );
		if ( directLight.visible && receiveShadow ) directLight.color *= engineCascadeShadow( dot( geometryNormal, directLight.direction ) );
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
		DirectionalLight engineUnshadowed;
		#pragma unroll_loop_start
		for ( int i = 3; i < NUM_DIR_LIGHTS; i ++ ) {
			engineUnshadowed = directionalLights[ i ];
			getDirectionalLightInfo( engineUnshadowed, directLight );
			RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
		}
		#pragma unroll_loop_end
	} else {
__ORIGINAL__
	}
#else
__ORIGINAL__
#endif
`;

/** The directional-light block of three's `lights_fragment_begin`, or null when the text is not the pinned one. */
export function directionalBlock(chunk:string):{start:number;end:number;text:string}|null{
 const start=chunk.indexOf(DIR_BLOCK_START);if(start<0||chunk.indexOf(DIR_BLOCK_START,start+1)>=0)return null;
 const loopEnd=chunk.indexOf('#pragma unroll_loop_end',start);if(loopEnd<0)return null;
 const endif=chunk.indexOf('#endif',loopEnd);if(endif<0)return null;
 const end=endif+'#endif'.length,text=chunk.slice(start,end);
 // The pinned r183 block: one unrolled loop over the directional lights with three's getShadow call.
 if(!text.includes('getShadow( directionalShadowMap[ i ]')||!text.includes('for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ )'))return null;
 return {start,end,text};
}

let patched:boolean|null=null;
/** Patches the two chunks once. False (and nothing changed) when the engine's chunk text is not the pinned one. */
export function installCascadeChunks():boolean{
 if(patched!==null)return patched;
 const lights=T.ShaderChunk.lights_fragment_begin,block=directionalBlock(lights);
 if(!block||T.ShaderChunk.shadowmap_pars_fragment.includes('engineCascadeShadow')){patched=false;return false;}
 T.ShaderChunk.lights_fragment_begin=lights.slice(0,block.start)+CASCADE_BRANCH.split('__ORIGINAL__').join(block.text)+lights.slice(block.end);
 T.ShaderChunk.shadowmap_pars_fragment=T.ShaderChunk.shadowmap_pars_fragment+PARS;
 patched=true;return true;
}

// ---------------------------------------------------------------------------------------------------- the rig
/** The addon with its global chunk injection turned off (the chunks above are gated, not replaced) and a per-cascade
 *  light margin proportional to the cascade's width. */
class SunCascades extends CSM{
 _injectInclude(){}
 override update(){
  const camera=this.camera,dir=this.lightDirection;
  orientation.lookAt(origin,dir,up);inverse.copy(orientation).invert();
  for(let i=0;i<this.frustums.length;i++){
   const light=this.lights[i],cam=light.shadow.camera,width=cam.right-cam.left,step=Math.round(SNAP*this.shadowMapSize)*width/this.shadowMapSize;
   cameraToLight.multiplyMatrices(inverse,camera.matrixWorld);this.frustums[i].toSpace(cameraToLight,lightFrustum);
   box.makeEmpty();for(let j=0;j<4;j++){box.expandByPoint(lightFrustum.vertices.near[j]);box.expandByPoint(lightFrustum.vertices.far[j]);}
   box.getCenter(center);
   // Half the depth range lies sunward of the slice. The centre snaps to a grid of a tenth of the cascade's width (a
   // whole number of texels) in all three axes; the cascade is `SLACK` wider than its slice, so the slice stays
   // inside it and a camera that drifts or settles by less than a grid step moves no cascade and redraws none.
   center.z=Math.ceil(box.max.z/step)*step+width*DEPTH_PER_WIDTH/2;center.x=Math.round(center.x/step)*step;center.y=Math.round(center.y/step)*step;
   center.applyMatrix4(orientation);
   light.position.copy(center);light.target.position.copy(center).add(dir);
   if(cam.near!==0||cam.far!==width*DEPTH_PER_WIDTH){cam.near=0;cam.far=width*DEPTH_PER_WIDTH;cam.updateProjectionMatrix();}
  }
 }
}
const origin=new T.Vector3(),up=new T.Vector3(0,1,0),center=new T.Vector3(),box=new T.Box3(),orientation=new T.Matrix4(),inverse=new T.Matrix4(),cameraToLight=new T.Matrix4();
const lightFrustum=new CSMFrustum({webGL:true});

/** What the rig needs from the renderer's shadow scheduler (`shadows.ts`, which loads this module on demand). */
export interface CascadeScheduler{invalidate(scene?:T.Object3D):void;apart(scene:T.Object3D,lights:readonly T.Light[]):void}
export interface CascadeOptions{
 /** The renderer's shadow scheduler; the caller has checked that the renderer is leased for the Reference technique. */
 scheduler:CascadeScheduler;
 quality?:Pick<Quality,'knob'>;
 /** How far from the camera cascades reach (m). Default: the diagonal of the sun's authored shadow box. */
 maxFar?:number;
}
export interface CascadeRig{
 /** True while the cascades stand in for the sun. */
 readonly active:boolean;
 readonly lights:readonly T.DirectionalLight[];
 dispose():void;
}

/** Cascades for `sun` in `scene` while `shadows.quality` is `ultra`; null when the chunks could not be patched. Called
 *  through `referenceShadows` (shadows.ts) for a renderer leased for the Reference technique. */
export function cascadeShadows(renderer:T.WebGLRenderer,scene:T.Scene,sun:T.DirectionalLight,o:CascadeOptions):CascadeRig|null{
 if(!installCascadeChunks())return null;
 const quality=o.quality??appQuality(),scheduler=o.scheduler;
 // The sun's authored shadow box and biases, read when the cascades are fitted (a scene may set them after the rig).
 const authored=()=>{
  const b=sun.shadow.camera,width=b.right-b.left;
  return {maxFar:o.maxFar??Math.hypot(width,b.top-b.bottom),bias:sun.shadow.bias*(b.far-b.near),normalTexels:sun.shadow.normalBias/(width/Math.max(1,sun.shadow.mapSize.x))};
 };
 let authoredType=renderer.shadowMap.type;
 let csm:SunCascades|null=null,active=false,disposed=false,lastCamera:T.Camera|null=null;
 const projection=new T.Matrix4();
 const ours=new WeakSet<T.WebGLRenderTarget>();
 const dir=new T.Vector3(),at=new T.Vector3();

 const build=(camera:T.Camera)=>{
  const c=new SunCascades({camera,parent:scene,cascades:CASCADES,maxFar:authored().maxFar,mode:'practical',shadowMapSize:CASCADE_MAP_SIZE,lightDirection:new T.Vector3(0,-1,0),lightIntensity:sun.intensity,lightNear:0,lightFar:1,lightMargin:0});
  c.lights.forEach((l,i)=>{markReferenceShadowLight(l);l.name=`${sun.name||'sun'} cascade ${i}`;l.visible=false;l.target.name=l.name+' target';});
  return c;
 };
 /** A cascade's own map: 32-bit depth sampled raw (Basic), and the smallest colour attachment three accepts. */
 const map=(light:T.DirectionalLight)=>{
  const rt=new T.WebGLRenderTarget(CASCADE_MAP_SIZE,CASCADE_MAP_SIZE,{format:T.RedFormat,type:T.UnsignedByteType,generateMipmaps:false});
  rt.texture.name=light.name+'.shadowColour';
  const depth=new T.DepthTexture(CASCADE_MAP_SIZE,CASCADE_MAP_SIZE,T.UnsignedIntType);depth.format=T.DepthFormat;depth.compareFunction=null;depth.minFilter=depth.magFilter=T.NearestFilter;depth.name=light.name+'.shadowMap';
  rt.depthTexture=depth;ours.add(rt);return rt;
 };
 const release=(light:T.DirectionalLight)=>{const m=light.shadow.map;if(!m)return;m.depthTexture?.dispose();m.dispose();light.shadow.map=null;};

 const activate=(camera:T.Camera)=>{
  csm??=build(camera);authoredType=renderer.shadowMap.type;
  sun.visible=false;release(sun);
  for(const l of csm.lights)l.visible=true;
  renderer.shadowMap.type=T.BasicShadowMap;active=true;lastCamera=null;scheduler.apart(scene,csm.lights);scheduler.invalidate(scene);
 };
 const deactivate=()=>{
  if(!active)return;active=false;
  sun.visible=true;renderer.shadowMap.type=authoredType;
  if(csm)for(const l of csm.lights){l.visible=false;release(l);}
  scheduler.apart(scene,[]);scheduler.invalidate(scene);
 };

 const step=(camera:T.Camera)=>{
  const want=!disposed&&quality.knob('shadows.quality')==='ultra'&&sun.castShadow;
  if(!want){deactivate();return;}
  if(!active)activate(camera);
  const c=csm!;
  // Refit when the viewing camera or its projection changes (a resize, the overhead/eye switch).
  if(camera!==lastCamera||!projection.equals(camera.projectionMatrix)){
   const a=authored();
   lastCamera=camera;projection.copy(camera.projectionMatrix);c.camera=camera;c.maxFar=Math.min(a.maxFar,(camera as T.PerspectiveCamera).far??a.maxFar);c.updateFrustums();
   // Widen every cascade by the slack the snapping grid needs (the addon fits each to its slice exactly), rounded up
   // to one of eight sizes per octave: a zoom or field-of-view easing that changes the slice a little keeps the size.
   for(const l of c.lights){const k=l.shadow.camera,h=2**(Math.ceil(Math.log2((k.right-k.left)*SLACK)*8)/8)/2;k.left=k.bottom=-h;k.right=k.top=h;k.updateProjectionMatrix();}
   for(const l of c.lights){
    const width=l.shadow.camera.right-l.shadow.camera.left,texel=width/CASCADE_MAP_SIZE,range=width*DEPTH_PER_WIDTH;
    // The authored world-space biases, carried to each cascade's texel size and depth range.
    l.shadow.normalBias=Math.max(1,a.normalTexels*.6)*texel;l.shadow.bias=Math.min(a.bias,-1.5*texel)/range;
    l.shadow.radius=width;l.shadow.intensity=sun.shadow.intensity;l.shadow.mapSize.set(CASCADE_MAP_SIZE,CASCADE_MAP_SIZE);
   }
  }
  sun.getWorldPosition(dir);sun.target.getWorldPosition(at);c.lightDirection.copy(at).sub(dir).normalize();
  c.update();
  for(const l of c.lights){
   l.color.copy(sun.color);l.intensity=sun.intensity;l.castShadow=true;
   l.updateMatrixWorld();l.target.updateMatrixWorld();
   if(!l.shadow.map||!ours.has(l.shadow.map as T.WebGLRenderTarget)){release(l);l.shadow.map=map(l);scheduler.invalidate(scene);}
  }
 };

 const previous=scene.onBeforeRender;
 const hook=function(this:T.Scene,...args:Parameters<T.Scene['onBeforeRender']>){
  if(args[0]===renderer)step(args[2]);
  previous.apply(this,args);
 };
 // The cascades follow the camera and the sun, which the colour tracker reads: the hook adds no hidden input. A hook
 // that was already there keeps forcing if it did.
 if(previous===T.Object3D.prototype.onBeforeRender||(previous as {stillSafe?:boolean}).stillSafe)stillSafe(hook);
 scene.onBeforeRender=hook;

 return {
  get active(){return active;},
  get lights(){return csm?.lights??[];},
  dispose(){
   if(disposed)return;disposed=true;deactivate();
   if(scene.onBeforeRender===hook)scene.onBeforeRender=previous;
   if(csm){for(const l of csm.lights)release(l);csm.remove();csm=null;}
  },
 };
}
