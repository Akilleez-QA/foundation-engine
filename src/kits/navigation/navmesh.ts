/**
 * Polygon navigation meshes (walkmeshes): creator-authored convex polygons joined at shared edges, located by a
 * uniform grid, routed with the existing incremental path search over a polygon graph, and turned into straight
 * waypoints by the funnel (string-pulling) algorithm with optional agent-radius clearance. `walkMesh` moves a point
 * along the surface and stops at the boundary. Generating a mesh from level geometry is an offline tooling concern;
 * this file only queries one.
 */
import {createNavigationGraph, type NavigationGraph} from './search';

export type MeshPoint = readonly [number, number, number];
export interface NavMeshInput {
  /** 3-65,536 vertices [x, y, z]; y is up. */
  readonly vertices: readonly MeshPoint[];
  /**
   * 1-8,192 strictly convex, planar polygons of 3-16 vertex indices, counter-clockwise in (x, z) coordinates (positive (b − a) × (c − a) with x as the first axis and z as the second, as in the terrain kit). Vertices at the same position must share
   * an index to connect; T-junctions do not connect.
   */
  readonly polygons: readonly (readonly number[])[];
  /** Grid cell size for point location, (0, 1e6]. Default: about the mean polygon size. */
  readonly cellSize?: number;
}
export interface NavMesh {
  readonly vertices: readonly MeshPoint[];
  readonly polygons: readonly (readonly number[])[];
  /** neighbors[p][e]: polygon across edge e (from vertex e to e+1), or -1 for a boundary edge. */
  readonly neighbors: readonly (readonly number[])[];
  readonly centroids: readonly MeshPoint[];
}
export const NAVMESH_LIMITS = Object.freeze({
  vertices: 65536,
  polygons: 8192,
  edges: 65536,
  polygonVertices: 16,
  corners: 1024,
});

function fail(message: string): never {
  throw new RangeError(`navmesh: ${message}`);
}
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const point = (v: unknown, what: string): MeshPoint => {
  if (!Array.isArray(v) || v.length !== 3) fail(`${what} must be [x, y, z]`);
  const p: MeshPoint = [v[0], v[1], v[2]];
  if (!p.every(finite) || p.some(c => Math.abs(c) > 1e7)) fail(`${what} must be finite within ±1e7`);
  return p;
};
/** Twice the signed area of (a, b, c) in (x, z) coordinates; positive for the accepted winding. */
const cross = (ax: number, az: number, bx: number, bz: number, cx: number, cz: number) =>
  (bx - ax) * (cz - az) - (bz - az) * (cx - ax);

interface Internal {
  readonly grid: Map<number, number[]>;
  readonly cell: number;
  readonly cols: number;
  readonly minX: number;
  readonly minZ: number;
}
const internals = new WeakMap<NavMesh, Internal>();
const meshOf = (mesh: NavMesh): Internal => {
  const i = internals.get(mesh);
  if (!i) fail('use defineNavMesh for the mesh');
  return i;
};

/** Validate, copy and freeze a mesh; compute adjacency (each edge shared by at most two polygons) and a locator grid. */
export function defineNavMesh(input: NavMeshInput): NavMesh {
  if (!input || typeof input !== 'object') fail('mesh must be an object');
  const vIn = input.vertices,
    pIn = input.polygons;
  if (!Array.isArray(vIn) || vIn.length < 3 || vIn.length > NAVMESH_LIMITS.vertices) fail('3-65,536 vertices');
  if (!Array.isArray(pIn) || pIn.length < 1 || pIn.length > NAVMESH_LIMITS.polygons) fail('1-8,192 polygons');
  const nv = vIn.length,
    np = pIn.length;
  const vertices: MeshPoint[] = [];
  for (let i = 0; i < nv; i++) vertices.push(Object.freeze(point(vIn[i], `vertex ${i}`)) as MeshPoint);
  const polygons: number[][] = [];
  for (let p = 0; p < np; p++) {
    const raw = pIn[p];
    if (!Array.isArray(raw) || raw.length < 3 || raw.length > NAVMESH_LIMITS.polygonVertices)
      fail(`polygon ${p} needs 3-16 vertices`);
    const n = raw.length,
      poly: number[] = [];
    for (let k = 0; k < n; k++) {
      const v: unknown = raw[k];
      if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0 || v >= nv) fail(`polygon ${p} has a bad index`);
      if (poly.includes(v)) fail(`polygon ${p} repeats a vertex`);
      poly.push(v);
    }
    for (let k = 0; k < n; k++) {
      const a = vertices[poly[k]!]!,
        b = vertices[poly[(k + 1) % n]!]!,
        c = vertices[poly[(k + 2) % n]!]!;
      if (cross(a[0], a[2], b[0], b[2], c[0], c[2]) <= 0)
        fail(`polygon ${p} must be strictly convex and counter-clockwise in (x, z)`);
    }
    polygons.push(poly);
  }
  // Adjacency: an undirected edge key maps to the polygons using it (each in opposite direction).
  const edges = new Map<string, {p: number; e: number}[]>();
  polygons.forEach((poly, p) =>
    poly.forEach((v, e) => {
      const w = poly[(e + 1) % poly.length]!;
      const key = v < w ? `${v}:${w}` : `${w}:${v}`;
      const list = edges.get(key) ?? [];
      if (list.some(o => polygons[o.p]![o.e] === v)) fail(`polygons ${list[0]!.p} and ${p} overlap along edge ${key}`);
      list.push({p, e});
      if (list.length > 2) fail(`edge ${key} is shared by more than two polygons`);
      edges.set(key, list);
    }),
  );
  const neighbors = polygons.map(poly => poly.map(() => -1));
  for (const list of edges.values())
    if (list.length === 2) {
      const [a, b] = list as [{p: number; e: number}, {p: number; e: number}];
      if (a.p === b.p) fail(`polygon ${a.p} uses an edge twice`);
      neighbors[a.p]![a.e] = b.p;
      neighbors[b.p]![b.e] = a.p;
    }
  const centroids = polygons.map(poly => {
    let x = 0,
      y = 0,
      z = 0;
    for (const v of poly) {
      x += vertices[v]![0];
      y += vertices[v]![1];
      z += vertices[v]![2];
    }
    return Object.freeze([x / poly.length, y / poly.length, z / poly.length]) as MeshPoint;
  });
  // Locator grid over polygon bounding boxes in x/z.
  let minX = Infinity,
    minZ = Infinity,
    maxX = -Infinity,
    maxZ = -Infinity,
    sum = 0;
  const boxes = polygons.map(poly => {
    let x0 = Infinity,
      z0 = Infinity,
      x1 = -Infinity,
      z1 = -Infinity;
    for (const v of poly) {
      const p = vertices[v]!;
      x0 = Math.min(x0, p[0]);
      z0 = Math.min(z0, p[2]);
      x1 = Math.max(x1, p[0]);
      z1 = Math.max(z1, p[2]);
    }
    minX = Math.min(minX, x0);
    minZ = Math.min(minZ, z0);
    maxX = Math.max(maxX, x1);
    maxZ = Math.max(maxZ, z1);
    sum += Math.max(x1 - x0, z1 - z0);
    return [x0, z0, x1, z1] as const;
  });
  const span = Math.max(maxX - minX, maxZ - minZ, 1e-6);
  let cell = input.cellSize ?? Math.max(sum / np, 1e-6);
  if (!finite(cell) || cell <= 0 || cell > 1e6) fail('cellSize must be within (0, 1e6]');
  cell = Math.max(cell, span / 1024); // at most ~1M cells
  const cols = Math.floor((maxX - minX) / cell) + 1;
  const grid = new Map<number, number[]>();
  let entries = 0;
  boxes.forEach(([x0, z0, x1, z1], p) => {
    for (let cz = Math.floor((z0 - minZ) / cell); cz <= Math.floor((z1 - minZ) / cell); cz++)
      for (let cx = Math.floor((x0 - minX) / cell); cx <= Math.floor((x1 - minX) / cell); cx++) {
        if (++entries > 4_000_000) fail('locator grid too large: raise cellSize');
        const k = cz * cols + cx;
        const list = grid.get(k);
        if (list) list.push(p);
        else grid.set(k, [p]);
      }
  });
  const mesh: NavMesh = Object.freeze({
    vertices: Object.freeze(vertices),
    polygons: Object.freeze(polygons.map(p => Object.freeze(p))),
    neighbors: Object.freeze(neighbors.map(n => Object.freeze(n))),
    centroids: Object.freeze(centroids),
  });
  internals.set(mesh, {grid, cell, cols, minX, minZ});
  return mesh;
}

/** True when (x, z) is inside or on polygon p (x/z plane). */
function inside(mesh: NavMesh, p: number, x: number, z: number): boolean {
  const poly = mesh.polygons[p]!;
  for (let k = 0; k < poly.length; k++) {
    const a = mesh.vertices[poly[k]!]!,
      b = mesh.vertices[poly[(k + 1) % poly.length]!]!;
    const len2 = (b[0] - a[0]) ** 2 + (b[2] - a[2]) ** 2;
    if (cross(a[0], a[2], b[0], b[2], x, z) < -1e-9 * Math.max(1, len2)) return false;
  }
  return true;
}
/** Height of polygon p's plane at (x, z), from its first three vertices. */
function heightAt(mesh: NavMesh, p: number, x: number, z: number): number {
  const poly = mesh.polygons[p]!;
  const a = mesh.vertices[poly[0]!]!,
    b = mesh.vertices[poly[1]!]!,
    c = mesh.vertices[poly[2]!]!;
  const d = cross(a[0], a[2], b[0], b[2], c[0], c[2]);
  const wb = cross(a[0], a[2], x, z, c[0], c[2]) / d,
    wc = cross(a[0], a[2], b[0], b[2], x, z) / d;
  return a[1] + (b[1] - a[1]) * wb + (c[1] - a[1]) * wc;
}

/**
 * The polygon under `position`: among polygons containing its x/z, the one whose surface height is nearest the point's
 * y within `maxHeight` (default 2). Null when off the mesh. Ties by lower polygon index.
 */
export function locate(mesh: NavMesh, position: MeshPoint, maxHeight = 2): number | null {
  const m = meshOf(mesh),
    p = point(position, 'position');
  if (!finite(maxHeight) || maxHeight < 0) fail('maxHeight must be ≥ 0');
  const cx = Math.floor((p[0] - m.minX) / m.cell),
    cz = Math.floor((p[2] - m.minZ) / m.cell);
  if (cx < 0 || cz < 0 || cx >= m.cols) return null;
  let best: number | null = null,
    bestDy = Infinity;
  for (const poly of m.grid.get(cz * m.cols + cx) ?? []) {
    if (!inside(mesh, poly, p[0], p[2])) continue;
    const dy = Math.abs(heightAt(mesh, poly, p[0], p[2]) - p[1]);
    if (dy <= maxHeight && (dy < bestDy || (dy === bestDy && poly < best!))) {
      best = poly;
      bestDy = dy;
    }
  }
  return best;
}

/**
 * The polygon graph for `createPathSearch`: node ids are `p<index>`, edges join neighbours with cost = distance between
 * the midpoints of the shared edges (centroid to portal midpoint to centroid). Use `corridor` to turn a path back into
 * polygon indices, then `findStraightPath`.
 */
export function navMeshGraph(mesh: NavMesh): NavigationGraph {
  meshOf(mesh);
  const edges = mesh.neighbors.reduce((n, list) => n + list.filter(q => q >= 0).length, 0);
  if (edges > NAVMESH_LIMITS.edges)
    fail(`mesh has ${edges} portal edges; the navigation graph admits ${NAVMESH_LIMITS.edges}`);
  const dist = (a: MeshPoint, b: MeshPoint) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  return createNavigationGraph(
    mesh.polygons.map((poly, p) => ({
      id: `p${p}`,
      edges: mesh.neighbors[p]!.flatMap((q, e) => {
        if (q < 0) return [];
        const a = mesh.vertices[poly[e]!]!,
          b = mesh.vertices[poly[(e + 1) % poly.length]!]!;
        const mid: MeshPoint = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
        return [{to: `p${q}`, cost: dist(mesh.centroids[p]!, mid) + dist(mid, mesh.centroids[q]!)}];
      }),
    })),
  );
}
/** Polygon indices for a path of `navMeshGraph` node ids. */
export function corridor(path: readonly string[]): number[] {
  return path.map(id => {
    const m = /^p(0|[1-9]\d{0,4})$/.exec(id);
    if (!m) fail(`not a navmesh node id: ${id}`);
    return Number(m[1]);
  });
}

export type StraightPath =
  | {readonly status: 'ok'; readonly points: readonly MeshPoint[]}
  | {readonly status: 'too-narrow'; readonly portal: number}
  | {readonly status: 'broken'; readonly at: number}
  | {readonly status: 'off-corridor'; readonly which: 'start' | 'goal'}
  | {readonly status: 'too-many-corners'};

/**
 * Funnel (string-pulling) over a polygon corridor from `start` to `goal`: the shortest path through the corridor's
 * portals in x/z, as corner waypoints including both ends: corners take heights interpolated along their portal edge,
 * the ends keep the caller's points. `radius` shrinks each portal from both ends (an approximation of a disc's path);
 * a portal narrower than 2 × radius returns `too-narrow`. Start and goal must lie in the first and last polygons
 * (`off-corridor` otherwise); consecutive polygons must be neighbours (`broken`). Consecutive duplicate corners are
 * removed; more than 1,024 corners returns `too-many-corners`.
 */
export function findStraightPath(
  mesh: NavMesh,
  path: readonly number[],
  start: MeshPoint,
  goal: MeshPoint,
  radius = 0,
): StraightPath {
  meshOf(mesh);
  const s = point(start, 'start'),
    g = point(goal, 'goal');
  if (!finite(radius) || radius < 0) fail('radius must be ≥ 0');
  if (!Array.isArray(path) || path.length < 1 || path.length > NAVMESH_LIMITS.polygons)
    fail('corridor must be 1-16,384 polygons');
  const ids0 = path.map((p, i) => {
    if (typeof p !== 'number' || !Number.isSafeInteger(p) || p < 0 || p >= mesh.polygons.length)
      fail(`corridor ${i} is not a polygon`);
    return p;
  });
  const ids = ids0;
  if (!inside(mesh, ids[0]!, s[0], s[2])) return Object.freeze({status: 'off-corridor', which: 'start'});
  if (!inside(mesh, ids[ids.length - 1]!, g[0], g[2])) return Object.freeze({status: 'off-corridor', which: 'goal'});
  // Portals as [left, right] seen walking from one polygon to the next, then the goal as a zero-width portal.
  const portals: [MeshPoint, MeshPoint][] = [];
  for (let i = 0; i + 1 < ids.length; i++) {
    const a = ids[i]!,
      b = ids[i + 1]!,
      e = mesh.neighbors[a]!.indexOf(b);
    if (e < 0) return Object.freeze({status: 'broken', at: i});
    const poly = mesh.polygons[a]!;
    // Polygon a is counter-clockwise, so edge (v_e → v_e+1) has the interior on its left: walking out through it,
    // v_e is on the right and v_e+1 on the left.
    let right = mesh.vertices[poly[e]!]!,
      left = mesh.vertices[poly[(e + 1) % poly.length]!]!;
    if (radius > 0) {
      const dx = left[0] - right[0],
        dz = left[2] - right[2],
        w = Math.hypot(dx, dz);
      if (w <= 2 * radius) return Object.freeze({status: 'too-narrow', portal: i});
      const ux = dx / w,
        uz = dz / w;
      const k = radius / w,
        dy = left[1] - right[1];
      right = [right[0] + ux * radius, right[1] + dy * k, right[2] + uz * radius];
      left = [left[0] - ux * radius, left[1] - dy * k, left[2] - uz * radius];
    }
    portals.push([left, right]);
  }
  portals.push([g, g]);
  const points: MeshPoint[] = [s];
  let apex: MeshPoint = s,
    left: MeshPoint = s,
    right: MeshPoint = s,
    apexIndex = -1,
    leftIndex = -1,
    rightIndex = -1;
  const tri = (a: MeshPoint, b: MeshPoint, c: MeshPoint) => cross(a[0], a[2], b[0], b[2], c[0], c[2]);
  const same = (a: MeshPoint, b: MeshPoint) => Math.abs(a[0] - b[0]) < 1e-12 && Math.abs(a[2] - b[2]) < 1e-12;
  for (let i = 0; i < portals.length; i++) {
    const [pl, pr] = portals[i]!;
    // Tighten the right side (right must stay clockwise of left, i.e. cross(apex, left, right) ≤ 0).
    if (tri(apex, right, pr) >= 0) {
      if (same(apex, right) || tri(apex, left, pr) < 0) {
        right = pr;
        rightIndex = i;
      } else {
        // Right crossed over left: left becomes a corner.
        if (!same(points[points.length - 1]!, left)) points.push(left);
        if (points.length > NAVMESH_LIMITS.corners) return Object.freeze({status: 'too-many-corners'});
        apex = left;
        apexIndex = leftIndex;
        left = apex;
        right = apex;
        leftIndex = apexIndex;
        rightIndex = apexIndex;
        i = apexIndex;
        continue;
      }
    }
    if (tri(apex, left, pl) <= 0) {
      if (same(apex, left) || tri(apex, right, pl) > 0) {
        left = pl;
        leftIndex = i;
      } else {
        if (!same(points[points.length - 1]!, right)) points.push(right);
        if (points.length > NAVMESH_LIMITS.corners) return Object.freeze({status: 'too-many-corners'});
        apex = right;
        apexIndex = rightIndex;
        left = apex;
        right = apex;
        leftIndex = apexIndex;
        rightIndex = apexIndex;
        i = apexIndex;
        continue;
      }
    }
  }
  if (!same(points[points.length - 1]!, g)) points.push(g);
  return Object.freeze({
    status: 'ok',
    points: Object.freeze(points.map(p => Object.freeze([p[0], p[1], p[2]]) as MeshPoint)),
  });
}

/**
 * Move from `from` (inside polygon `start`) by `delta` in x/z across shared edges, stopping at the first boundary edge
 * (with `slide`, the remaining motion continues along that edge once). Returns the end point (height on the end
 * polygon's plane), the end polygon, whether a boundary was hit, and `truncated` when the 256-crossing bound stopped the
 * move early. `from` must lie in `start`. Moving exactly along a shared edge stays in the polygon it starts in.
 */
export function walkMesh(
  mesh: NavMesh,
  start: number,
  from: MeshPoint,
  delta: readonly [number, number],
  slide = true,
): {
  readonly position: MeshPoint;
  readonly polygon: number;
  readonly blocked: boolean;
  readonly truncated: boolean;
} {
  meshOf(mesh);
  if (!Number.isSafeInteger(start) || start < 0 || start >= mesh.polygons.length) fail('start must be a polygon index');
  const f = point(from, 'from');
  if (!Array.isArray(delta) || delta.length !== 2) fail('delta must be [dx, dz]');
  const d0: unknown = delta[0],
    d1: unknown = delta[1];
  if (!finite(d0) || !finite(d1)) fail('delta must be finite');
  if (!inside(mesh, start, f[0], f[2])) fail('from must lie inside the start polygon');
  let truncated = false;
  let x = f[0],
    z = f[2],
    dx = d0,
    dz = d1,
    poly = start,
    blocked = false,
    slid = !slide;
  for (let step = 0; dx !== 0 || dz !== 0; step++) {
    if (step >= 256) {
      truncated = true;
      break;
    }
    const verts = mesh.polygons[poly]!;
    // Earliest exit edge along the move.
    let tExit = 1,
      exitEdge = -1;
    for (let e = 0; e < verts.length; e++) {
      const a = mesh.vertices[verts[e]!]!,
        b = mesh.vertices[verts[(e + 1) % verts.length]!]!;
      const ex = b[0] - a[0],
        ez = b[2] - a[2];
      // The interior is left of a counter-clockwise edge (positive cross); moving so the cross falls leaves it.
      const rate = ex * dz - ez * dx;
      if (rate >= -1e-15) continue;
      const t = (ex * (z - a[2]) - ez * (x - a[0])) / -rate;
      const tt = Math.max(0, t);
      if (tt < tExit) {
        tExit = tt;
        exitEdge = e;
      }
    }
    if (exitEdge < 0) {
      x += dx;
      z += dz;
      break;
    }
    x += dx * tExit;
    z += dz * tExit;
    const rest: [number, number] = [dx * (1 - tExit), dz * (1 - tExit)];
    const next = mesh.neighbors[poly]![exitEdge]!;
    if (next >= 0) {
      poly = next;
      [dx, dz] = rest;
      continue;
    }
    blocked = true;
    if (slid) break;
    slid = true;
    const a = mesh.vertices[verts[exitEdge]!]!,
      b = mesh.vertices[verts[(exitEdge + 1) % verts.length]!]!;
    const ex = b[0] - a[0],
      ez = b[2] - a[2],
      len2 = ex * ex + ez * ez;
    const along = (rest[0] * ex + rest[1] * ez) / len2;
    dx = ex * along;
    dz = ez * along;
  }
  const y = heightAt(mesh, poly, x, z);
  return Object.freeze({position: Object.freeze([x, y, z]) as MeshPoint, polygon: poly, blocked, truncated});
}
