import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createObjectiveRun } from './index';
const options = { runId: 'run-1', requirements: [{ id: 'collect', event: 'sample', target: 2 }] };
const sample = { runId: 'run-1', eventId: 'e1', event: 'sample', amount: 1 };
test('objectives: duplicates, changed payloads and stale events cannot advance a run', () => {
  const r = createObjectiveRun(options);
  assert.equal(r.record(sample), 'accepted');
  assert.equal(r.record(sample), 'duplicate');
  assert.equal(r.record({ ...sample, amount: 2 }), 'conflict');
  assert.equal(r.record({ ...sample, runId: 'old' }), 'stale');
  assert.equal(r.progress()[0].count, 1);
  assert.equal(r.cancel(), true);
  assert.equal(r.record({ ...sample, eventId: 'e2' }), 'cancelled');
  assert.equal(r.claimReward('a'), null);
  assert.equal(createObjectiveRun(options, r.snapshot()).record({ ...sample, eventId: 'e3' }), 'cancelled');
});
test('objectives: reward retries preserve claim identity and reject obsolete acknowledgement', () => {
  const r = createObjectiveRun(options);
  r.record({ ...sample, amount: Number.MAX_SAFE_INTEGER });
  assert.equal(r.progress()[0].count, 2);
  const first = r.claimReward('attempt-1')!;
  const restored = createObjectiveRun(options, r.snapshot());
  const second = restored.claimReward('attempt-2')!;
  assert.equal(first.claimId, second.claimId);
  assert.equal(restored.acknowledgeReward('attempt-1'), false);
  assert.equal(restored.acknowledgeReward('attempt-2'), true);
  assert.equal(createObjectiveRun(options, restored.snapshot()).claimReward('attempt-3'), null);
});
test('objectives: snapshots are detached, validated against definition and replayed', () => {
  const r = createObjectiveRun(options); r.record(sample);
  const s = r.snapshot(); s.events[0].amount = 10; s.requirements[0].target = 5;
  assert.equal(r.progress()[0].count, 1);
  assert.throws(() => createObjectiveRun(options, s));
  const good = r.snapshot(); good.events.push(sample);
  assert.throws(() => createObjectiveRun(options, good));
  assert.throws(() => r.record({ ...sample, amount: Infinity }));
  assert.throws(() => createObjectiveRun({ ...options, requirements: [{ ...options.requirements[0], target: 0 }] }));
});
