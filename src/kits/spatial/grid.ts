/**
 * kits/spatial/grid.ts: a bounded uniform-grid spatial index over a finite 2D rectangle.
 *
 * The caller owns identities (nonnegative safe integers, e.g. ECS entity numbers), positions and the meaning
 * of every query. The grid owns only its preallocated typed arrays: admission is decided before any write,
 * capacity never grows, and no callback is ever invoked, so there is no reentrancy and nothing to cancel.
 * Queries write ids into a caller Float64Array or number[] and report a status (optionally into a reused record); a query that would scan more cells than the
 * configured bound is refused before any work.
 */

/** Construction bounds. All are required; every allocation is sized from them once. */
export interface GridLimits {
  /** Edge length of one square cell, in the caller's world units. Finite and positive. */
  readonly cellSize: number;
  /** Inclusive finite world rectangle. Positions outside it are refused. */
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  /** Most live entries; positive safe integer, at most {@link GRID_CEILING}.maxEntries. */
  readonly maxEntries: number;
  /** Most cells the rectangle may need (columns x rows); positive safe integer, at most {@link GRID_CEILING}.maxCells. */
  readonly maxCells: number;
  /** Most cells one query may scan; wider queries return `too-wide` without work. */
  readonly maxCellsPerQuery: number;
}

/** Hard ceilings of this implementation (eager typed-array allocation). */
export const GRID_CEILING = Object.freeze({ maxEntries: 1 << 20, maxCells: 1 << 22 });

export type InsertStatus = 'inserted' | 'duplicate' | 'saturated' | 'out-of-bounds' | 'closed';
export type MoveStatus = 'moved' | 'absent' | 'out-of-bounds' | 'closed';
export type RemoveStatus = 'removed' | 'absent' | 'closed';
/**
 * - `complete`: every matching entry is in the buffer.
 * - `truncated`: the buffer filled before the scan finished; the set is INCOMPLETE (fail closed for disclosure).
 * - `too-wide`: the query would scan more than `maxCellsPerQuery` cells; nothing was scanned or written.
 * - `closed`: the grid was disposed.
 */
export type QueryStatus = 'complete' | 'truncated' | 'too-wide' | 'closed';

export interface QueryResult {
  status: QueryStatus;
  /** Ids written to the front of the buffer. */
  count: number;
  /** Cells scanned (work accounting, not a time bound). */
  cellsVisited: number;
  /** Entries distance-/rectangle-tested. */
  entriesExamined: number;
  /** The grid revision the result describes. */
  revision: number;
}

/** A reusable result record for the optional last argument of every query (no allocation per query). */
export function createQueryResult(): QueryResult {
  return { status: 'complete', count: 0, cellsVisited: 0, entriesExamined: 0, revision: 0 };
}

/**
 * A writable id buffer. Only `Float64Array` (holds every safe integer exactly) or a pre-sized `number[]`:
 * narrower typed arrays would silently wrap ids into a different, real entity, so they are rejected.
 */
export type IdBuffer = Float64Array | number[];

export interface GridStats {
  readonly size: number;
  readonly maxEntries: number;
  readonly columns: number;
  readonly rows: number;
  readonly revision: number;
  readonly closed: boolean;
}

export interface SpatialGrid {
  readonly limits: GridLimits;
  /** Admit a new id at a position. Refusals change nothing. */
  insert(id: number, x: number, y: number): InsertStatus;
  /** Move a live id. An out-of-bounds target leaves the entry where it was. */
  move(id: number, x: number, y: number): MoveStatus;
  remove(id: number): RemoveStatus;
  has(id: number): boolean;
  /** A detached copy of a live entry's position. */
  position(id: number): { x: number; y: number } | undefined;
  /** Squared distance from a live entry to a point without allocating; NaN when the id is absent or the grid closed. */
  distanceSquared(id: number, x: number, y: number): number;
  /**
   * Ids whose position lies in the inclusive rectangle. Every query takes an optional `result` record
   * (see {@link createQueryResult}) that is overwritten and returned; without one a new record is allocated.
   */
  queryRect(minX: number, minY: number, maxX: number, maxY: number, out: IdBuffer, result?: QueryResult): QueryResult;
  /** Ids within `radius` (inclusive) of a point. */
  queryCircle(x: number, y: number, radius: number, out: IdBuffer, result?: QueryResult): QueryResult;
  /**
   * Up to `out.length` nearest ids within `maxDistance`, nearest first; equal distances order by ascending id,
   * so the result does not depend on insertion history. `exclude` (e.g. the querying entity) is skipped.
   * Work is O(entries examined x k): keep k small (steering typically uses 4 to 10).
   */
  queryNearest(x: number, y: number, maxDistance: number, out: IdBuffer, exclude?: number, result?: QueryResult): QueryResult;
  /** Remove every entry; capacity and limits are kept. */
  clear(): void;
  /** Terminal and idempotent: releases the arrays; later mutations and queries report `closed`. */
  dispose(): void;
  readonly stats: GridStats;
}

const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n > 0;
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

function checkId(id: number): void {
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 0) throw new TypeError('spatial grid: id must be a nonnegative safe integer');
}
function checkPoint(x: number, y: number): void {
  if (!finite(x) || !finite(y)) throw new TypeError('spatial grid: coordinates must be finite numbers');
}
function checkBuffer(out: IdBuffer): void {
  if (!(out instanceof Float64Array) && !Array.isArray(out)) throw new TypeError('spatial grid: out must be a Float64Array or number[] (narrower typed arrays would wrap ids)');
}
function checkResult(result: QueryResult | undefined): void {
  if (result !== undefined && (result === null || typeof result !== 'object' || Object.isFrozen(result))) throw new TypeError('spatial grid: result must be a writable record');
}

const KEYS = ['cellSize', 'minX', 'minY', 'maxX', 'maxY', 'maxEntries', 'maxCells', 'maxCellsPerQuery'] as const;

/** Validate and copy limits; allocate every array once. Throws RangeError/TypeError without allocating on bad limits. */
export function createSpatialGrid(input: GridLimits): SpatialGrid {
  if (input === null || typeof input !== 'object') throw new TypeError('spatial grid: limits must be an object');
  const extra = Object.keys(input).filter(k => !(KEYS as readonly string[]).includes(k));
  if (extra.length) throw new TypeError(`spatial grid: unknown limit '${extra[0]}'`);
  const limits: GridLimits = Object.freeze(Object.fromEntries(KEYS.map(k => [k, input[k]])) as unknown as GridLimits);
  const { cellSize, minX, minY, maxX, maxY, maxEntries, maxCells, maxCellsPerQuery } = limits;
  if (!finite(cellSize) || cellSize <= 0) throw new RangeError('spatial grid: cellSize must be finite and positive');
  if (![minX, minY, maxX, maxY].every(finite) || !(minX < maxX) || !(minY < maxY)) throw new RangeError('spatial grid: bounds must be finite with min < max');
  if (!isCount(maxEntries) || maxEntries > GRID_CEILING.maxEntries) throw new RangeError(`spatial grid: maxEntries must be a positive safe integer <= ${GRID_CEILING.maxEntries}`);
  if (!isCount(maxCells) || maxCells > GRID_CEILING.maxCells) throw new RangeError(`spatial grid: maxCells must be a positive safe integer <= ${GRID_CEILING.maxCells}`);
  if (!isCount(maxCellsPerQuery)) throw new RangeError('spatial grid: maxCellsPerQuery must be a positive safe integer');
  const columns = Math.max(1, Math.ceil((maxX - minX) / cellSize));
  const rows = Math.max(1, Math.ceil((maxY - minY) / cellSize));
  if (!Number.isSafeInteger(columns) || !Number.isSafeInteger(rows) || columns * rows > maxCells) {
    throw new RangeError(`spatial grid: ${columns} x ${rows} cells exceed maxCells ${maxCells}`);
  }
  const inv = 1 / cellSize;

  let head: Int32Array | null = new Int32Array(columns * rows).fill(-1);
  let next = new Int32Array(maxEntries), prev = new Int32Array(maxEntries), cellOf = new Int32Array(maxEntries);
  let ids = new Float64Array(maxEntries), xs = new Float64Array(maxEntries), ys = new Float64Array(maxEntries);
  let free = new Int32Array(maxEntries);
  const slotOf = new Map<number, number>();
  // Scratch distances for queryNearest, sized to the largest possible k (maxEntries) once, here.
  let scratch = new Float64Array(maxEntries);
  let freeTop = 0, revision = 0;
  const resetFree = () => { for (let i = 0; i < maxEntries; i++) free[i] = maxEntries - 1 - i; freeTop = maxEntries; };
  resetFree();

  const inBounds = (x: number, y: number) => x >= minX && x <= maxX && y >= minY && y <= maxY;
  const colOf = (x: number) => Math.min(columns - 1, Math.floor((x - minX) * inv));
  const rowOf = (y: number) => Math.min(rows - 1, Math.floor((y - minY) * inv));
  const link = (slot: number, cell: number) => {
    const h = head![cell]!;
    prev[slot] = -1; next[slot] = h; if (h >= 0) prev[h] = slot;
    head![cell] = slot; cellOf[slot] = cell;
  };
  const unlink = (slot: number) => {
    const p = prev[slot]!, n = next[slot]!;
    if (p >= 0) next[p] = n; else head![cellOf[slot]!] = n;
    if (n >= 0) prev[n] = p;
  };
  const finish = (r: QueryResult | undefined, status: QueryStatus, count: number, cellsVisited: number, entriesExamined: number): QueryResult => {
    if (!r) return { status, count, cellsVisited, entriesExamined, revision };
    r.status = status; r.count = count; r.cellsVisited = cellsVisited; r.entriesExamined = entriesExamined; r.revision = revision;
    return r;
  };

  /** Clamp a query box to cell indices; null when it misses the grid entirely. */
  function cellRange(x0: number, y0: number, x1: number, y1: number): [number, number, number, number] | null {
    if (x1 < minX || y1 < minY || x0 > maxX || y0 > maxY) return null;
    return [colOf(Math.max(x0, minX)), rowOf(Math.max(y0, minY)), colOf(Math.min(x1, maxX)), rowOf(Math.min(y1, maxY))];
  }
  const tooWide = (r: [number, number, number, number]) => (r[2] - r[0] + 1) * (r[3] - r[1] + 1) > maxCellsPerQuery;

  /** Shared scan for rectangle and circle tests. `circle` uses (cx, cy, r2); otherwise the box is the test. */
  function scan(x0: number, y0: number, x1: number, y1: number, circle: boolean, cx: number, cy: number, r2: number, out: IdBuffer, res: QueryResult | undefined): QueryResult {
    const range = cellRange(x0, y0, x1, y1);
    if (!range) return finish(res, 'complete', 0, 0, 0);
    if (tooWide(range)) return finish(res, 'too-wide', 0, 0, 0);
    const cap = out.length, h = head!;
    let count = 0, cells = 0, examined = 0;
    for (let row = range[1]; row <= range[3]; row++) {
      for (let col = range[0]; col <= range[2]; col++) {
        cells++;
        for (let s = h[row * columns + col]!; s >= 0; s = next[s]!) {
          examined++;
          const px = xs[s]!, py = ys[s]!;
          const hit = circle ? (px - cx) * (px - cx) + (py - cy) * (py - cy) <= r2 : px >= x0 && px <= x1 && py >= y0 && py <= y1;
          if (!hit) continue;
          if (count === cap) return finish(res, 'truncated', count, cells, examined);
          out[count++] = ids[s]!;
        }
      }
    }
    return finish(res, 'complete', count, cells, examined);
  }

  const grid: SpatialGrid = {
    limits,
    insert(id, x, y) {
      checkId(id); checkPoint(x, y);
      if (!head) return 'closed';
      if (slotOf.has(id)) return 'duplicate';
      if (!inBounds(x, y)) return 'out-of-bounds';
      if (freeTop === 0) return 'saturated';
      const slot = free[--freeTop]!;
      ids[slot] = id; xs[slot] = x; ys[slot] = y;
      link(slot, rowOf(y) * columns + colOf(x));
      slotOf.set(id, slot); revision++;
      return 'inserted';
    },
    move(id, x, y) {
      checkId(id); checkPoint(x, y);
      if (!head) return 'closed';
      const slot = slotOf.get(id);
      if (slot === undefined) return 'absent';
      if (!inBounds(x, y)) return 'out-of-bounds';
      xs[slot] = x; ys[slot] = y;
      const cell = rowOf(y) * columns + colOf(x);
      if (cell !== cellOf[slot]) { unlink(slot); link(slot, cell); }
      revision++;
      return 'moved';
    },
    remove(id) {
      checkId(id);
      if (!head) return 'closed';
      const slot = slotOf.get(id);
      if (slot === undefined) return 'absent';
      unlink(slot); slotOf.delete(id); free[freeTop++] = slot; revision++;
      return 'removed';
    },
    has(id) { return !!head && slotOf.has(id); },
    distanceSquared(id, x, y) {
      const slot = head ? slotOf.get(id) : undefined;
      if (slot === undefined) return NaN;
      const dx = xs[slot]! - x, dy = ys[slot]! - y;
      return dx * dx + dy * dy;
    },
    position(id) {
      const slot = head ? slotOf.get(id) : undefined;
      return slot === undefined ? undefined : { x: xs[slot]!, y: ys[slot]! };
    },
    queryRect(x0, y0, x1, y1, out, result) {
      checkPoint(x0, y0); checkPoint(x1, y1); checkBuffer(out); checkResult(result);
      if (x0 > x1 || y0 > y1) throw new RangeError('spatial grid: rectangle min must not exceed max');
      if (!head) return finish(result, 'closed', 0, 0, 0);
      return scan(x0, y0, x1, y1, false, 0, 0, 0, out, result);
    },
    queryCircle(x, y, radius, out, result) {
      checkPoint(x, y); checkBuffer(out); checkResult(result);
      if (!finite(radius) || radius < 0) throw new RangeError('spatial grid: radius must be finite and nonnegative');
      if (!head) return finish(result, 'closed', 0, 0, 0);
      return scan(x - radius, y - radius, x + radius, y + radius, true, x, y, radius * radius, out, result);
    },
    queryNearest(x, y, maxDistance, out, exclude, result) {
      checkPoint(x, y); checkBuffer(out); checkResult(result);
      if (!finite(maxDistance) || maxDistance < 0) throw new RangeError('spatial grid: maxDistance must be finite and nonnegative');
      if (exclude !== undefined) checkId(exclude);
      if (!head) return finish(result, 'closed', 0, 0, 0);
      const range = cellRange(x - maxDistance, y - maxDistance, x + maxDistance, y + maxDistance);
      if (!range) return finish(result, 'complete', 0, 0, 0);
      if (tooWide(range)) return finish(result, 'too-wide', 0, 0, 0);
      const k = Math.min(out.length, maxEntries), r2 = maxDistance * maxDistance;
      const d = scratch, h = head;
      let count = 0, cells = 0, examined = 0;
      for (let row = range[1]; row <= range[3]; row++) {
        for (let col = range[0]; col <= range[2]; col++) {
          cells++;
          for (let s = h[row * columns + col]!; s >= 0; s = next[s]!) {
            examined++;
            const id = ids[s]!;
            if (id === exclude) continue;
            const dx = xs[s]! - x, dy = ys[s]! - y, dist = dx * dx + dy * dy;
            if (dist > r2 || k === 0) continue;
            // Bounded insertion into the sorted top-k (distance, then id).
            if (count === k && (dist > d[k - 1]! || (dist === d[k - 1]! && id > out[k - 1]!))) continue;
            let i = count < k ? count++ : k - 1;
            while (i > 0 && (d[i - 1]! > dist || (d[i - 1]! === dist && out[i - 1]! > id))) { d[i] = d[i - 1]!; out[i] = out[i - 1]!; i--; }
            d[i] = dist; out[i] = id;
          }
        }
      }
      return finish(result, 'complete', count, cells, examined);
    },
    clear() {
      if (!head) return;
      head.fill(-1); slotOf.clear(); resetFree(); revision++;
    },
    dispose() {
      if (!head) return;
      head = null; slotOf.clear(); freeTop = 0;
      next = prev = cellOf = free = new Int32Array(0);
      ids = xs = ys = scratch = new Float64Array(0);
    },
    get stats(): GridStats {
      return { size: slotOf.size, maxEntries, columns, rows, revision, closed: !head };
    },
  };
  return Object.freeze(grid);
}
