import test from 'node:test';
import assert from 'node:assert/strict';
import {
  beginCraftExperiment,
  applyCraftExperiment,
  lockCraftManifest,
  parseCraftManifest,
  resolveCraftSlots,
  type CraftRecipe,
  type CraftInput,
} from './crafting';
import {prepareStockChange} from '../inventory/dimensional';
import {prepareIndustryCommand, type IndustrialState} from './industry';
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
function fixture() {
  const input: CraftInput = {
    bounds: {slots: 2, selections: 4, attributes: 2, weights: 4, points: 4, steps: 4, properties: 4},
    stockBounds: {containers: 8, batches: 8, positions: 16, changes: 16, properties: 4},
    stock: {
      version: 1,
      containers: ['source', 'input', 'output', 'work', 'installed'].map(id => ({
        id,
        maxMassMg: 10000000,
        maxVolumeUl: 10000000,
        phases: ['solid'],
      })),
      batches: [
        {
          id: 'a',
          material: 'metal',
          unit: 'g',
          phase: 'solid',
          massMg: 1000,
          volumeUl: 100,
          properties: {thermal: 800, strength: 600},
        },
        {
          id: 'b',
          material: 'metal',
          unit: 'g',
          phase: 'solid',
          massMg: 1000,
          volumeUl: 100,
          properties: {thermal: 600, strength: 900},
        },
      ],
      positions: [
        {container: 'source', batch: 'a', quantity: 3000},
        {container: 'source', batch: 'b', quantity: 3000},
      ],
    },
  };
  const recipe: CraftRecipe = {
    id: 'component',
    version: 1,
    pointLimit: 2,
    slots: [{id: 'metal', materials: ['metal'], unit: 'g', quantity: 1000}],
    attributes: [
      {
        id: 'efficiency',
        weights: [
          {slot: 'metal', property: 'thermal', weight: 3},
          {slot: 'metal', property: 'strength', weight: 1},
        ],
        initialPermille: 500,
        gainPermille: 100,
        effectPermille: 1000,
      },
      {
        id: 'light',
        weights: [{slot: 'metal', property: 'strength', weight: 1}],
        initialPermille: 500,
        gainPermille: 100,
        effectPermille: 1000,
      },
    ],
    output: {
      material: 'component',
      unit: 'count',
      phase: 'solid',
      massMg: {base: 950000, terms: [{attribute: 'light', coefficient: -100000}]},
      volumeUl: {base: 150000, terms: []},
      properties: {efficiency: {base: 0, terms: [{attribute: 'efficiency', coefficient: 1000}]}},
    },
    scrap: {material: 'swarf', unit: 'mg', phase: 'solid', massMg: 1, volumeUl: 1, properties: {}},
    workJ: 100,
    maxPowerW: 100,
  };
  const selected = [{slot: 'metal', container: 'source', batch: 'a', quantity: 1000}];
  const start = () => beginCraftExperiment(recipe, selected, {id: 'experiment/1', pointBudget: 2}, input);
  return {input, recipe, selected, start};
}
test('crafting: exact batch resolution uses recipe-specific quantity weighting and prevents slot overbooking', () => {
  const f = fixture();
  const selected = [
    {slot: 'metal', container: 'source', batch: 'a', quantity: 500},
    {slot: 'metal', container: 'source', batch: 'b', quantity: 500},
  ];
  assert.deepEqual(resolveCraftSlots(f.recipe, selected, f.input).values, [
    {id: 'efficiency', ceiling: 712, value: 356},
    {id: 'light', ceiling: 750, value: 375},
  ]);
  f.input.stock.positions[0]!.quantity = 400;
  assert.throws(() => resolveCraftSlots(f.recipe, selected, f.input), /insufficient/);
  assert.throws(() => resolveCraftSlots(f.recipe, [{...selected[0]!, quantity: 999}], f.input), /slot-quantity/);
  const extra = {
    ...f.recipe,
    slots: [...f.recipe.slots, {id: 'second', materials: ['metal'], unit: 'g', quantity: 1000}],
  };
  f.input.stock.positions[0]!.quantity = 1500;
  assert.throws(
    () => resolveCraftSlots(extra, [...f.selected, {...f.selected[0]!, slot: 'second'}], f.input),
    /insufficient/,
  );
});
test('crafting: finite authored effects and point budget preserve deterministic detached experiments', () => {
  const f = fixture(),
    start = f.start(),
    step = {attribute: 'efficiency', points: 2, effectPermille: 1000};
  const a = applyCraftExperiment(start, step, f.recipe, f.input),
    b = applyCraftExperiment(clone(start), step, f.recipe, f.input);
  assert.deepEqual(a, b);
  assert.equal(start.steps.length, 0);
  assert.equal(a.values[0]!.value, 525);
  assert.throws(() => applyCraftExperiment(a.state, {...step, points: 1}, f.recipe, f.input), /points/);
  assert.throws(() => applyCraftExperiment(start, {...step, effectPermille: 999}, f.recipe, f.input), /points/);
  assert.throws(() => beginCraftExperiment(f.recipe, f.selected, {id: 'e', pointBudget: 3}, f.input), /integer/);
});
test('crafting: locked manifest conserves primary plus scrap and repeats through actual powered industry', () => {
  const f = fixture(),
    trial = applyCraftExperiment(f.start(), {attribute: 'light', points: 2, effectPermille: 1000}, f.recipe, f.input);
  const manifest = lockCraftManifest(
    trial.state,
    {manifest: 'plan/1', output: 'component/1', scrap: 'swarf/1'},
    f.recipe,
    f.input,
  );
  assert.ok(Object.isFrozen(manifest.plan.outputs[0]!.batch));
  assert.equal(manifest.plan.outputs[0]!.batch.massMg, 908000);
  assert.equal(manifest.plan.outputs[1]!.quantity, 92000);
  assert.deepEqual(parseCraftManifest(clone(manifest), f.recipe, f.input), manifest);
  assert.throws(
    () =>
      applyCraftExperiment(
        manifest.experiment,
        {attribute: 'light', points: 1, effectPermille: 1000},
        f.recipe,
        f.input,
      ),
    /locked/,
  );
  const moved = prepareStockChange(
    f.input.stock,
    {
      consume: [{container: 'source', batch: 'a', quantity: 2000}],
      produce: [{container: 'input', batch: 'a', quantity: 2000}],
    },
    f.input.stockBounds,
  );
  assert.ok(moved.ok);
  let state: IndustrialState = {
    version: 1 as const,
    stock: moved.state,
    deposits: [],
    plans: [manifest.plan],
    machines: [
      {
        id: 'm',
        plan: manifest.id,
        input: 'input',
        output: 'output',
        work: 'work',
        installed: 'installed',
        powered: true,
        active: false,
        progressJ: 0,
        completed: 0,
        energyRemainder: 0,
      },
    ],
  };
  const bounds = {stock: f.input.stockBounds, deposits: 1, plans: 2, machines: 1, maxStepTicks: 100};
  for (let i = 0; i < 2; i++) {
    const result = prepareIndustryCommand(state, {kind: 'step', machine: 'm', ticks: 10, allocatedPowerW: 100}, bounds);
    assert.ok(result.ok);
    assert.equal(result.completed, true);
    state = result.state;
  }
  assert.equal(state.stock.positions.find(p => p.batch === 'component/1')!.quantity, 2);
  assert.equal(state.machines[0]!.completed, 2);
  assert.deepEqual(
    state.stock.batches.find(b => b.id === 'component/1'),
    manifest.plan.outputs[0]!.batch,
  );
});
test('crafting: restore rejects altered outputs, effects, ceilings, selected identities and conflicting batch IDs', () => {
  const f = fixture(),
    manifest = lockCraftManifest(f.start(), {manifest: 'p', output: 'o', scrap: 's'}, f.recipe, f.input);
  for (const mutate of [
    (m: typeof manifest) => {
      m.plan.outputs[0]!.batch.massMg++;
    },
    (m: typeof manifest) => {
      m.values[0]!.ceiling++;
    },
    (m: typeof manifest) => {
      m.experiment.steps = [{attribute: 'light', points: 1, effectPermille: 999}];
    },
    (m: typeof manifest) => {
      m.experiment.selections[0]!.batch = 'missing';
    },
    (m: typeof manifest) => {
      m.plan.inputs[0]!.quantity++;
    },
  ]) {
    const bad = clone(manifest);
    mutate(bad);
    assert.throws(() => parseCraftManifest(bad, f.recipe, f.input));
  }
  assert.throws(
    () => lockCraftManifest(f.start(), {manifest: 'p', output: 'a', scrap: 's'}, f.recipe, f.input),
    /identity/,
  );
});
test('crafting: bounds admit indexed records only and ignore unrelated caller graphs', () => {
  const f = fixture();
  f.selected[Symbol.iterator] = function* () {
    throw Error('iterator');
  };
  const state = f.start();
  assert.equal(state.selections.length, 1);
  const huge = new Array(5);
  Object.defineProperty(huge, 0, {
    get() {
      throw Error('must not inspect oversized entry');
    },
  });
  assert.throws(() => resolveCraftSlots(f.recipe, huge, f.input), /integer/);
  const raw = Object.assign(
    clone(lockCraftManifest(state, {manifest: 'p', output: 'o', scrap: 's'}, f.recipe, f.input)),
    {
      ignored: null as unknown,
      toJSON() {
        throw Error('toJSON');
      },
    },
  );
  raw.ignored = raw;
  assert.ok(parseCraftManifest(raw, f.recipe, f.input));
  const bad = clone(f.recipe);
  bad.output.massMg.base = Number.MAX_SAFE_INTEGER;
  assert.throws(() => lockCraftManifest(state, {manifest: 'p', output: 'o', scrap: 's'}, bad, f.input), /mass-balance/);
});

test('crafting: maximum-length manifest IDs round trip when primary uses all mass', () => {
  const f = fixture();
  f.recipe.output.massMg = {base: 1000000, terms: []};
  const manifest = lockCraftManifest(
    f.start(),
    {manifest: 'm'.repeat(256), output: 'unused-scrap', scrap: 'not-published'},
    f.recipe,
    f.input,
  );
  assert.equal(manifest.plan.outputs.length, 1);
  assert.deepEqual(parseCraftManifest(clone(manifest), f.recipe, f.input), manifest);
});
