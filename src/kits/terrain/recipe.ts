import { createSampledSurface, type SampledSurfaceOptions, type Surface } from './surface';
export type TerrainField = 'height' | 'material' | 'exclusion';
export type TerrainParameter = null | boolean | number | string | readonly TerrainParameter[] | { readonly [key: string]: TerrainParameter };
export interface TerrainRecipeStep { readonly operator: string; readonly version: number; readonly parameters: string }
export interface TerrainRecipe extends Pick<SampledSurfaceOptions, 'id' | 'revision' | 'originX' | 'originZ' | 'spacing' | 'cellsX' | 'cellsZ'> {
  readonly formatVersion: 1; readonly seed: number; readonly steps: readonly TerrainRecipeStep[];
}
export interface TerrainPoint { readonly x: number; readonly z: number; readonly ix: number; readonly iz: number; readonly seed: number }
/** Executable code stays outside the serialized recipe. Callbacks are trusted, synchronous and pointwise. */
export interface TerrainOperator {
  readonly id: string; readonly version: number;
  readonly reads: readonly TerrainField[]; readonly writes: readonly TerrainField[];
  readonly validate: (parameters: TerrainParameter) => boolean;
  readonly evaluate: (point: TerrainPoint, fields: Readonly<Partial<Record<TerrainField, number>>>, parameters: TerrainParameter) => Readonly<Partial<Record<TerrainField, number>>>;
}
export interface TerrainRecipeLimits { readonly maxParameterBytes: number; readonly maxParameterNodes: number; readonly maxParameterDepth: number }
const defaults: TerrainRecipeLimits = { maxParameterBytes: 4096, maxParameterNodes: 256, maxParameterDepth: 16 };
const fields: readonly TerrainField[] = ['height', 'material', 'exclusion'];
const integer = (value: number, max: number) => Number.isSafeInteger(value) && value >= 0 && value <= max;
const identity = (value: string) => typeof value === 'string' && value.trim().length > 0 && value.length <= 256;
export function terrainParameters(json: string, limits: TerrainRecipeLimits): TerrainParameter {
  if (typeof json !== 'string' || json.length > limits.maxParameterBytes || new TextEncoder().encode(json).length > limits.maxParameterBytes) throw Error('terrain recipe: parameter bytes');
  const value: TerrainParameter = JSON.parse(json), pending = [{ value, depth: 0 }];
  let count = 0;
  while (pending.length) {
    const item = pending.pop()!;
    if (++count > limits.maxParameterNodes || item.depth > limits.maxParameterDepth) throw Error('terrain recipe: parameter structure');
    if (typeof item.value === 'number' && !Number.isFinite(item.value)) throw Error('terrain recipe: nonfinite parameter');
    if (item.value && typeof item.value === 'object') {
      const children = Object.values(item.value);
      if (children.length > limits.maxParameterNodes - count - pending.length) throw Error('terrain recipe: parameter structure');
      for (const child of children) pending.push({ value: child, depth: item.depth + 1 });
      Object.freeze(item.value);
    }
  }
  return value;
}
function boundedArray<T>(values: readonly T[], max: number): T[] {
  if (!Array.isArray(values)) throw Error('terrain recipe: array required');
  const length = values.length;
  if (!integer(length, max)) throw Error('terrain recipe: array limit');
  const copy: T[] = [];
  for (let i = 0; i < length; i++) copy.push(values[i]!);
  return copy;
}
function channels(values: readonly TerrainField[]): readonly TerrainField[] {
  const copy = boundedArray(values, 3), seen = new Set<TerrainField>();
  for (const value of copy) {
    if (!fields.includes(value) || seen.has(value)) throw Error('terrain recipe: invalid channels');
    seen.add(value);
  }
  return Object.freeze(copy);
}
/**
 * Captures and validates the recipe/operator definitions now. Each yield completes one grid row.
 * The return value owns sampled buffers; final canonical intake/normals remain synchronous.
 */
export function terrainRecipeSlices(recipe: TerrainRecipe, operators: readonly TerrainOperator[], configured: TerrainRecipeLimits = defaults): Generator<void, SampledSurfaceOptions, void> {
  const { id, revision, originX, originZ, spacing, cellsX, cellsZ, seed, formatVersion, steps: sourceSteps } = recipe;
  const { maxParameterBytes, maxParameterNodes, maxParameterDepth } = configured;
  const limits = { maxParameterBytes, maxParameterNodes, maxParameterDepth };
  if (!integer(limits.maxParameterBytes, Number.MAX_SAFE_INTEGER) || !limits.maxParameterBytes || !integer(limits.maxParameterNodes, Number.MAX_SAFE_INTEGER) || !limits.maxParameterNodes || !integer(limits.maxParameterDepth, Number.MAX_SAFE_INTEGER)) throw Error('terrain recipe: invalid limits');
  if (formatVersion !== 1 || !identity(id) || !integer(revision, Number.MAX_SAFE_INTEGER) || !integer(seed, 0xffffffff)) throw Error('terrain recipe: invalid identity/version');
  if (![originX, originZ, spacing].every(Number.isFinite) || spacing <= 0 || !integer(cellsX, 256) || !cellsX || !integer(cellsZ, 256) || !cellsZ) throw Error('terrain recipe: invalid grid');
  const operatorItems = boundedArray(operators, 64), stepItems = boundedArray(sourceSteps, 64);
  // Capture executable references and declarations before invoking any creator validator.
  const definitions = operatorItems.map(operator => {
    const { id, version, validate, evaluate, reads, writes } = operator;
    if (!identity(id) || !integer(version, Number.MAX_SAFE_INTEGER) || typeof validate !== 'function' || typeof evaluate !== 'function') throw Error('terrain recipe: invalid operator');
    return Object.freeze({ id, version, validate, evaluate, reads: channels(reads), writes: channels(writes) });
  });
  const keys = definitions.map(operator => JSON.stringify([operator.id, operator.version]));
  if (new Set(keys).size !== keys.length) throw Error('terrain recipe: duplicate operator version');
  const steps = stepItems.map(step => {
    const { operator, version, parameters: json } = step;
    if (!identity(operator) || !integer(version, Number.MAX_SAFE_INTEGER)) throw Error('terrain recipe: invalid step');
    const definition = definitions.find(value => value.id === operator && value.version === version);
    if (!definition) throw Error('terrain recipe: unknown operator version');
    return { definition, parameter: terrainParameters(json, limits) };
  });
  const axis = (origin: number, cells: number) => {
    const result = new Float32Array(cells + 1);
    for (let i = 0; i <= cells; i++) {
      result[i] = origin + i * spacing;
      if (!Number.isFinite(result[i]) || (i > 0 && result[i]! <= result[i - 1]!)) throw Error('terrain recipe: collapsed grid');
    }
    return result;
  };
  const xs = axis(originX, cellsX), zs = axis(originZ, cellsZ);
  for (const step of steps) if (step.definition.validate(step.parameter) !== true) throw Error('terrain recipe: rejected parameters');
  return (function* () {
    const count = (cellsX + 1) * (cellsZ + 1), heights = new Float32Array(count), materials = new Uint16Array(count), exclusions = new Uint8Array(count);
    for (let iz = 0; iz <= cellsZ; iz++) {
      for (let ix = 0; ix <= cellsX; ix++) {
        const point = Object.freeze({ x: xs[ix]!, z: zs[iz]!, ix, iz, seed });
        const state: Record<TerrainField, number> = { height: 0, material: 0, exclusion: 0 };
        for (const { definition, parameter } of steps) {
          const input: Partial<Record<TerrainField, number>> = {};
          for (const field of definition.reads) input[field] = state[field];
          const output = definition.evaluate(point, Object.freeze(input), parameter);
          if (!output || typeof output !== 'object' || (Object.getPrototypeOf(output) !== Object.prototype && Object.getPrototypeOf(output) !== null)) throw Error('terrain recipe: invalid operator result');
          for (const key of Reflect.ownKeys(output)) {
            if (typeof key !== 'string' || !definition.writes.includes(key as TerrainField)) throw Error('terrain recipe: undeclared output');
            const value = output[key as TerrainField];
            if (typeof value !== 'number' || !Number.isFinite(value) || (key === 'material' && !integer(value, 65535)) || (key === 'exclusion' && value !== 0 && value !== 1)) throw Error('terrain recipe: invalid output field');
            state[key as TerrainField] = value;
          }
        }
        const index = iz * (cellsX + 1) + ix;
        heights[index] = state.height;
        if (!Number.isFinite(heights[index])) throw Error('terrain recipe: height overflow');
        materials[index] = state.material; exclusions[index] = state.exclusion;
      }
      yield;
    }
    return { id, revision, originX, originZ, spacing, cellsX, cellsZ, heights, materials, exclusions };
  })();
}
/** Synchronous convenience evaluation; no publication, scheduling or live-world mutation. */
export function evaluateTerrainRecipe(recipe: TerrainRecipe, operators: readonly TerrainOperator[], limits?: TerrainRecipeLimits): Surface {
  const work = terrainRecipeSlices(recipe, operators, limits);
  let next = work.next();
  while (!next.done) next = work.next();
  return createSampledSurface(next.value);
}
