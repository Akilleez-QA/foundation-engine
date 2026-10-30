import type {WorkerHost} from '../../platform/workers/host';
import {drainSlices, type JobKind, type JobModule, type JobOwner, type JobClass} from '../../platform/workers/job';
import {terrainParameters, type TerrainParameter, type TerrainRecipeLimits} from './recipe';
import {
  adoptTerrainRegion,
  captureTerrainRegion,
  terrainRegionSlices,
  terrainRegionWire,
  type TerrainRegionOptions,
  type TerrainRegionPoint,
  type TerrainRegionValue,
  type TerrainRegionWire,
} from './region';
export interface TerrainRegionRecipe {
  readonly formatVersion: 1;
  readonly evaluatorVersion: number;
  readonly region: TerrainRegionOptions;
  readonly seed: number;
  readonly parameters: string;
}
/** Trusted synchronous point evaluator; global indices are explicit and never relabel local recipe indices. */
export interface TerrainRegionEvaluator {
  readonly version: number;
  readonly validate: (parameters: TerrainParameter) => boolean;
  readonly evaluate: (
    point: TerrainRegionPoint & Readonly<{seed: number}>,
    parameters: TerrainParameter,
  ) => TerrainRegionValue;
}
export interface TerrainRegionJobInput {
  readonly recipe: TerrainRegionRecipe;
}
/** Register the same evaluator module in worker and sliced fallback; executable code is never serialized. */
export function createTerrainRegionJob(
  id: string,
  evaluator: TerrainRegionEvaluator,
  configured: TerrainRecipeLimits = {maxParameterBytes: 4096, maxParameterNodes: 256, maxParameterDepth: 16},
) {
  const {version, validate, evaluate} = evaluator;
  const {maxParameterBytes, maxParameterNodes, maxParameterDepth} = configured;
  if (
    typeof id !== 'string' ||
    !/^job\.[\w.-]{1,200}$/.test(id) ||
    !Number.isSafeInteger(version) ||
    version < 0 ||
    typeof validate !== 'function' ||
    typeof evaluate !== 'function'
  )
    throw Error('terrain region job: invalid registration');
  if (
    ![maxParameterBytes, maxParameterNodes, maxParameterDepth].every(Number.isSafeInteger) ||
    maxParameterBytes < 1 ||
    maxParameterNodes < 1 ||
    maxParameterDepth < 0
  )
    throw Error('terrain region job: invalid limits');
  const limits = Object.freeze({maxParameterBytes, maxParameterNodes, maxParameterDepth});
  const capture = (input: TerrainRegionRecipe): TerrainRegionRecipe => {
    const {formatVersion, evaluatorVersion, region: raw, seed, parameters} = input;
    const region = captureTerrainRegion(raw);
    if (
      formatVersion !== 1 ||
      evaluatorVersion !== version ||
      !Number.isSafeInteger(seed) ||
      seed < 0 ||
      seed > 0xffffffff ||
      typeof parameters !== 'string' ||
      parameters.length > maxParameterBytes
    )
      throw Error('terrain region job: invalid recipe');
    return Object.freeze({formatVersion, evaluatorVersion, region, seed, parameters});
  };
  const slices = function* (input: TerrainRegionJobInput) {
    const recipe = capture(input.recipe),
      parameter = terrainParameters(recipe.parameters, limits);
    if (validate(parameter) !== true) throw Error('terrain region job: rejected parameters');
    const region = yield* terrainRegionSlices(recipe.region, p =>
      evaluate(Object.freeze({...p, seed: recipe.seed}), parameter),
    );
    return terrainRegionWire(region);
  };
  const kind: JobKind<TerrainRegionJobInput, TerrainRegionWire> = Object.freeze({
    id,
    cancellation: Object.freeze({mode: 'sliced', deadlineMs: 100}),
    fallback: Object.freeze({mode: 'main-thread', slices}),
  });
  const module: JobModule<TerrainRegionJobInput, TerrainRegionWire> = {
    async run(input, ctx) {
      const output = await drainSlices(slices(input), ctx);
      return {
        output,
        transfer: [
          output.data.xs.buffer,
          output.data.zs.buffer,
          output.data.heights.buffer,
          output.data.materials.buffer,
          output.data.exclusions.buffer,
          output.data.normals!.buffer,
        ] as ArrayBuffer[],
      };
    },
  };
  return Object.freeze({
    kind,
    module,
    slices,
    async prepare(
      host: WorkerHost,
      owner: JobOwner,
      input: TerrainRegionRecipe,
      signal: AbortSignal,
      urgency: JobClass = 'foreground',
    ) {
      const recipe = capture(input),
        count = (recipe.region.cellsX + 3) * (recipe.region.cellsZ + 3),
        params = recipe.parameters.length * 6 + 4096;
      const bytes = {input: params, output: count * 128 + 4096, scratch: count * 256 + params * 8 + 4096};
      if (
        ![bytes.input, bytes.output, bytes.scratch, bytes.input + bytes.output + bytes.scratch].every(
          Number.isSafeInteger,
        )
      )
        throw Error('terrain region job: reservation overflow');
      const result = await host.run(
        {
          kind,
          owner,
          version: recipe.region.lattice.revision,
          key: recipe.region.id,
          class: urgency,
          bytes,
          materialise: () => ({input: {recipe: structuredClone(recipe)}}),
        },
        signal,
      );
      if (result.status !== 'done') return result;
      if (signal.aborted || owner.signal.aborted) return {status: 'cancelled' as const};
      return {status: 'done' as const, region: adoptTerrainRegion(recipe.region, result.output)};
    },
  });
}
/** Optional example plane; creators can register entirely different point evaluators. */
export const basicTerrainRegionJob = createTerrainRegionJob('job.kits.terrain.region', {
  version: 1,
  validate: p => Array.isArray(p) && p.length === 3 && p.every(n => typeof n === 'number' && Number.isFinite(n)),
  evaluate: (p, parameters) => {
    const [x, z, offset] = parameters as readonly number[];
    return {height: p.x * x! + p.z * z! + offset!};
  },
});
export const prepareTerrainRegion = basicTerrainRegionJob.prepare;
