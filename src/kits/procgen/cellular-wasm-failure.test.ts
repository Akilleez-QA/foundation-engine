import assert from 'node:assert/strict';
import test from 'node:test';
import type {JobContext} from '../../platform/workers/job';
import {cellularGridJob} from './cellular';
import {cellularWasmGridJob} from './cellular-wasm';
import {CELLULAR_WASM_BYTES} from './cellular-wasm-bytes';
import type {GridRecipe} from './grid-job';

// This file has its own test process and therefore starts with an empty module cache.
const context: JobContext = {cancelled: () => false, checkpoint: async () => {}};
const recipe = (seed: number): GridRecipe => ({
  formatVersion: 1,
  generatorVersion: 1,
  id: 'wasm-failure',
  revision: 0,
  seed,
  cellsX: 97,
  cellsY: 2,
  cellsZ: 89,
  parameters: '[0.45,4,5,4]',
});
const run = (seed = 42) => cellularWasmGridJob.module.run({recipe: recipe(seed)}, context);

async function recovered() {
  const result = await run();
  assert.deepEqual(result.output.values, cellularGridJob.generateNow(recipe(42)).values);
  assert.deepEqual(result.transfer, [result.output.values.buffer]);
}

test('GEN-01 WASM compile failure clears cache; concurrent retry shares compile and owns separate memory', async t => {
  const realCompile = WebAssembly.compile;
  const failure = new WebAssembly.CompileError('injected compilation failure');
  const memories: WebAssembly.Memory[] = [];
  let resolveModule!: (module: WebAssembly.Module) => void;
  const pending = new Promise<WebAssembly.Module>(resolve => {
    resolveModule = resolve;
  });
  let attempts = 0;
  const compile = t.mock.method(WebAssembly, 'compile', () => {
    if (++attempts === 1) return Promise.reject(failure);
    return pending;
  });
  t.mock.method(
    WebAssembly,
    'Memory',
    new Proxy(WebAssembly.Memory, {
      construct(target, args) {
        const memory = Reflect.construct(target, args) as WebAssembly.Memory;
        memories.push(memory);
        return memory;
      },
    }),
  );
  await assert.rejects(
    async () => run(),
    error => error === failure,
  );
  assert.equal(memories.length, 0, 'compile failure allocates no job memory');
  const first = run(7),
    second = run(91);
  assert.equal(compile.mock.callCount(), 2, 'concurrent retries share one pending compilation');
  assert.equal(memories.length, 0, 'instances wait for compilation');
  resolveModule(await realCompile(Uint8Array.from(CELLULAR_WASM_BYTES)));
  const [a, b] = await Promise.all([first, second]);
  assert.equal(memories.length, 2);
  assert.notEqual(memories[0], memories[1]);
  assert.notEqual(memories[0]!.buffer, memories[1]!.buffer);
  for (const memory of memories) assert.throws(() => memory.grow(1), RangeError);
  assert.deepEqual(a.output.values, cellularGridJob.generateNow(recipe(7)).values);
  assert.deepEqual(b.output.values, cellularGridJob.generateNow(recipe(91)).values);
  assert.notEqual(a.output.values.buffer, b.output.values.buffer);
  await recovered();
  assert.equal(compile.mock.callCount(), 2, 'successful compilation remains cached');
});

test('GEN-01 WASM instance failure rejects and a later invocation recovers', async t => {
  const failure = new WebAssembly.LinkError('injected instance failure');
  const instance = t.mock.method(
    WebAssembly,
    'Instance',
    new Proxy(WebAssembly.Instance, {
      construct() {
        throw failure;
      },
    }),
  );
  await assert.rejects(
    async () => run(),
    error => error === failure,
  );
  assert.equal(instance.mock.callCount(), 1);
  instance.mock.restore();
  await recovered();
});

test('GEN-01 WASM kernel trap rejects without output and a later invocation recovers', async t => {
  const failure = new WebAssembly.RuntimeError('injected smoothing trap');
  let calls = 0;
  const instance = t.mock.method(
    WebAssembly,
    'Instance',
    new Proxy(WebAssembly.Instance, {
      construct(target, args) {
        const real = Reflect.construct(target, args) as WebAssembly.Instance;
        return {
          exports: {
            ...real.exports,
            smooth_chunk: () => {
              calls++;
              throw failure;
            },
          },
        };
      },
    }),
  );
  await assert.rejects(
    async () => run(),
    error => error === failure,
  );
  assert.equal(calls, 1, 'a trap stops smoothing immediately');
  instance.mock.restore();
  await recovered();
});
