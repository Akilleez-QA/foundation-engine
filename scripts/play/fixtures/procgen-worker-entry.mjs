import {createWorkerHost} from '../../../src/platform/workers/host.ts';
import {deriveSeed} from '../../../src/core/rng.ts';
import {cellularGridJob} from '../../../src/kits/procgen/cellular.ts';
const recipe = {
  formatVersion: 1,
  generatorVersion: 1,
  id: 'diagnostic',
  revision: 1,
  seed: deriveSeed(42, 'region', 3, -2),
  cellsX: 48,
  cellsY: 2,
  cellsZ: 32,
  parameters: '[0.45,4,5,4]',
};
const digest = values => {
  let h = 2166136261;
  for (const v of values) h = Math.imul(h ^ v, 16777619) >>> 0;
  return h;
};
window.runProcgenWorkerCheck = async () => {
  const host = createWorkerHost(),
    fallback = createWorkerHost({createWorker: null});
  const owner = {id: 'diagnostic', signal: new AbortController().signal};
  try {
    const worker = await cellularGridJob.prepare(host, owner, recipe, new AbortController().signal);
    const inline = await cellularGridJob.prepare(fallback, owner, recipe, new AbortController().signal);
    if (worker.status !== 'done' || inline.status !== 'done') throw Error('generation unavailable');
    const direct = cellularGridJob.generateNow(recipe);
    const abort = new AbortController(),
      big = {...recipe, id: 'large', cellsX: 256, cellsY: 4, cellsZ: 256};
    const pending = cellularGridJob.prepare(host, owner, big, abort.signal);
    for (let i = 0; i < 500 && host.stats().running === 0; i++) await new Promise(r => setTimeout(r, 1));
    const runningAtAbort = host.stats().running;
    abort.abort();
    const cancelled = (await pending).status;
    // the slot and reservation retire only when the worker acknowledges (or misses the deadline and is terminated)
    for (let i = 0; i < 400 && host.stats().running > 0; i++) await new Promise(r => setTimeout(r, 5));
    const stale = (await cellularGridJob.prepare(host, owner, {...recipe, revision: 0}, new AbortController().signal))
      .status;
    return {
      worker: host.stats(),
      fallback: fallback.stats(),
      digests: [digest(worker.grid.values), digest(inline.grid.values), digest(direct.values)],
      solid: worker.grid.values.reduce((a, b) => a + b, 0),
      cells: worker.grid.values.length,
      cancelled,
      runningAtAbort,
      stale,
    };
  } finally {
    host.dispose();
    fallback.dispose();
  }
};
