import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkerHost } from '../../platform/workers/host';
import { createFakeTimers, createInProcessWorker, fakeWorkerFactory } from '../../platform/workers/fake-worker';
import { JobCancelledSignal, type JobModule } from '../../platform/workers/job';
import { createRng, deriveSeed } from '../../core/rng';
import { createGridGenerationJob, GRID_MAX_CELLS, type GridRecipe, type GridJobInput, type GridWire } from './grid-job';
import { cellularGridJob as job } from './cellular';
import registered from './workers/cellular.job';

const recipe: GridRecipe = { formatVersion: 1, generatorVersion: 1, id: 'cave', revision: 1, seed: deriveSeed(42, 'region', 3, -2), cellsX: 24, cellsY: 2, cellsZ: 16, parameters: '[0.45,4,5,4]' };
const owner = () => ({ id: 'procgen', signal: new AbortController().signal });
const signal = () => new AbortController().signal;
const context = { checkpoint: async () => {}, cancelled: () => false };
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

/** Independent oracle: the rule written directly over nested arrays, with no shared helper but the RNG primitives. */
function oracle(r: GridRecipe, [fill, steps, birth, survive]: number[]): number[] {
  const out: number[] = [];
  for (let y = 0; y < r.cellsY; y++) {
    const random = createRng(deriveSeed(r.seed, 'layer', y));
    let g: number[][] = [];
    for (let z = 0; z < r.cellsZ; z++) { g.push([]); for (let x = 0; x < r.cellsX; x++) g[z]!.push(random.next() < fill! ? 1 : 0); }
    for (let s = 0; s < steps!; s++) {
      g = g.map((row, z) => row.map((v, x) => {
        let n = 0;
        for (const [dx, dz] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] as const) n += g[z + dz]?.[x + dx] ?? 1;
        return v ? +(n >= survive!) : +(n >= birth!);
      }));
    }
    for (const row of g) out.push(...row);
  }
  return out;
}

test('GEN-01 cellular grid matches an independent oracle and is identical across runs, fallback and worker runtime', async () => {
  const expected = oracle(recipe, [0.45, 4, 5, 4]);
  assert.ok(expected.includes(0) && expected.includes(1), 'the oracle case is not degenerate');
  const direct = job.generateNow(recipe);
  assert.deepEqual([...direct.values], expected);
  assert.deepEqual([...job.generateNow(recipe).values], expected, 'second run');
  assert.equal(direct.get(5, 1, 7), expected[(1 * 16 + 7) * 24 + 5]);
  const fallback = createWorkerHost({ createWorker: null });
  try {
    const result = await job.prepare(fallback, owner(), recipe, signal());
    assert.equal(result.status, 'done'); if (result.status === 'done') assert.deepEqual([...result.grid.values], expected);
    assert.equal(fallback.stats().reservedBytes, 0);
  } finally { fallback.dispose(); }
  // the registered module through the real worker runtime, with a structured-clone/transfer boundary
  const wire = await registered.run({ recipe }, context), clone = structuredClone(wire.output, { transfer: [...wire.transfer!] });
  assert.equal(wire.output.values.byteLength, 0, 'the worker transferred its buffer');
  assert.deepEqual([...clone.values], expected);
  const timers = createFakeTimers(), loaders = { 'job.kits.procgen.cellular': async () => registered as JobModule };
  const host = createWorkerHost({ timers, hardwareConcurrency: 4, createWorker: () => createInProcessWorker(loaders, timers) });
  try {
    let settled: unknown; void job.prepare(host, owner(), recipe, signal()).then(v => { settled = v; });
    for (let i = 0; i < 2000 && !settled; i++) { timers.flush(); await tick(); }
    const result = settled as Awaited<ReturnType<typeof job.prepare>>;
    assert.equal(result.status, 'done'); if (result.status === 'done') assert.deepEqual([...result.grid.values], expected);
  } finally { host.dispose(); }
});

test('GEN-01 regions derived from one root regenerate identically regardless of request order', () => {
  const at = (cx: number, cz: number) => job.generateNow({ ...recipe, id: `r${cx},${cz}`, seed: deriveSeed(7, 'region', cx, cz), cellsY: 1 });
  const coords = [[0, 0], [1, 0], [-1, 0], [0, -1], [5, 9]] as const;
  const forward = coords.map(([x, z]) => [...at(x, z).values].join(''));
  const backward = [...coords].reverse().map(([x, z]) => [...at(x, z).values].join('')).reverse();
  assert.deepEqual(forward, backward);
  assert.equal(new Set(forward).size, coords.length, 'distinct regions differ');
  // a layer depends on (seed, y) only: a taller grid starts with the same layers
  const tall = job.generateNow({ ...recipe, cellsY: 3 }), short = job.generateNow({ ...recipe, cellsY: 1 });
  assert.deepEqual([...tall.values.subarray(0, 24 * 16)], [...short.values]);
});

test('GEN-01 bounds refuse before admission: cells, parameters, versions, registration and limits', async () => {
  const fake = fakeWorkerFactory(), host = createWorkerHost({ createWorker: fake.create });
  try {
    for (const bad of [
      { cellsX: 512, cellsY: 1, cellsZ: 513 }, { cellsX: 0 }, { cellsY: 1.5 }, { cellsZ: -1 }, { seed: -1 }, { seed: 2 ** 32 }, { revision: -1 },
      { id: '' }, { id: 'x'.repeat(257) }, { generatorVersion: 2 }, { formatVersion: 2 }, { parameters: 'x'.repeat(4097) }, { parameters: 5 },
    ] as Partial<GridRecipe>[]) await assert.rejects(job.prepare(host, owner(), { ...recipe, ...bad } as GridRecipe, signal()), /procgen grid/, JSON.stringify(bad));
    assert.equal(fake.workers.length, 0, 'no worker was spawned for a refused recipe');
    assert.equal(host.stats().reservedBytes, 0);
    assert.equal(host.stats().pending + host.stats().running, 0);
  } finally { host.dispose(); }
  // parameter structure is checked inside admitted work; validate must return literal true
  for (const parameters of ['[0.45,4,5]', '[2,4,5,4]', '[0.45,4,5,4.5]', '{"a":1}', '[[[[[[[[[[[[[[[[[[1]]]]]]]]]]]]]]]]]]', `[${'0,'.repeat(300)}0]`, 'not json'])
    assert.throws(() => job.generateNow({ ...recipe, parameters }), parameters);
  const truthy = createGridGenerationJob('job.test.truthy', { version: 1, maxValue: 1, validate: () => 1 as never, *generate() {} });
  assert.throws(() => truthy.generateNow({ ...recipe, parameters: 'null' }), /rejected parameters/);
  for (const reg of [{ version: -1 }, { maxValue: 65536 }, { scratchBytesPerCell: 65 }, { validate: 1 }, { generate: null }])
    assert.throws(() => createGridGenerationJob('job.test.bad', { version: 1, maxValue: 1, validate: () => true, *generate() {}, ...reg } as never), /invalid registration/);
  assert.throws(() => createGridGenerationJob('not-a-job', { version: 1, maxValue: 1, validate: () => true, *generate() {} }), /invalid registration/);
  for (const limits of [{ maxCells: GRID_MAX_CELLS + 1 }, { maxCells: 0 }, { maxSlices: 0 }, { maxParameterBytes: 0 }, { maxParameterDepth: -1 }])
    assert.throws(() => createGridGenerationJob('job.test.limits', { version: 1, maxValue: 1, validate: () => true, *generate() {} }, limits), /invalid limits/);
  // configured limits are enforced; reservation counts output and declared scratch
  const small = createGridGenerationJob('job.test.small', { version: 1, maxValue: 1, scratchBytesPerCell: 8, validate: () => true, *generate() {} }, { maxCells: 64 });
  assert.throws(() => small.generateNow({ ...recipe, cellsX: 8, cellsY: 1, cellsZ: 9, parameters: 'null' }), /cell count/);
  const r = small.reservation({ ...recipe, cellsX: 8, cellsY: 1, cellsZ: 8, parameters: 'null' });
  assert.equal(r.output, 64 * 2 + 4096); assert.equal(r.scratch, 64 * 10 + (4 * 6 + 4096) * 8 + 4096);
});

test('GEN-01 runaway and out-of-range generators fail without publishing and release reservations', async () => {
  let finals = 0;
  const forever = createGridGenerationJob('job.test.forever', { version: 1, maxValue: 3, validate: () => true, *generate() { try { for (;;) yield; } finally { finals++; } } }, { maxSlices: 100 });
  assert.throws(() => forever.generateNow({ ...recipe, parameters: 'null' }), /slice limit exceeded/);
  assert.equal(finals, 1, 'the creator generator was closed exactly once');
  const host = createWorkerHost({ createWorker: null });
  try {
    await assert.rejects(forever.prepare(host, owner(), { ...recipe, parameters: 'null' }, signal()), /slice limit/);
    assert.equal(host.stats().reservedBytes, 0);
    const raw = createGridGenerationJob('job.test.raw', { version: 1, maxValue: 3, validate: () => true, *generate(cells) { cells.values[17] = 4; } });
    await assert.rejects(raw.prepare(host, owner(), { ...recipe, parameters: 'null' }, signal()), /out of range/);
    const checked = createGridGenerationJob('job.test.checked', { version: 1, maxValue: 3, validate: () => true, *generate(cells) { cells.set(0, 0, 0, 3); cells.set(1, 0, 0, 4); } });
    assert.throws(() => checked.generateNow({ ...recipe, parameters: 'null' }), /out of range/);
    const outside = createGridGenerationJob('job.test.outside', { version: 1, maxValue: 3, validate: () => true, *generate(cells) { cells.set(24, 0, 0, 1); } });
    assert.throws(() => outside.generateNow({ ...recipe, parameters: 'null' }), /outside grid/);
    const notGenerator = createGridGenerationJob('job.test.plain', { version: 1, maxValue: 3, validate: () => true, generate: (() => undefined) as never });
    assert.throws(() => notGenerator.generateNow({ ...recipe, parameters: 'null' }), /must return a generator/);
    assert.equal(host.stats().reservedBytes, 0);
  } finally { host.dispose(); }
});

test('GEN-01 cancellation mid-job in fallback, worker runtime and module checkpoints closes the generator once', async () => {
  // main-thread fallback: abort from inside the 10th slice
  let finals = 0, slices = 0; const ctl = new AbortController();
  const slow = createGridGenerationJob('job.test.slow', { version: 1, maxValue: 1, validate: () => true, *generate() { try { for (let i = 0; i < 1000; i++) { if (++slices === 10) ctl.abort(); yield; } } finally { finals++; } } });
  const fallback = createWorkerHost({ createWorker: null });
  try {
    assert.equal((await slow.prepare(fallback, owner(), { ...recipe, parameters: 'null' }, ctl.signal)).status, 'cancelled');
    for (let i = 0; i < 20 && finals === 0; i++) await new Promise(resolve => setTimeout(resolve, 2));
    assert.ok(slices < 1000, `stopped after ${slices} slices`); assert.equal(finals, 1); assert.equal(fallback.stats().reservedBytes, 0);
  } finally { fallback.dispose(); }
  // the real worker runtime: abort while the registered job is running
  const timers = createFakeTimers(), loaders = { 'job.kits.procgen.cellular': async () => registered as JobModule };
  const host = createWorkerHost({ timers, hardwareConcurrency: 4, createWorker: () => createInProcessWorker(loaders, timers) });
  try {
    const abort = new AbortController(); let settled: unknown;
    void job.prepare(host, owner(), { ...recipe, cellsX: 128, cellsZ: 128 }, abort.signal).then(v => { settled = v; });
    for (let i = 0; i < 20; i++) { timers.flush(); await tick(); }
    assert.equal(settled, undefined, 'still running'); assert.equal(host.stats().running, 1);
    abort.abort();
    for (let i = 0; i < 40; i++) { timers.flush(); await tick(); }
    assert.deepEqual(settled, { status: 'cancelled' }); assert.equal(host.stats().reservedBytes, 0); assert.equal(host.stats().running, 0);
  } finally { host.dispose(); }
  // module checkpoints at several depths
  for (const stop of [1, 7, 40]) {
    let checkpoints = 0, closed = 0;
    const probe = createGridGenerationJob('job.test.probe', { version: 1, maxValue: 1, validate: () => true, *generate() { try { for (let i = 0; i < 100; i++) yield; } finally { closed++; } } });
    await assert.rejects(async () => probe.module.run({ recipe: { ...recipe, parameters: 'null' } }, { cancelled: () => false, checkpoint: async () => { if (++checkpoints === stop) throw new JobCancelledSignal(); } }), JobCancelledSignal);
    assert.equal(closed, 1);
  }
});

test('GEN-01 supersession, owner loss, captured input and corrupt worker output cannot publish', async () => {
  const fake = fakeWorkerFactory(), host = createWorkerHost({ createWorker: fake.create }), lifetime = owner();
  try {
    const old = job.prepare(host, lifetime, recipe, signal()), newer = job.prepare(host, lifetime, { ...recipe, revision: 2 }, signal());
    assert.equal((await old).status, 'superseded');
    host.dispose(); assert.equal((await newer).status, 'cancelled');
  } finally { host.dispose(); }
  // a queued recipe is captured before admission: later caller mutation cannot reach the worker
  {
    const workers = fakeWorkerFactory(), h = createWorkerHost({ createWorker: workers.create, hardwareConcurrency: 8, profile: { maxSlots: 1, maxPending: 2, maxReservedBytes: 64 * 1024 * 1024 } }), o = owner();
    try {
      const first = job.prepare(h, o, recipe, signal());
      const mutable = { ...recipe, id: 'queued' }, second = job.prepare(h, o, mutable, signal());
      (mutable as { seed: number }).seed = 1; (mutable as { cellsX: number }).cellsX = 2;
      workers.workers[0]!.complete((await registered.run({ recipe }, context)).output); await first;
      const input = workers.workers[0]!.lastRun()!.input as GridJobInput;
      assert.equal(input.recipe.seed, recipe.seed); assert.equal(input.recipe.cellsX, 24);
      workers.workers[0]!.complete((await registered.run(input, context)).output); assert.equal((await second).status, 'done');
      assert.equal(h.stats().reservedBytes, 0);
    } finally { h.dispose(); }
  }
  const corruptions: ((w: GridWire) => unknown)[] = [
    w => ({ ...w, values: w.values.subarray(1) }),
    w => { w.values[3] = 2; return w; },
    w => ({ ...w, values: new Int16Array(w.values.length) }),
    w => ({ ...w, descriptor: { ...w.descriptor, seed: w.descriptor.seed ^ 1 } }),
    w => ({ ...w, descriptor: { ...w.descriptor, cellsX: 16, cellsZ: 24 } }),
    w => ({ ...w, descriptor: { ...w.descriptor, revision: 9 } }),
    w => ({ ...w, slices: -1 }),
    w => ({ ...w, descriptor: null }),
    () => null,
  ];
  for (const corrupt of corruptions) {
    const workers = fakeWorkerFactory(), h = createWorkerHost({ createWorker: workers.create });
    try {
      const pending = job.prepare(h, owner(), recipe, signal());
      workers.workers[0]!.complete(corrupt(structuredClone((await registered.run({ recipe }, context)).output)));
      await assert.rejects(pending, /procgen grid/); assert.equal(h.stats().reservedBytes, 0);
    } finally { h.dispose(); }
  }
});
