import type {Surface} from './surface';
export interface ScatterPoint {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}
/** Stable world-cell identity; sampling never depends on tile order, LOD or revision. */
export function createSurfaceScatter(
  surface: Surface,
  options: {
    seed: number;
    layer: string;
    startX: number;
    startZ: number;
    columns: number;
    rows: number;
    cellSize: number;
    minNormalY?: number;
  },
) {
  const o = {...options};
  for (const n of [o.seed, o.startX, o.startZ, o.columns, o.rows])
    if (!Number.isSafeInteger(n)) throw Error('scatter: integer coordinates required');
  if (
    !o.layer ||
    o.layer.length > 128 ||
    o.columns < 1 ||
    o.rows < 1 ||
    o.columns * o.rows > 4096 ||
    !(o.cellSize > 0) ||
    !Number.isFinite(o.cellSize) ||
    !Number.isFinite(o.minNormalY ?? 0) ||
    (o.minNormalY ?? 0) < 0 ||
    (o.minNormalY ?? 0) > 1
  )
    throw Error('scatter: invalid bounds');
  const hash = (x: number, z: number, salt: number) => {
    let h = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ o.seed ^ salt;
    for (const c of o.layer) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  let cursor = 0,
    cancelled = false;
  const points: ScatterPoint[] = [];
  return {
    cancel() {
      cancelled = true;
    },
    step(maxCandidates: number, revision = surface.revision) {
      if (!Number.isSafeInteger(maxCandidates) || maxCandidates < 0 || maxCandidates > 4096)
        throw Error('scatter: invalid budget');
      if (revision !== surface.revision) cancelled = true;
      let worked = 0;
      while (!cancelled && worked < maxCandidates && cursor < o.columns * o.rows) {
        const cx = o.startX + (cursor % o.columns),
          cz = o.startZ + Math.floor(cursor / o.columns);
        cursor++;
        worked++;
        const x = (cx + hash(cx, cz, 1)) * o.cellSize,
          z = (cz + hash(cx, cz, 2)) * o.cellSize,
          s = surface.sample(x, z);
        if (s && !s.excluded && s.normal.y >= (o.minNormalY ?? 0))
          points.push(Object.freeze({id: `${o.layer}:${cx}:${cz}`, x, y: s.height, z}));
      }
      return {
        worked,
        status: cancelled
          ? ('cancelled' as const)
          : cursor === o.columns * o.rows
            ? ('complete' as const)
            : ('pending' as const),
        points: Object.freeze([...points]),
      };
    },
  };
}
