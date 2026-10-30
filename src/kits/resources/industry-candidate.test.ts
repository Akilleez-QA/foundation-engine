import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createIndustryCandidate,
  prepareIndustryCommand,
  type IndustrialState,
  type IndustryBounds,
  type IndustryCommand,
} from './industry';

function fixture() {
  const bounds: IndustryBounds = {
    stock: {containers: 20, batches: 10, positions: 20, changes: 20, properties: 4},
    deposits: 2,
    plans: 2,
    machines: 2,
    maxStepTicks: 10,
  };
  const feed = {id: 'feed', material: 'ore', unit: 'g', phase: 'solid', massMg: 1000, volumeUl: 100, properties: {}};
  const product = {...feed, id: 'product', material: 'metal'};
  const state: IndustrialState = {
    version: 1,
    stock: {
      version: 1,
      batches: [feed],
      containers: ['input', 'output', 'work', 'installed'].map(id => ({
        id,
        maxMassMg: 100000,
        maxVolumeUl: 100000,
        phases: ['solid'],
      })),
      positions: [{container: 'input', batch: 'feed', quantity: 5}],
    },
    deposits: [{id: 'deposit', body: 'body', region: 'region', batch: 'feed', remaining: 10}],
    plans: [
      {
        id: 'plan',
        inputs: [{batch: 'feed', quantity: 1}],
        outputs: [{batch: product, quantity: 1}],
        workJ: 2,
        maxPowerW: 10,
      },
    ],
    machines: [
      {
        id: 'machine',
        plan: 'plan',
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
  return {state, bounds};
}

test('industry candidate matches standalone transitions across interrupted work, completion, cancel and harvest', () => {
  const {state, bounds} = fixture();
  let standalone = state;
  const candidate = createIndustryCandidate(state, bounds);
  const commands: IndustryCommand[] = [
    {kind: 'step', machine: 'machine', ticks: 1, allocatedPowerW: 3},
    {kind: 'step', machine: 'machine', ticks: 2, allocatedPowerW: 10},
    {kind: 'step', machine: 'machine', ticks: 1, allocatedPowerW: 10},
    {kind: 'cancel', machine: 'machine'},
    {kind: 'harvest', deposit: 'deposit', container: 'input', quantity: 2},
    {kind: 'power', machine: 'machine', enabled: false},
    {kind: 'step', machine: 'machine', ticks: 10, allocatedPowerW: 10},
  ];
  for (const command of commands) {
    const result = prepareIndustryCommand(standalone, command, bounds);
    assert.equal(result.ok, true);
    const {state: next, ...receipt} = result;
    assert.deepEqual(candidate.apply(command), receipt);
    assert.deepEqual(candidate.snapshot(), next);
    standalone = next;
  }
});

test('industry candidate isolates original data, bounds, commands and every returned snapshot', () => {
  const {state, bounds} = fixture();
  const candidate = createIndustryCandidate(state, bounds);
  state.machines[0]!.powered = false;
  state.plans[0]!.workJ = 999;
  bounds.maxStepTicks = 100;
  candidate.snapshot().machines[0]!.powered = false;
  assert.deepEqual(candidate.apply({kind: 'step', machine: 'machine', ticks: 11, allocatedPowerW: 10}), {
    ok: false,
    reason: 'limit',
  });
  const command: IndustryCommand = {kind: 'step', machine: 'machine', ticks: 2, allocatedPowerW: 10};
  const result = candidate.apply(command);
  command.machine = 'mutated';
  assert.equal(result.ok, true);
  assert.equal(candidate.snapshot().machines[0]!.completed, 1);
  assert.equal('state' in result, false);
});

test('industry candidate failure after tentative reservation leaves its accepted private state unchanged', () => {
  const {state, bounds} = fixture();
  state.stock.containers.find(c => c.id === 'output')!.phases = ['gas'];
  const candidate = createIndustryCandidate(state, bounds),
    before = candidate.snapshot();
  assert.deepEqual(candidate.apply({kind: 'step', machine: 'machine', ticks: 2, allocatedPowerW: 10}), {
    ok: false,
    reason: 'phase',
  });
  assert.deepEqual(candidate.snapshot(), before);
  assert.equal(candidate.apply({kind: 'power', machine: 'machine', enabled: false}).ok, true);
});

test('industry candidate bounds attempts and retirement; reentrant command getters cannot overwrite work', () => {
  const {state, bounds} = fixture();
  const limited = createIndustryCandidate(state, bounds, {maxCommands: 1});
  assert.equal(limited.apply({kind: 'power', machine: 'missing', enabled: true}).ok, false);
  assert.deepEqual(limited.apply({kind: 'power', machine: 'machine', enabled: false}), {
    ok: false,
    reason: 'candidate-limit',
  });
  const candidate = createIndustryCandidate(state, bounds);
  const command = {
    kind: 'power',
    get machine() {
      assert.deepEqual(candidate.apply({kind: 'power', machine: 'machine', enabled: false}), {
        ok: false,
        reason: 'busy',
      });
      candidate.dispose();
      return 'machine';
    },
    enabled: false,
  } as IndustryCommand;
  assert.deepEqual(candidate.apply(command), {ok: false, reason: 'retired'});
  assert.throws(() => candidate.snapshot(), /retired/);
  assert.deepEqual(candidate.apply({kind: 'power', machine: 'machine', enabled: false}), {
    ok: false,
    reason: 'retired',
  });
});

test('industry candidate construction retains final-state validation and cannot spend bill for an invalid plan', () => {
  const {state, bounds} = fixture(),
    candidate = createIndustryCandidate(state, bounds),
    before = candidate.snapshot();
  const ids = ['next-in', 'next-out', 'next-work', 'next-installed'];
  const result = candidate.apply({
    kind: 'construct',
    machine: {id: 'next', plan: 'unknown', input: ids[0]!, output: ids[1]!, work: ids[2]!, installed: ids[3]!},
    containers: ids.map(id => ({id, maxMassMg: 100000, maxVolumeUl: 100000, phases: ['solid']})),
    bill: [{container: 'input', batch: 'feed', quantity: 1}],
  });
  assert.deepEqual(result, {ok: false, reason: 'unknown-plan'});
  assert.deepEqual(candidate.snapshot(), before);
});

test('industry command admission ignores arbitrary extras and captures only bounded schema arrays', () => {
  const {state, bounds} = fixture(),
    candidate = createIndustryCandidate(state, bounds);
  const extra: Record<string, unknown> = {};
  extra.self = extra;
  Object.defineProperty(extra, 'explosive', {
    enumerable: true,
    get() {
      throw Error('must not traverse extras');
    },
  });
  const command = {kind: 'power', machine: 'machine', enabled: false, extra} as IndustryCommand;
  Object.defineProperty(command, 'unrelated', {
    enumerable: true,
    get() {
      throw Error('must not read unknown fields');
    },
  });
  assert.equal(candidate.apply(command).ok, true);
  const machine = {
    id: 'next',
    plan: 'plan',
    input: 'next-in',
    output: 'next-out',
    work: 'next-work',
    installed: 'next-installed',
  };
  const containers = ['next-in', 'next-out', 'next-work', 'next-installed'].map(id => ({
    id,
    maxMassMg: 100000,
    maxVolumeUl: 100000,
    phases: ['solid'],
  }));
  const bill = [{container: 'input', batch: 'feed', quantity: 1}];
  const before = candidate.snapshot();
  const hugeBill = new Array(bounds.stock.changes + 1);
  Object.defineProperty(hugeBill, '0', {
    get() {
      throw Error('must reject length before entries');
    },
  });
  assert.deepEqual(candidate.apply({kind: 'construct', machine, containers, bill: hugeBill}), {
    ok: false,
    reason: 'limit',
  });
  const hugePhases = new Array(bounds.stock.changes + 1);
  Object.defineProperty(hugePhases, '0', {
    get() {
      throw Error('must reject phase length before entries');
    },
  });
  assert.deepEqual(
    candidate.apply({
      kind: 'construct',
      machine,
      containers: [{...containers[0]!, phases: hugePhases}, ...containers.slice(1)],
      bill,
    }),
    {ok: false, reason: 'limit'},
  );
  assert.deepEqual(candidate.snapshot(), before);
  // Custom iterators and unknown fields must never enlarge the admitted input.
  Object.defineProperty(bill, Symbol.iterator, {
    value() {
      throw Error('must use bounded indexed reads');
    },
  });
  Object.defineProperty(containers[0], 'extra', {
    get() {
      throw Error('must ignore container extras');
    },
    enumerable: true,
  });
  assert.equal(candidate.apply({kind: 'construct', machine, containers, bill}).ok, true);
  containers[0]!.phases[0] = 'gas';
  bill[0]!.quantity = 99;
  const after = candidate.snapshot();
  assert.deepEqual(after.stock.containers.find(c => c.id === 'next-in')!.phases, ['solid']);
  assert.equal(after.stock.positions.find(p => p.container === 'next-installed')!.quantity, 1);
});

test('industry command admission reads array length once and remains retired after rejecting getter data', () => {
  const {state, bounds} = fixture(),
    candidate = createIndustryCandidate(state, bounds);
  let lengthReads = 0;
  const bill = new Proxy([], {
    get(target, key, receiver) {
      if (key === 'length') {
        lengthReads++;
        return lengthReads === 1 ? bounds.stock.changes + 1 : 0;
      }
      return Reflect.get(target, key, receiver);
    },
  });
  assert.deepEqual(
    candidate.apply({
      kind: 'construct',
      machine: {id: 'next', plan: 'plan', input: 'a', output: 'b', work: 'c', installed: 'd'},
      containers: [],
      bill,
    }),
    {ok: false, reason: 'limit'},
  );
  assert.equal(lengthReads, 1);
  const command = {
    kind: 'power',
    get machine() {
      candidate.dispose();
      return null;
    },
    enabled: false,
  } as unknown as IndustryCommand;
  assert.deepEqual(candidate.apply(command), {ok: false, reason: 'retired'});
  assert.throws(() => candidate.snapshot(), /retired/);
});
