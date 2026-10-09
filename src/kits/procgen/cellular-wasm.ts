/**
 * Opt-in worker WASM smoothing for the existing cellular generator. The host owns admission,
 * cancellation and publication; the main-thread fallback and synchronous tools keep the JS implementation.
 */
import {createRng} from '../../core/rng';
import {JobCancelledSignal, type JobModule} from '../../platform/workers/job';
import {cellularGenerator, CELLULAR_CELLS_PER_SLICE} from './cellular';
import {CELLULAR_WASM_BYTES} from './cellular-wasm-bytes';
import {createGridGenerationJob, type GridGenerator, type GridJobInput, type GridWire} from './grid-job';

const id = 'job.kits.procgen.cellular-wasm';
const heapBase = 65536;
const fixedScratch = 131072;
const fallbackGenerator: GridGenerator = Object.freeze({...cellularGenerator, scratchFixedBytes: fixedScratch});
const fallbackJob = createGridGenerationJob(id, fallbackGenerator);
let compiled: Promise<WebAssembly.Module> | undefined;

function compile(): Promise<WebAssembly.Module> {
  if (!compiled) {
    compiled = WebAssembly.compile(Uint8Array.from(CELLULAR_WASM_BYTES)).catch(error => {
      compiled = undefined;
      throw error;
    });
  }
  return compiled;
}

type SmoothChunk = (
  input: number,
  output: number,
  width: number,
  height: number,
  start: number,
  end: number,
  birth: number,
  survive: number,
) => number;

function compiledGenerator(module: WebAssembly.Module): GridGenerator {
  return {
    ...fallbackGenerator,
    *generate(cells, context, parameters) {
      const [fill, steps, birth, survive] = parameters as readonly number[];
      const {cellsX: width, cellsY: layers, cellsZ: height, values} = cells;
      const plane = width * height;
      const pages = Math.ceil((heapBase + 2 * plane) / 65536);
      const memory = new WebAssembly.Memory({initial: pages, maximum: pages});
      const instance = new WebAssembly.Instance(module, {env: {memory}});
      const exportedBase = instance.exports.__heap_base;
      const exportedSmooth = instance.exports.smooth_chunk;
      if (
        !(exportedBase instanceof WebAssembly.Global) ||
        exportedBase.value !== heapBase ||
        typeof exportedSmooth !== 'function'
      )
        throw new Error('procgen cellular WASM: incompatible kernel');
      const smooth = exportedSmooth as SmoothChunk;
      let inputPointer = heapBase,
        outputPointer = heapBase + plane,
        input = new Uint8Array(memory.buffer, inputPointer, plane),
        output = new Uint8Array(memory.buffer, outputPointer, plane),
        visits = 0;
      for (let y = 0; y < layers; y++) {
        const random = createRng(context.derive('layer', y));
        for (let i = 0; i < plane; i++) {
          input[i] = random.next() < fill! ? 1 : 0;
          if (++visits === CELLULAR_CELLS_PER_SLICE) {
            visits = 0;
            yield;
          }
        }
        for (let step = 0; step < steps!; step++) {
          for (let start = 0; start < plane;) {
            const end = Math.min(plane, start + CELLULAR_CELLS_PER_SLICE - visits);
            if (smooth(inputPointer, outputPointer, width, height, start, end, birth!, survive!) !== 0)
              throw new Error('procgen cellular WASM: rejected chunk');
            visits += end - start;
            start = end;
            if (visits === CELLULAR_CELLS_PER_SLICE) {
              visits = 0;
              yield;
            }
          }
          [inputPointer, outputPointer] = [outputPointer, inputPointer];
          [input, output] = [output, input];
        }
        values.set(input, y * plane);
      }
    },
  };
}

const module: JobModule<GridJobInput, GridWire> = {
  async run(input, ctx) {
    const kernel = await compile();
    if (ctx.cancelled()) throw new JobCancelledSignal();
    // Only immutable compiled code is shared. Each invocation creates its own grid adapter,
    // generator, instance and fixed memory; cancellation closes the generator through drainSlices.
    return createGridGenerationJob(id, compiledGenerator(kernel)).module.run(input, ctx);
  },
};

/**
 * Optional `job.kits.procgen.cellular-wasm`. Worker execution uses WASM smoothing;
 * `generateNow`, `slices` and the host's main-thread fallback intentionally run the original JS generator.
 * All execution paths reserve the same conservative fixed scratch allowance.
 */
export const cellularWasmGridJob = Object.freeze({...fallbackJob, module});
export const prepareCellularGridWasm = cellularWasmGridJob.prepare;
