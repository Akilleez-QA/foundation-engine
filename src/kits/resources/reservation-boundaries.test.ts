import test from 'node:test';
import assert from 'node:assert/strict';
import {createInventoryLedger, type InventorySnapshot, type MaterialBatch} from '../inventory/pure';
import {createProduction, type ProductionCommand, type ProductionOptions} from './production';
import {createIndustryCandidate, type IndustrialState, type IndustryBounds, type IndustryCommand} from './industry';

const ore: MaterialBatch = {id: 'ore', material: 'ore', properties: {}},
  reagent: MaterialBatch = {id: 'reagent', material: 'reagent', properties: {}},
  product: MaterialBatch = {id: 'product', material: 'product', properties: {}},
  capacities = {pool: 32, output: 32};
const amount = (batchId: string, quantity: number) => ({container: 'pool', batchId, quantity});
function seeded(reagentQuantity: number) {
  const ledger = createInventoryLedger({capacities});
  assert.equal(
    ledger.transact(
      'seed',
      [],
      [
        {container: 'pool', batch: ore, quantity: 10},
        {container: 'pool', batch: reagent, quantity: reagentQuantity},
      ],
    ).ok,
    true,
  );
  return ledger;
}
function productionOptions(initialInventory: InventorySnapshot): ProductionOptions {
  return {capacities, initialInventory, deposits: [], recipes: [], jobs: []};
}

test('independent reservations sharing ingredient pools survive commit, production admission, cancellation and replay', () => {
  let ledger = seeded(6);
  assert.equal(ledger.reserve('a', [amount('ore', 3), amount('reagent', 1)]).ok, true);
  assert.equal(ledger.reserve('b', [amount('ore', 4), amount('reagent', 2)]).ok, true);
  const outputs = [{container: 'output', batch: product, quantity: 4}];
  assert.deepEqual(ledger.commitReservation('commit-a', 'a', outputs), {ok: true, duplicate: false});
  assert.equal(ledger.quantity('pool', 'ore'), 7);
  assert.equal(ledger.quantity('pool', 'reagent'), 5);
  assert.equal(ledger.available('pool', 'ore'), 3, 'only reservation a was consumed');
  assert.equal(ledger.available('pool', 'reagent'), 3, 'reservation b still owns both ingredients');

  ledger = createInventoryLedger({capacities}, ledger.snapshot());
  const production = createProduction(productionOptions(ledger.snapshot())),
    before = production.snapshot();
  assert.deepEqual(
    production.apply({kind: 'exchange', id: 'competing-use', consume: [amount('ore', 4)], produce: []}, 0),
    {ok: false, reason: 'insufficient'},
  );
  assert.deepEqual(production.snapshot(), before, 'adopting stock into production preserves outstanding custody');

  assert.deepEqual(ledger.release('cancel-b', 'b'), {ok: true, duplicate: false});
  assert.equal(ledger.available('pool', 'ore'), 7);
  assert.equal(ledger.available('pool', 'reagent'), 5);
  assert.equal(ledger.quantity('output', 'product'), 4);
  assert.equal(
    ledger.quantity('pool', 'ore') + ledger.quantity('pool', 'reagent') + ledger.quantity('output', 'product'),
    16,
  );
  const settled = ledger.snapshot();
  ledger = createInventoryLedger({capacities}, settled);
  assert.deepEqual(ledger.commitReservation('commit-a', 'a', outputs), {ok: true, duplicate: true});
  assert.deepEqual(ledger.release('cancel-b', 'b'), {ok: true, duplicate: true});
  assert.deepEqual(ledger.commitReservation('late-b', 'b', outputs), {ok: false, reason: 'reservation'});
  assert.deepEqual(ledger.snapshot(), settled, 'retries neither consume again nor resurrect cancelled custody');
});

test('a final ingredient shortage preserves earlier inputs and unrelated reservations through production retry', () => {
  const ledger = seeded(1);
  assert.equal(ledger.reserve('other-job', [amount('ore', 4)]).ok, true);
  const options = productionOptions(ledger.snapshot());
  let production = createProduction(options);
  const exchange: ProductionCommand = {
    kind: 'exchange',
    id: 'assemble',
    consume: [amount('ore', 3), amount('reagent', 2)],
    produce: [{container: 'output', batch: product, quantity: 5}],
  };
  const before = production.snapshot();
  assert.deepEqual(production.apply(exchange, 0), {ok: false, reason: 'insufficient'});
  assert.deepEqual(production.snapshot(), before, 'the final missing ingredient cannot consume the earlier one');
  assert.equal(
    production.apply(
      {
        kind: 'exchange',
        id: 'supply-reagent',
        consume: [],
        produce: [{container: 'pool', batch: reagent, quantity: 1}],
      },
      0,
    ).ok,
    true,
  );
  assert.equal(production.apply(exchange, 0).ok, true, 'refusal does not consume the command identity');
  assert.equal(production.quantity('pool', 'ore'), 7);
  assert.equal(production.quantity('pool', 'reagent'), 0);
  assert.equal(production.quantity('output', 'product'), 5);
  const settled = production.snapshot();
  production = createProduction(options, settled);
  const duplicate = production.apply(exchange, 0);
  assert.ok(duplicate.ok && duplicate.duplicate);
  assert.deepEqual(production.snapshot(), settled);
  assert.deepEqual(
    production.apply({kind: 'exchange', id: 'steal-held-stock', consume: [amount('ore', 4)], produce: []}, 0),
    {ok: false, reason: 'insufficient'},
  );
  assert.deepEqual(production.snapshot(), settled, 'successful retry did not spend the other job reservation');
});

function industryFixture(): {state: IndustrialState; bounds: IndustryBounds} {
  const batch = (id: string) => ({
    id,
    material: id,
    unit: 'unit',
    phase: 'solid',
    massMg: 1,
    volumeUl: 1,
    properties: {},
  });
  const machine = (id: string) => ({
    id,
    plan: 'combine',
    input: `${id}/input`,
    output: `${id}/output`,
    work: `${id}/work`,
    installed: `${id}/installed`,
    powered: true,
    active: false,
    progressJ: 0,
    completed: 0,
    energyRemainder: 0,
  });
  const machines = [machine('a'), machine('b')];
  return {
    bounds: {
      stock: {containers: 12, batches: 4, positions: 16, changes: 16, properties: 2},
      deposits: 1,
      plans: 1,
      machines: 2,
      maxStepTicks: 10,
    },
    state: {
      version: 1,
      stock: {
        version: 1,
        batches: [batch('ore'), batch('reagent')],
        containers: ['pool', ...machines.flatMap(m => [m.input, m.output, m.work, m.installed])].map(id => ({
          id,
          maxMassMg: 32,
          maxVolumeUl: 32,
          phases: ['solid'],
        })),
        positions: [
          {container: 'pool', batch: 'ore', quantity: 10},
          {container: 'pool', batch: 'reagent', quantity: 4},
        ],
      },
      deposits: [],
      plans: [
        {
          id: 'combine',
          inputs: [
            {batch: 'ore', quantity: 3},
            {batch: 'reagent', quantity: 1},
          ],
          outputs: [{batch: batch('product'), quantity: 4}],
          workJ: 4,
          maxPowerW: 10,
        },
      ],
      machines,
    },
  };
}

test('two industry jobs keep independent custody from a common stock pool across shortage, completion and cancellation', () => {
  const {state, bounds} = industryFixture(),
    original = structuredClone(state);
  let candidate = createIndustryCandidate(state, bounds);
  const apply = (command: IndustryCommand) => {
    const result = candidate.apply(command);
    assert.ok(result.ok, JSON.stringify(result));
    const snapshot = candidate.snapshot();
    assert.equal(
      snapshot.stock.positions.reduce(
        (sum, p) => sum + p.quantity * snapshot.stock.batches.find(b => b.id === p.batch)!.massMg,
        0,
      ),
      14,
    );
    return result;
  };
  const supply = (to: string, batch: string, quantity: number): IndustryCommand => ({
    kind: 'transfer',
    from: 'pool',
    to,
    batch,
    quantity,
  });
  apply(supply('a/input', 'ore', 3));
  apply(supply('a/input', 'reagent', 1));
  apply(supply('b/input', 'ore', 3));
  apply({kind: 'step', machine: 'a', ticks: 1, allocatedPowerW: 10});
  const held = candidate.snapshot(),
    blocked = apply({kind: 'step', machine: 'b', ticks: 1, allocatedPowerW: 10});
  assert.equal(blocked.blocked, 'input');
  assert.deepEqual(candidate.snapshot(), held, 'missing final ingredient cannot disturb either job custody');
  apply(supply('b/input', 'reagent', 1));
  apply({kind: 'step', machine: 'b', ticks: 1, allocatedPowerW: 10});
  const bothHeld = candidate.snapshot();
  candidate.dispose();
  candidate = createIndustryCandidate(JSON.parse(JSON.stringify(bothHeld)), bounds);
  assert.equal(apply({kind: 'step', machine: 'a', ticks: 3, allocatedPowerW: 10}).completed, true);
  const completed = candidate.snapshot(),
    quantity = (s: IndustrialState, container: string, batch: string) =>
      s.stock.positions.find(p => p.container === container && p.batch === batch)?.quantity ?? 0;
  assert.equal(quantity(completed, 'a/output', 'product'), 4);
  assert.equal(quantity(completed, 'b/work', 'ore'), 3);
  assert.equal(quantity(completed, 'b/work', 'reagent'), 1);
  assert.deepEqual(completed.machines[1], bothHeld.machines[1], 'completing a cannot advance or retire b');
  apply({kind: 'cancel', machine: 'b'});
  const settled = candidate.snapshot();
  assert.equal(quantity(settled, 'b/input', 'ore'), 3);
  assert.equal(quantity(settled, 'b/input', 'reagent'), 1);
  assert.equal(quantity(settled, 'b/output', 'product'), 0);
  assert.equal(quantity(settled, 'b/work', 'ore'), 0);
  assert.equal(quantity(settled, 'b/work', 'reagent'), 0);
  assert.equal(settled.machines[0]!.completed, 1);
  assert.equal(settled.machines[1]!.completed, 0);
  apply({kind: 'cancel', machine: 'b'});
  assert.deepEqual(candidate.snapshot(), settled);
  assert.deepEqual(state, original, 'candidate work never publishes into its source snapshot');
  candidate.dispose();
});
