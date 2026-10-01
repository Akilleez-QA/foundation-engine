import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSurveyAdapter } from './survey.mjs';
const state = () => ({
  view: {
    clock: 0,
    spawns: [
      {
        id: 'field',
        incarnation: 0,
        deposit: {
          id: 'field',
          revision: 0,
          seed: 1,
          cellSize: 1,
          expiresTick: 100,
          reserve: 8,
          batch: {
            id: 'input-a',
            material: 'input',
            properties: { grade: 400 },
          },
        },
      },
    ],
  },
  retired: false,
  blocked: null,
});
test('survey samples bounded batches and completes exactly64 observations without harvest', () => {
  const runtime = state(),
    before = structuredClone(runtime),
    owner = createSurveyAdapter({ readRuntime: () => runtime });
  assert.equal(owner.start('field').status, 'started');
  for (let i = 0; i < 8; i++) {
    const result = owner.step();
    assert.equal(result.sampled, 8);
    assert.equal(result.status, i === 7 ? 'complete' : 'pending');
  }
  assert.equal(owner.read().points.length, 64);
  assert.equal(owner.step().sampled, 0);
  assert.deepEqual(runtime, before);
});
test('replacement, expiry, cancellation and retirement revoke retained callbacks', () => {
  for (const mode of ['replacement', 'expiry', 'cancel', 'retire']) {
    const runtime = state(),
      owner = createSurveyAdapter({ readRuntime: () => runtime });
    owner.start('field');
    const retained = owner.capture();
    if (mode === 'replacement') runtime.view.spawns[0].incarnation++;
    if (mode === 'expiry') runtime.view.clock = 100;
    if (mode === 'cancel') owner.cancel();
    if (mode === 'retire') owner.dispose();
    assert.ok(['stale', 'retired'].includes(retained().status));
    assert.equal(owner.read().points.length, 0);
  }
});
test('same incarnation changed facts reject; late callback cannot progress replacement survey', () => {
  const runtime = state(),
    owner = createSurveyAdapter({ readRuntime: () => runtime });
  owner.start('field');
  const old = owner.capture();
  runtime.view.spawns[0].deposit.seed++;
  assert.equal(old().status, 'stale');
  owner.start('field');
  assert.equal(old().status, 'stale');
  assert.equal(owner.step().sampled, 8);
});
test('retirement during current snapshot read cannot publish', () => {
  const runtime = state();
  let retire = false,
    owner;
  owner = createSurveyAdapter({
    readRuntime: () => {
      if (retire) owner.dispose();
      return runtime;
    },
  });
  owner.start('field');
  const callback = owner.capture();
  retire = true;
  assert.equal(callback().status, 'stale');
  assert.equal(owner.read().status, 'retired');
});
