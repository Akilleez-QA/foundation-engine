import test from 'node:test';
import assert from 'node:assert/strict';
import {activeRestartPlan, restartActiveWindow, sampleAttempts} from './active-restart.mjs';

const row = {id: 'play', scene: 'scene.play', active: true};
const plan = {when: '.ended', key: 'Space', timeoutMs: 30000};

test('active restart is explicit, bounded and rejected for non-active or malformed rows', () => {
  assert.equal(activeRestartPlan(row), null);
  assert.deepEqual(activeRestartPlan({...row, activeRestart: plan}), plan);
  for (const activeRestart of [
    null,
    [],
    {},
    {...plan, when: ''},
    {...plan, key: ''},
    {...plan, timeoutMs: 0},
    {...plan, timeoutMs: 30001},
    {...plan, timeoutMs: 1.5},
    {...plan, script: 'mutate()'},
  ]) {
    assert.throws(() => activeRestartPlan({...row, activeRestart}), /activeRestart needs/);
  }
  assert.throws(() => activeRestartPlan({...row, active: false, activeRestart: plan}), /requires active/);
});

function fixture({detachError, markerError} = {}) {
  const calls = [],
    old = {
      isConnected: true,
      async dispose() {
        calls.push('release handle');
      },
    };
  let time = 0;
  const marker = {
    first() {
      return this;
    },
    async waitFor(o) {
      calls.push(['marker', o]);
      if (markerError) throw markerError;
      time = 20;
    },
    async elementHandle() {
      return old;
    },
  };
  const page = {
    locator(selector) {
      if (selector.includes('data-scene-state'))
        return {
          async waitFor(o) {
            calls.push(['active', o]);
            time = 40;
          },
        };
      return {
        locator(selector) {
          assert.equal(selector, plan.when);
          return marker;
        },
        async press(key, options) {
          calls.push(['key', key, options]);
          time = 25;
        },
      };
    },
    async waitForFunction(fn, element, o) {
      calls.push(['retirement', o]);
      assert.equal(element, old);
      assert.equal(fn(old), false);
      if (detachError) throw detachError;
      old.isConnected = false;
      assert.equal(fn(old), true);
      time = 30;
    },
  };
  return {page, calls, now: () => time};
}

test('native restart waits for an ended marker, old-visit retirement and new active scene under one deadline', async () => {
  const f = fixture();
  const result = await restartActiveWindow(f.page, row, plan, {now: f.now});
  assert.deepEqual(f.calls, [
    ['marker', {state: 'visible', timeout: 30000}],
    ['key', 'Space', {timeout: 29980}],
    ['retirement', {timeout: 29975}],
    ['active', {state: 'attached', timeout: 29970}],
    'release handle',
  ]);
  assert.deepEqual(result, {key: 'Space', when: '.ended', elapsedMs: 40, retiredMarker: true});
});

test('missing ended state or failed retirement cannot be mistaken for an already-active old scene', async () => {
  const missing = fixture({markerError: Error('not ended')});
  await assert.rejects(restartActiveWindow(missing.page, row, plan, {now: missing.now}), /not ended/);
  assert.equal(missing.calls.length, 1, 'no speculative restart key');
  const stale = fixture({detachError: Error('old visit retained')});
  await assert.rejects(restartActiveWindow(stale.page, row, plan, {now: stale.now}), /old visit retained/);
  assert.equal(
    stale.calls.some(c => Array.isArray(c) && c[0] === 'active'),
    false,
  );
  assert.equal(stale.calls.at(-1), 'release handle');
});

test('every active retry prepares again outside measurement; count breaches still leave sampling immediately', async () => {
  const calls = [];
  let attempt = 0;
  const result = await sampleAttempts({
    resample: 3,
    prepare: async () => {
      calls.push('prepare');
      return {visit: ++attempt};
    },
    measure: async () => {
      calls.push('measure');
      return {
        draws: 99,
        classification: {kind: attempt === 1 ? 'inconclusive' : 'steady', comparable: attempt !== 1, reasons: ['test']},
      };
    },
  });
  assert.deepEqual(calls, ['prepare', 'measure', 'prepare', 'measure']);
  assert.equal(result.draws, 99, 'measurement is never capped or exempted');
  assert.deepEqual(result.preparations, [{visit: 1}, {visit: 2}]);
  assert.equal(result.resampled, 1);
  let measured = false;
  await assert.rejects(
    sampleAttempts({
      resample: 3,
      prepare: async () => {
        throw Error('cannot restart');
      },
      measure: async () => {
        measured = true;
      },
    }),
    /cannot restart/,
  );
  assert.equal(measured, false);
});

test('rows without preparation retain the existing bounded retry behavior', async () => {
  let calls = 0;
  const result = await sampleAttempts({
    resample: 3,
    measure: async () => {
      calls++;
      return {classification: {kind: 'inconclusive', comparable: false, reasons: ['no frames']}};
    },
  });
  assert.equal(calls, 4);
  assert.equal(result.resampled, 3);
  assert.equal(result.preparations, undefined);
  assert.equal(result.classification.comparable, false);
});
