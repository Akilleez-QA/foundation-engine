import * as T from 'three';
import {updateWorldMatrixFromRoot} from './world-matrix';

/** Bounds for what is drawn, excluding released stages and hidden effects.
 * Covers the static meshes, instanced meshes, lines and points used by our toys.
 */
export function visibleModelBounds(root: T.Object3D, result = new T.Box3()) {
  result.makeEmpty();
  updateWorldMatrixFromRoot(root, true);
  const part = new T.Box3();
  root.traverseVisible(object => {
    if (!(object instanceof T.Mesh || object instanceof T.Line || object instanceof T.Points)) return;
    if (object instanceof T.InstancedMesh) {
      object.computeBoundingBox();
      if (object.boundingBox) part.copy(object.boundingBox);
      else return;
    } else {
      if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
      if (!object.geometry.boundingBox) return;
      part.copy(object.geometry.boundingBox);
    }
    result.union(part.applyMatrix4(object.matrixWorld));
  });
  return result;
}

/** Sphere fit remains conservative for any viewing direction and aspect ratio. */
export function modelFitDistance(radius: number, fov: number, aspect: number, margin = 1.2) {
  const vertical = T.MathUtils.degToRad(fov / 2);
  const halfAngle = Math.min(vertical, Math.atan(Math.tan(vertical) * aspect));
  return (radius / Math.sin(halfAngle)) * margin;
}
