import type {MaterialBatch} from '../inventory/pure.js';
export interface Deposit {
  readonly id: string;
  readonly revision: number;
  readonly seed: number;
  readonly cellSize: number;
  readonly expiresTick: number;
  readonly reserve: number;
  readonly batch: MaterialBatch;
}
export const integer = (n: number, min = 0, max = Number.MAX_SAFE_INTEGER): number => {
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error('resources: invalid integer');
  return n;
};
export const identifier = (id: string): string => {
  if (typeof id !== 'string' || !id || id.length > 128) throw new Error('resources: invalid id');
  return id;
};
export function defineDeposit(input: Deposit): Deposit {
  identifier(input.id);
  integer(input.revision);
  integer(input.seed, 0, 0xffffffff);
  integer(input.expiresTick);
  integer(input.reserve);
  if (!Number.isFinite(input.cellSize) || input.cellSize <= 0) throw new Error('resources: invalid field scale');
  identifier(input.batch.id);
  identifier(input.batch.material);
  const properties: Record<string, number> = Object.create(null);
  for (const key of Object.keys(input.batch.properties).sort()) {
    identifier(key);
    const value = input.batch.properties[key]!;
    if (!Number.isFinite(value)) throw new Error('resources: invalid property');
    properties[key] = value;
  }
  return Object.freeze({
    ...input,
    batch: Object.freeze({id: input.batch.id, material: input.batch.material, properties: Object.freeze(properties)}),
  });
}
function fieldHash(x: number, z: number, seed: number): number {
  let h = Math.imul(x, 0x45d9f3b) ^ Math.imul(z, 0x27d4eb2d) ^ seed;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h ^= h >>> 16;
  return (h >>> 0) / 0xffffffff;
}
/** Version-one abundance field. Reserve is separate and does not alter this function. */
export function sampleDeposit(deposit: Deposit, x: number, z: number): number {
  if (![x, z].every(n => Number.isFinite(n) && Math.abs(n) <= 1e9)) throw new Error('resources: invalid coordinates');
  const px = x / deposit.cellSize,
    pz = z / deposit.cellSize;
  if (Math.abs(px) > 0x3fffffff || Math.abs(pz) > 0x3fffffff) throw new Error('resources: field lattice out of range');
  const ix = Math.floor(px),
    iz = Math.floor(pz),
    u = px - ix,
    v = pz - iz;
  const seed = deposit.seed ^ deposit.revision;
  const a = fieldHash(ix, iz, seed),
    b = fieldHash(ix + 1, iz, seed),
    c = fieldHash(ix, iz + 1, seed),
    d = fieldHash(ix + 1, iz + 1, seed);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}
export interface SurveyPoint {
  readonly x: number;
  readonly z: number;
  readonly abundance: number;
}
export type SurveyResult =
  | Readonly<{status: 'pending' | 'cancelled' | 'stale'}>
  | Readonly<{status: 'complete'; depositId: string; revision: number; points: readonly SurveyPoint[]}>;
export function createSurvey(
  input: Deposit,
  options: {x: number; z: number; spacing: number; columns: number; rows: number},
) {
  const deposit = defineDeposit(input),
    o = {...options};
  integer(o.columns, 1, 64);
  integer(o.rows, 1, 64);
  if (!Number.isFinite(o.spacing) || o.spacing <= 0) throw new Error('resources: invalid survey spacing');
  sampleDeposit(deposit, o.x, o.z);
  sampleDeposit(deposit, o.x + (o.columns - 1) * o.spacing, o.z + (o.rows - 1) * o.spacing);
  let result: SurveyResult = Object.freeze({status: 'pending'});
  const points: SurveyPoint[] = [];
  return {
    get result() {
      return result;
    },
    cancel() {
      if (result.status === 'pending') {
        points.length = 0;
        result = Object.freeze({status: 'cancelled'});
      }
    },
    step(maxPoints: number, currentRevision: number) {
      integer(maxPoints, 0, 4096);
      integer(currentRevision);
      if (result.status !== 'pending') return {result, sampled: 0};
      if (currentRevision !== deposit.revision) {
        points.length = 0;
        result = Object.freeze({status: 'stale'});
        return {result, sampled: 0};
      }
      let sampled = 0;
      while (sampled < maxPoints && points.length < o.columns * o.rows) {
        const x = o.x + (points.length % o.columns) * o.spacing,
          z = o.z + Math.floor(points.length / o.columns) * o.spacing;
        points.push(Object.freeze({x, z, abundance: sampleDeposit(deposit, x, z)}));
        sampled++;
      }
      if (points.length === o.columns * o.rows)
        result = Object.freeze({
          status: 'complete',
          depositId: deposit.id,
          revision: deposit.revision,
          points: Object.freeze(points),
        });
      return {result, sampled};
    },
  };
}
/** Properties and weights must share authored units/scales; no universal quality score. */
export function recipeSuitability(
  properties: Readonly<Record<string, number>>,
  weights: Readonly<Record<string, number>>,
): number {
  let sum = 0,
    weight = 0;
  for (const key of Object.keys(weights).sort()) {
    const w = weights[key]!,
      p = properties[key];
    if (!Number.isFinite(w) || w < 0 || p === undefined || !Number.isFinite(p))
      throw new Error('resources: invalid suitability input');
    sum += p * w;
    weight += w;
  }
  if (!Number.isFinite(sum) || !Number.isFinite(weight) || weight <= 0)
    throw new Error('resources: invalid suitability weights');
  return sum / weight;
}
