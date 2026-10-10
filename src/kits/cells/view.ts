/**
 * kits/cells/view.ts: the visible cell set for one camera. Finds the camera's cells, then floods through open
 * portals, narrowing a screen-space clip rectangle portal by portal. A bounded worklist keeps, per cell, the
 * bounding rectangle of every rectangle that reached it and the least portal depth; a cell is processed again only
 * when either grows, so cycles terminate and no rectangle that reaches a cell is ever dropped.
 */
import {cellsContaining, type CellGraph} from './graph';
import type {CellPvs} from './pvs';

/** What a view needs from the camera: world position and the view-projection matrix (column-major, as three.js). */
export interface CellCamera {
  readonly position: ArrayLike<number>;
  readonly viewProjection: ArrayLike<number>;
}

export interface CellViewOptions {
  /** Processed cell visits per update before the conservative overflow fallback, 1 to 16,777,216. */
  readonly maxVisits: number;
  /** Portal steps from the camera's cells that may be visible, 1 to cellCount: the creator's horizon. */
  readonly maxDepth: number;
  /** Camera outside every cell: all cells visible, none, or a creator list of cells. */
  readonly outside: 'all' | 'none' | readonly number[];
  /** Optional PVS table of the same graph: a pre-filter in `portals` mode, the whole answer in `pvs` mode. */
  readonly pvs?: CellPvs;
  /**
   * `portals` (default) narrows through open portals; `pvs` uses only the table rows of the camera's cells, and then
   * `maxVisits` and `maxDepth` are not used (the table's own depth applies).
   */
  readonly mode?: 'portals' | 'pvs';
}

/**
 * - `portals`: the flood completed.
 * - `pvs`: answered from the PVS table (mode `pvs`).
 * - `outside`: the camera is in no cell; the `outside` fallback applied.
 * - `overflow`: `maxVisits` ran out; every cell of the camera cells' PVS rows (or every cell without a PVS) is visible.
 */
export type CellViewStatus = 'portals' | 'pvs' | 'outside' | 'overflow';

export interface CellViewResult {
  /** 1 for each visible cell. */
  readonly visible: Uint8Array;
  /** Visible cells ascending in `cells[0 .. count)`. */
  readonly cells: Int32Array;
  count: number;
  /** Per cell, its clip rectangle in normalised device coordinates (minX, minY, maxX, maxY); valid when visible. */
  readonly rects: Float64Array;
  status: CellViewStatus;
  /** Cells the camera is in (overlapping boxes may give more than one). */
  cameraCells: number;
  /** Cell visits processed this update. */
  visits: number;
  /** Portals not followed because they lie past `maxDepth`, counted when they lead to a cell not yet reached. */
  depthLimited: number;
  /**
   * True when the visible set differs from the one this result held before the update. An update with the same
   * camera and graph revision reuses the previous answer and reports false without recomputing.
   */
  changed: boolean;
}

export interface CellView {
  /** Recompute (or reuse) the visible set into `out`. Throws on malformed input before changing `out`. */
  update(camera: CellCamera, out: CellViewResult): CellViewStatus;
  /** Forget the cached camera so the next update recomputes. */
  invalidate(): void;
}

export const VISIT_CEILING = 16_777_216;

/** Which view last wrote each result record. */
const lastWriter = new WeakMap<CellViewResult, object>();

/** A result record sized for the graph; reuse one per view. */
export function createCellViewResult(graph: CellGraph): CellViewResult {
  const n = graph.cellCount;
  return {
    visible: new Uint8Array(n),
    cells: new Int32Array(n),
    count: 0,
    rects: new Float64Array(4 * n),
    status: 'outside',
    cameraCells: 0,
    visits: 0,
    depthLimited: 0,
    changed: true,
  };
}

export function createCellView(graph: CellGraph, options: CellViewOptions): CellView {
  if (!graph || typeof graph !== 'object' || !graph.packed) throw new TypeError('cells: a cell graph is required');
  if (!options || typeof options !== 'object') throw new TypeError('cells: view options are required');
  const n = graph.cellCount,
    tol = graph.tolerance;
  const maxVisits = options.maxVisits,
    maxDepth = options.maxDepth;
  if (!Number.isSafeInteger(maxVisits) || maxVisits < 1 || maxVisits > VISIT_CEILING)
    throw new RangeError(`cells: maxVisits must be an integer in [1, ${VISIT_CEILING}]`);
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 1 || maxDepth > Math.max(1, n))
    throw new RangeError(`cells: maxDepth must be an integer in [1, ${Math.max(1, n)}]`);
  const mode = options.mode ?? 'portals';
  if (mode !== 'portals' && mode !== 'pvs') throw new TypeError('cells: mode must be portals or pvs');
  const pvs = options.pvs;
  if (pvs !== undefined && (typeof pvs !== 'object' || pvs.graph !== graph))
    throw new TypeError('cells: the PVS table must be built from this graph');
  if (mode === 'pvs' && !pvs) throw new TypeError('cells: mode pvs needs a PVS table');
  let outsideAll = false;
  const outsideCells: number[] = [];
  if (options.outside === 'all') outsideAll = true;
  else if (options.outside !== 'none') {
    if (!Array.isArray(options.outside)) throw new TypeError("cells: outside must be 'all', 'none' or a cell list");
    for (const c of options.outside) {
      if (!Number.isSafeInteger(c) || c < 0 || c >= n) throw new RangeError(`cells: outside names no cell ${c}`);
      if (!outsideCells.includes(c)) outsideCells.push(c);
    }
  }
  const {boxes, portalA, portalB, open, vertexStart, vertices, planes, adjacencyStart, adjacency} = graph.packed;
  const wEps = tol * 1e-3;
  // Scratch, allocated once.
  const seeds = new Int32Array(n),
    cover = new Float64Array(4 * n),
    depth = new Int32Array(n),
    queued = new Uint8Array(n),
    queue = new Int32Array(n),
    prev = new Uint8Array(n),
    clipIn = new Float64Array(3 * (graph.maxPortalVertices + 1)),
    clipOut = new Float64Array(3 * (graph.maxPortalVertices + 1)),
    rect = new Float64Array(4);
  const lastPos = new Float64Array(3),
    lastVp = new Float64Array(16);
  let lastOut: CellViewResult | undefined,
    lastRevision = -1;
  const token = {};

  /** Union of the PVS rows of the camera's cells, built once per update (cells x camera cells bit reads). */
  const allow = new Uint8Array(n);
  const buildAllow = (seedCount: number): void => {
    if (!pvs) return;
    const {bits, words} = pvs;
    allow.fill(0);
    for (let s = 0; s < seedCount; s++) {
      const row = seeds[s]! * words;
      for (let c = 0; c < n; c++) if ((bits[row + (c >>> 5)]! >>> (c & 31)) & 1) allow[c] = 1;
    }
  };
  const pvsAllows = (_seedCount: number, o: number): boolean => !pvs || allow[o] === 1;

  /** Narrow `cover` rectangle of cell `from` by portal `p`; writes `rect`, returns false when nothing shows. */
  const narrow = (p: number, from: number, cam: CellCamera): boolean => {
    const vp = cam.viewProjection,
      cx = cam.position[0]!,
      cy = cam.position[1]!,
      cz = cam.position[2]!;
    const r0 = cover[4 * from]!,
      r1 = cover[4 * from + 1]!,
      r2 = cover[4 * from + 2]!,
      r3 = cover[4 * from + 3]!;
    const vs = vertexStart[p]!,
      ve = vertexStart[p + 1]!,
      count = ve - vs;
    if (nearPortal(p, vs, count, cx, cy, cz)) {
      rect[0] = r0;
      rect[1] = r1;
      rect[2] = r2;
      rect[3] = r3;
      return true;
    }
    for (let i = 0; i < count; i++) {
      const o = 3 * (vs + i),
        x = vertices[o]!,
        y = vertices[o + 1]!,
        z = vertices[o + 2]!;
      clipIn[3 * i] = vp[0]! * x + vp[4]! * y + vp[8]! * z + vp[12]!;
      clipIn[3 * i + 1] = vp[1]! * x + vp[5]! * y + vp[9]! * z + vp[13]!;
      clipIn[3 * i + 2] = vp[3]! * x + vp[7]! * y + vp[11]! * z + vp[15]!;
    }
    // Keep the part in front of the eye (w >= wEps), not the near plane: a ray may cross a portal closer than the
    // near plane and still show the cell beyond it.
    let k = 0;
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % count;
      const aw = clipIn[3 * i + 2]!,
        bw = clipIn[3 * j + 2]!;
      const ain = aw >= wEps,
        bin = bw >= wEps;
      if (ain) {
        clipOut[3 * k] = clipIn[3 * i]!;
        clipOut[3 * k + 1] = clipIn[3 * i + 1]!;
        clipOut[3 * k + 2] = aw;
        k++;
      }
      if (ain !== bin) {
        const t = (wEps - aw) / (bw - aw);
        clipOut[3 * k] = clipIn[3 * i]! + t * (clipIn[3 * j]! - clipIn[3 * i]!);
        clipOut[3 * k + 1] = clipIn[3 * i + 1]! + t * (clipIn[3 * j + 1]! - clipIn[3 * i + 1]!);
        clipOut[3 * k + 2] = wEps;
        k++;
      }
    }
    if (k === 0) return false;
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (let i = 0; i < k; i++) {
      const w = clipOut[3 * i + 2]!,
        x = clipOut[3 * i]! / w,
        y = clipOut[3 * i + 1]! / w;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    rect[0] = Math.max(x0, r0);
    rect[1] = Math.max(y0, r1);
    rect[2] = Math.min(x1, r2);
    rect[3] = Math.min(y1, r3);
    return rect[0]! <= rect[2]! && rect[1]! <= rect[3]!;
  };

  /** The camera within `tol` of the portal polygon: its projection degenerates, so the portal fills the rectangle. */
  const nearPortal = (p: number, vs: number, count: number, cx: number, cy: number, cz: number): boolean => {
    const nx = planes[4 * p]!,
      ny = planes[4 * p + 1]!,
      nz = planes[4 * p + 2]!;
    const dist = nx * cx + ny * cy + nz * cz + planes[4 * p + 3]!;
    if (Math.abs(dist) >= tol) return false;
    const qx = cx - dist * nx,
      qy = cy - dist * ny,
      qz = cz - dist * nz;
    for (let i = 0; i < count; i++) {
      const a = 3 * (vs + i),
        b = 3 * (vs + ((i + 1) % count));
      const ex = vertices[b]! - vertices[a]!,
        ey = vertices[b + 1]! - vertices[a + 1]!,
        ez = vertices[b + 2]! - vertices[a + 2]!;
      const wx = qx - vertices[a]!,
        wy = qy - vertices[a + 1]!,
        wz = qz - vertices[a + 2]!;
      const side = nx * (ey * wz - ez * wy) + ny * (ez * wx - ex * wz) + nz * (ex * wy - ey * wx);
      if (side < -tol * Math.hypot(ex, ey, ez)) return false;
    }
    return true;
  };

  const markAll = (out: CellViewResult, seedCount: number, usePvs: boolean): void => {
    for (let c = 0; c < n; c++) out.visible[c] = !usePvs || pvsAllows(seedCount, c) ? 1 : 0;
  };
  const fullRects = (out: CellViewResult): void => {
    for (let c = 0; c < n; c++) {
      out.rects[4 * c] = -1;
      out.rects[4 * c + 1] = -1;
      out.rects[4 * c + 2] = 1;
      out.rects[4 * c + 3] = 1;
    }
  };

  const flood = (cam: CellCamera, out: CellViewResult, seedCount: number): boolean => {
    depth.fill(-1);
    queued.fill(0);
    let head = 0,
      size = 0;
    for (let s = 0; s < seedCount; s++) {
      const c = seeds[s]!;
      depth[c] = 0;
      cover[4 * c] = -1;
      cover[4 * c + 1] = -1;
      cover[4 * c + 2] = 1;
      cover[4 * c + 3] = 1;
      queued[c] = 1;
      queue[(head + size++) % n] = c;
    }
    let visits = 0,
      limited = 0;
    while (size > 0) {
      if (visits >= maxVisits) {
        out.visits = visits;
        out.depthLimited = limited;
        return false;
      }
      const c = queue[head]!;
      head = (head + 1) % n;
      size--;
      queued[c] = 0;
      visits++;
      const nd = depth[c]! + 1;
      for (let k = adjacencyStart[c]!; k < adjacencyStart[c + 1]!; k++) {
        const p = adjacency[k]!;
        if (!open[p]) continue;
        const o = portalA[p] === c ? portalB[p]! : portalA[p]!;
        if (!pvsAllows(seedCount, o)) continue;
        if (nd > maxDepth) {
          if (depth[o] === -1) limited++;
          continue;
        }
        if (!narrow(p, c, cam)) continue;
        const q = 4 * o;
        if (depth[o] === -1) {
          cover[q] = rect[0]!;
          cover[q + 1] = rect[1]!;
          cover[q + 2] = rect[2]!;
          cover[q + 3] = rect[3]!;
          depth[o] = nd;
        } else {
          const inside =
            rect[0]! >= cover[q]! &&
            rect[1]! >= cover[q + 1]! &&
            rect[2]! <= cover[q + 2]! &&
            rect[3]! <= cover[q + 3]!;
          if (inside && nd >= depth[o]!) continue;
          // Grow to the bounding rectangle and the least depth: a superset of both visits.
          cover[q] = Math.min(cover[q]!, rect[0]!);
          cover[q + 1] = Math.min(cover[q + 1]!, rect[1]!);
          cover[q + 2] = Math.max(cover[q + 2]!, rect[2]!);
          cover[q + 3] = Math.max(cover[q + 3]!, rect[3]!);
          if (nd < depth[o]!) depth[o] = nd;
        }
        if (!queued[o]) {
          queued[o] = 1;
          queue[(head + size++) % n] = o;
        }
      }
    }
    for (let c = 0; c < n; c++) {
      const on = depth[c] !== -1;
      out.visible[c] = on ? 1 : 0;
      if (on) for (let i = 0; i < 4; i++) out.rects[4 * c + i] = cover[4 * c + i]!;
    }
    out.visits = visits;
    out.depthLimited = limited;
    return true;
  };

  return {
    invalidate() {
      lastOut = undefined;
    },
    update(cam, out) {
      if (!cam || typeof cam !== 'object') throw new TypeError('cells: camera is required');
      const pos = cam.position,
        vp = cam.viewProjection;
      if (!pos || pos.length !== 3 || !Number.isFinite(pos[0]) || !Number.isFinite(pos[1]) || !Number.isFinite(pos[2]))
        throw new TypeError('cells: camera position must be three finite numbers');
      if (!vp || vp.length !== 16) throw new TypeError('cells: viewProjection must have 16 numbers');
      for (let i = 0; i < 16; i++)
        if (!Number.isFinite(vp[i])) throw new TypeError('cells: viewProjection must be finite');
      if (!out || !(out.visible instanceof Uint8Array) || out.visible.length !== n || out.rects.length !== 4 * n)
        throw new TypeError('cells: out must be a result created for this graph');
      // The cache is keyed on this view too: another view writing the same result invalidates it.
      let same = lastOut === out && lastWriter.get(out) === token && lastRevision === graph.revision;
      for (let i = 0; same && i < 3; i++) same = lastPos[i] === pos[i];
      for (let i = 0; same && i < 16; i++) same = lastVp[i] === vp[i];
      if (same) {
        out.changed = false;
        return out.status;
      }
      for (let i = 0; i < 3; i++) lastPos[i] = pos[i]!;
      for (let i = 0; i < 16; i++) lastVp[i] = vp[i]!;
      lastRevision = graph.revision;
      lastOut = out;
      lastWriter.set(out, token);
      prev.set(out.visible);
      const seedCount = cellsContaining(boxes, n, pos[0]!, pos[1]!, pos[2]!, tol, seeds);
      buildAllow(seedCount);
      out.cameraCells = seedCount;
      out.visits = 0;
      out.depthLimited = 0;
      if (seedCount === 0) {
        out.status = 'outside';
        out.visible.fill(outsideAll ? 1 : 0);
        for (const c of outsideCells) out.visible[c] = 1;
        fullRects(out);
      } else if (mode === 'pvs') {
        out.status = 'pvs';
        markAll(out, seedCount, true);
        fullRects(out);
      } else if (flood(cam, out, seedCount)) out.status = 'portals';
      else {
        out.status = 'overflow';
        markAll(out, seedCount, !!pvs);
        fullRects(out);
      }
      let count = 0,
        changed = false;
      for (let c = 0; c < n; c++) {
        if (out.visible[c]) out.cells[count++] = c;
        if (out.visible[c] !== prev[c]) changed = true;
      }
      out.count = count;
      out.changed = changed;
      return out.status;
    },
  };
}
