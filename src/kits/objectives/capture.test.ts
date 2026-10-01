import test from 'node:test';
import assert from 'node:assert/strict';
import { createObjectiveRun } from './run';
import { createStagedObjectives, type StagedDefinition } from './stages';

const requirements = [{ id: 'count', event: 'accepted', target: 2 }];
const options = { runId: 'run', requirements, maxEvents: 2 };
const definition: StagedDefinition = { id: 'definition', revision: 0, start: 'a', stages: [{ id: 'a', requirements, choices: [{ id: 'finish', to: null }] }] };
function forged<T>(rows: T[], length: unknown): T[] {
  return new Proxy(rows, { get(target, key, receiver) { return key === 'length' ? length : Reflect.get(target, key, receiver); } });
}

test('objective capture ignores overridden array methods and reads event fields once', () => {
  const supplied = [...requirements];
  Object.defineProperty(supplied, 'map', { value() { throw Error('caller map'); } });
  const run = createObjectiveRun({ ...options, requirements: supplied });
  let reads = 0;
  assert.equal(run.record({ runId: 'run', eventId: 'one', event: 'accepted', get amount() { reads++; return reads === 1 ? 1 : 999; } }), 'accepted');
  assert.equal(reads, 1); assert.equal(run.progress()[0]!.count, 1);
  const saved = run.snapshot();
  Object.defineProperty(saved.events, Symbol.iterator, { value() { throw Error('caller iterator'); } });
  assert.deepEqual(createObjectiveRun(options, saved).snapshot(), run.snapshot());
});

test('objective event getters cannot mutate the run during admission', () => {
  const run = createObjectiveRun(options), before = run.snapshot();
  assert.throws(() => run.record({ runId: 'run', eventId: 'one', event: 'accepted', get amount() { run.cancel(); return 1; } }), /reentrant/);
  assert.deepEqual(run.snapshot(), before);
  assert.equal(run.record({ runId: 'run', eventId: 'one', event: 'accepted', amount: 1 }), 'accepted');
});

test('objective restore rejects forged bounded lengths before coercion or element reads', () => {
  const saved = createObjectiveRun(options).snapshot(); let coercions = 0;
  const length = { valueOf() { coercions++; return 0; } };
  assert.throws(() => createObjectiveRun(options, { ...saved, events: forged([], length) }), /bound/);
  assert.equal(coercions, 0);
  for (const bad of [-1, 0.5, NaN, Infinity, '0', 3]) {
    assert.throws(() => createObjectiveRun(options, { ...saved, events: forged([], bad) }), /bound/);
  }
});

test('staged definitions and both restore histories reject nonprimitive lengths', () => {
  let coercions = 0;
  const length = { valueOf() { coercions++; return 1; } };
  assert.throws(() => createStagedObjectives({ runId: 'run', definition: { ...definition, stages: forged([...definition.stages], length) } }), /bound/);
  const opts = { runId: 'run', definition };
  const saved = createStagedObjectives(opts).snapshot();
  assert.throws(() => createStagedObjectives(opts, { ...saved, history: forged([], length) }), /bound/);
  assert.throws(() => createStagedObjectives(opts, { ...saved, objective: { ...saved.objective, events: forged([], length) } }), /bound/);
  assert.equal(coercions, 0);
});
