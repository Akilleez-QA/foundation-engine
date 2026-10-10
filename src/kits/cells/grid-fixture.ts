/**
 * kits/cells/grid-fixture.ts: a seeded generator of grid-of-rooms levels (boxes on a regular grid, rectangular
 * openings of random size in shared walls and floors, random open or closed), and an independent brute-force
 * reference that marches camera rays room to room through open openings. Used by this kit's tests; not exported
 * from the kit.
 */
import type {CellBox, PortalInput} from './graph';

export interface GridOpening {
  /** Axis of the wall's normal (0 x, 1 y, 2 z) and the wall coordinate on that axis. */
  readonly axis: 0 | 1 | 2;
  readonly at: number;
  /** Ranges on the two other axes, ascending axis order. */
  readonly lo: readonly [number, number];
  readonly hi: readonly [number, number];
  readonly a: number;
  readonly b: number;
  open: boolean;
}

export interface GridLevel {
  readonly cols: number;
  readonly rows: number;
  readonly floors: number;
  readonly size: number;
  readonly height: number;
  readonly cells: CellBox[];
  readonly portals: PortalInput[];
  readonly openings: GridOpening[];
}

export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateGridLevel(
  random: () => number,
  o: {cols: number; rows: number; floors: number; doorChance: number; openChance: number},
): GridLevel {
  const size = 4,
    height = 3;
  const cells: CellBox[] = [];
  const index = (i: number, j: number, f: number) => f * o.cols * o.rows + j * o.cols + i;
  for (let f = 0; f < o.floors; f++)
    for (let j = 0; j < o.rows; j++)
      for (let i = 0; i < o.cols; i++)
        cells.push({min: [i * size, f * height, j * size], max: [(i + 1) * size, (f + 1) * height, (j + 1) * size]});
  const openings: GridOpening[] = [];
  const span = (from: number, length: number): [number, number] => {
    const w = length * (0.15 + 0.6 * random());
    const start = from + (length - w) * random();
    return [start, start + w];
  };
  for (let f = 0; f < o.floors; f++)
    for (let j = 0; j < o.rows; j++)
      for (let i = 0; i < o.cols; i++) {
        const here = index(i, j, f);
        // Sometimes two openings share a wall (they may overlap): a room is then reached by several portals.
        const add = (axis: 0 | 1 | 2, at: number, b: number, r: () => [[number, number], [number, number]]) => {
          for (let k = 0; k < 2; k++) {
            if (random() >= (k === 0 ? o.doorChance : 0.25)) return;
            const [r1, r2] = r();
            openings.push({
              axis,
              at,
              lo: [r1[0], r2[0]],
              hi: [r1[1], r2[1]],
              a: here,
              b,
              open: random() < o.openChance,
            });
          }
        };
        if (i + 1 < o.cols)
          add(0, (i + 1) * size, index(i + 1, j, f), () => [span(f * height, height), span(j * size, size)]);
        if (j + 1 < o.rows)
          add(2, (j + 1) * size, index(i, j + 1, f), () => [span(i * size, size), span(f * height, height)]);
        if (f + 1 < o.floors)
          add(1, (f + 1) * height, index(i, j, f + 1), () => [span(i * size, size), span(j * size, size)]);
      }
  const portals: PortalInput[] = openings.map(op => {
    const point = (u: number, v: number): [number, number, number] => {
      const p: [number, number, number] = [0, 0, 0];
      const others = [0, 1, 2].filter(k => k !== op.axis) as [number, number];
      p[op.axis] = op.at;
      p[others[0]] = u;
      p[others[1]] = v;
      return p;
    };
    return {
      a: op.a,
      b: op.b,
      open: op.open,
      points: [
        point(op.lo[0], op.lo[1]),
        point(op.hi[0], op.lo[1]),
        point(op.hi[0], op.hi[1]),
        point(op.lo[0], op.hi[1]),
      ],
    };
  });
  return {cols: o.cols, rows: o.rows, floors: o.floors, size, height, cells, portals, openings};
}

/**
 * Mark the rooms a ray from `origin` along `dir` enters, starting in room `start`, crossing only open openings
 * (strictly inside their rectangle), up to distance `far`. Independent of the kit's projection code.
 */
export function marchRay(
  level: GridLevel,
  start: number,
  origin: readonly number[],
  dir: readonly number[],
  far: number,
  seen: Uint8Array,
): void {
  let cell = start,
    t = 0;
  seen[cell] = 1;
  for (let guard = 0; guard < 4 * level.cells.length; guard++) {
    const box = level.cells[cell]!;
    let exit = Infinity,
      axis = -1,
      at = 0;
    for (let k = 0; k < 3; k++) {
      const d = dir[k]!;
      if (d === 0) continue;
      const bound = d > 0 ? box.max[k]! : box.min[k]!;
      const tk = (bound - origin[k]!) / d;
      if (tk < exit) {
        exit = tk;
        axis = k;
        at = bound;
      }
    }
    if (axis < 0 || exit > far || exit < t - 1e-9) return;
    t = exit;
    const p = [origin[0]! + dir[0]! * t, origin[1]! + dir[1]! * t, origin[2]! + dir[2]! * t];
    const others = [0, 1, 2].filter(k => k !== axis) as [number, number];
    const m = 1e-6;
    const through = level.openings.find(
      op =>
        op.open &&
        op.axis === axis &&
        Math.abs(op.at - at) < 1e-9 &&
        (op.a === cell || op.b === cell) &&
        p[others[0]]! > op.lo[0] + m &&
        p[others[0]]! < op.hi[0] - m &&
        p[others[1]]! > op.lo[1] + m &&
        p[others[1]]! < op.hi[1] - m,
    );
    if (!through) return;
    cell = through.a === cell ? through.b : through.a;
    seen[cell] = 1;
  }
}
