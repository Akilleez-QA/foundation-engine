import test from 'node:test';
import assert from 'node:assert/strict';
import {JobCancelledSignal, type JobContext} from '../../platform/workers/job';
import {cellularGridJob} from './cellular';
import {cellularWasmGridJob} from './cellular-wasm';
import type {GridRecipe} from './grid-job';

const context: JobContext = {cancelled: () => false, checkpoint: async () => {}};
const recipe = (overrides: Partial<GridRecipe> = {}): GridRecipe => ({
  formatVersion: 1,
  generatorVersion: 1,
  id: 'wasm-parity',
  revision: 0,
  seed: 42,
  cellsX: 17,
  cellsY: 3,
  cellsZ: 23,
  parameters: '[0.45,4,5,4]',
  ...overrides,
});

async function assertParity(input: GridRecipe) {
  const expected = cellularGridJob.generateNow(input),
    result = await cellularWasmGridJob.module.run({recipe: input}, context);
  assert.deepEqual(result.output.values, expected.values, JSON.stringify(input));
  assert.equal(result.output.slices, expected.slices, 'generator slice counts match');
  assert.deepEqual(result.output.descriptor, {
    id: input.id,
    revision: input.revision,
    generatorVersion: input.generatorVersion,
    seed: input.seed,
    cellsX: input.cellsX,
    cellsY: input.cellsY,
    cellsZ: input.cellsZ,
  });
  assert.equal(result.output.values.byteOffset, 0);
  assert.equal(result.output.values.buffer.byteLength, input.cellsX * input.cellsY * input.cellsZ * 2);
  assert.deepEqual(result.transfer, [result.output.values.buffer]);
  return result;
}

test('GEN-01 optional WASM worker matches the reference across seeds, thin grids and threshold extremes', async () => {
  for (const seed of [0, 1, 42, 0x80000000, 0xffffffff])
    for (const [cellsX, cellsY, cellsZ] of [
      [1, 1, 1],
      [1, 3, 37],
      [31, 2, 1],
      [17, 3, 23],
    ] as const)
      await assertParity(recipe({seed, cellsX, cellsY, cellsZ}));
  for (const parameters of [
    '[0,0,0,0]',
    '[1,0,9,9]',
    '[0,1,0,9]',
    '[1,1,9,0]',
    '[0.5,2,9,9]',
    '[0.5,3,0,0]',
    '[0.45,16,5,4]',
  ])
    await assertParity(recipe({parameters}));
});

test('GEN-01 optional WASM worker preserves slice boundaries within passes and across layers', async () => {
  for (const cellsX of [4095, 4096, 4097])
    for (const cellsY of [1, 3])
      for (const steps of [0, 1, 2])
        await assertParity(recipe({cellsX, cellsY, cellsZ: 1, parameters: `[0.45,${steps},5,4]`}));
  // The adapter's additional output-validation checkpoint also matches above 65,536 cells.
  await assertParity(recipe({cellsX: 257, cellsY: 1, cellsZ: 257, parameters: '[0.45,2,5,4]'}));
});

test('GEN-01 optional WASM concurrent jobs own independent, transferable output buffers', async () => {
  const inputs = [recipe({seed: 7, cellsX: 97, cellsZ: 89}), recipe({seed: 91, cellsX: 83, cellsZ: 101})],
    [first, second] = await Promise.all(inputs.map(assertParity));
  assert.ok(first && second);
  assert.notEqual(first.output.values.buffer, second.output.values.buffer);
  const secondSnapshot = second.output.values.slice(),
    transferred = structuredClone(first.output, {transfer: [...first.transfer!]});
  assert.equal(first.output.values.byteLength, 0);
  assert.deepEqual(transferred.values, cellularGridJob.generateNow(inputs[0]!).values);
  transferred.values.fill(0xffff);
  assert.deepEqual(second.output.values, secondSnapshot, 'transferring and changing one output cannot affect another');
  await assertParity(inputs[0]!);
  assert.deepEqual(second.output.values, secondSnapshot, 'a later instance cannot overwrite an earlier output');
});

test('GEN-01 optional WASM worker cancellation at checkpoints rejects and a later run recovers', async () => {
  const input = recipe({cellsX: 129, cellsY: 2, cellsZ: 127});
  await assert.rejects(
    async () => cellularWasmGridJob.module.run({recipe: input}, {...context, cancelled: () => true}),
    JobCancelledSignal,
  );
  for (const stop of [1, 5, 12]) {
    let checkpoints = 0;
    await assert.rejects(
      async () =>
        cellularWasmGridJob.module.run(
          {recipe: input},
          {
            cancelled: () => checkpoints >= stop,
            checkpoint: async () => {
              if (++checkpoints === stop) throw new JobCancelledSignal();
            },
          },
        ),
      JobCancelledSignal,
    );
    assert.equal(checkpoints, stop, 'no work checkpoints after cancellation');
    await assertParity(input);
  }
});
