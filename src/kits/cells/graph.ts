/**
 * kits/cells/graph.ts: the creator's cells (axis-aligned boxes) and portals (planar convex polygons joining two
 * cells, open or closed), validated and packed into flat arrays at construction. Pure data; no renderer.
 */

export type CellVec3 = readonly [x: number, y: number, z: number];

/** One cell: an axis-aligned box, `min <= max` on every axis. */
export interface CellBox {
  readonly min: CellVec3;
  readonly max: CellVec3;
}

/** One portal: a planar convex polygon (3 or more vertices in order) joining cells `a` and `b`. */
export interface PortalInput {
  readonly a: number;
  readonly b: number;
  readonly points: readonly CellVec3[];
  /** Closed portals (a shut door) are never traversed. Default open. */
  readonly open?: boolean;
}

export interface CellGraphLimits {
  /** Ceiling on cells, at most `CELL_CEILING`. */
  readonly maxCells: number;
  /** Ceiling on portals, at most `PORTAL_CEILING`. */
  readonly maxPortals: number;
  /** Ceiling on vertices per portal, 3 to `PORTAL_VERTEX_CEILING`. */
  readonly maxPortalVertices: number;
}

export interface CellGraphInput {
  readonly cells: readonly CellBox[];
  readonly portals: readonly PortalInput[];
  readonly limits: CellGraphLimits;
  /**
   * World-unit tolerance (default 0.001, at most 1): portal planarity and the distance a portal vertex may sit
   * outside either cell, the camera-in-cell slack, and the camera distance within which a portal is treated as
   * filling the current clip rectangle.
   */
  readonly tolerance?: number;
}

export const CELL_CEILING = 65_536;
export const PORTAL_CEILING = 262_144;
export const PORTAL_VERTEX_CEILING = 32;

export interface CellGraph {
  readonly cellCount: number;
  readonly portalCount: number;
  readonly maxPortalVertices: number;
  readonly tolerance: number;
  /** Advances on every effective `setOpen`; a view recomputes when it changes. */
  readonly revision: number;
  /** Open or close a portal. Returns true when the state changed. */
  setOpen(portal: number, open: boolean): boolean;
  isOpen(portal: number): boolean;
  /** The two cells a portal joins. */
  portalCells(portal: number): readonly [a: number, b: number];
  /** Cells whose box (expanded by the tolerance) contains the point, ascending, written to `out`; returns the count. */
  cellsAt(x: number, y: number, z: number, out: Int32Array): number;
  /** @internal Packed geometry read by views and PVS builders of this kit. */
  readonly packed: PackedCellGraph;
}

/** @internal */
export interface PackedCellGraph {
  /** 6 per cell: minX, minY, minZ, maxX, maxY, maxZ. */
  readonly boxes: Float64Array;
  readonly portalA: Int32Array;
  readonly portalB: Int32Array;
  readonly open: Uint8Array;
  /** Vertex range of portal p: [vertexStart[p], vertexStart[p + 1]). */
  readonly vertexStart: Int32Array;
  /** 3 per vertex. */
  readonly vertices: Float64Array;
  /** 4 per portal: unit normal and offset (n . x + d = 0). */
  readonly planes: Float64Array;
  /** Portals of cell c, ascending: adjacency[adjacencyStart[c] .. adjacencyStart[c + 1]). */
  readonly adjacencyStart: Int32Array;
  readonly adjacency: Int32Array;
}

const posInt = (v: unknown, max: number, name: string): number => {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1 || v > max)
    throw new RangeError(`cells: ${name} must be an integer in [1, ${max}]`);
  return v;
};
const finite3 = (v: unknown, name: string): CellVec3 => {
  if (!Array.isArray(v) || v.length !== 3) throw new TypeError(`cells: ${name} must be three finite numbers`);
  const [x, y, z]: unknown[] = v;
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    typeof z !== 'number' ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(z)
  )
    throw new TypeError(`cells: ${name} must be three finite numbers`);
  return [x, y, z];
};

/** Validate and pack a cell graph. Throws on malformed or over-limit input; nothing is retained from the input. */
export function createCellGraph(input: CellGraphInput): CellGraph {
  if (!input || typeof input !== 'object') throw new TypeError('cells: graph input must be an object');
  const lim = input.limits;
  if (!lim || typeof lim !== 'object') throw new TypeError('cells: limits are required');
  const maxCells = posInt(lim.maxCells, CELL_CEILING, 'maxCells'),
    maxPortals = posInt(lim.maxPortals, PORTAL_CEILING, 'maxPortals'),
    maxVerts = posInt(lim.maxPortalVertices, PORTAL_VERTEX_CEILING, 'maxPortalVertices');
  if (maxVerts < 3) throw new RangeError('cells: maxPortalVertices must be at least 3');
  const tol = input.tolerance ?? 0.001;
  if (typeof tol !== 'number' || !Number.isFinite(tol) || tol <= 0 || tol > 1)
    throw new RangeError('cells: tolerance must be in (0, 1]');
  const cells = input.cells,
    portals = input.portals;
  if (!Array.isArray(cells) || cells.length < 1) throw new TypeError('cells: at least one cell is required');
  if (cells.length > maxCells) throw new RangeError(`cells: ${cells.length} cells exceed maxCells ${maxCells}`);
  if (!Array.isArray(portals)) throw new TypeError('cells: portals must be an array');
  if (portals.length > maxPortals)
    throw new RangeError(`cells: ${portals.length} portals exceed maxPortals ${maxPortals}`);
  const n = cells.length,
    pc = portals.length;
  const boxes = new Float64Array(6 * n);
  for (let c = 0; c < n; c++) {
    const box = cells[c];
    if (!box || typeof box !== 'object') throw new TypeError(`cells: cell ${c} must be an object`);
    const mn = finite3(box.min, `cell ${c} min`),
      mx = finite3(box.max, `cell ${c} max`);
    for (let k = 0; k < 3; k++) {
      if (mn[k]! > mx[k]!) throw new RangeError(`cells: cell ${c} has min > max`);
      boxes[6 * c + k] = mn[k]!;
      boxes[6 * c + 3 + k] = mx[k]!;
    }
  }
  const portalA = new Int32Array(pc),
    portalB = new Int32Array(pc),
    open = new Uint8Array(pc),
    vertexStart = new Int32Array(pc + 1),
    planes = new Float64Array(4 * pc);
  let total = 0;
  for (let p = 0; p < pc; p++) {
    const pt = portals[p];
    if (!pt || typeof pt !== 'object' || !Array.isArray(pt.points))
      throw new TypeError(`cells: portal ${p} must have points`);
    if (pt.points.length < 3 || pt.points.length > maxVerts)
      throw new RangeError(`cells: portal ${p} needs 3 to ${maxVerts} points`);
    total += pt.points.length;
  }
  const vertices = new Float64Array(3 * total);
  const degree = new Int32Array(n);
  let v = 0;
  for (let p = 0; p < pc; p++) {
    const pt = portals[p]!;
    const a = pt.a,
      b = pt.b;
    if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || a < 0 || b < 0 || a >= n || b >= n || a === b)
      throw new RangeError(`cells: portal ${p} must join two different existing cells`);
    if (pt.open !== undefined && typeof pt.open !== 'boolean')
      throw new TypeError(`cells: portal ${p} open must be a boolean`);
    portalA[p] = a;
    portalB[p] = b;
    open[p] = pt.open === false ? 0 : 1;
    vertexStart[p] = v;
    for (let i = 0; i < pt.points.length; i++) {
      const q = finite3(pt.points[i], `portal ${p} point ${i}`);
      vertices[3 * v] = q[0];
      vertices[3 * v + 1] = q[1];
      vertices[3 * v + 2] = q[2];
      v++;
    }
    planeOf(vertices, vertexStart[p]!, v, planes, p, tol);
    for (let i = vertexStart[p]!; i < v; i++)
      for (const cell of [a, b])
        for (let k = 0; k < 3; k++) {
          const x = vertices[3 * i + k]!;
          if (x < boxes[6 * cell + k]! - tol || x > boxes[6 * cell + 3 + k]! + tol)
            throw new RangeError(`cells: portal ${p} vertex ${i - vertexStart[p]!} lies outside cell ${cell}`);
        }
    degree[a]!++;
    degree[b]!++;
  }
  vertexStart[pc] = v;
  const adjacencyStart = new Int32Array(n + 1);
  for (let c = 0; c < n; c++) adjacencyStart[c + 1] = adjacencyStart[c]! + degree[c]!;
  const adjacency = new Int32Array(adjacencyStart[n]!),
    fill = adjacencyStart.slice(0, n);
  for (let p = 0; p < pc; p++) {
    adjacency[fill[portalA[p]!]!++] = p;
    adjacency[fill[portalB[p]!]!++] = p;
  }
  const packed: PackedCellGraph = {
    boxes,
    portalA,
    portalB,
    open,
    vertexStart,
    vertices,
    planes,
    adjacencyStart,
    adjacency,
  };
  let revision = 0;
  const portalIndex = (p: number): number => {
    if (!Number.isSafeInteger(p) || p < 0 || p >= pc) throw new RangeError(`cells: no portal ${p}`);
    return p;
  };
  return {
    cellCount: n,
    portalCount: pc,
    maxPortalVertices: maxVerts,
    tolerance: tol,
    get revision() {
      return revision;
    },
    setOpen(p, value) {
      portalIndex(p);
      if (typeof value !== 'boolean') throw new TypeError('cells: open must be a boolean');
      const next = value ? 1 : 0;
      if (open[p] === next) return false;
      open[p] = next;
      revision++;
      return true;
    },
    isOpen: p => open[portalIndex(p)] === 1,
    portalCells: p => [portalA[portalIndex(p)]!, portalB[p]!] as const,
    cellsAt(x, y, z, out) {
      if (![x, y, z].every(Number.isFinite)) throw new TypeError('cells: point must be finite');
      if (!(out instanceof Int32Array) || out.length < n)
        throw new TypeError('cells: out must be an Int32Array of cellCount');
      return cellsContaining(boxes, n, x, y, z, tol, out);
    },
    packed,
  };
}

/** @internal Cells whose expanded box contains the point, ascending. */
export function cellsContaining(
  boxes: Float64Array,
  n: number,
  x: number,
  y: number,
  z: number,
  tol: number,
  out: Int32Array,
): number {
  let k = 0;
  for (let c = 0; c < n; c++) {
    const o = 6 * c;
    if (
      x >= boxes[o]! - tol &&
      y >= boxes[o + 1]! - tol &&
      z >= boxes[o + 2]! - tol &&
      x <= boxes[o + 3]! + tol &&
      y <= boxes[o + 4]! + tol &&
      z <= boxes[o + 5]! + tol
    )
      out[k++] = c;
  }
  return k;
}

/** Newell normal, planarity and strict convexity of one portal polygon. */
function planeOf(vs: Float64Array, start: number, end: number, planes: Float64Array, p: number, tol: number): void {
  let nx = 0,
    ny = 0,
    nz = 0,
    cx = 0,
    cy = 0,
    cz = 0;
  const count = end - start;
  for (let i = 0; i < count; i++) {
    const a = 3 * (start + i),
      b = 3 * (start + ((i + 1) % count));
    nx += (vs[a + 1]! - vs[b + 1]!) * (vs[a + 2]! + vs[b + 2]!);
    ny += (vs[a + 2]! - vs[b + 2]!) * (vs[a]! + vs[b]!);
    nz += (vs[a]! - vs[b]!) * (vs[a + 1]! + vs[b + 1]!);
    cx += vs[a]!;
    cy += vs[a + 1]!;
    cz += vs[a + 2]!;
  }
  const len = Math.hypot(nx, ny, nz);
  if (!(len > tol * tol)) throw new RangeError(`cells: portal ${p} has no area`);
  nx /= len;
  ny /= len;
  nz /= len;
  const d = -(nx * cx + ny * cy + nz * cz) / count;
  for (let i = 0; i < count; i++) {
    const a = 3 * (start + i);
    if (Math.abs(nx * vs[a]! + ny * vs[a + 1]! + nz * vs[a + 2]! + d) > tol)
      throw new RangeError(`cells: portal ${p} is not planar`);
  }
  for (let i = 0; i < count; i++) {
    const a = 3 * (start + i),
      b = 3 * (start + ((i + 1) % count)),
      c = 3 * (start + ((i + 2) % count));
    const ex = vs[b]! - vs[a]!,
      ey = vs[b + 1]! - vs[a + 1]!,
      ez = vs[b + 2]! - vs[a + 2]!,
      fx = vs[c]! - vs[b]!,
      fy = vs[c + 1]! - vs[b + 1]!,
      fz = vs[c + 2]! - vs[b + 2]!;
    const turn = nx * (ey * fz - ez * fy) + ny * (ez * fx - ex * fz) + nz * (ex * fy - ey * fx);
    if (!(turn > 0)) throw new RangeError(`cells: portal ${p} is not strictly convex`);
  }
  planes[4 * p] = nx;
  planes[4 * p + 1] = ny;
  planes[4 * p + 2] = nz;
  planes[4 * p + 3] = d;
}
