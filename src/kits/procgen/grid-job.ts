/**
 * Seeded cell-grid generation on the existing WorkerHost (GEN-01).
 *
 * A creator registers a generator (executable code, imported by both the worker module and the main-thread fallback)
 * and submits serializable recipes. The host owns scheduling, byte admission, cancellation, supersession and
 * fallback; this adapter adds input capture, bounded parameters, a slice ceiling and output validation. No second
 * scheduler, registry or publication owner is created: a returned grid never publishes itself.
 */
import type { WorkerHost } from '../../platform/workers/host';
import { drainSlices, type JobClass, type JobKind, type JobModule, type JobOwner } from '../../platform/workers/job';
import { createRng, deriveSeed, type Rng, type SeedPart } from '../../core/rng';

export type GridParameter = null | boolean | number | string | readonly GridParameter[] | { readonly [key: string]: GridParameter };
export interface GridLimits {
  /** Cells per grid (cellsX × cellsY × cellsZ). 1..GRID_MAX_CELLS. */
  readonly maxCells: number;
  /** Yields a generator may make before the job fails as runaway work. 1..2^24. */
  readonly maxSlices: number;
  readonly maxParameterBytes: number;
  readonly maxParameterNodes: number;
  readonly maxParameterDepth: number;
}
/** Hard ceiling for `maxCells`: 2^22 cells, 8 MiB of Uint16 output. */
export const GRID_MAX_CELLS = 4194304;
export const GRID_DEFAULT_LIMITS: GridLimits = Object.freeze({ maxCells: 262144, maxSlices: 65536, maxParameterBytes: 4096, maxParameterNodes: 256, maxParameterDepth: 16 });

/** Serializable request. `seed` is usually `deriveSeed(root, ...path)`; `id`/`revision` are the supersession key/version. */
export interface GridRecipe {
  readonly formatVersion: 1;
  readonly generatorVersion: number;
  readonly id: string;
  readonly revision: number;
  readonly seed: number;
  readonly cellsX: number;
  readonly cellsY: number;
  readonly cellsZ: number;
  /** JSON text, parsed and frozen inside admitted work. */
  readonly parameters: string;
}
/** The grid a generator fills. Index order is x fastest, then z, then y: `(y * cellsZ + z) * cellsX + x`. */
export interface GridCells {
  readonly cellsX: number;
  readonly cellsY: number;
  readonly cellsZ: number;
  /** Raw storage for fast paths. Typed-array writes wrap modulo 2^16; values above `maxValue` fail the job. */
  readonly values: Uint16Array;
  index(x: number, y: number, z: number): number;
  get(x: number, y: number, z: number): number;
  /** Checked write: in-bounds integer coordinates and an integer value 0..maxValue, else throws. */
  set(x: number, y: number, z: number, value: number): void;
}
export interface GridContext {
  readonly seed: number;
  /** One stream seeded from `seed`; its draw order is part of the generator's deterministic contract. */
  readonly random: Rng;
  /** `deriveSeed(seed, ...path)`: order-independent sub-streams (per layer, per feature). */
  derive(...path: SeedPart[]): number;
}
/**
 * Trusted creator code. `generate` must be deterministic in (cells, context, parameters): no `Math.random`, time,
 * mutable module state or invocation-order dependence. Each `yield` ends one bounded slice and is a cancellation
 * checkpoint; work between yields is not time-limited by this adapter.
 */
export interface GridGenerator {
  readonly version: number;
  /** Largest value the generator writes, 0..65535. */
  readonly maxValue: number;
  /** Declared extra working bytes per cell for byte admission (accounting only, not measured). Default 0, max 64. */
  readonly scratchBytesPerCell?: number;
  readonly validate: (parameters: GridParameter) => boolean;
  readonly generate: (cells: GridCells, context: GridContext, parameters: GridParameter) => Generator<void, void, void>;
}
export interface GridDescriptor {
  readonly id: string; readonly revision: number; readonly generatorVersion: number; readonly seed: number;
  readonly cellsX: number; readonly cellsY: number; readonly cellsZ: number;
}
export interface GridWire { readonly descriptor: GridDescriptor; readonly values: Uint16Array; readonly slices: number }
/** An adopted candidate. `values` is caller-owned (transferred or freshly allocated); copy it to keep a baseline. */
export interface GeneratedGrid extends GridDescriptor {
  readonly values: Uint16Array;
  readonly slices: number;
  index(x: number, y: number, z: number): number;
  get(x: number, y: number, z: number): number;
}
export interface GridJobInput { readonly recipe: GridRecipe }
export type GridPrepareResult =
  | { readonly status: 'done'; readonly grid: GeneratedGrid }
  | { readonly status: 'cancelled' | 'superseded' | 'preempted' | 'saturated' | 'oversized' };

const fail = (why: string): never => { throw Error(`procgen grid: ${why}`); };
const int = (n: unknown, min: number, max: number): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= min && n <= max;

/** Bounded JSON: UTF-8 bytes before parsing, then node count, depth and finiteness; values are frozen. */
export function parseGridParameters(json: string, limits: Pick<GridLimits, 'maxParameterBytes' | 'maxParameterNodes' | 'maxParameterDepth'>): GridParameter {
  if (typeof json !== 'string' || json.length > limits.maxParameterBytes || new TextEncoder().encode(json).length > limits.maxParameterBytes) fail('parameter bytes');
  const value = JSON.parse(json) as GridParameter, pending: { value: GridParameter; depth: number }[] = [{ value, depth: 0 }];
  let count = 0;
  while (pending.length) {
    const item = pending.pop()!;
    if (++count > limits.maxParameterNodes || item.depth > limits.maxParameterDepth) fail('parameter structure');
    if (typeof item.value === 'number' && !Number.isFinite(item.value)) fail('nonfinite parameter');
    if (item.value && typeof item.value === 'object') {
      const children = Object.values(item.value);
      if (children.length > limits.maxParameterNodes - count - pending.length) fail('parameter structure');
      for (const child of children) pending.push({ value: child, depth: item.depth + 1 });
      Object.freeze(item.value);
    }
  }
  return value;
}

function captureLimits(limits: Partial<GridLimits>): GridLimits {
  const l = { ...GRID_DEFAULT_LIMITS, ...limits };
  if (!int(l.maxCells, 1, GRID_MAX_CELLS) || !int(l.maxSlices, 1, 2 ** 24) || !int(l.maxParameterBytes, 1, 2 ** 20) || !int(l.maxParameterNodes, 1, 2 ** 16) || !int(l.maxParameterDepth, 0, 64)) fail('invalid limits');
  return Object.freeze({ maxCells: l.maxCells, maxSlices: l.maxSlices, maxParameterBytes: l.maxParameterBytes, maxParameterNodes: l.maxParameterNodes, maxParameterDepth: l.maxParameterDepth });
}

function cellsOf(cellsX: number, cellsY: number, cellsZ: number, values: Uint16Array, maxValue: number): GridCells {
  const index = (x: number, y: number, z: number) => {
    if (!int(x, 0, cellsX - 1) || !int(y, 0, cellsY - 1) || !int(z, 0, cellsZ - 1)) fail('cell outside grid');
    return (y * cellsZ + z) * cellsX + x;
  };
  return Object.freeze({
    cellsX, cellsY, cellsZ, values, index,
    get: (x: number, y: number, z: number) => values[index(x, y, z)]!,
    set: (x: number, y: number, z: number, value: number) => { if (!int(value, 0, maxValue)) fail('cell value out of range'); values[index(x, y, z)] = value; },
  });
}

/** Registers one generator under one job id. Import the result in the worker file and in the caller (fallback). */
export function createGridGenerationJob(id: string, generator: GridGenerator, limits: Partial<GridLimits> = {}) {
  const { version, maxValue, validate, generate } = generator, scratchPerCell = generator.scratchBytesPerCell ?? 0;
  if (typeof id !== 'string' || !/^job\.[\w.-]{1,200}$/.test(id) || !int(version, 0, Number.MAX_SAFE_INTEGER) || !int(maxValue, 0, 65535) || !int(scratchPerCell, 0, 64) || typeof validate !== 'function' || typeof generate !== 'function') fail('invalid registration');
  const bounds = captureLimits(limits);
  const capture = (input: GridRecipe): GridRecipe => {
    if (!input || typeof input !== 'object') fail('invalid recipe');
    const { formatVersion, generatorVersion, id: gridId, revision, seed, cellsX, cellsY, cellsZ, parameters } = input;
    if (formatVersion !== 1 || generatorVersion !== version) fail('format or generator version');
    if (typeof gridId !== 'string' || gridId.length < 1 || gridId.length > 256) fail('id');
    if (!int(revision, 0, Number.MAX_SAFE_INTEGER) || !int(seed, 0, 0xffffffff)) fail('revision or seed');
    if (!int(cellsX, 1, bounds.maxCells) || !int(cellsY, 1, bounds.maxCells) || !int(cellsZ, 1, bounds.maxCells) || cellsX * cellsY * cellsZ > bounds.maxCells) fail('cell count');
    if (typeof parameters !== 'string' || parameters.length > bounds.maxParameterBytes) fail('parameter bytes');
    return Object.freeze({ formatVersion, generatorVersion, id: gridId, revision, seed, cellsX, cellsY, cellsZ, parameters });
  };
  const descriptorOf = (r: GridRecipe): GridDescriptor => Object.freeze({ id: r.id, revision: r.revision, generatorVersion: r.generatorVersion, seed: r.seed, cellsX: r.cellsX, cellsY: r.cellsY, cellsZ: r.cellsZ });
  const slices = function* (input: GridJobInput): Generator<void, GridWire, void> {
    const recipe = capture(input.recipe), parameters = parseGridParameters(recipe.parameters, bounds);
    if (validate(parameters) !== true) fail('rejected parameters');
    const values = new Uint16Array(recipe.cellsX * recipe.cellsY * recipe.cellsZ);
    const cells = cellsOf(recipe.cellsX, recipe.cellsY, recipe.cellsZ, values, maxValue);
    const random = createRng(recipe.seed);
    const context: GridContext = Object.freeze({ seed: recipe.seed, random, derive: (...path: SeedPart[]) => deriveSeed(recipe.seed, ...path) });
    const work = generate(cells, context, parameters);
    if (!work || typeof work.next !== 'function' || typeof work.return !== 'function') fail('generate must return a generator');
    let count = 0;
    try {
      for (;;) {
        const step = work.next();
        if (step.done) break;
        if (++count > bounds.maxSlices) fail('slice limit exceeded');
        yield;
      }
    } finally { work.return(undefined); }
    for (let i = 0; i < values.length; i++) {
      if (values[i]! > maxValue) fail('cell value out of range');
      if ((i & 0xffff) === 0xffff) yield;
    }
    return { descriptor: descriptorOf(recipe), values, slices: count };
  };
  const adopt = (recipe: GridRecipe, wire: GridWire): GeneratedGrid => {
    if (!wire || typeof wire !== 'object' || !wire.descriptor || typeof wire.descriptor !== 'object') fail('malformed output');
    const expected = descriptorOf(recipe), d = wire.descriptor as unknown as Record<string, unknown>;
    for (const k of Object.keys(expected) as (keyof GridDescriptor)[]) if (d[k] !== expected[k]) fail(`output ${k} mismatch`);
    const { values, slices: used } = wire, count = recipe.cellsX * recipe.cellsY * recipe.cellsZ;
    if (!(values instanceof Uint16Array) || values.length !== count) fail('output length');
    if (!int(used, 0, bounds.maxSlices)) fail('output slice count');
    for (let i = 0; i < count; i++) if (values[i]! > maxValue) fail('cell value out of range');
    const index = (x: number, y: number, z: number) => {
      if (!int(x, 0, recipe.cellsX - 1) || !int(y, 0, recipe.cellsY - 1) || !int(z, 0, recipe.cellsZ - 1)) fail('cell outside grid');
      return (y * recipe.cellsZ + z) * recipe.cellsX + x;
    };
    return Object.freeze({ ...expected, values, slices: used, index, get: (x: number, y: number, z: number) => values[index(x, y, z)]! });
  };
  const kind: JobKind<GridJobInput, GridWire> = Object.freeze({ id, cancellation: Object.freeze({ mode: 'sliced', deadlineMs: 100 }), fallback: Object.freeze({ mode: 'main-thread', slices }) });
  const module: JobModule<GridJobInput, GridWire> = {
    async run(input, ctx) {
      const output = await drainSlices(slices(input), ctx);
      return { output, transfer: [output.values.buffer as ArrayBuffer] };
    },
  };
  /** Bytes reserved before any payload exists: parameters, Uint16 output, declared scratch. */
  const reservation = (recipe: GridRecipe) => {
    const count = recipe.cellsX * recipe.cellsY * recipe.cellsZ, params = recipe.parameters.length * 6 + 4096;
    return { input: params, output: count * 2 + 4096, scratch: count * (2 + scratchPerCell) + params * 8 + 4096 };
  };
  return Object.freeze({
    kind, module, slices, limits: bounds, reservation: (input: GridRecipe) => reservation(capture(input)),
    /** Synchronous drain for tests and offline tools; runtime callers use `prepare`. */
    generateNow(input: GridRecipe): GeneratedGrid {
      const recipe = capture(input), it = slices({ recipe });
      for (;;) { const step = it.next(); if (step.done) return adopt(recipe, step.value); }
    },
    async prepare(host: WorkerHost, owner: JobOwner, input: GridRecipe, signal: AbortSignal, urgency: JobClass = 'foreground'): Promise<GridPrepareResult> {
      const recipe = capture(input);
      const result = await host.run({ kind, owner, version: recipe.revision, key: recipe.id, class: urgency, bytes: reservation(recipe), materialise: () => ({ input: { recipe: structuredClone(recipe) } }) }, signal);
      if (result.status !== 'done') return result;
      if (signal.aborted || owner.signal.aborted) return { status: 'cancelled' };
      return { status: 'done', grid: adopt(recipe, result.output) };
    },
  });
}
