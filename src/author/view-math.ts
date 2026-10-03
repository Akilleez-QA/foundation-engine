/**
 * author/view-math.ts: pointer picking without three.js, so systems and tests can use it. The camera is the scene's
 * `ctx.view.camera` (vertical `fov`, optional `minWidthFov`) at the view's aspect.
 */
import type {SceneContext, Vec3, ViewState} from './defs';

/** The vertical field of view actually used (widened on narrow screens by `minWidthFov`), in degrees. */
export function effectiveFov(view: Pick<ViewState, 'camera' | 'aspect'>): number {
  const {fov, minWidthFov} = view.camera;
  return minWidthFov
    ? Math.max(fov, (2 * Math.atan(Math.tan((minWidthFov * Math.PI) / 360) / view.aspect) * 180) / Math.PI)
    : fov;
}

/** The ray from the camera through a point of the view (normalised device coordinates, -1…1). */
export function viewRay(
  view: Pick<ViewState, 'camera' | 'aspect'>,
  ndc: {x: number; y: number},
): {origin: Vec3; dir: Vec3} {
  const [px, py, pz] = view.camera.position,
    [tx, ty, tz] = view.camera.target;
  const norm = (v: Vec3): Vec3 => {
    const l = Math.hypot(...v) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const cross = (a: Vec3, b: Vec3): Vec3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const f = norm([tx - px, ty - py, tz - pz]),
    r = norm(cross(f, [0, 1, 0])),
    u = cross(r, f);
  const h = Math.tan((effectiveFov(view) * Math.PI) / 360),
    w = h * view.aspect;
  return {
    origin: [px, py, pz],
    dir: norm([
      f[0] + r[0] * ndc.x * w + u[0] * ndc.y * h,
      f[1] + r[1] * ndc.x * w + u[1] * ndc.y * h,
      f[2] + r[2] * ndc.x * w + u[2] * ndc.y * h,
    ]),
  };
}

/** Where the pointer meets the horizontal plane at height `y`, or null when it points above the horizon. */
export function pointerOnGround(ctx: Pick<SceneContext, 'view' | 'input'>, y = 0): {x: number; z: number} | null {
  const {origin, dir} = viewRay(ctx.view, ctx.input.pointer);
  if (dir[1] >= -1e-6) return null;
  const k = (y - origin[1]) / dir[1];
  return {x: origin[0] + dir[0] * k, z: origin[2] + dir[2] * k};
}

/** Where a world point appears in the view, in normalised device coordinates (x right, y up), or null behind the camera. */
export function projectToView(view: Pick<ViewState, 'camera' | 'aspect'>, p: Vec3): {x: number; y: number} | null {
  const [px, py, pz] = view.camera.position,
    [tx, ty, tz] = view.camera.target;
  const norm = (v: Vec3): Vec3 => {
    const l = Math.hypot(...v) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const cross = (a: Vec3, b: Vec3): Vec3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const f = norm([tx - px, ty - py, tz - pz]),
    r = norm(cross(f, [0, 1, 0])),
    u = cross(r, f);
  const d: Vec3 = [p[0] - px, p[1] - py, p[2] - pz],
    z = dot(d, f);
  if (z <= 1e-6) return null;
  const h = Math.tan((effectiveFov(view) * Math.PI) / 360),
    w = h * view.aspect;
  return {x: dot(d, r) / z / w, y: dot(d, u) / z / h};
}
