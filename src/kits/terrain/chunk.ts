import type { Surface, SurfaceMesh } from './surface';

export interface SurfaceChunkOptions {
  readonly startX: number;
  readonly startZ: number;
  readonly cellsX: number;
  readonly cellsZ: number;
  readonly stride: 1 | 2 | 4;
  /** Maximum permitted conservative vertical error; omitted accepts the reported bound. */
  readonly maxError?: number;
}
export interface SurfaceChunk {
  readonly mesh: SurfaceMesh;
  readonly bounds: Readonly<{ min: Readonly<{ x: number; y: number; z: number }>; max: Readonly<{ x: number; y: number; z: number }> }>;
  /** Actual stride: one when the requested error bound required fallback. */
  readonly stride: 1 | 2 | 4;
  /** Conservative vertical error bound, not a measured maximum. Zero for canonical triangles. */
  readonly maxError: number;
}

/**
 * Build one finite tile from the canonical lattice. Fine outer borders preserve identical
 * edge vertices across neighboring tiles of any supported stride, without skirts.
 * Coarse blocks fan around their canonical center. Both height range and affine-plane residuals bound vertical
 * error everywhere, including intersections of coarse and canonical triangle edges.
 * Build on revision/LOD changes, not each frame. Reads only the requested tile lattice.
 */
export function buildSurfaceChunk(surface: Surface, options: SurfaceChunkOptions): SurfaceChunk {
  const { startX, startZ, cellsX, cellsZ } = options;
  for (const value of [startX, startZ, cellsX, cellsZ]) {
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('terrain chunk: ranges must be nonnegative integer grid coordinates');
  }
  if (cellsX === 0 || cellsZ === 0 || startX + cellsX > surface.cellsX || startZ + cellsZ > surface.cellsZ) throw new RangeError('terrain chunk: range outside surface');
  if (![1, 2, 4].includes(options.stride) || cellsX % options.stride !== 0 || cellsZ % options.stride !== 0) throw new RangeError('terrain chunk: stride must be 1, 2 or 4 and divide both dimensions');
  if (options.maxError !== undefined && (!Number.isFinite(options.maxError) || options.maxError < 0)) throw new RangeError('terrain chunk: maxError must be finite and nonnegative');

  const width = surface.cellsX + 1;
  // Only copy this tile's lattice, never the complete surface per chunk.
  const canonical: number[] = [], attributes = new Map<number, ReturnType<Surface['vertex']>>();
  let material: number | undefined, boundary = false;
  for (let z=startZ;z<=startZ+cellsZ;z++)for(let x=startX;x<=startX+cellsX;x++) {
    const v=surface.vertex(x,z), i=z*width+x;attributes.set(i,v);canonical[i*3]=v.x;canonical[i*3+1]=v.y;canonical[i*3+2]=v.z;
    if(material===undefined)material=v.material;else if(material!==v.material)boundary=true;
  }
  // Exact tile fallback preserves discrete authored boundaries and cannot introduce
  // internal coarse/fine T junctions. Homogeneous neighbors may still simplify.
  if(boundary && options.stride>1)return buildSurfaceChunk(surface,{...options,stride:1});
  const endX = startX + cellsX, endZ = startZ + cellsZ;
  const stride = options.stride;
  let maxError = 0, planeError = 0;
  if (stride > 1) {
    for (let z = startZ; z < endZ; z += stride) for (let x = startX; x < endX; x += stride) {
      let min = Infinity, max = -Infinity;
      for (let dz = 0; dz <= stride; dz++) for (let dx = 0; dx <= stride; dx++) {
        const h = canonical[((z + dz) * width + x + dx) * 3 + 1]!;
        min = Math.min(min, h); max = Math.max(max, h);
      }
      maxError = Math.max(maxError, max - min);
    }
  }

  const positions: number[] = [], indices: number[] = [], normals: number[] = [], vertices = new Map<number, number>();
  const min = { x: Infinity, y: Infinity, z: Infinity }, max = { x: -Infinity, y: -Infinity, z: -Infinity };
  const vertex = (x: number, z: number): number => {
    const key = z * width + x, existing = vertices.get(key);
    if (existing !== undefined) return existing;
    const offset = key * 3, index = positions.length / 3;
    const px = canonical[offset]!, py = canonical[offset + 1]!, pz = canonical[offset + 2]!;
    if (![px, py, pz].every(Number.isFinite)) throw new RangeError('terrain chunk: malformed canonical mesh');
    positions.push(px, py, pz); const n=attributes.get(key)!.normal;normals.push(n.x,n.y,n.z); vertices.set(key, index);
    min.x = Math.min(min.x, px); min.y = Math.min(min.y, py); min.z = Math.min(min.z, pz);
    max.x = Math.max(max.x, px); max.y = Math.max(max.y, py); max.z = Math.max(max.z, pz);
    return index;
  };
  for (let z = startZ; z < endZ; z += stride) for (let x = startX; x < endX; x += stride) {
    if (stride === 1) {
      const a = vertex(x, z), b = vertex(x + 1, z), c = vertex(x, z + 1), d = vertex(x + 1, z + 1);
      indices.push(a, c, b, b, c, d);
      continue;
    }
    const center = vertex(x + stride / 2, z + stride / 2), perimeter: number[] = [];
    // Walk counterclockwise in X/Z coordinates; the resulting 3D normal points up.
    const leftStep = x === startX ? 1 : stride, bottomStep = z + stride === endZ ? 1 : stride;
    const rightStep = x + stride === endX ? 1 : stride, topStep = z === startZ ? 1 : stride;
    for (let dz = 0; dz < stride; dz += leftStep) perimeter.push(vertex(x, z + dz));
    for (let dx = 0; dx < stride; dx += bottomStep) perimeter.push(vertex(x + dx, z + stride));
    for (let dz = stride; dz > 0; dz -= rightStep) perimeter.push(vertex(x + stride, z + dz));
    for (let dx = stride; dx > 0; dx -= topStep) perimeter.push(vertex(x + dx, z));
    for (let p = 0; p < perimeter.length; p++) {
      const a = perimeter[p]!, b = perimeter[(p + 1) % perimeter.length]!;
      indices.push(center, a, b);
      // On each canonical triangle, the difference from this coarse affine plane
      // is affine too. Its extrema occur at canonical vertices. Checking the whole
      // block (a superset of this fan triangle) gives a conservative bound without
      // needing to construct all intersections between the two triangulations.
      const cx = positions[center * 3]!, cz = positions[center * 3 + 2]!, cy = positions[center * 3 + 1]!;
      const ax = positions[a * 3]! - cx, az = positions[a * 3 + 2]! - cz, ay = positions[a * 3 + 1]! - cy;
      const bx = positions[b * 3]! - cx, bz = positions[b * 3 + 2]! - cz, by = positions[b * 3 + 1]! - cy;
      const determinant = ax * bz - az * bx;
      const slopeX = (ay * bz - az * by) / determinant, slopeZ = (ax * by - ay * bx) / determinant;
      for (let dz = 0; dz <= stride; dz++) for (let dx = 0; dx <= stride; dx++) {
        const offset = ((z + dz) * width + x + dx) * 3;
        const plane = cy + slopeX * (canonical[offset]! - cx) + slopeZ * (canonical[offset + 2]! - cz);
        planeError = Math.max(planeError, Math.abs(canonical[offset + 1]! - plane));
      }
    }
  }
  maxError = Math.min(maxError, planeError);
  if (options.maxError !== undefined && maxError > options.maxError) return buildSurfaceChunk(surface, { ...options, stride: 1 });
  return Object.freeze({ mesh: { positions, indices, normals }, bounds: Object.freeze({ min: Object.freeze(min), max: Object.freeze(max) }), stride, maxError });
}
