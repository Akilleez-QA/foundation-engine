import {Camera,OrthographicCamera,PerspectiveCamera,Quaternion,Vector3} from 'three';
/** Screen-space drag: one finger follows the selected mode, two fingers pan. */
export function dragTouchCamera(camera:Camera,target:Vector3,dx:number,dy:number,width:number,height:number,mode:'pan'|'rotate',rotateSpeed=.65){
 if(width<=0||height<=0)return;
 const offset=camera.position.clone().sub(target),right=new Vector3(1,0,0).applyQuaternion(camera.quaternion),up=new Vector3(0,1,0).applyQuaternion(camera.quaternion);
 if(mode==='pan'){
  const vertical=camera instanceof OrthographicCamera?(camera.top-camera.bottom)/camera.zoom:camera instanceof PerspectiveCamera?2*offset.length()*Math.tan(camera.fov*Math.PI/360)/camera.zoom:0;
  const horizontal=camera instanceof OrthographicCamera?(camera.right-camera.left)/camera.zoom:vertical*width/height;
  const shift=right.multiplyScalar(-dx/width*horizontal).add(up.multiplyScalar(dy/height*vertical));
  camera.position.add(shift);target.add(shift);
 }else{
  const axis=up.multiplyScalar(-dx).add(right.multiplyScalar(-dy));
  if(axis.lengthSq()===0)return;
  const q=new Quaternion().setFromAxisAngle(axis.normalize(),Math.hypot(dx,dy)*Math.PI/Math.min(width,height)*rotateSpeed);
  offset.applyQuaternion(q);camera.up.applyQuaternion(q);camera.position.copy(target).add(offset);camera.lookAt(target);
 }
}
export type TouchPoint={x:number;y:number};
export function touchMetrics(points:TouchPoint[]){const a=points[0];if(!a)throw Error('touchMetrics: no points');const b=points[1]??a;return {x:(a.x+b.x)/2,y:(a.y+b.y)/2,distance:Math.hypot(a.x-b.x,a.y-b.y)};}
