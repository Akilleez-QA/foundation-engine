import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createStagedObjectives, type StagedDefinition} from './stages';
import {createProduction, type ProductionOptions} from '../resources';

const definition: StagedDefinition = {
  id: 'process',
  revision: 1,
  start: 'first',
  stages: [
    {
      id: 'first',
      requirements: [{id: 'made', event: 'produced', target: 2}],
      choices: [
        {id: 'continue', to: 'second'},
        {id: 'finish', to: null},
      ],
    },
    {id: 'second', requirements: [{id: 'made', event: 'produced', target: 1}], choices: [{id: 'finish', to: null}]},
  ],
};
const options = {definition, runId: 'run-1', maxEventsPerStage: 2};
const event = (model: ReturnType<typeof createStagedObjectives>, eventId = 'e', amount = 2) => ({
  ...model.ticket(),
  eventId,
  event: 'produced',
  amount,
});

test('stages: explicit branch, duplicate transition, stale stage and restored completion', () => {
  let model = createStagedObjectives(options);
  const early = {...model.ticket(), id: 'move', choice: 'continue'};
  assert.equal(model.transition(early), 'incomplete');
  const e = event(model);
  assert.equal(model.record(e), 'accepted');
  assert.equal(model.record(e), 'duplicate');
  assert.equal(model.record({...e, amount: 1}), 'conflict');
  assert.equal(model.view().stage, 'first');
  assert.equal(model.transition({...early, choice: 'missing'}), 'unavailable');
  assert.equal(model.transition(early), 'accepted');
  assert.equal(model.transition(early), 'duplicate');
  assert.equal(model.transition({...early, choice: 'finish'}), 'conflict');
  const before = model.snapshot();
  assert.equal(model.record(e), 'stale');
  assert.deepEqual(model.snapshot(), before);
  model = createStagedObjectives(options, before);
  assert.equal(model.record(event(model, 'new', 1)), 'accepted');
  assert.equal(model.transition({...model.ticket(), id: 'end', choice: 'finish'}), 'accepted');
  assert.equal(createStagedObjectives(options, model.snapshot()).view().status, 'complete');
  assert.equal(model.cancel(), false);
});

test('stages: cancellation, bounds, detached inputs and invalid restore', () => {
  const input = structuredClone(options),
    model = createStagedObjectives(input);
  input.definition.stages[0]!.requirements[0]!.target = 999;
  model.record(event(model, 'partial', 1));
  assert.equal(model.view().progress[0]!.target, 2);
  assert.equal(model.cancel(), true);
  assert.equal(model.cancel(), false);
  assert.equal(model.record(event(model)), 'cancelled');
  assert.equal(createStagedObjectives(options, model.snapshot()).view().status, 'cancelled');
  const full = createStagedObjectives({...options, maxEventsPerStage: 1});
  full.record(event(full, 'one', 1));
  const before = full.snapshot();
  assert.equal(full.record(event(full, 'two', 1)), 'saturated');
  assert.deepEqual(full.snapshot(), before);
  assert.throws(() => createStagedObjectives(options, null));
  assert.throws(() => createStagedObjectives({...options, definition: {...definition, revision: 2}}, before));
  assert.throws(() =>
    createStagedObjectives({
      ...options,
      definition: {...definition, stages: [{...definition.stages[0]!, choices: [{id: 'cycle', to: 'first'}]}]},
    }),
  );
  const detached = model.snapshot();
  detached.definition.stages[0]!.requirements[0]!.target = 90;
  assert.equal(model.view().progress[0]!.target, 2);
  const forged = structuredClone(before);
  forged.cancelled = true;
  assert.throws(() => createStagedObjectives(options, forged));
});

test('stages: bounded production receipts compose in one reloadable envelope', () => {
  const productionOptions: ProductionOptions = {
    capacities: {input: 10, output: 10},
    deposits: [],
    recipes: [
      {
        id: 'part',
        inputs: [{batchId: 'raw', quantity: 1}],
        output: {batch: {id: 'part', material: 'part', properties: {}}, quantity: 1},
      },
    ],
    jobs: [
      {
        id: 'factory',
        kind: 'factory',
        recipeId: 'part',
        inputContainer: 'input',
        outputContainer: 'output',
        limit: 3,
        startTick: 0,
        periodTicks: 1,
        powered: true,
      },
    ],
    initialInventory: {
      version: 1,
      capacities: {input: 10, output: 10},
      operations: [
        {
          kind: 'exchange',
          id: 'stock',
          consume: [],
          produce: [{container: 'input', batch: {id: 'raw', material: 'raw', properties: {}}, quantity: 3}],
        },
      ],
    },
  };
  let production = createProduction(productionOptions),
    stages = createStagedObjectives(options);
  const firstTicket = stages.ticket();
  const command = {kind: 'advance' as const, id: 'cycle-1', jobId: 'factory', toTick: 1, maxTicks: 1, maxCycles: 1};
  const receipt = production.apply(command, production.epoch);
  assert.equal(receipt.ok, true);
  if (!receipt.ok) throw Error('expected production');
  const acceptedFact = {...firstTicket, eventId: command.id, event: 'produced', amount: receipt.produced};
  assert.equal(stages.record(acceptedFact), 'accepted');
  const envelope = {production: production.snapshot(), stages: stages.snapshot()};
  production = createProduction(productionOptions, envelope.production);
  stages = createStagedObjectives(options, envelope.stages);
  assert.equal(stages.view().progress[0]!.count, 1);
  const repeated = production.apply(command, production.epoch);
  assert.equal(repeated.ok && repeated.duplicate, true);
  assert.equal(stages.record(acceptedFact), 'duplicate');
  const next = production.apply({...command, id: 'cycle-2', toTick: 2}, production.epoch);
  assert.equal(next.ok, true);
  assert.equal(stages.record({...acceptedFact, eventId: 'cycle-2'}), 'accepted');
  assert.equal(stages.transition({...firstTicket, id: 'next', choice: 'continue'}), 'accepted');
  assert.equal(stages.record(acceptedFact), 'stale');
  const stock = production.snapshot();
  stages.cancel();
  assert.deepEqual(production.snapshot(), stock, 'cancellation has no implicit inventory effects');
  assert.equal(production.quantity('output', 'part'), 2);
  assert.equal(createStagedObjectives(options, stages.snapshot()).view().status, 'cancelled');
});

test('stages: restore rejects skipped predecessors, altered completion and reward claims', () => {
  const run = createStagedObjectives(options);
  run.record(event(run));
  run.transition({...run.ticket(), id: 'next', choice: 'continue'});
  const saved = run.snapshot();
  const skipped = structuredClone(saved);
  skipped.history = [];
  assert.throws(() => createStagedObjectives(options, skipped));
  const incomplete = structuredClone(saved);
  incomplete.history[0]!.objective.events = [];
  assert.throws(() => createStagedObjectives(options, incomplete));
  const reward = structuredClone(saved);
  reward.history[0]!.objective.reward = {attemptId: 'unpaid', acknowledged: false};
  assert.throws(() => createStagedObjectives(options, reward));
  assert.throws(() => createStagedObjectives(options, {...saved, objective: undefined}));
  const missing = structuredClone(saved);
  missing.objective.runId = 'other';
  assert.throws(() => createStagedObjectives(options, missing));
  const ready = createStagedObjectives(options);
  ready.record(event(ready));
  ready.cancel();
  assert.equal(createStagedObjectives(options, ready.snapshot()).view().status, 'cancelled');
});

test('stages: admission rejects excessive definitions and ignores caller array methods', () => {
  const modified = structuredClone(definition);
  (modified.stages as ObjectiveStageArray).map = () => [];
  assert.equal(createStagedObjectives({...options, definition: modified}).view().stage, 'first');
  assert.throws(() =>
    createStagedObjectives({...options, definition: {...definition, stages: Array(65).fill(definition.stages[0])}}),
  );
  assert.throws(() => createStagedObjectives({...options, maxEventsPerStage: 4097}));
});
type ObjectiveStageArray = StagedDefinition['stages'] & {map: () => never[]};

test('stages: accepted bounded identity does not expand beyond nested objective bounds', () => {
  const run = createStagedObjectives({...options, runId: '\\'.repeat(96)});
  assert.equal(run.record(event(run)), 'accepted');
  assert.equal(createStagedObjectives({...options, runId: '\\'.repeat(96)}, run.snapshot()).view().ready, true);
});

test('stages: mutation guards precede getters and release after rejection', () => {
  const run = createStagedObjectives(options),
    before = run.snapshot();
  const maliciousEvent = {
    ...event(run),
    get eventId() {
      run.cancel();
      return 'bad';
    },
  };
  assert.throws(() => run.record(maliciousEvent), /reentrant/);
  assert.deepEqual(run.snapshot(), before);
  assert.equal(run.record(event(run)), 'accepted');
  const ready = run.snapshot();
  const maliciousTransition = {
    ...run.ticket(),
    id: 'next',
    get choice() {
      run.record(event(run));
      return 'continue';
    },
  };
  assert.throws(() => run.transition(maliciousTransition), /reentrant/);
  assert.deepEqual(run.snapshot(), ready);
  assert.equal(run.transition({...run.ticket(), id: 'next', choice: 'continue'}), 'accepted');
});

test('stages: restore captures bounded indexed history, ignoring forged iterators', () => {
  const run = createStagedObjectives({...options, maxEventsPerStage: 1});
  const saved = run.snapshot();
  Object.defineProperty(saved.objective.events, Symbol.iterator, {
    value: function* () {
      yield {runId: saved.objective.runId, eventId: 'one', event: 'produced', amount: 1};
      yield {runId: saved.objective.runId, eventId: 'two', event: 'produced', amount: 1};
    },
  });
  const restored = createStagedObjectives({...options, maxEventsPerStage: 1}, saved);
  assert.equal(restored.view().progress[0]!.count, 0);
  assert.equal(restored.snapshot().objective.events.length, 0);
  const tooMany = run.snapshot();
  tooMany.objective.events = [
    {runId: tooMany.objective.runId, eventId: 'one', event: 'produced', amount: 1},
    {runId: tooMany.objective.runId, eventId: 'two', event: 'produced', amount: 1},
  ];
  assert.throws(() => createStagedObjectives({...options, maxEventsPerStage: 1}, tooMany), /bound/);
});

test('stages: definition destination getter is captured exactly once', () => {
  let reads = 0;
  const configured = {
    ...definition,
    stages: [
      {
        ...definition.stages[0]!,
        choices: [
          {
            id: 'finish',
            get to(): string | null {
              reads++;
              return reads === 1 ? null : 'missing';
            },
          },
        ],
      },
    ],
  };
  const run = createStagedObjectives({...options, definition: configured});
  assert.equal(reads, 1);
  run.record(event(run));
  assert.equal(run.transition({...run.ticket(), id: 'finish', choice: 'finish'}), 'accepted');
});

test('stages: snapshot top-level and historical objective getters are captured once', () => {
  const run = createStagedObjectives(options),
    fresh = run.snapshot();
  let historyReads = 0,
    objectiveReads = 0;
  const changing = {
    ...fresh,
    get history() {
      historyReads++;
      return historyReads === 1 ? [] : Array(100).fill(null);
    },
    get objective() {
      objectiveReads++;
      return objectiveReads === 1 ? fresh.objective : null;
    },
  };
  assert.equal(createStagedObjectives(options, changing).view().stage, 'first');
  assert.equal(historyReads, 1);
  assert.equal(objectiveReads, 1);
  run.record(event(run));
  run.transition({...run.ticket(), id: 'next', choice: 'continue'});
  const progressed = run.snapshot(),
    original = progressed.history[0]!;
  let nestedReads = 0;
  Object.defineProperty(original, 'objective', {
    get() {
      nestedReads++;
      return nestedReads === 1 ? freshCompleted : null;
    },
  });
  const completedRun = createStagedObjectives(options);
  completedRun.record(event(completedRun));
  const freshCompleted = completedRun.snapshot().objective;
  assert.equal(createStagedObjectives(options, progressed).view().stage, 'second');
  assert.equal(nestedReads, 1);
});
