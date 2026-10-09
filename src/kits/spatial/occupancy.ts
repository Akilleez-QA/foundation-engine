/** Immutable binary raster queries. No world, renderer, timer or persistence owner. */
export const OCCUPANCY_MAX_CELLS = 1 << 22;
export type OccupancyOutside = 'clear' | 'blocked' | 'refuse';
export interface OccupancyOptions {
  readonly width: number;
  readonly height: number;
  readonly values: Uint8Array;
  readonly revision: number;
  readonly maxCells: number;
  readonly maxCellsPerQuery: number;
  readonly outside: OccupancyOutside;
}
export interface OccupancyResult {
  readonly status: 'clear' | 'hit' | 'outside' | 'too-wide' | 'numeric-refusal';
  readonly revision: number;
  readonly cellsVisited: number;
  /** Present only for an occupied in-grid cell. */
  readonly cell?: Readonly<{x: number; y: number}>;
  /** Segment fraction, rounded to Number after exact contact ordering. Outside blocked contacts have no cell. */
  readonly t?: number;
}
export interface Occupancy {
  readonly width: number;
  readonly height: number;
  readonly revision: number;
  point(x: number, y: number): OccupancyResult;
  /** Half-open integer cell rectangle; an empty rectangle is clear. */
  rectangle(minX: number, minY: number, maxX: number, maxY: number): OccupancyResult;
  /** Closed unit-square contact, including both endpoints and corner/edge touches. */
  segment(x0: number, y0: number, x1: number, y1: number): OccupancyResult;
}

const integer = (n: number, low: number, high: number) => Number.isSafeInteger(n) && n >= low && n <= high;
type Fraction = {n: bigint; d: bigint};
const ZERO: Fraction = {n: 0n, d: 1n},
  ONE: Fraction = {n: 1n, d: 1n};
const fraction = (n: bigint, d: bigint): Fraction => (d < 0n ? {n: -n, d: -d} : {n, d});
const compare = (a: Fraction, b: Fraction) => {
  const delta = a.n * b.d - b.n * a.d;
  return delta < 0n ? -1 : delta > 0n ? 1 : 0;
};
const floor = (n: bigint, d: bigint) => (n >= 0n ? n / d : -((-n + d - 1n) / d));
/** Each finite IEEE value is an exact integer times a power of two. */
function dyadic(value: number): {n: bigint; exponent: number} {
  const bytes = new DataView(new ArrayBuffer(8));
  bytes.setFloat64(0, value);
  const bits = bytes.getBigUint64(0),
    raw = Number((bits >> 52n) & 2047n);
  let n = bits & ((1n << 52n) - 1n);
  if (raw) n |= 1n << 52n;
  if (bits >> 63n) n = -n;
  let exponent = raw ? raw - 1023 - 52 : -1074;
  if (n === 0n) return {n, exponent: 0};
  while (n % 2n === 0n) {
    n /= 2n;
    exponent++;
  }
  return {n, exponent};
}
function rounded(t: Fraction): number {
  if (t.n === 0n) return 0;
  // Independent shifts prevent Infinity/Infinity when subnormal endpoints enlarge the common scale.
  const a = Math.max(0, t.n.toString(2).length - 53),
    b = Math.max(0, t.d.toString(2).length - 53);
  return Math.min(1, (Number(t.n >> BigInt(a)) / Number(t.d >> BigInt(b))) * 2 ** (a - b));
}

export function createOccupancy(options: OccupancyOptions): Occupancy {
  const {width, height, revision, maxCells, maxCellsPerQuery, outside, values} = options;
  if (
    !integer(maxCells, 1, OCCUPANCY_MAX_CELLS) ||
    !integer(width, 1, maxCells) ||
    !integer(height, 1, maxCells) ||
    width * height > maxCells ||
    !integer(maxCellsPerQuery, 1, maxCells) ||
    !integer(revision, 0, Number.MAX_SAFE_INTEGER) ||
    !['clear', 'blocked', 'refuse'].includes(outside)
  )
    throw Error('occupancy: invalid options');
  const typed = Object.getPrototypeOf(Uint8Array.prototype) as object;
  const buffer = Object.getOwnPropertyDescriptor(typed, 'buffer')?.get?.call(values) as ArrayBufferLike;
  const length: unknown = Object.getOwnPropertyDescriptor(typed, 'length')?.get?.call(values);
  if (
    !(values instanceof Uint8Array) ||
    length !== width * height ||
    (typeof SharedArrayBuffer !== 'undefined' && buffer instanceof SharedArrayBuffer)
  )
    throw Error('occupancy: expected unshared byte mask');
  const mask = new Uint8Array(values);
  if (mask.some(v => v > 1)) throw Error('occupancy: mask must contain only zero or one');
  const result = (
    status: OccupancyResult['status'],
    cellsVisited = 0,
    cell?: {x: number; y: number},
    t?: number,
  ): OccupancyResult =>
    Object.freeze({
      status,
      revision,
      cellsVisited,
      ...(cell ? {cell: Object.freeze(cell)} : {}),
      ...(t === undefined ? {} : {t}),
    });
  const point = (x: number, y: number) => {
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) throw Error('occupancy: expected integer cell');
    if (x < 0 || y < 0 || x >= width || y >= height)
      return result(outside === 'refuse' ? 'outside' : outside === 'blocked' ? 'hit' : 'clear');
    return mask[y * width + x] ? result('hit', 1, {x, y}) : result('clear', 1);
  };
  return Object.freeze({
    width,
    height,
    revision,
    point,
    rectangle(minX: number, minY: number, maxX: number, maxY: number) {
      if (![minX, minY, maxX, maxY].every(Number.isSafeInteger) || minX > maxX || minY > maxY)
        throw Error('occupancy: invalid rectangle');
      if (minX === maxX || minY === maxY) return result('clear');
      if (minX < 0 || minY < 0 || maxX > width || maxY > height) {
        if (outside === 'refuse') return result('outside');
        if (outside === 'blocked') return result('hit');
      }
      const left = Math.max(0, minX),
        top = Math.max(0, minY),
        right = Math.min(width, maxX),
        bottom = Math.min(height, maxY);
      const count = Math.max(0, right - left) * Math.max(0, bottom - top);
      if (count > maxCellsPerQuery) return result('too-wide');
      let visited = 0;
      for (let y = top; y < bottom; y++)
        for (let x = left; x < right; x++) {
          visited++;
          if (mask[y * width + x]) return result('hit', visited, {x, y});
        }
      return result('clear', visited);
    },
    segment(x0: number, y0: number, x1: number, y1: number) {
      if (![x0, y0, x1, y1].every(Number.isFinite)) throw Error('occupancy: nonfinite segment');
      if ([x0, y0, x1, y1].some(v => Math.abs(v) > Number.MAX_SAFE_INTEGER)) return result('numeric-refusal');
      const inside = (x: number, y: number) => x >= 0 && x <= width && y >= 0 && y <= height;
      const startInside = inside(x0, y0),
        endInside = inside(x1, y1);
      if (outside === 'refuse' && (!startInside || !endInside)) return result('outside');
      if (outside === 'blocked' && !startInside) return result('hit', 0, undefined, 0);
      // Exact dyadic coordinates keep distant adjacent boundaries distinct, even when their Number t rounds equal.
      const parts = [x0, y0, x1, y1].map(dyadic),
        exponent = Math.min(0, ...parts.map(p => p.exponent));
      const unit = 1n << BigInt(-exponent),
        numbers = parts.map(p => p.n << BigInt(p.exponent - exponent));
      const ox = numbers[0]!,
        oy = numbers[1]!,
        dx = numbers[2]! - ox,
        dy = numbers[3]! - oy;
      let enter = ZERO,
        exit = ONE;
      for (const [origin, direction, bound] of [
        [ox, dx, BigInt(width) * unit],
        [oy, dy, BigInt(height) * unit],
      ]) {
        if (direction === 0n) {
          if (origin! < 0n || origin! > bound!) return result('clear');
          continue;
        }
        let a = fraction(-origin!, direction!),
          b = fraction(bound! - origin!, direction!);
        if (compare(a, b) > 0) [a, b] = [b, a];
        if (compare(a, enter) > 0) enter = a;
        if (compare(b, exit) < 0) exit = b;
      }
      if (compare(enter, exit) > 0) return result('clear');
      const coordinate = (origin: bigint, direction: bigint, t: Fraction) => ({
        n: origin * t.d + direction * t.n,
        d: unit * t.d,
      });
      const firstBoundary = (origin: bigint, direction: bigint) => {
        const p = coordinate(origin, direction, enter),
          low = floor(p.n, p.d);
        return direction > 0n ? low + 1n : p.n % p.d === 0n ? low - 1n : low;
      };
      let bx = firstBoundary(ox, dx),
        by = firstBoundary(oy, dy),
        at = enter,
        visited = 0;
      const seen = new Set<number>();
      // Each event advances at least one integer boundary; endpoints add at most two events.
      for (let event = 0; event < width + height + 3; event++) {
        const px = coordinate(ox, dx, at),
          py = coordinate(oy, dy, at);
        const ix = Number(floor(px.n, px.d)),
          iy = Number(floor(py.n, py.d));
        const xs = px.n % px.d === 0n ? [ix - 1, ix] : [ix],
          ys = py.n % py.d === 0n ? [iy - 1, iy] : [iy];
        const group: number[] = [];
        for (const y of ys)
          for (const x of xs)
            if (x >= 0 && y >= 0 && x < width && y < height) {
              const id = y * width + x;
              if (!seen.has(id)) group.push(id);
            }
        if (visited + group.length > maxCellsPerQuery) return result('too-wide', visited);
        let hit: number | undefined;
        for (const id of group) {
          seen.add(id);
          visited++;
          if (mask[id] && hit === undefined) hit = id;
        }
        if (hit !== undefined) return result('hit', visited, {x: hit % width, y: Math.floor(hit / width)}, rounded(at));
        if (compare(at, exit) === 0)
          return outside === 'blocked' && !endInside
            ? result('hit', visited, undefined, rounded(exit))
            : result('clear', visited);
        const tx = dx === 0n ? null : fraction(bx * unit - ox, dx),
          ty = dy === 0n ? null : fraction(by * unit - oy, dy);
        let next = exit;
        if (tx && compare(tx, next) < 0) next = tx;
        if (ty && compare(ty, next) < 0) next = ty;
        if (compare(next, at) <= 0) return result('numeric-refusal', visited);
        if (tx && compare(tx, next) === 0) bx += dx > 0n ? 1n : -1n;
        if (ty && compare(ty, next) === 0) by += dy > 0n ? 1n : -1n;
        at = next;
      }
      return result('numeric-refusal', visited);
    },
  });
}
