import type {WorkerHost} from '../../platform/workers/host';
import {drainSlices, type JobKind, type JobModule, type JobOwner, type JobClass} from '../../platform/workers/job';
import {
  terrainRecipeSlices,
  type TerrainRecipe,
  type TerrainOperator,
  type TerrainRecipeLimits,
  type TerrainField,
} from './recipe';
import {sampledSurfaceWireSlices, adoptGeneratedSurface, type SurfaceWire} from './surface';
import {basicTerrainOperators} from './recipe-operators';
export interface TerrainRecipeJobInput {
  readonly recipe: TerrainRecipe;
}
function bounded<T>(input: readonly T[], max: number): T[] {
  if (!Array.isArray(input)) throw Error('terrain job: array required');
  const length = input.length;
  if (!Number.isSafeInteger(length) || length < 0 || length > max) throw Error('terrain job: array bound');
  const result: T[] = [];
  for (let i = 0; i < length; i++) result.push(input[i]!);
  return result;
}
/** Bind identical executable definitions to one existing lazy job row and its sliced fallback. */
export function createTerrainRecipeJob(
  id: string,
  operators: readonly TerrainOperator[],
  configured: TerrainRecipeLimits = {maxParameterBytes: 4096, maxParameterNodes: 256, maxParameterDepth: 16},
) {
  if (typeof id !== 'string' || !/^job\.[\w.-]{1,200}$/.test(id)) throw Error('terrain job: invalid job id');
  const {maxParameterBytes, maxParameterNodes, maxParameterDepth} = configured;
  if (
    ![maxParameterBytes, maxParameterNodes, maxParameterDepth].every(Number.isSafeInteger) ||
    maxParameterBytes < 1 ||
    maxParameterNodes < 1 ||
    maxParameterDepth < 0
  )
    throw Error('terrain job: invalid limits');
  const limits = Object.freeze({maxParameterBytes, maxParameterNodes, maxParameterDepth});
  const definitions = bounded(operators, 64).map(operator => {
    const {id, version, validate, evaluate, reads, writes} = operator;
    return Object.freeze({
      id,
      version,
      validate,
      evaluate,
      reads: Object.freeze(bounded<TerrainField>(reads, 3)),
      writes: Object.freeze(bounded<TerrainField>(writes, 3)),
    });
  });
  const slices = function* (input: TerrainRecipeJobInput) {
    const samples = yield* terrainRecipeSlices(input.recipe, definitions, limits);
    return yield* sampledSurfaceWireSlices(samples);
  };
  const kind: JobKind<TerrainRecipeJobInput, SurfaceWire> = Object.freeze<JobKind<TerrainRecipeJobInput, SurfaceWire>>({
    id,
    cancellation: Object.freeze({mode: 'sliced', deadlineMs: 100}),
    fallback: Object.freeze({mode: 'main-thread', slices}),
  });
  const module: JobModule<TerrainRecipeJobInput, SurfaceWire> = {
    async run(input, ctx) {
      const output = await drainSlices(slices(input), ctx);
      return {
        output,
        transfer: [
          output.xs.buffer,
          output.zs.buffer,
          output.heights.buffer,
          output.materials.buffer,
          output.exclusions.buffer,
          output.normals!.buffer,
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
      recipe: TerrainRecipe,
      signal: AbortSignal,
      urgency: JobClass = 'foreground',
    ) {
      const {formatVersion, id, revision, originX, originZ, spacing, cellsX, cellsZ, seed, steps: sourceSteps} = recipe;
      if (
        formatVersion !== 1 ||
        typeof id !== 'string' ||
        !id.trim() ||
        id.length > 256 ||
        !Number.isSafeInteger(revision) ||
        revision < 0 ||
        !Number.isSafeInteger(seed) ||
        seed < 0 ||
        seed > 0xffffffff ||
        ![originX, originZ, spacing].every(Number.isFinite) ||
        spacing <= 0 ||
        ![cellsX, cellsZ].every(n => Number.isSafeInteger(n) && n >= 1 && n <= 256)
      )
        throw Error('terrain job: invalid recipe metadata');
      let parameterReservation = 0;
      const steps = bounded(sourceSteps, 64).map(step => {
        const {operator, version, parameters} = step;
        if (
          typeof operator !== 'string' ||
          !operator.trim() ||
          operator.length > 256 ||
          !Number.isSafeInteger(version) ||
          version < 0 ||
          typeof parameters !== 'string' ||
          parameters.length > maxParameterBytes
        )
          throw Error('terrain job: invalid step metadata');
        parameterReservation += parameters.length * 6 + 2048;
        return Object.freeze({operator, version, parameters});
      });
      const snapshot: TerrainRecipe = Object.freeze({
        formatVersion,
        id,
        revision,
        originX,
        originZ,
        spacing,
        cellsX,
        cellsZ,
        seed,
        steps: Object.freeze(steps),
      });
      const count = (cellsX + 1) * (cellsZ + 1);
      // Conservative payload allowances include simultaneous sample/wire/canonical copies and parsed JSON.
      const input = parameterReservation + 4096,
        output = count * 64 + 4096,
        scratch = count * 128 + parameterReservation * 8 + 4096;
      if (![input, output, scratch, input + output + scratch].every(Number.isSafeInteger))
        throw Error('terrain job: reservation overflow');
      const result = await host.run(
        {
          kind,
          owner,
          version: revision,
          key: id,
          class: urgency,
          bytes: {input, output, scratch},
          materialise: () => ({input: {recipe: structuredClone(snapshot)}}),
        },
        signal,
      );
      if (result.status !== 'done') return result;
      // Host validated delivery; recheck after the promise boundary before adopting owned output.
      if (signal.aborted || owner.signal.aborted) return {status: 'cancelled' as const};
      return {status: 'done' as const, surface: adoptGeneratedSurface(snapshot, result.output)};
    },
  });
}
export const basicTerrainRecipeJob = createTerrainRecipeJob('job.kits.terrain.recipe', basicTerrainOperators);
export const prepareTerrainRecipe = basicTerrainRecipeJob.prepare;
