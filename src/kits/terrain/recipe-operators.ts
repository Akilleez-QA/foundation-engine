import type {TerrainOperator, TerrainParameter} from './recipe';
const tuple = (v: TerrainParameter, length: number): v is readonly number[] =>
  Array.isArray(v) && v.length === length && v.every(n => typeof n === 'number' && Number.isFinite(n));
/** Optional versioned examples; creator jobs may supply entirely different operator sets. */
export const basicTerrainOperators: readonly TerrainOperator[] = Object.freeze([
  Object.freeze({
    id: 'plane',
    version: 1,
    reads: Object.freeze([]),
    writes: Object.freeze(['height'] as const),
    validate: (v: TerrainParameter) => tuple(v, 3),
    evaluate: (p: Parameters<TerrainOperator['evaluate']>[0], _f: unknown, v: TerrainParameter) => {
      const [x, z, offset] = v as readonly number[];
      return {height: p.x * x! + p.z * z! + offset!};
    },
  }),
  Object.freeze({
    id: 'height-scale',
    version: 1,
    reads: Object.freeze(['height'] as const),
    writes: Object.freeze(['height'] as const),
    validate: (v: TerrainParameter) => tuple(v, 2),
    evaluate: (_p: unknown, f: Parameters<TerrainOperator['evaluate']>[1], v: TerrainParameter) => {
      const [scale, offset] = v as readonly number[];
      return {height: f.height! * scale! + offset!};
    },
  }),
]);
