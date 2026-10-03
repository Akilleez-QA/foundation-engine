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

// A page with only the APIs the restart may use: evaluate and keyboard. Locators, element handles and waitForFunction
// would inject Playwright's selector engine into the measured page heap; this fake has none of them, so using one fails.
function fixture({markerAfter = 0, retireAfter = 0, activeAfter = 0, neverMarker = false, neverRetire = false} = {}) {
  const calls = [];
  let time = 0,
    held = false,
    pressed = false,
    polls = {holdMarker: 0, markerRetired: 0, sceneActive: 0};
  const page = {
    async evaluate(fn, arg) {
      assert.deepEqual(arg, {scene: row.scene, when: plan.when, slot: '__benchRestartMarker'});
      calls.push(fn.name);
      if (fn.name === 'holdMarker') {
        if (neverMarker || polls.holdMarker++ < markerAfter) return false;
        held = true;
        return true;
      }
      if (fn.name === 'markerRetired') return held && pressed && !neverRetire && polls.markerRetired++ >= retireAfter;
      if (fn.name === 'sceneActive') return polls.sceneActive++ >= activeAfter;
      if (fn.name === 'releaseMarker') {
        held = false;
        return;
      }
      if (fn.name === 'focusScene') return;
      throw Error(`unexpected page function ${fn.name}`);
    },
    keyboard: {
      async press(key) {
        assert.equal(held, true, 'the key is pressed only after the ended marker is held');
        calls.push(['key', key]);
        pressed = true;
      },
    },
  };
  return {
    page,
    calls,
    now: () => time,
    sleep: async ms => {
      time += ms;
    },
    held: () => held,
  };
}

test('native restart waits for an ended marker, old-visit retirement and new active scene under one deadline', async () => {
  const f = fixture({markerAfter: 2, retireAfter: 1, activeAfter: 1});
  const result = await restartActiveWindow(f.page, row, plan, {now: f.now, sleep: f.sleep});
  assert.deepEqual(f.calls, [
    'holdMarker',
    'holdMarker',
    'holdMarker',
    'focusScene',
    ['key', 'Space'],
    'markerRetired',
    'markerRetired',
    'sceneActive',
    'sceneActive',
    'releaseMarker',
  ]);
  assert.deepEqual(result, {key: 'Space', when: '.ended', elapsedMs: 200, retiredMarker: true});
  assert.equal(f.held(), false, 'the page keeps no reference to the old marker');
});

test('missing ended state or failed retirement cannot be mistaken for an already-active old scene', async () => {
  const missing = fixture({neverMarker: true});
  await assert.rejects(
    restartActiveWindow(missing.page, row, {...plan, timeoutMs: 300}, {now: missing.now, sleep: missing.sleep}),
    /no visible \.ended within 300 ms/,
  );
  assert.equal(
    missing.calls.some(c => Array.isArray(c) && c[0] === 'key'),
    false,
    'no speculative restart key',
  );
  const stale = fixture({neverRetire: true});
  await assert.rejects(
    restartActiveWindow(stale.page, row, {...plan, timeoutMs: 300}, {now: stale.now, sleep: stale.sleep}),
    /old visit's marker did not retire/,
  );
  assert.equal(stale.calls.includes('sceneActive'), false);
  assert.equal(stale.calls.at(-1), 'releaseMarker');
  assert.equal(stale.held(), false);
});

test('the page-side checks find a visible marker inside the scene mount and see it detach', async () => {
  const marker = {isConnected: true, getClientRects: () => [{}]};
  const mount = {querySelector: sel => (sel === plan.when ? marker : null)};
  const page = {active: false};
  const stubs = {
    document: {
      querySelector: sel =>
        sel === '#app[data-scene="scene.play"]'
          ? mount
          : sel === '#app[data-scene="scene.play"][data-scene-state="active"]' && page.active
            ? mount
            : null,
    },
    getComputedStyle: () => ({visibility: 'visible'}),
    CSS: {escape: v => v},
    window: globalThis,
  };
  const saved = Object.fromEntries(Object.keys(stubs).map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const [k, v] of Object.entries(stubs))
    Object.defineProperty(globalThis, k, {value: v, configurable: true, writable: true});
  try {
    const calls = [];
    let time = 0;
    const real = {
      async evaluate(fn, arg) {
        calls.push(fn.name);
        return fn(arg);
      },
      keyboard: {
        async press() {
          marker.isConnected = false;
          page.active = true;
        },
      },
    };
    await restartActiveWindow(real, row, plan, {
      now: () => time,
      sleep: async ms => {
        time += ms;
      },
    });
    assert.deepEqual(calls, ['holdMarker', 'focusScene', 'markerRetired', 'sceneActive', 'releaseMarker']);
    assert.equal(globalThis.__benchRestartMarker, undefined);
  } finally {
    for (const [k, d] of Object.entries(saved)) {
      if (d) Object.defineProperty(globalThis, k, d);
      else delete globalThis[k];
    }
  }
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
