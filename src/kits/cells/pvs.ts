/**
 * kits/cells/pvs.ts: a precomputed, conservative cell-to-cell potential visibility table. Cell `b` is potentially
 * visible from cell `a` when the portal graph joins them in at most `maxDepth` portal steps, counting closed portals
 * as passable, so the table stays valid whatever portals open or close later. Stored as one bit per pair.
 */
import type {CellGraph} from './graph';

/** Largest cell count a PVS table accepts: 4,096 cells is 16,777,216 bits (2 MiB). */
export const PVS_CELL_CEILING = 4_096;

export interface CellPvsOptions {
  /** Portal steps from a cell that remain potentially visible, 1 to cellCount. Default cellCount (reachability). */
  readonly maxDepth?: number;
}

export interface CellPvs {
  readonly graph: CellGraph;
  readonly cellCount: number;
  readonly maxDepth: number;
  /** 32-bit words per row. */
  readonly words: number;
  /** Row-major bits: bit `b` of row `a` is set when `b` is potentially visible from `a`. */
  readonly bits: Uint32Array;
  has(from: number, to: number): boolean;
  /** Cells potentially visible from `from`, ascending, written to `out`; returns the count. */
  visibleFrom(from: number, out: Int32Array): number;
}

/** Build the table with one bounded breadth-first search per cell: O(cells x (cells + portals)) time, cells^2 bits. */
export function buildCellPvs(graph: CellGraph, options: CellPvsOptions = {}): CellPvs {
  const n = graph.cellCount;
  if (n > PVS_CELL_CEILING) throw new RangeError(`cells: a PVS table accepts at most ${PVS_CELL_CEILING} cells`);
  const maxDepth = options.maxDepth ?? n;
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 1 || maxDepth > Math.max(1, n))
    throw new RangeError(`cells: PVS maxDepth must be an integer in [1, ${Math.max(1, n)}]`);
  const words = (n + 31) >>> 5,
    bits = new Uint32Array(n * words);
  const {adjacencyStart, adjacency, portalA, portalB} = graph.packed;
  const depth = new Int32Array(n),
    queue = new Int32Array(n);
  for (let s = 0; s < n; s++) {
    depth.fill(-1);
    let head = 0,
      tail = 0;
    depth[s] = 0;
    queue[tail++] = s;
    while (head < tail) {
      const c = queue[head++]!;
      bits[s * words + (c >>> 5)]! |= 1 << (c & 31);
      if (depth[c]! >= maxDepth) continue;
      for (let k = adjacencyStart[c]!; k < adjacencyStart[c + 1]!; k++) {
        const p = adjacency[k]!,
          o = portalA[p] === c ? portalB[p]! : portalA[p]!;
        if (depth[o] !== -1) continue;
        depth[o] = depth[c]! + 1;
        queue[tail++] = o;
      }
    }
  }
  const cell = (c: number): number => {
    if (!Number.isSafeInteger(c) || c < 0 || c >= n) throw new RangeError(`cells: no cell ${c}`);
    return c;
  };
  return Object.freeze({
    graph,
    cellCount: n,
    maxDepth,
    words,
    bits,
    has: (from: number, to: number) => ((bits[cell(from) * words + (cell(to) >>> 5)]! >>> (to & 31)) & 1) === 1,
    visibleFrom(from: number, out: Int32Array) {
      cell(from);
      if (!(out instanceof Int32Array) || out.length < n)
        throw new TypeError('cells: out must be an Int32Array of cellCount');
      let k = 0;
      for (let c = 0; c < n; c++) if ((bits[from * words + (c >>> 5)]! >>> (c & 31)) & 1) out[k++] = c;
      return k;
    },
  });
}
