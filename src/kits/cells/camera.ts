/**
 * kits/cells/camera.ts: a cell camera from the scene's `ctx.view` (position, target, vertical fov, aspect), for
 * games that draw through the engine's own renderer. It matches the renderer's camera: Y up, the same look-at
 * construction and the engine's default near and far planes. A three.js handle can pass its own camera instead.
 */
import {effectiveFov, type ViewState} from '../../author';

export interface ViewCellCamera {
  readonly position: Float64Array;
  readonly viewProjection: Float64Array;
}

/** A reusable record for `cellCameraFromView`. */
export function createViewCellCamera(): ViewCellCamera {
  return {position: new Float64Array(3), viewProjection: new Float64Array(16)};
}

/**
 * Write the perspective view-projection (column-major) of `view` into `out`. `near` and `far` default to the
 * engine renderer's 0.1 and 500; pass your own when a scene changes them.
 */
export function cellCameraFromView(
  view: Pick<ViewState, 'camera' | 'aspect'>,
  out: ViewCellCamera,
  near = 0.1,
  far = 500,
): ViewCellCamera {
  const [px, py, pz] = view.camera.position,
    [tx, ty, tz] = view.camera.target;
  if (![px, py, pz, tx, ty, tz, view.aspect].every(Number.isFinite) || !(view.aspect > 0))
    throw new TypeError('cells: view camera must be finite with a positive aspect');
  if (!(near > 0) || !(far > near) || !Number.isFinite(far)) throw new RangeError('cells: need 0 < near < far');
  // Camera basis as a look-at with up +Y: z points from the target to the eye.
  let zx = px - tx,
    zy = py - ty,
    zz = pz - tz;
  if (zx === 0 && zy === 0 && zz === 0) zz = 1;
  let len = Math.hypot(zx, zy, zz);
  zx /= len;
  zy /= len;
  zz /= len;
  // x = up × z with up (0, 1, 0).
  let xx = zz,
    xy = 0,
    xz = -zx;
  if (Math.hypot(xx, xz) === 0) {
    // Looking straight up or down: nudge as the renderer's look-at does.
    zz += 0.0001;
    len = Math.hypot(zx, zy, zz);
    zx /= len;
    zy /= len;
    zz /= len;
    xx = zz;
    xz = -zx;
  }
  len = Math.hypot(xx, xy, xz);
  xx /= len;
  xy /= len;
  xz /= len;
  const yx = zy * xz - zz * xy,
    yy = zz * xx - zx * xz,
    yz = zx * xy - zy * xx;
  const f = 1 / Math.tan((effectiveFov(view) * Math.PI) / 360),
    a = view.aspect;
  const A = -(far + near) / (far - near),
    B = (-2 * far * near) / (far - near);
  // View matrix rows: [x, -x.p], [y, -y.p], [z, -z.p]; projection rows: [f/a 0 0 0], [0 f 0 0], [0 0 A B], [0 0 -1 0].
  const tX = -(xx * px + xy * py + xz * pz),
    tY = -(yx * px + yy * py + yz * pz),
    tZ = -(zx * px + zy * py + zz * pz);
  const m = out.viewProjection;
  m[0] = (f / a) * xx;
  m[4] = (f / a) * xy;
  m[8] = (f / a) * xz;
  m[12] = (f / a) * tX;
  m[1] = f * yx;
  m[5] = f * yy;
  m[9] = f * yz;
  m[13] = f * tY;
  m[2] = A * zx;
  m[6] = A * zy;
  m[10] = A * zz;
  m[14] = A * tZ + B;
  m[3] = -zx;
  m[7] = -zy;
  m[11] = -zz;
  m[15] = -tZ;
  out.position[0] = px;
  out.position[1] = py;
  out.position[2] = pz;
  return out;
}
