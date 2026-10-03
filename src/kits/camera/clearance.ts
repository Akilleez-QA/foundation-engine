import type {Vec3} from '../../author';
export interface Pose {
  position: Vec3;
  target: Vec3;
}

/** Return distance to first obstruction along this finite segment, or null when clear. */
export type CameraObstruction = (from: Vec3, to: Vec3) => number | null;
/** Resolve after smoothing. Five parallel rays approximate a camera footprint; this is not a swept sphere. */
export function clearCamera(pose: Pose, obstruction: CameraObstruction, radius = 0.15, padding = 0.1): Pose {
  if (pose.position.length !== 3 || pose.target.length !== 3)
    throw new RangeError('camera: expected three coordinates');
  pose = {position: [...pose.position], target: [...pose.target]};
  if (![...pose.position, ...pose.target, radius, padding].every(Number.isFinite) || radius < 0 || padding < 0)
    throw new RangeError('camera: invalid clearance input');
  // Every Vec3 here has three coordinates (checked above), so each map index i is in range.
  const d = pose.position.map((v, i) => v - pose.target[i]!) as Vec3;
  const length = Math.hypot(...d);
  if (!Number.isFinite(length)) throw new RangeError('camera: segment range overflow');
  if (length === 0) return {position: [...pose.position], target: [...pose.target]};
  const direction = d.map(v => v / length) as Vec3;
  const horizontal = Math.hypot(direction[0], direction[2]);
  const right: Vec3 = horizontal > 1e-8 ? [direction[2] / horizontal, 0, -direction[0] / horizontal] : [1, 0, 0];
  const up: Vec3 = [
    direction[1] * right[2] - direction[2] * right[1],
    direction[2] * right[0] - direction[0] * right[2],
    direction[0] * right[1] - direction[1] * right[0],
  ];
  let safe = length;
  const offsets: Vec3[] = [
    [0, 0, 0],
    right.map(v => v * radius) as Vec3,
    right.map(v => -v * radius) as Vec3,
    up.map(v => v * radius) as Vec3,
    up.map(v => -v * radius) as Vec3,
  ];
  for (const offset of offsets) {
    const from = pose.target.map((v, i) => v + offset[i]!) as Vec3,
      to = pose.position.map((v, i) => v + offset[i]!) as Vec3;
    if (![...from, ...to].every(Number.isFinite)) throw new RangeError('camera: footprint range overflow');
    const hit = obstruction(from, to);
    if (hit === null) continue;
    if (!Number.isFinite(hit) || hit < 0 || hit > length + 1e-7)
      throw new RangeError('camera: obstruction distance outside segment');
    safe = Math.min(safe, Math.max(0, hit - padding));
  }
  return {target: [...pose.target], position: pose.target.map((v, i) => v + direction[i]! * safe) as Vec3};
}
