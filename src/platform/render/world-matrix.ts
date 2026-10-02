import type * as T from 'three';

/**
 * Brings `o`'s world matrix (with `children`, its whole subtree's too) up to date from the scene root down.
 *
 * three r185 changed `updateWorldMatrix(true, …)`: an ancestor is recomputed only when its own
 * `matrixWorldNeedsUpdate` is set. A node with a manually managed local matrix (`matrixAutoUpdate = false`, as the
 * engine's attached model roots are) never sets it when its parent moves, so through that call it keeps a stale
 * world matrix and everything read below it is stale too. Forcing each level restores the r183 result at the r183
 * cost (r183 recomputed every level); the recursion allocates nothing.
 */
export function updateWorldMatrixFromRoot(o:T.Object3D,children=false):void{
 if(o.parent)ancestors(o.parent);
 o.updateWorldMatrix(false,children,true);
}
const ancestors=(o:T.Object3D):void=>{if(o.parent)ancestors(o.parent);o.updateWorldMatrix(false,false,true);};
