import * as T from 'three';

/**
 * Whether a mesh was actually drawn since the last check: three calls onBeforeRender only for
 * visible, frustum-passing objects of a scene being rendered (never for shadow passes). Canvas
 * screens use it to repaint only while someone can see them. `within` ignores draws from a
 * camera further away than that (a speck through a far window).
 */
export function renderedSince(mesh:T.Object3D,within=Infinity){
 let seen=false;const range2=within*within;
 mesh.onBeforeRender=(_renderer,_scene,camera)=>{
  if(within===Infinity){seen=true;return;}
  const m=mesh.matrixWorld.elements,c=camera.matrixWorld.elements,dx=m[12]-c[12],dy=m[13]-c[13],dz=m[14]-c[14];
  if(dx*dx+dy*dy+dz*dz<=range2)seen=true;
 };
 return ()=>{const was=seen;seen=false;return was;};
}

/**
 * A sphere that holds `parts` however they turn about any axis through `pivot` (world space), grown by `slack` metres
 * of their own travel and by the length of their shadow: a typical outdoor sun stands about 55° high, so no shadow falls
 * further from its caster than the caster is tall. Read once, after the parts are placed.
 */
export function motionBounds(parts:readonly T.Object3D[],pivot:T.Vector3,slack=0){
 const box=new T.Box3(),corner=new T.Vector3();let radius=0,top=0;
 for(const part of parts){part.updateWorldMatrix(true,true);box.setFromObject(part);if(box.isEmpty())continue;top=Math.max(top,box.max.y-Math.min(0,box.min.y));
  for(let i=0;i<8;i++)radius=Math.max(radius,pivot.distanceTo(corner.set(i&1?box.max.x:box.min.x,i&2?box.max.y:box.min.y,i&4?box.max.z:box.min.z)));}
 return new T.Sphere(pivot.clone(),radius+slack+top);
}
/**
 * Whether a view can see anything inside a sphere from `motionBounds`, for a part that moves only to be seen (* N1): a windmill or an part's arm turning where nobody can see it or its shadow changes no pixel, but it
 * is a changed shadow caster, so it redraws the whole shadow map on every frame. `look(camera)` takes this frame's
 * view (matrices current); `sees(bounds, object)` also needs `object`, when given, to be shown (it and every
 * ancestor visible). Allocates nothing per frame.
 */
export function motionView(){
 const frustum=new T.Frustum(),matrix=new T.Matrix4();
 return {
  look(camera:T.Camera){matrix.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);frustum.setFromProjectionMatrix(matrix);},
  sees(bounds:T.Sphere,object?:T.Object3D){for(let o:T.Object3D|null=object??null;o;o=o.parent)if(!o.visible)return false;return frustum.intersectsSphere(bounds);},
 };
}
