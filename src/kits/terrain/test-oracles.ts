/** Small independent numeric reference for tests, never imported by the terrain runtime. */
export interface OraclePoint { readonly x: number; readonly y: number; readonly z: number }
export interface OracleGrid { baseX: number; baseZ: number; spacing: number; startX: number; startZ: number; cellsX: number; cellsZ: number }
export interface OracleSourcePoint { readonly gx: number; readonly gz: number; readonly x: number; readonly z: number }
export interface OracleTriangle {
  readonly vertices: readonly [OraclePoint, OraclePoint, OraclePoint];
  readonly normal: OraclePoint;
  readonly area: number;
}
export interface OracleContact extends OraclePoint { readonly normal: OraclePoint; readonly distance: number }
const point = (x: number, y: number, z: number): OraclePoint => Object.freeze({ x, y, z });
const finite = (n: number) => { if (!Number.isFinite(n)) throw Error('oracle: finite value required'); return n; };
const integer = (n: number) => { if (!Number.isSafeInteger(n)) throw Error('oracle: integer required'); return n; };
/** Round the full global expression once, never recompose from a rounded local origin. */
export function oracleAxis(base: number, spacing: number, start: number, cells: number): readonly number[] {
  finite(base); finite(spacing); integer(start); integer(cells);
  if (spacing <= 0 || cells < 1 || cells > 18) throw Error('oracle: axis bound');
  const values: number[] = [];
  for (let i = 0; i <= cells; i++) {
    const value = Math.fround(base + integer(start + i) * spacing);
    if (!Number.isFinite(value) || (i > 0 && value <= values[i - 1]!)) throw Error('oracle: collapsed axis');
    values.push(value);
  }
  return Object.freeze(values);
}
function triangle(a: OraclePoint, b: OraclePoint, c: OraclePoint): OracleTriangle {
  // Solve the height plane h(x,z) = h(a) + sx*(x-a.x) + sz*(z-a.z).
  // This reference deliberately does not reuse runtime triangle cross-products.
  const bx = b.x - a.x, bz = b.z - a.z, cx = c.x - a.x, cz = c.z - a.z;
  const determinant = bx * cz - cx * bz;
  if (!Number.isFinite(determinant) || determinant === 0) throw Error('oracle: degenerate triangle');
  const sx = ((b.y - a.y) * cz - (c.y - a.y) * bz) / determinant;
  const sz = (bx * (c.y - a.y) - cx * (b.y - a.y)) / determinant;
  const length = Math.hypot(sx, 1, sz), area = Math.abs(determinant) * length / 2;
  if (!Number.isFinite(area) || !Number.isFinite(length)) throw Error('oracle: overflowing triangle');
  return Object.freeze({ vertices: Object.freeze([a, b, c] as const), normal: point(-sx / length, 1 / length, -sz / length), area });
}
function barycentric(t: OracleTriangle, x: number, z: number): readonly [number, number, number] | null {
  const [a, b, c] = t.vertices;
  const denominator = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
  const wa = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / denominator;
  const wb = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / denominator;
  const wc = 1 - wa - wb;
  // This tolerance is solely for a reference point lying numerically on a shared edge.
  return Math.min(wa, wb, wc) >= -1e-10 && Math.max(wa, wb, wc) <= 1 + 1e-10 ? [wa, wb, wc] : null;
}
/** Brute-force finite reference: up to 16x16 core cells plus one dependency cell on every side. */
export function createTerrainOracle(grid: OracleGrid, source: (point: OracleSourcePoint) => number) {
  const { baseX, baseZ, spacing, startX, startZ, cellsX, cellsZ } = grid;
  integer(cellsX); integer(cellsZ);
  if (cellsX < 1 || cellsX > 16 || cellsZ < 1 || cellsZ > 16 || typeof source !== 'function') throw Error('oracle: core bound');
  const xs = oracleAxis(baseX, spacing, integer(startX - 1), cellsX + 2);
  const zs = oracleAxis(baseZ, spacing, integer(startZ - 1), cellsZ + 2);
  const vertices: OraclePoint[][] = [];
  for (let iz = 0; iz < zs.length; iz++) {
    const row: OraclePoint[] = [];
    for (let ix = 0; ix < xs.length; ix++) {
      const x = xs[ix]!, z = zs[iz]!, height = Math.fround(finite(source(Object.freeze({ gx: startX + ix - 1, gz: startZ + iz - 1, x, z }))));
      row.push(point(x, finite(height), z));
    }
    vertices.push(row);
  }
  const cell = (ix: number, iz: number): readonly OracleTriangle[] => {
    const southwest = vertices[iz]![ix]!, southeast = vertices[iz]![ix + 1]!;
    const northwest = vertices[iz + 1]![ix]!, northeast = vertices[iz + 1]![ix + 1]!;
    // The declared diagonal joins southeast to northwest; both faces point upward.
    return [triangle(southwest, northwest, southeast), triangle(southeast, northwest, northeast)];
  };
  const core: OracleTriangle[] = [];
  for (let iz = 1; iz <= cellsZ; iz++) for (let ix = 1; ix <= cellsX; ix++) core.push(...cell(ix, iz));
  const triangles = Object.freeze(core);
  const extent = Object.freeze({ minX: xs[1]!, maxX: xs[cellsX + 1]!, minZ: zs[1]!, maxZ: zs[cellsZ + 1]! });
  return Object.freeze({
    extent,
    vertex(ix: number, iz: number) {
      integer(ix); integer(iz);
      if (ix < 0 || ix > cellsX || iz < 0 || iz > cellsZ) throw Error('oracle: outside core');
      const vertex = vertices[iz + 1]![ix + 1]!;
      let nx = 0, ny = 0, nz = 0;
      // Enumerate incident faces from four surrounding cells, including halo cells.
      for (const z of [iz, iz + 1]) for (const x of [ix, ix + 1]) for (const face of cell(x, z)) {
        if (!face.vertices.includes(vertex)) continue;
        nx += face.normal.x * face.area; ny += face.normal.y * face.area; nz += face.normal.z * face.area;
      }
      const length = Math.hypot(nx, ny, nz);
      return Object.freeze({ ...vertex, normal: point(nx / length, ny / length, nz / length) });
    },
    triangles: () => triangles,
    sample(x: number, z: number) {
      finite(x); finite(z);
      if (x < extent.minX || x > extent.maxX || z < extent.minZ || z > extent.maxZ) return null;
      for (const face of triangles) {
        const weights = barycentric(face, x, z);
        if (weights) return Object.freeze({ x, y: face.vertices.reduce((sum, v, index) => sum + v.y * weights[index]!, 0), z, normal: face.normal });
      }
      return null;
    },
    raycast(origin: OraclePoint, direction: OraclePoint, maxDistance = Infinity): OracleContact | null {
      for (const value of [origin.x, origin.y, origin.z, direction.x, direction.y, direction.z]) finite(value);
      if (Number.isNaN(maxDistance) || maxDistance < 0) throw Error('oracle: invalid range');
      const magnitude = Math.hypot(direction.x, direction.y, direction.z);
      if (!Number.isFinite(magnitude) || magnitude === 0) throw Error('oracle: invalid ray');
      const ray = point(direction.x / magnitude, direction.y / magnitude, direction.z / magnitude);
      let nearest: OracleContact | null = null;
      for (const face of triangles) {
        const n = face.normal, a = face.vertices[0];
        const denominator = n.x * ray.x + n.y * ray.y + n.z * ray.z;
        if (Math.abs(denominator) < 1e-14) continue;
        const signedDistance = (n.x * (a.x - origin.x) + n.y * (a.y - origin.y) + n.z * (a.z - origin.z)) / denominator;
        const distance = signedDistance === 0 ? 0 : signedDistance;
        if (distance < 0 || distance > maxDistance || (nearest && distance >= nearest.distance)) continue;
        const x = origin.x + distance * ray.x, y = origin.y + distance * ray.y, z = origin.z + distance * ray.z;
        if (!barycentric(face, x, z)) continue;
        nearest = Object.freeze({ x, y, z, distance, normal: n });
      }
      return nearest;
    },
  });
}
