import test from 'node:test';
import assert from 'node:assert/strict';
import {defineScene, testScene} from '../../author';
import {createInventoryLedger} from '../inventory';
import {
  createProduction,
  defineDeposit,
  sampleDeposit,
  createSurvey,
  recipeSuitability,
  resourceProductionSystem,
  type ProductionOptions,
} from './index';
const ore = {id: 'ore-spawn-1', material: 'ore', properties: {conductivity: 40, strength: 80}};
const deposit = () =>
  defineDeposit({id: 'deposit', revision: 2, seed: 123, cellSize: 10, expiresTick: 1000, reserve: 20, batch: ore});
function options(stock = 10): ProductionOptions {
  const inventory = createInventoryLedger({capacities: {bag: 100, output: 100}});
  if (stock) inventory.transact('seed', [], [{container: 'bag', batch: ore, quantity: stock}]);
  return {
    capacities: {bag: 100, output: 100},
    initialInventory: inventory.snapshot(),
    deposits: [deposit()],
    recipes: [
      {
        id: 'plate',
        inputs: [{batchId: ore.id, quantity: 2}],
        output: {batch: {id: 'plate-ore-1', material: 'plate', properties: {}}, quantity: 1},
        suitability: {weights: {conductivity: 1, strength: 3}, property: 'suitability'},
      },
    ],
    jobs: [
      {
        kind: 'harvester',
        id: 'extract',
        depositId: 'deposit',
        x: 12,
        z: -8,
        container: 'bag',
        startTick: 0,
        periodTicks: 1,
        powered: true,
      },
      {
        kind: 'factory',
        id: 'press',
        recipeId: 'plate',
        inputContainer: 'bag',
        outputContainer: 'output',
        startTick: 0,
        periodTicks: 10,
        powered: true,
        limit: 50,
      },
    ],
  };
}
const advance = (
  model: ReturnType<typeof createProduction>,
  id: string,
  jobId: string,
  toTick: number,
  maxCycles = 10,
  maxTicks = 1000,
) => model.apply({kind: 'advance', id, jobId, toTick, maxCycles, maxTicks});
test('deposit identity/properties are immutable and abundance is reproducible independently of reserve', () => {
  const input = {...deposit(), batch: structuredClone(ore)},
    d = defineDeposit(input);
  input.batch.properties.strength = 1;
  assert.equal(d.batch.properties.strength, 80);
  assert.ok(Object.isFrozen(d.batch.properties));
  const depleted = defineDeposit({...d, reserve: 0});
  for (const [x, z] of [
    [0, 0],
    [-3, 8],
    [21, -17],
  ]) {
    assert.equal(sampleDeposit(d, x!, z!), sampleDeposit(depleted, x!, z!));
    assert.ok(sampleDeposit(d, x!, z!) >= 0 && sampleDeposit(d, x!, z!) <= 1);
  }
  assert.notEqual(sampleDeposit(d, 12, -8), sampleDeposit(defineDeposit({...d, revision: 3}), 12, -8));
});
test('survey work yields, returns frozen field samples, rejects stale revisions and cancels', () => {
  const o = {x: -10, z: -10, spacing: 2, columns: 4, rows: 3},
    survey = createSurvey(deposit(), o);
  o.x = 99;
  const first = survey.step(5, 2);
  assert.equal(first.sampled, 5);
  assert.equal(first.result.status, 'pending');
  assert.equal(survey.step(5, 2).sampled, 5);
  const complete = survey.step(5, 2).result;
  assert.equal(complete.status, 'complete');
  if (complete.status === 'complete') {
    assert.equal(complete.points.length, 12);
    assert.equal(complete.points[0]!.x, -10);
    assert.ok(Object.isFrozen(complete.points));
    for (const p of complete.points) assert.equal(p.abundance, sampleDeposit(deposit(), p.x, p.z));
  }
  const stale = createSurvey(deposit(), o);
  stale.step(1, 2);
  assert.equal(stale.step(1, 3).result.status, 'stale');
  const cancelled = createSurvey(deposit(), o);
  cancelled.cancel();
  assert.equal(cancelled.step(10, 2).sampled, 0);
  assert.throws(() => createSurvey(deposit(), {...o, columns: 0}));
});
test('recipe weights calculate suitability and reject missing or degenerate properties', () => {
  assert.equal(recipeSuitability(ore.properties, {conductivity: 1, strength: 3}), 70);
  for (const weights of [{missing: 1}, {conductivity: 0}, {conductivity: -1}, {strength: NaN}] as Record<
    string,
    number
  >[])
    assert.throws(() => recipeSuitability(ore.properties, weights));
});
test('factory commits exact ingredients, output metadata, clocks and receipt in one restorable snapshot', () => {
  const o = options(),
    model = createProduction(o);
  assert.deepEqual(advance(model, 'craft', 'press', 20), {
    ok: true,
    duplicate: false,
    throughTick: 20,
    produced: 2,
    pending: false,
  });
  assert.equal(model.quantity('bag', ore.id), 6);
  assert.equal(model.quantity('output', 'plate-ore-1'), 2);
  assert.equal(model.material('plate-ore-1')!.properties.suitability, 70);
  const snapshot = model.snapshot(),
    restored = createProduction(o, snapshot);
  assert.deepEqual(restored.snapshot(), snapshot);
  assert.equal(advance(restored, 'craft', 'press', 20).ok, true);
  assert.deepEqual(restored.snapshot(), snapshot);
  assert.deepEqual(advance(restored, 'craft', 'press', 30), {ok: false, reason: 'conflict'});
  snapshot.remaining.deposit = 999;
  assert.throws(() => createProduction(o, snapshot));
});
test('factory catchup is bounded and input exhaustion cannot create extra outputs', () => {
  const model = createProduction(options());
  assert.deepEqual(advance(model, 'first', 'press', 100000, 2), {
    ok: true,
    duplicate: false,
    throughTick: 20,
    produced: 2,
    pending: true,
  });
  advance(model, 'second', 'press', 100000, 2);
  advance(model, 'third', 'press', 100000, 2);
  assert.equal(model.quantity('bag', ore.id), 0);
  assert.equal(model.quantity('output', 'plate-ore-1'), 5);
  advance(model, 'empty', 'press', 100000, 2);
  assert.equal(model.quantity('output', 'plate-ore-1'), 5);
  assert.equal(model.snapshot().jobs.press!.progress, 0);
});
test('harvester conserves finite reserve, respects expiry and separates field abundance', () => {
  const o = options(0),
    model = createProduction(o),
    before = sampleDeposit(o.deposits[0]!, 12, -8);
  for (let i = 0; i < 10; i++) advance(model, `extract-${i}`, 'extract', 10000, 100);
  assert.equal(model.quantity('bag', ore.id) + model.snapshot().remaining.deposit!, 20);
  assert.equal(model.snapshot().remaining.deposit, 0);
  assert.equal(sampleDeposit(o.deposits[0]!, 12, -8), before);
  const short = options(0);
  short.deposits = [{...deposit(), expiresTick: 1}];
  const stopped = createProduction(short);
  advance(stopped, 'late', 'extract', 10000, 100);
  assert.equal(stopped.quantity('bag', ore.id), 0);
});
test('hopper capacity limits harvest without burning reserves', () => {
  const o = options(0);
  o.capacities.bag = 2;
  o.initialInventory = createInventoryLedger({capacities: o.capacities}).snapshot();
  const model = createProduction(o);
  advance(model, 'full', 'extract', 1000, 100);
  assert.equal(model.quantity('bag', ore.id), 2);
  assert.equal(model.snapshot().remaining.deposit, 18);
  advance(model, 'still-full', 'extract', 2000, 100);
  assert.equal(model.snapshot().remaining.deposit, 18);
});
test('piecewise power and rates cannot retroactively credit offline work', () => {
  const model = createProduction(options());
  advance(model, 'half', 'press', 5);
  assert.deepEqual(
    model.apply({kind: 'configure', id: 'bad-speed', jobId: 'press', atTick: 5, powered: true, periodTicks: 1}),
    {ok: false, reason: 'unsettled'},
  );
  model.apply({kind: 'configure', id: 'off', jobId: 'press', atTick: 5, powered: false, periodTicks: 10});
  advance(model, 'off-time', 'press', 100);
  assert.equal(model.quantity('output', 'plate-ore-1'), 0);
  model.apply({kind: 'configure', id: 'on', jobId: 'press', atTick: 100, powered: true, periodTicks: 10});
  advance(model, 'finish', 'press', 105);
  assert.equal(model.quantity('output', 'plate-ore-1'), 1);
  model.apply({kind: 'configure', id: 'speed', jobId: 'press', atTick: 105, powered: true, periodTicks: 5});
  advance(model, 'faster', 'press', 110);
  assert.equal(model.quantity('output', 'plate-ore-1'), 2);
});
test('same-container crafting uses net capacity and colliding ledger receipt cannot double-credit', () => {
  const o = options(100);
  o.jobs = [{...o.jobs[1]!, outputContainer: 'bag'} as (typeof o.jobs)[number]];
  const model = createProduction(o);
  advance(model, 'make-space', 'press', 10);
  assert.equal(model.quantity('bag', ore.id), 98);
  assert.equal(model.quantity('bag', 'plate-ore-1'), 1);
  const collision = createProduction(options()),
    snapshot = collision.snapshot();
  assert.deepEqual(advance(collision, 'seed', 'press', 10), {ok: false, reason: 'conflict'});
  assert.deepEqual(collision.snapshot(), snapshot);
});
test('frame system advances one job and retries rejected composite publication before more work', async () => {
  const o = options(),
    model = createProduction(o);
  let accepted = false,
    publications = 0;
  const system = resourceProductionSystem({
    model,
    options: o,
    nowTick: () => 100,
    maxCycles: 2,
    publish: () => {
      publications++;
      return accepted;
    },
  });
  const scene = await testScene(defineScene({id: 'resource-test', title: 'Resources', systems: [system]}));
  assert.throws(() => scene.run(1 / 60), /publication/);
  const pending = model.snapshot();
  assert.equal(pending.commands.length, 1);
  accepted = true;
  scene.run(1 / 60);
  assert.equal(model.snapshot().commands.length, 1);
  assert.equal(publications, 2);
  scene.run(1 / 60);
  assert.equal(model.snapshot().commands.length, 2);
});
test('frame publication requires literal true and retries the exact detached envelope', async () => {
  const o = options(),
    model = createProduction(o);
  let result: unknown = Promise.resolve(true);
  const offered: ReturnType<typeof model.snapshot>[] = [];
  const system = resourceProductionSystem({
    model,
    options: o,
    nowTick: () => 100,
    maxCycles: 2,
    publish: snapshot => {
      offered.push(structuredClone(snapshot));
      snapshot.jobs.extract!.tick = 999;
      return result as boolean;
    },
  });
  const scene = await testScene(defineScene({id: 'publication-test', title: 'Resources', systems: [system]}));
  for (const rejected of [Promise.resolve(true), {}, 1, 'accepted', undefined, null, false]) {
    result = rejected;
    assert.throws(() => scene.run(1 / 60), /publication was not accepted/);
    assert.equal(model.snapshot().commands.length, 1);
    assert.deepEqual(offered.at(-1), offered[0]);
    assert.deepEqual(model.snapshot(), offered[0]);
  }
  result = true;
  scene.run(1 / 60);
  assert.deepEqual(offered.at(-1), offered[0]);
  assert.deepEqual(model.snapshot(), offered[0]);
  scene.run(1 / 60);
  assert.equal(model.snapshot().commands.length, 2);
});
test('blocked output and reserved inputs do not consume or create material', () => {
  const o = options();
  o.capacities.output = 0;
  const stock = createInventoryLedger({capacities: o.capacities});
  stock.transact('initial', [], [{container: 'bag', batch: ore, quantity: 10}]);
  o.initialInventory = stock.snapshot();
  const full = createProduction(o);
  advance(full, 'full-output', 'press', 100);
  assert.equal(full.quantity('bag', ore.id), 10);
  assert.equal(full.quantity('output', 'plate-ore-1'), 0);
  const locked = options(),
    inventory = createInventoryLedger(locked, locked.initialInventory);
  inventory.reserve('reserved', [{container: 'bag', batchId: ore.id, quantity: 9}]);
  locked.initialInventory = inventory.snapshot();
  const reserved = createProduction(locked);
  advance(reserved, 'locked', 'press', 100);
  assert.equal(reserved.quantity('bag', ore.id), 10);
  assert.equal(reserved.quantity('output', 'plate-ore-1'), 0);
});
test('failed output metadata leaves the complete production snapshot unchanged', () => {
  const o = options(),
    inventory = createInventoryLedger(o, o.initialInventory);
  inventory.transact(
    'other-output',
    [],
    [{container: 'output', batch: {id: 'plate-ore-1', material: 'wrong', properties: {}}, quantity: 1}],
  );
  o.initialInventory = inventory.snapshot();
  const model = createProduction(o),
    before = model.snapshot();
  assert.deepEqual(advance(model, 'conflicting-batch', 'press', 10), {ok: false, reason: 'batch-conflict'});
  assert.deepEqual(model.snapshot(), before);
});
test('configuration changes require explicit migration; external snapshot edits cannot mutate owner state', () => {
  const o = options(),
    model = createProduction(o);
  advance(model, 'tick', 'press', 10);
  const snapshot = model.snapshot();
  snapshot.jobs.press!.completed = 999;
  assert.equal(model.snapshot().jobs.press!.completed, 1);
  assert.throws(() => createProduction(o, snapshot));
  const changed = options();
  changed.deposits = [{...deposit(), revision: 3}];
  assert.throws(() => createProduction(changed, model.snapshot()));
});
test('checkpoint preserves partial work, reserves and metadata while rejecting previous epoch retries', () => {
  const o = options(),
    model = createProduction(o);
  const partial = {kind: 'advance' as const, id: 'partial', jobId: 'press', toTick: 5, maxTicks: 10, maxCycles: 1};
  model.apply(partial, 0);
  advance(model, 'extract-partial', 'extract', 1);
  const before = model.snapshot();
  assert.equal(model.checkpoint(), 1);
  const saved = model.snapshot();
  assert.deepEqual(saved.jobs, before.jobs);
  assert.deepEqual(saved.remaining, before.remaining);
  assert.equal(saved.commands.length, 0);
  assert.equal(saved.inventory.operations.length, 0);
  assert.equal(model.material(ore.id)!.properties.strength, 80);
  const restored = createProduction(o, saved);
  assert.deepEqual(restored.apply(partial, 0), {ok: false, reason: 'stale-epoch'});
  assert.deepEqual(restored.apply(partial), {ok: false, reason: 'stale-epoch'});
  const finish = {...partial, toTick: 10};
  assert.equal(restored.apply(finish, 1).ok, true);
  assert.equal(restored.quantity('output', 'plate-ore-1'), 1);
  const done = restored.snapshot();
  assert.equal(restored.apply(finish, 1).ok, true);
  assert.deepEqual(restored.snapshot(), done);
  assert.equal(restored.material('plate-ore-1')!.properties.suitability, 70);
});
test('bounded production histories compact across 100 explicit epochs without adding stock', () => {
  const o = {...options(), maxCommands: 2},
    model = createProduction(o);
  for (let epoch = 0; epoch < 100; epoch++) {
    const tick = epoch * 10;
    assert.equal(
      model.apply({kind: 'configure', id: 'off', jobId: 'press', atTick: tick, powered: false, periodTicks: 10}, epoch)
        .ok,
      true,
    );
    assert.equal(
      model.apply({kind: 'advance', id: 'clock', jobId: 'press', toTick: tick + 10, maxTicks: 10, maxCycles: 1}, epoch)
        .ok,
      true,
    );
    const before = model.snapshot();
    assert.deepEqual(
      model.apply({kind: 'advance', id: 'extra', jobId: 'press', toTick: tick + 11, maxTicks: 1, maxCycles: 1}, epoch),
      {ok: false, reason: 'checkpoint-required'},
    );
    assert.deepEqual(model.snapshot(), before);
    model.checkpoint();
    const saved = model.snapshot();
    assert.equal(saved.commands.length, 0);
    assert.equal(saved.inventory.operations.length, 0);
    assert.deepEqual(createProduction(o, saved).snapshot(), saved);
  }
  assert.equal(model.epoch, 100);
  assert.equal(model.quantity('bag', ore.id), 10);
  assert.equal(model.quantity('output', 'plate-ore-1'), 0);
  assert.equal(model.snapshot().remaining.deposit, 20);
});
test('checkpoint retains reserved inputs and rejects mixed epochs or malformed base progress', () => {
  const o = options(),
    inventory = createInventoryLedger(o, o.initialInventory);
  inventory.reserve('locked', [{container: 'bag', batchId: ore.id, quantity: 9}]);
  o.initialInventory = inventory.snapshot();
  const model = createProduction(o);
  model.checkpoint();
  assert.equal(
    model.apply({kind: 'advance', id: 'blocked', jobId: 'press', toTick: 10, maxTicks: 10, maxCycles: 1}, 1).ok,
    true,
  );
  assert.equal(model.quantity('bag', ore.id), 10);
  assert.equal(model.quantity('output', 'plate-ore-1'), 0);
  const good = model.snapshot();
  const mixed = structuredClone(good);
  mixed.base.inventory.epoch = 0;
  assert.throws(() => createProduction(o, mixed));
  const progress = structuredClone(good);
  progress.base.jobs.press!.progress = 10;
  assert.throws(() => createProduction(o, progress));
  const identity = structuredClone(good);
  delete identity.base.remaining.deposit;
  identity.base.remaining.other = 20;
  assert.throws(() => createProduction(o, identity));
});

test('reordered command fields retry identically before and after restore', () => {
  const o = options(),
    model = createProduction(o);
  const command = {kind: 'advance' as const, id: 'order', jobId: 'press', toTick: 10, maxTicks: 10, maxCycles: 1};
  model.apply(command, 0);
  const snapshot = model.snapshot();
  const reordered = {maxCycles: 1, toTick: 10, jobId: 'press', id: 'order', maxTicks: 10, kind: 'advance' as const};
  for (const owner of [model, createProduction(o, snapshot)]) {
    const retry = owner.apply(reordered, 0);
    assert.ok(retry.ok && retry.duplicate);
    assert.deepEqual(owner.snapshot(), snapshot);
  }
});
