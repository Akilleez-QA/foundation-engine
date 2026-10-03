import type {SurfaceChunk} from './chunk';
export interface TerrainProjection {
  position: readonly number[];
  target: readonly number[];
  verticalFov: number;
  viewportHeight: number;
  near: number;
}
/** Conservative perspective projection of a vertical height-error segment. */
export function projectedSurfaceError(chunk: SurfaceChunk, view: TerrainProjection): number {
  if (
    view.position.length !== 3 ||
    view.target.length !== 3 ||
    ![...view.position, ...view.target, view.verticalFov, view.viewportHeight, view.near].every(Number.isFinite) ||
    view.verticalFov <= 0 ||
    view.verticalFov >= 180 ||
    view.viewportHeight <= 0 ||
    view.near <= 0
  )
    throw Error('terrain LOD: invalid projection');
  const f = view.target.map((v, i) => v - view.position[i]!),
    length = Math.hypot(...f);
  if (!length) throw Error('terrain LOD: zero direction');
  let depth = Infinity,
    radius = 0;
  for (const x of [chunk.bounds.min.x, chunk.bounds.max.x])
    for (const y of [chunk.bounds.min.y, chunk.bounds.max.y])
      for (const z of [chunk.bounds.min.z, chunk.bounds.max.z]) {
        const d = [x - view.position[0]!, y - view.position[1]!, z - view.position[2]!];
        depth = Math.min(
          depth,
          d.reduce((n, v, i) => n + (v * f[i]!) / length, 0),
        );
        radius = Math.max(radius, Math.hypot(...d));
      }
  const safeDepth = depth - chunk.maxError;
  if (safeDepth <= view.near) return Infinity;
  const focal = view.viewportHeight / (2 * Math.tan((view.verticalFov * Math.PI) / 360));
  // Includes perspective denominator movement, not merely focal*error/depth.
  return focal * chunk.maxError * (1 / safeDepth + radius / (safeDepth * safeDepth));
}
export function selectSurfaceLod(errorPixels: number, current: 1 | 2, refinePixels = 3, coarsenPixels = 2): 1 | 2 {
  if (
    Number.isNaN(errorPixels) ||
    errorPixels < 0 ||
    ![refinePixels, coarsenPixels].every(Number.isFinite) ||
    (current !== 1 && current !== 2) ||
    !(refinePixels > coarsenPixels) ||
    coarsenPixels < 0
  )
    throw Error('terrain LOD: invalid thresholds');
  return errorPixels > refinePixels ? 1 : errorPixels < coarsenPixels ? 2 : current;
}
