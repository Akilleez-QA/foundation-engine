/** Fixed authored lights. Construction and renderer grading live at the render boundary.
 * Rows preserve the existing light count, including zero-intensity slots; updates mutate slots in place.
 */
import * as T from 'three';
import type {ShadowMapRequest} from './quality';
import {liveShadowMap} from './quality-runtime';
import {scheduleShadows} from './shadows';

type XYZ = readonly [number, number, number];
type LightKinds = {ambient:T.AmbientLight; hemisphere:T.HemisphereLight; directional:T.DirectionalLight; point:T.PointLight; spot:T.SpotLight};
interface AuthoredLight {
 color:T.ColorRepresentation;
 intensity:number;
 position?:XYZ;
 target?:XYZ;
 shadow?: {
  camera?:Partial<Pick<T.OrthographicCamera,'left'|'right'|'top'|'bottom'|'near'|'far'>>;
  bias?:number; normalBias?:number;
  /** Absent preserves three's default map size; view-dependent requests are supplied by the caller. */
  mapSize?:ShadowMapRequest;
  /** Legacy authored map: copied exactly, without opting into live quality sizing. */
  fixedMapSize?:number;
 };
}
export type LightDef = AuthoredLight & (
 | {kind:'ambient'|'directional'}
 | {kind:'hemisphere'; groundColor:T.ColorRepresentation}
 | {kind:'point'; distance:number; decay:number}
 | {kind:'spot'; distance:number; angle:number; penumbra:number; decay:number}
);
export type LightFor<D extends LightDef> = LightKinds[D['kind']];

/** Construct a private slot from immutable authored data. The caller retains scene insertion order. */
export function createRigLight<D extends LightDef>(def:D, renderer?:T.WebGLRenderer):LightFor<D> {
 let light:T.Light;
 switch(def.kind){
  case 'ambient':light=new T.AmbientLight(def.color,def.intensity);break;
  case 'hemisphere':light=new T.HemisphereLight(def.color,def.groundColor,def.intensity);break;
  case 'directional':light=new T.DirectionalLight(def.color,def.intensity);break;
  case 'point':light=new T.PointLight(def.color,def.intensity,def.distance,def.decay);break;
  case 'spot':light=new T.SpotLight(def.color,def.intensity,def.distance,def.angle,def.penumbra,def.decay);break;
 }
 if(def.position)light.position.fromArray(def.position);
 if(def.target&&(light instanceof T.DirectionalLight||light instanceof T.SpotLight))light.target.position.fromArray(def.target);
 if(def.shadow){
  if(!(light instanceof T.DirectionalLight||light instanceof T.SpotLight||light instanceof T.PointLight))throw new Error('Only direct lights cast shadows');
  light.castShadow=true;
  if(def.shadow.camera)Object.assign(light.shadow.camera,def.shadow.camera);
  if(def.shadow.bias!==undefined)light.shadow.bias=def.shadow.bias;
  if(def.shadow.normalBias!==undefined)light.shadow.normalBias=def.shadow.normalBias;
  if(def.shadow.fixedMapSize!==undefined)light.shadow.mapSize.setScalar(def.shadow.fixedMapSize);
  if(def.shadow.mapSize!==undefined){
   const live=liveShadowMap(light,def.shadow.mapSize,renderer),dispose=light.dispose;
   light.dispose=function(){live.dispose();dispose.call(this);};
  }
  if(renderer)scheduleShadows(renderer);
 }
 return light as LightFor<D>;
}

export function createLightRig<const D extends Record<string,LightDef>>(rows:D,renderer?:T.WebGLRenderer){
 const lights={} as {[K in keyof D]:LightFor<D[K]>};
 for(const key in rows)lights[key]=createRigLight(rows[key]!,renderer); // key comes from iterating rows
 let disposed=false;
 return {lights,dispose(){
  if(disposed)return;disposed=true;
  for(const light of Object.values(lights)){
   light.removeFromParent();
   if(light instanceof T.DirectionalLight||light instanceof T.SpotLight)light.target.removeFromParent();
   light.dispose();
  }
 }};
}

/** Immediate exposure assignment: authored mood interpolation remains owned by the existing caller. */
export function applyExposure(renderer:Pick<T.WebGLRenderer,'toneMappingExposure'>,exposure:number):void{
 renderer.toneMappingExposure=exposure;
}
export function applyLightingGrade(renderer:T.WebGLRenderer,exposure:number):void{
 renderer.outputColorSpace=T.SRGBColorSpace;
 renderer.toneMapping=T.ACESFilmicToneMapping;
 applyExposure(renderer,exposure);
}
