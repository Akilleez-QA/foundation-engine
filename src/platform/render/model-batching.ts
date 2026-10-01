/** Compatibility adapter: app-owned assets stay borrowed by the platform build step. */
import type * as T from 'three';
import {assetOwners} from '../assets/app-ownership';
import {batchStaticMeshes as batch,bakeStaticMeshes as bake} from './batching';
export {shareEqualMaterials} from './batching';
export function batchStaticMeshes(group:T.Group,keep=new Set<T.Object3D>(),options:{recursive?:boolean}={}){
 return batch(group,keep,assetOwners,options);
}
export function bakeStaticMeshes(scope:T.Object3D,moving:ReadonlySet<T.Object3D>=new Set(),skipScopes:ReadonlySet<T.Object3D>=new Set(),options:{keepNamedGroups?:boolean}={}){
 return bake(scope,moving,skipScopes,{...options,owner:assetOwners});
}
