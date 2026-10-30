import {createWorkerHost} from '../../../src/platform/workers/host.ts';
import {deriveSeed} from '../../../src/core/rng.ts';
import {cellularGridJob} from '../../../src/kits/procgen/cellular.ts';
import {cellularWasmGridJob} from '../../../src/kits/procgen/cellular-wasm.ts';

const recipe = {
  formatVersion: 1,
  generatorVersion: 1,
  id: 'wasm-browser',
  revision: 1,
  seed: deriveSeed(42, 'region', 3, -2),
  cellsX: 64,
  cellsY: 2,
  cellsZ: 64,
  parameters: '[0.45,4,5,4]',
};
const profile = {maxSlots: 2, maxPending: 8, maxReservedBytes: 16 * 1024 * 1024, warm: 2};
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const check = (condition, message) => {
  if (!condition) throw Error(message);
};
const owner = id => ({id, signal: new AbortController().signal});
const signal = () => new AbortController().signal;
const settle = async host => {
  for (let i = 0; i < 1000 && (host.stats().running || host.stats().pending); i++) await pause(5);
  const stats = host.stats();
  check(stats.running === 0 && stats.pending === 0 && stats.reservedBytes === 0, 'host did not release reservations');
  return stats;
};
const equal = (result, expectedRecipe) => {
  check(result.status === 'done', `expected done, got ${result.status}`);
  const expected = cellularGridJob.generateNow(expectedRecipe);
  check(result.grid.values.length === expected.values.length, 'grid length differs');
  for (let i = 0; i < expected.values.length; i++)
    check(result.grid.values[i] === expected.values[i], `JS/WASM mismatch at cell ${i}`);
  check(result.grid.slices === expected.slices, 'slice count differs');
};

window.runCellularWasmCheck = async () => {
  const host = createWorkerHost({profile, hardwareConcurrency: 4});
  const fallback = createWorkerHost({profile, createWorker: null});
  const tiny = createWorkerHost({profile: {...profile, maxReservedBytes: 1024}});
  const disposable = createWorkerHost({profile, hardwareConcurrency: 4});
  const a = owner('owner-a'),
    b = owner('owner-b');
  const big = {...recipe, cellsX: 256, cellsY: 4, cellsZ: 256, parameters: '[0.45,16,5,4]'};
  const report = {};
  try {
    // Same key and revision with distinct owner lifetimes must not supersede each other.
    const alternate = {...recipe, seed: deriveSeed(91, 'other')};
    let workerTicks = 0;
    const workerTimer = setInterval(() => workerTicks++, 0);
    let completed;
    try {
      const first = cellularWasmGridJob.prepare(host, a, recipe, signal());
      const second = cellularWasmGridJob.prepare(host, b, alternate, signal());
      report.concurrentRunning = host.stats().running;
      completed = await Promise.all([first, second]);
    } finally {
      clearInterval(workerTimer);
    }
    equal(completed[0], recipe);
    equal(completed[1], alternate);
    check(report.concurrentRunning === 2, 'two distinct owners did not run concurrently');
    check(completed[0].grid.values.buffer !== completed[1].grid.values.buffer, 'jobs share output storage');
    check(workerTicks > 0, 'main-thread timer did not run during worker jobs');
    report.workerTicks = workerTicks;
    report.completion = await settle(host);

    let fallbackTicks = 0;
    const fallbackTimer = setInterval(() => fallbackTicks++, 0);
    let inline;
    try {
      inline = await cellularWasmGridJob.prepare(fallback, a, recipe, signal());
    } finally {
      clearInterval(fallbackTimer);
    }
    equal(inline, recipe);
    check(fallbackTicks > 1, 'no-worker fallback did not yield across browser tasks');
    report.fallbackTicks = fallbackTicks;
    report.fallback = await settle(fallback);

    // Warm worker, long recipe, then a browser task before cancelling active execution.
    const abort = new AbortController();
    const cancelled = cellularWasmGridJob.prepare(host, a, {...big, id: 'cancel'}, abort.signal);
    await pause(20);
    report.runningAtAbort = host.stats().running;
    check(report.runningAtAbort === 1, 'cancel did not target active work');
    abort.abort();
    report.cancelled = (await cancelled).status;
    check(report.cancelled === 'cancelled', 'active abort delivered output');
    report.afterCancel = await settle(host);
    const recovered = await cellularWasmGridJob.prepare(host, a, {...recipe, id: 'recovery'}, signal());
    equal(recovered, {...recipe, id: 'recovery'});
    report.recovery = recovered.status;

    const old = cellularWasmGridJob.prepare(host, a, {...big, id: 'replace'}, signal());
    await pause(20);
    const newestRecipe = {...recipe, id: 'replace', revision: 2};
    const newest = cellularWasmGridJob.prepare(host, a, newestRecipe, signal());
    report.superseded = (await old).status;
    check(report.superseded === 'superseded', 'old active revision was not superseded');
    equal(await newest, newestRecipe);
    report.stale = (await cellularWasmGridJob.prepare(host, a, {...recipe, id: 'replace'}, signal())).status;
    check(report.stale === 'superseded', 'stale revision was accepted');
    await settle(host);

    const lifetime = new AbortController();
    const owned = cellularWasmGridJob.prepare(host, {id: 'ending-owner', signal: lifetime.signal}, big, signal());
    await pause(20);
    check(host.stats().running === 1, 'owner abort did not target active work');
    lifetime.abort();
    report.ownerAborted = (await owned).status;
    check(report.ownerAborted === 'cancelled', 'owner abort delivered output');
    report.afterOwnerAbort = await settle(host);

    const disposing = cellularWasmGridJob.prepare(disposable, a, big, signal());
    check(disposable.stats().running === 1, 'dispose did not target dispatched work');
    disposable.dispose();
    report.disposed = (await disposing).status;
    check(report.disposed === 'cancelled', 'disposed host delivered output');
    report.afterDispose = await settle(disposable);
    check(report.afterDispose.workers === 0, 'disposed host retained workers');

    report.tinyBudget = (await cellularWasmGridJob.prepare(tiny, a, recipe, signal())).status;
    check(report.tinyBudget === 'oversized', 'tiny budget admitted WASM job');
    report.tiny = await settle(tiny);
    check(
      report.tiny.workers === 0 && report.tiny.peakReservedBytes === 0,
      'refused job allocated a worker or reserved bytes',
    );
    report.bitExactCells = recipe.cellsX * recipe.cellsY * recipe.cellsZ * 5;
    report.final = await settle(host);
    return report;
  } finally {
    host.dispose();
    fallback.dispose();
    tiny.dispose();
    disposable.dispose();
  }
};
